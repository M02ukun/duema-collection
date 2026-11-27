/**
 * 撮影したカードの「色の配置の特徴」を、全カードの特徴（事前計算済み）と照らし合わせる。
 */
import { fingerprint, FP_DIM } from '../shared/fingerprint.mjs';

export interface FeatureSet {
  ids: string[];
  vecs: Int8Array;
  norms: Float32Array;
}

let loading: Promise<FeatureSet | null> | null = null;

/** 特徴ファイルを読み込む（初回のみ数MB。以降はブラウザのキャッシュ） */
export function loadFeatures(): Promise<FeatureSet | null> {
  if (!loading) {
    loading = (async () => {
      try {
        const base = import.meta.env.BASE_URL;
        const [meta, bin] = await Promise.all([
          fetch(`${base}data/features.json`).then((r) => (r.ok ? r.json() : null)),
          fetch(`${base}data/features.bin`).then((r) => (r.ok ? r.arrayBuffer() : null)),
        ]);
        if (!meta || !bin || meta.dim !== FP_DIM) return null;
        const vecs = new Int8Array(bin);
        const n = meta.ids.length;
        const norms = new Float32Array(n);
        for (let i = 0; i < n; i++) {
          let s = 0;
          for (let k = i * FP_DIM, e = k + FP_DIM; k < e; k++) s += vecs[k] * vecs[k];
          norms[i] = Math.sqrt(s) || 1;
        }
        return { ids: meta.ids as string[], vecs, norms };
      } catch {
        return null;
      }
    })();
    loading.then((r) => { if (!r) loading = null; });
  }
  return loading;
}

/** カード部分の画像から、少しずつ位置と大きさをずらした特徴を作る（枠合わせのズレを吸収する） */
function queryVectors(card: HTMLCanvasElement): Int8Array[] {
  const W = 325, H = 454;
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  const ctx = c.getContext('2d', { willReadFrequently: true })!;
  const out: Int8Array[] = [];
  for (const s of [1, 0.93]) {
    for (const dx of [-0.03, 0, 0.03]) {
      for (const dy of [-0.03, 0, 0.03]) {
        const sw = card.width * s, sh = card.height * s;
        const sx = (card.width - sw) / 2 + dx * card.width;
        const sy = (card.height - sh) / 2 + dy * card.height;
        ctx.clearRect(0, 0, W, H);
        ctx.drawImage(card, sx, sy, sw, sh, 0, 0, W, H);
        out.push(fingerprint(ctx.getImageData(0, 0, W, H).data, W, H));
      }
    }
  }
  return out;
}

export interface ImageMatch {
  id: string;
  /** 似ている度合い（-1〜1、1 が同じ） */
  sim: number;
}

/** 似ているカードを上位から返す。simOf で任意のカードの似ている度合いも引ける */
export function matchImage(cardOrCards: HTMLCanvasElement | HTMLCanvasElement[], fs: FeatureSet, limit = 40): { top: ImageMatch[]; simOf: (id: string) => number } {
  const cards = Array.isArray(cardOrCards) ? cardOrCards : [cardOrCards];
  const qs = cards.flatMap(queryVectors).map((q) => {
    let s = 0;
    for (const v of q) s += v * v;
    return { q, norm: Math.sqrt(s) || 1 };
  });
  const n = fs.ids.length;
  const best = new Float32Array(n).fill(-1);
  const { vecs, norms } = fs;
  for (const { q, norm } of qs) {
    for (let i = 0; i < n; i++) {
      let dot = 0;
      const base = i * FP_DIM;
      for (let k = 0; k < FP_DIM; k++) dot += q[k] * vecs[base + k];
      const sim = dot / (norm * norms[i]);
      if (sim > best[i]) best[i] = sim;
    }
  }
  const idx = Array.from({ length: n }, (_, i) => i).sort((a, b) => best[b] - best[a]).slice(0, limit);
  const pos = new Map(fs.ids.map((id, i) => [id, i]));
  return {
    top: idx.map((i) => ({ id: fs.ids[i], sim: best[i] })),
    simOf: (id) => { const i = pos.get(id); return i === undefined ? -1 : best[i]; },
  };
}
