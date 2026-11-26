import { createWorker, PSM, type Worker } from 'tesseract.js';
import { parseCodeText, type ParsedCode } from './parse';

/** 0〜1 の割合で表した切り抜き範囲 */
export interface CropRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** カード右下（パック記号・番号のあたり）の初期範囲 */
export const DEFAULT_CROP: CropRect = { x: 0.45, y: 0.88, w: 0.55, h: 0.12 };

let workerPromise: Promise<Worker> | null = null;

function getWorker(onProgress?: (p: number) => void) {
  if (!workerPromise) {
    workerPromise = (async () => {
      // import.meta.env.BASE_URL を基準に、自前で配信しているファイルを使う
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
        tessedit_char_whitelist: 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-/ ',
        tessedit_pageseg_mode: PSM.SINGLE_BLOCK,
      });
      return w;
    })();
    workerPromise.catch(() => (workerPromise = null));
  }
  progressCb = onProgress;
  return workerPromise;
}
let progressCb: ((p: number) => void) | undefined;

/** 指定範囲を切り抜き、拡大・グレースケール・二値化した canvas を作る */
export function preprocess(img: HTMLImageElement, crop: CropRect, invert = false): HTMLCanvasElement {
  const sx = Math.round(crop.x * img.naturalWidth);
  const sy = Math.round(crop.y * img.naturalHeight);
  const sw = Math.max(1, Math.round(crop.w * img.naturalWidth));
  const sh = Math.max(1, Math.round(crop.h * img.naturalHeight));
  // 文字の高さがある程度になるよう拡大（Tesseract は小さすぎる文字に弱い）
  const scale = Math.min(4, Math.max(1, 240 / sh));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(sw * scale);
  canvas.height = Math.round(sh * scale);
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(img, sx, sy, sw, sh, 0, 0, canvas.width, canvas.height);

  const data = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const px = data.data;
  const gray = new Uint8Array(canvas.width * canvas.height);
  const hist = new Array(256).fill(0);
  for (let i = 0, j = 0; i < px.length; i += 4, j++) {
    const g = Math.round(0.299 * px[i] + 0.587 * px[i + 1] + 0.114 * px[i + 2]);
    gray[j] = g;
    hist[g]++;
  }
  // 大津の二値化
  const total = gray.length;
  let sum = 0;
  for (let t = 0; t < 256; t++) sum += t * hist[t];
  let sumB = 0, wB = 0, best = 0, threshold = 128;
  for (let t = 0; t < 256; t++) {
    wB += hist[t];
    if (!wB) continue;
    const wF = total - wB;
    if (!wF) break;
    sumB += t * hist[t];
    const mB = sumB / wB;
    const mF = (sum - sumB) / wF;
    const between = wB * wF * (mB - mF) ** 2;
    if (between > best) {
      best = between;
      threshold = t;
    }
  }
  // 暗い画素が多数派なら背景が暗い（白文字）とみなして反転する
  let dark = 0;
  for (const g of gray) if (g <= threshold) dark++;
  const flip = (dark > total / 2) !== invert;
  for (let i = 0, j = 0; i < px.length; i += 4, j++) {
    let v = gray[j] > threshold ? 255 : 0;
    if (flip) v = 255 - v;
    px[i] = px[i + 1] = px[i + 2] = v;
  }
  ctx.putImageData(data, 0, 0);
  return canvas;
}

export interface OcrResult extends ParsedCode {
  rawText: string;
  preview: string;
}

export async function recognizeCode(
  img: HTMLImageElement,
  crop: CropRect,
  onProgress?: (p: number) => void,
): Promise<OcrResult> {
  const worker = await getWorker(onProgress);
  let lastRaw = '';
  let lastPreview = '';
  // 通常 → 反転 の順に試し、番号が取れたところで終わる
  for (const invert of [false, true]) {
    const canvas = preprocess(img, crop, invert);
    const { data } = await worker.recognize(canvas);
    const parsed = parseCodeText(data.text);
    lastRaw = data.text.trim();
    lastPreview = canvas.toDataURL('image/png');
    if (parsed.number) return { ...parsed, rawText: lastRaw, preview: lastPreview };
  }
  return { ...parseCodeText(lastRaw), rawText: lastRaw, preview: lastPreview };
}
