// カード左上のコストの数字と、枠の色（文明）を読む。
// 判別の候補を絞り込むのではなく、「コストと色が合うカードを上に上げる」ために使う。
import { createWorker, PSM, type Worker } from 'tesseract.js';
import type { Civilization } from './types';

export interface CostCiv {
  /** 読めたコスト（読めなければ null） */
  cost: number | null;
  /** 文明ごとの色の強さ（0〜1、いちばん強い文明が1） */
  civ: Record<Civilization, number>;
  /** 枠の色がはっきりしているか（0〜1） */
  civConfidence: number;
}

let workerP: Promise<Worker> | null = null;
function digitWorker() {
  workerP ??= (async () => {
    const base = new URL(`${import.meta.env.BASE_URL}tesseract/`, location.href).href;
    const w = await createWorker('eng', 1, { workerPath: `${base}worker.min.js`, corePath: base, langPath: `${base}lang` });
    await w.setParameters({ tessedit_char_whitelist: '0123456789', tessedit_pageseg_mode: PSM.SINGLE_WORD, user_defined_dpi: '300' });
    return w;
  })();
  workerP.catch(() => { workerP = null; });
  return workerP;
}

export function warmUpCostCiv() {
  digitWorker().catch(() => {});
}

function rgbToHsv(r: number, g: number, b: number) {
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn;
  let h = 0;
  if (d) {
    if (mx === r) h = ((g - b) / d) % 6;
    else if (mx === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h *= 60;
    if (h < 0) h += 360;
  }
  return { h, s: mx ? d / mx : 0, v: mx / 255 };
}

/** 枠の色から文明を推定する。card はまっすぐに切り出したカード画像 */
export function readCiv(card: HTMLCanvasElement): Pick<CostCiv, 'civ' | 'civConfidence'> {
  const W = card.width, H = card.height;
  const g = card.getContext('2d', { willReadFrequently: true })!;
  const count: Record<Civilization, number> = { 光: 0, 水: 0, 闇: 0, 火: 0, 自然: 0, ゼロ: 0 };
  let total = 0;
  // 左右の枠（イラストや文章の外側）と、コストの枠
  const regions = [
    [0.015, 0.12, 0.06, 0.88], [0.94, 0.12, 0.985, 0.88], [0.02, 0.015, 0.17, 0.11],
  ];
  for (const [x0, y0, x1, y1] of regions) {
    const sx = Math.round(x0 * W), sy = Math.round(y0 * H), sw = Math.max(1, Math.round((x1 - x0) * W)), sh = Math.max(1, Math.round((y1 - y0) * H));
    const d = g.getImageData(sx, sy, sw, sh).data;
    for (let i = 0; i < d.length; i += 8) {
      const { h, s, v } = rgbToHsv(d[i], d[i + 1], d[i + 2]);
      if (v < 0.2) continue; // カードのふちの黒
      total++;
      if (s < 0.18) {
        // 灰色は闇（明るすぎる白は数えない）
        if (v < 0.75) count.闇 += 0.6;
        continue;
      }
      if (s < 0.3) continue;
      if (h < 18 || h >= 335) count.火++;
      else if (h >= 38 && h < 68) count.光++;
      else if (h >= 75 && h < 165) count.自然++;
      else if (h >= 180 && h < 250) count.水++;
      else if (h >= 255 && h < 335) count.闇++;
    }
  }
  const max = Math.max(...Object.values(count), 1e-6);
  const civ = Object.fromEntries(Object.entries(count).map(([k, v]) => [k, v / max])) as Record<Civilization, number>;
  return { civ, civConfidence: Math.min(1, max / Math.max(1, total) / 0.25) };
}

/** 左上のコストの数字を読む。debug を渡すと試した結果を入れる */
export async function readCost(card: HTMLCanvasElement, debug?: unknown[]): Promise<number | null> {
  const W = card.width, H = card.height;
  const sx = 0.02 * W, sy = 0.012 * H, sw = 0.16 * W, sh = 0.105 * H;
  const scale = 120 / sh;
  const cw = Math.round(sw * scale), ch = Math.round(sh * scale);
  const src = document.createElement('canvas');
  src.width = cw; src.height = ch;
  const sg = src.getContext('2d', { willReadFrequently: true })!;
  sg.imageSmoothingQuality = 'high';
  sg.drawImage(card, sx, sy, sw, sh, 0, 0, cw, ch);
  const raw = sg.getImageData(0, 0, cw, ch).data;
  const pad = 24;
  const c = document.createElement('canvas');
  c.width = cw + pad * 2; c.height = ch + pad * 2;
  const g = c.getContext('2d', { willReadFrequently: true })!;
  const w = await digitWorker();
  const votes = new Map<number, number>();
  // コストの数字は「白い文字に黒いふち取り」。白っぽい画素を数字として取り出し、
  // 画像のふちに触れている白（背景の文字枠など）は消す
  const variants: Uint8Array[] = [];
  for (const thr of [185, 150, 215]) {
    const b = new Uint8Array(cw * ch);
    for (let i = 0; i < b.length; i++) {
      const r = raw[i * 4], gg = raw[i * 4 + 1], bb = raw[i * 4 + 2];
      const mn = Math.min(r, gg, bb), mx = Math.max(r, gg, bb);
      b[i] = mn > thr && (mx - mn) < 0.3 * mx ? 1 : 0;
    }
    variants.push(dropBorderBlobs(b, cw, ch));
  }
  for (const bin of variants) {
    // 数字の範囲だけを切り出し、文字の高さをそろえる
    let x0 = cw, y0 = ch, x1 = -1, y1 = -1;
    for (let y = 0; y < ch; y++) for (let x = 0; x < cw; x++) if (bin[y * cw + x]) {
      if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
    }
    if (x1 < 0) continue;
    const k = 64 / (y1 - y0 + 1);
    c.width = Math.round((x1 - x0 + 1) * k) + pad * 2;
    c.height = 64 + pad * 2;
    const img = g.createImageData(c.width, c.height);
    const d = img.data;
    d.fill(255);
    for (let y = 0; y < c.height - pad * 2; y++) for (let x = 0; x < c.width - pad * 2; x++) {
      const sxp = Math.min(x1, x0 + Math.floor(x / k)), syp = Math.min(y1, y0 + Math.floor(y / k));
      const j = ((y + pad) * c.width + x + pad) * 4;
      d[j] = d[j + 1] = d[j + 2] = bin[syp * cw + sxp] ? 0 : 255;
    }
    g.putImageData(img, 0, 0);
    const invert = variants.indexOf(bin);
    for (const psm of [PSM.SINGLE_WORD, PSM.SINGLE_LINE]) {
      await w.setParameters({ tessedit_pageseg_mode: psm });
      const r = await w.recognize(c);
      const t = r.data.text.replace(/\D/g, '');
      const conf = r.data.confidence;
      debug?.push({ invert, psm, text: r.data.text.trim(), conf: Math.round(conf), img: c.toDataURL() });
      if (!t || t.length > 2) continue;
      const n = Number(t);
      if (n > 20 || conf < 60) continue;
      votes.set(n, (votes.get(n) ?? 0) + conf);
      break;
    }
  }
  if (!votes.size) return null;
  return [...votes.entries()].sort((a, b) => b[1] - a[1])[0][0];
}

export async function readCostCiv(card: HTMLCanvasElement): Promise<CostCiv> {
  const cost = await readCost(card).catch(() => null);
  return { cost, ...readCiv(card) };
}

/** カードの文明・コストが、読み取った結果とどれくらい合うか（-1〜1） */
export function costCivScore(read: CostCiv, card: { civ: string[]; cost: number | null; costs?: (number | null)[] }): number {
  let s = 0;
  if (read.cost != null) {
    const costs = card.costs?.length ? card.costs : [card.cost];
    s += costs.includes(read.cost) ? 0.5 : -0.25;
  }
  if (read.civConfidence > 0.3 && card.civ.length) {
    const has = card.civ.reduce((a, c) => a + (read.civ[c as Civilization] ?? 0), 0) / card.civ.length;
    const other = Math.max(0, ...Object.entries(read.civ).filter(([k]) => !card.civ.includes(k)).map(([, v]) => v));
    s += 0.5 * read.civConfidence * (has - 0.6 * other);
  }
  return s;
}

/** 画像のふちに触れている塊と、小さすぎる塊を消す */
function dropBorderBlobs(bin: Uint8Array, w: number, h: number): Uint8Array {
  const out = new Uint8Array(w * h);
  const seen = new Uint8Array(w * h);
  for (let s0 = 0; s0 < w * h; s0++) {
    if (!bin[s0] || seen[s0]) continue;
    const stack = [s0], pix: number[] = [];
    let touches = false;
    seen[s0] = 1;
    while (stack.length) {
      const i = stack.pop()!;
      pix.push(i);
      const x = i % w, y = (i / w) | 0;
      if (x === 0 || y === 0 || x === w - 1 || y === h - 1) touches = true;
      for (const j of [x > 0 ? i - 1 : -1, x < w - 1 ? i + 1 : -1, y > 0 ? i - w : -1, y < h - 1 ? i + w : -1]) {
        if (j >= 0 && bin[j] && !seen[j]) { seen[j] = 1; stack.push(j); }
      }
    }
    let top = h, bottom = 0;
    for (const i of pix) { const y = (i / w) | 0; if (y < top) top = y; if (y > bottom) bottom = y; }
    // 数字は大きい。細い弧や小さな模様は除く
    if (!touches && pix.length > w * h * 0.01 && bottom - top > h * 0.25) for (const i of pix) out[i] = 1;
  }
  return out;
}
