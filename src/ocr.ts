import { createWorker, PSM, type Worker } from 'tesseract.js';
import { parseCodeText, type ParsedCode } from './parse';

/** 0〜1 の割合で表した切り抜き範囲 */
export interface CropRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** 写真がカード全体のときの、右下（パック記号・番号のあたり）の初期範囲 */
export const DEFAULT_CROP: CropRect = { x: 0.4, y: 0.88, w: 0.6, h: 0.12 };

type Source = HTMLImageElement | HTMLVideoElement | HTMLCanvasElement;

function sourceSize(s: Source) {
  if (s instanceof HTMLImageElement) return { w: s.naturalWidth, h: s.naturalHeight };
  if (s instanceof HTMLVideoElement) return { w: s.videoWidth, h: s.videoHeight };
  return { w: s.width, h: s.height };
}

let workerPromise: Promise<Worker> | null = null;
let progressCb: ((p: number) => void) | undefined;

function getWorker(onProgress?: (p: number) => void) {
  progressCb = onProgress;
  if (!workerPromise) {
    workerPromise = (async () => {
      // 自前で配信しているファイルを使う（CDN 不要・2回目以降はオフラインでも動く）
      const base = new URL(`${import.meta.env.BASE_URL}tesseract/`, location.href).href;
      const w = await createWorker('eng', 1, {
        workerPath: `${base}worker.min.js`,
        corePath: base,
        langPath: `${base}lang`,
        logger: (m) => {
          if (m.status === 'recognizing text') progressCb?.(m.progress);
        },
      });
      await w.setParameters({
        tessedit_char_whitelist: 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-/? ',
        user_defined_dpi: '300',
      });
      return w;
    })();
    workerPromise.catch(() => (workerPromise = null));
  }
  return workerPromise;
}

/** 文字認識の準備（データの読み込み）を先に始めておく */
export function warmUpOcr() {
  getWorker().catch(() => {});
}

/** 範囲を切り抜いて、文字の高さがほどよくなるよう拡大したグレースケール画像を作る */
function cropGray(src: Source, crop: CropRect, targetHeight: number) {
  const { w: W, h: H } = sourceSize(src);
  const sx = Math.round(crop.x * W), sy = Math.round(crop.y * H);
  const sw = Math.max(1, Math.round(crop.w * W)), sh = Math.max(1, Math.round(crop.h * H));
  const scale = Math.min(6, Math.max(0.5, targetHeight / sh));
  const w = Math.round(sw * scale), h = Math.round(sh * scale);
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d', { willReadFrequently: true })!;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(src, sx, sy, sw, sh, 0, 0, w, h);
  const px = ctx.getImageData(0, 0, w, h).data;
  const gray = new Uint8ClampedArray(w * h);
  for (let i = 0, j = 0; i < px.length; i += 4, j++) {
    // 色付きの背景（文明の色）に強いよう、明るさは RGB の最大値と最小値の中間で取る
    const mx = Math.max(px[i], px[i + 1], px[i + 2]);
    const mn = Math.min(px[i], px[i + 1], px[i + 2]);
    gray[j] = (mx + mn) >> 1;
  }
  return { gray: smooth(gray, w, h), w, h };
}

/** 3x3 の平均でざらつき（ノイズ）を減らす */
function smooth(g: Uint8ClampedArray, w: number, h: number): Uint8ClampedArray {
  const out = new Uint8ClampedArray(g.length);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let s = 0, n = 0;
      for (let dy = -1; dy <= 1; dy++) {
        const yy = y + dy;
        if (yy < 0 || yy >= h) continue;
        for (let dx = -1; dx <= 1; dx++) {
          const xx = x + dx;
          if (xx < 0 || xx >= w) continue;
          s += g[yy * w + xx];
          n++;
        }
      }
      out[y * w + x] = s / n;
    }
  }
  return out;
}

function otsu(gray: Uint8ClampedArray): number {
  const hist = new Array(256).fill(0);
  for (const g of gray) hist[g]++;
  const total = gray.length;
  let sum = 0;
  for (let t = 0; t < 256; t++) sum += t * hist[t];
  let sumB = 0, wB = 0, best = 0, th = 128;
  for (let t = 0; t < 256; t++) {
    wB += hist[t];
    if (!wB) continue;
    const wF = total - wB;
    if (!wF) break;
    sumB += t * hist[t];
    const d = sumB / wB - (sum - sumB) / wF;
    const between = wB * wF * d * d;
    if (between > best) { best = between; th = t; }
  }
  return th;
}

/** 周りの明るさとの差で白黒にする（照明のムラや反射に強い） */
function adaptive(gray: Uint8ClampedArray, w: number, h: number): Uint8ClampedArray {
  const integral = new Float64Array((w + 1) * (h + 1));
  for (let y = 0; y < h; y++) {
    let row = 0;
    for (let x = 0; x < w; x++) {
      row += gray[y * w + x];
      integral[(y + 1) * (w + 1) + x + 1] = integral[y * (w + 1) + x + 1] + row;
    }
  }
  const r = Math.max(8, Math.round(h / 3));
  const out = new Uint8ClampedArray(w * h);
  for (let y = 0; y < h; y++) {
    const y0 = Math.max(0, y - r), y1 = Math.min(h, y + r + 1);
    for (let x = 0; x < w; x++) {
      const x0 = Math.max(0, x - r), x1 = Math.min(w, x + r + 1);
      const s = integral[y1 * (w + 1) + x1] - integral[y0 * (w + 1) + x1] - integral[y1 * (w + 1) + x0] + integral[y0 * (w + 1) + x0];
      const mean = s / ((x1 - x0) * (y1 - y0));
      out[y * w + x] = gray[y * w + x] < mean - 12 ? 0 : 255;
    }
  }
  return out;
}

type Variant = 'gray' | 'otsu' | 'otsu-inv' | 'adaptive' | 'adaptive-inv';

/** 加工した画像を、周りに余白を付けた canvas にする（文字が黒・背景が白になるようにそろえる） */
function render(gray: Uint8ClampedArray, w: number, h: number, v: Variant): HTMLCanvasElement {
  let data: Uint8ClampedArray;
  if (v === 'gray') data = gray;
  else if (v.startsWith('otsu')) {
    const th = otsu(gray);
    data = gray.map((g) => (g > th ? 255 : 0));
  } else data = adaptive(v.endsWith('inv') ? gray.map((g) => 255 - g) : gray, w, h);
  if (v.startsWith('otsu')) {
    let dark = 0;
    for (const d of data) if (!d) dark++;
    const textIsWhite = dark > data.length / 2;
    if (textIsWhite !== (v === 'otsu-inv')) data = data.map((d) => 255 - d);
  }
  const pad = Math.round(h * 0.25);
  const c = document.createElement('canvas');
  c.width = w + pad * 2;
  c.height = h + pad * 2;
  const ctx = c.getContext('2d')!;
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, c.width, c.height);
  const img = ctx.createImageData(w, h);
  for (let i = 0; i < data.length; i++) {
    img.data[i * 4] = img.data[i * 4 + 1] = img.data[i * 4 + 2] = data[i];
    img.data[i * 4 + 3] = 255;
  }
  ctx.putImageData(img, pad, pad);
  return c;
}

export interface OcrResult extends ParsedCode {
  rawText: string;
  preview: string;
}

export interface OcrOptions {
  /** 登録済みのパック記号（読み間違いの補正に使う） */
  knownSets?: string[];
  /** 拡大後の切り抜き範囲の高さ（px） */
  targetHeight?: number;
  /** 速さ優先（カメラの連続読み取り用）なら true */
  quick?: boolean;
  /** この点数以上の結果が出たらそこで打ち切る */
  goodScore?: number;
  onProgress?: (p: number) => void;
}

/**
 * 加工方法と読み取りモードを何通りか試し、一番それらしい結果を返す。
 */
export async function recognizeCode(src: Source, crop: CropRect, opts: OcrOptions = {}): Promise<OcrResult> {
  const { knownSets = [], targetHeight = 220, quick = false, goodScore = 6, onProgress } = opts;
  const worker = await getWorker(onProgress);
  const { gray, w, h } = cropGray(src, crop, targetHeight);
  const plan: [Variant, PSM][] = quick
    ? [['gray', PSM.SINGLE_BLOCK], ['adaptive', PSM.SINGLE_BLOCK]]
    : [
        ['gray', PSM.SINGLE_BLOCK],
        ['adaptive', PSM.SINGLE_BLOCK],
        ['otsu', PSM.SINGLE_BLOCK],
        ['adaptive-inv', PSM.SINGLE_BLOCK],
        ['otsu-inv', PSM.SINGLE_BLOCK],
        ['adaptive', PSM.SPARSE_TEXT],
        ['gray', PSM.SINGLE_LINE],
      ];
  let best: OcrResult | null = null;
  // パック記号と番号は、別々の読み方で取れることがあるので一番良いものを組み合わせる
  let bestSet = { code: '', strength: -1 };
  let bestNo = { no: '', score: -99, rarity: '' };
  for (const [variant, psm] of plan) {
    const canvas = render(gray, w, h, variant);
    await worker.setParameters({ tessedit_pageseg_mode: psm });
    const { data } = await worker.recognize(canvas);
    const parsed = parseCodeText(data.text, knownSets);
    if (!best || parsed.score > best.score) {
      best = { ...parsed, rawText: data.text.replace(/\s+/g, ' ').trim(), preview: canvas.toDataURL('image/png') };
    }
    if (parsed.setCode && parsed.setStrength > bestSet.strength) bestSet = { code: parsed.setCode, strength: parsed.setStrength };
    if (parsed.number && parsed.numberScore > bestNo.score) bestNo = { no: parsed.number, score: parsed.numberScore, rarity: parsed.rarity };
    if (best.score >= goodScore) break;
  }
  const r = best!;
  if (r.score < goodScore) {
    // 1回で全部そろわなかったときは、別々に取れた良い方を組み合わせる
    if (bestSet.strength > r.setStrength) r.setCode = bestSet.code;
    if (bestNo.score > r.numberScore) { r.number = bestNo.no; r.rarity = r.rarity || bestNo.rarity; }
  }
  return r;
}
