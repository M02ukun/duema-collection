/**
 * カード全体の写真から、カード名を日本語で読み取り、カードリストの名前とあいまい照合する。
 * 小さい収録番号よりも大きく書かれたカード名のほうが読みやすいので、こちらを主に使う。
 */
import { createWorker, PSM, type Worker } from 'tesseract.js';
import { normName, type CardDb, type MasterCard } from './carddb';

export interface CardRect { x: number; y: number; w: number; h: number }

type Source = HTMLImageElement | HTMLVideoElement | HTMLCanvasElement;

let jpnWorker: Promise<Worker> | null = null;
function getJpnWorker() {
  if (!jpnWorker) {
    jpnWorker = (async () => {
      const base = new URL(`${import.meta.env.BASE_URL}tesseract/`, location.href).href;
      const w = await createWorker('jpn', 1, {
        workerPath: `${base}worker.min.js`,
        corePath: base,
        langPath: `${base}lang`,
      });
      await w.setParameters({ tessedit_pageseg_mode: PSM.SPARSE_TEXT, preserve_interword_spaces: '1' });
      return w;
    })();
    jpnWorker.catch(() => (jpnWorker = null));
  }
  return jpnWorker;
}
export function warmUpNameOcr() {
  getJpnWorker().catch(() => {});
}

function size(s: Source) {
  if (s instanceof HTMLImageElement) return { w: s.naturalWidth, h: s.naturalHeight };
  if (s instanceof HTMLVideoElement) return { w: s.videoWidth, h: s.videoHeight };
  return { w: s.width, h: s.height };
}

/** カード部分を切り出して、幅 width px のキャンバスにする */
export function cropCard(src: Source, rect: CardRect, width = 900): HTMLCanvasElement {
  const { w: W, h: H } = size(src);
  const sx = rect.x * W, sy = rect.y * H, sw = rect.w * W, sh = rect.h * H;
  const c = document.createElement('canvas');
  c.width = width;
  c.height = Math.round((width * sh) / sw);
  const ctx = c.getContext('2d')!;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(src, sx, sy, sw, sh, 0, 0, c.width, c.height);
  return c;
}

/** 帯状の範囲を切り出し、グレースケール（必要なら反転）にして余白を付ける */
function band(card: HTMLCanvasElement, y0: number, y1: number, invert: boolean, scale = 1.4): HTMLCanvasElement {
  const sy = Math.round(card.height * y0), sh = Math.round(card.height * (y1 - y0));
  const w = Math.round(card.width * scale), h = Math.round(sh * scale);
  const pad = 20;
  const c = document.createElement('canvas');
  c.width = w + pad * 2;
  c.height = h + pad * 2;
  const ctx = c.getContext('2d', { willReadFrequently: true })!;
  ctx.fillStyle = invert ? '#000' : '#fff';
  ctx.fillRect(0, 0, c.width, c.height);
  ctx.drawImage(card, 0, sy, card.width, sh, pad, pad, w, h);
  const img = ctx.getImageData(0, 0, c.width, c.height);
  const d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    let g = (Math.max(d[i], d[i + 1], d[i + 2]) + Math.min(d[i], d[i + 1], d[i + 2])) >> 1;
    if (invert) g = 255 - g;
    d[i] = d[i + 1] = d[i + 2] = g;
  }
  ctx.putImageData(img, 0, 0);
  return c;
}

const bigrams = (s: string) => {
  const out = new Set<string>();
  for (let i = 0; i < s.length - 1; i++) out.add(s.slice(i, i + 2));
  if (s.length === 1) out.add(s);
  return out;
};

/** 名前のあいまい検索用の索引（2文字ずつの組み合わせ） */
export class NameIndex {
  private readonly names: string[] = [];
  private readonly grams: number[] = [];
  private readonly cardsByName = new Map<number, MasterCard[]>();
  private readonly index = new Map<string, number[]>();

  constructor(db: CardDb) {
    const idOf = new Map<string, number>();
    for (const c of db.list.cards) {
      // ツインパクトは面ごとの名前でも引けるようにする
      const parts = new Set([c.name, ...c.name.split(/\s+\/\s+/)]);
      for (const part of parts) {
        const n = normName(part);
        if (n.length < 2) continue;
        let i = idOf.get(n);
        if (i === undefined) {
          i = this.names.length;
          idOf.set(n, i);
          this.names.push(n);
          const g = bigrams(n);
          this.grams.push(g.size);
          for (const b of g) {
            const arr = this.index.get(b);
            if (arr) arr.push(i);
            else this.index.set(b, [i]);
          }
          this.cardsByName.set(i, []);
        }
        const list = this.cardsByName.get(i)!;
        if (!list.includes(c)) list.push(c);
      }
    }
  }

  /** 読み取った文字列（1行分）に近い名前を、点数（0〜1）付きで返す */
  match(text: string, limit = 10): { score: number; name: string; cards: MasterCard[] }[] {
    const q = normName(text);
    if (q.length < 2) return [];
    const qg = bigrams(q);
    const hits = new Map<number, number>();
    for (const b of qg) for (const i of this.index.get(b) ?? []) hits.set(i, (hits.get(i) ?? 0) + 1);
    const scored: { i: number; score: number }[] = [];
    for (const [i, common] of hits) {
      // 名前側の何割が読めているか（行に余計な文字が混ざっても下がりにくいように名前側を重視）
      const recall = common / this.grams[i];
      const precision = common / qg.size;
      const score = 0.6 * recall + 0.4 * precision;
      if (score >= 0.3) scored.push({ i, score });
    }
    scored.sort((a, b) => b.score - a.score || this.names[a.i].length - this.names[b.i].length);
    return scored.slice(0, limit).map(({ i, score }) => ({ score, name: this.names[i], cards: this.cardsByName.get(i)! }));
  }
}

export interface NameCandidate {
  score: number;
  /** その名前のカード（再録などで複数ある） */
  cards: MasterCard[];
}

export interface NameRecResult {
  candidates: NameCandidate[];
  lines: string[];
  preview: string;
}

/**
 * カード画像から候補を探す。まず上部（カード名の帯）を読み、
 * 決め手がなければツインパクトの下側の名前のあたりとカード全体も読む。
 */
export async function recognizeCardByName(
  src: Source,
  rect: CardRect,
  index: NameIndex,
  onStage?: (s: string) => void,
): Promise<NameRecResult> {
  const worker = await getJpnWorker();
  const card = cropCard(src, rect);
  const best = new Map<string, NameCandidate & { name: string }>();
  const lines: string[] = [];

  async function read(canvas: HTMLCanvasElement, weight: number) {
    const { data } = await worker.recognize(canvas);
    for (const raw of data.text.split('\n')) {
      const line = raw.replace(/\s+/g, ' ').trim();
      if (normName(line).length < 2) continue;
      lines.push(line);
      for (const m of index.match(line)) {
        const s = m.score * weight;
        const prev = best.get(m.name);
        if (!prev || prev.score < s) best.set(m.name, { name: m.name, score: s, cards: m.cards });
      }
    }
  }
  const top = () => [...best.values()].sort((a, b) => b.score - a.score);

  onStage?.('カード名を読み取り中…');
  await read(band(card, 0, 0.2, false), 1);
  if ((top()[0]?.score ?? 0) < 0.8) await read(band(card, 0, 0.2, true), 1);
  if ((top()[0]?.score ?? 0) < 0.8) {
    onStage?.('もう少し詳しく読み取り中…');
    await read(band(card, 0.44, 0.64, false), 0.95);
  }
  if ((top()[0]?.score ?? 0) < 0.6) await read(band(card, 0, 1, false, 1), 0.85);

  const candidates = top().slice(0, 8).map(({ score, cards }) => ({ score, cards }));
  return { candidates, lines, preview: card.toDataURL('image/jpeg', 0.7) };
}
