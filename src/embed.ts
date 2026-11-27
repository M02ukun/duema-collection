// 画像認識AI（DINOv2-small）でカードを照合する。
// 全カードの特徴（embed.bin）は GitHub Actions で計算済み。撮った写真だけここで計算して、いちばん近いカードを探す。
import { EMBED_SIZE, MODEL_FILE, pickVector, toInput } from '../shared/embed.mjs';

type Ort = typeof import('onnxruntime-web');
interface EmbedSet { dim: number; ids: string[]; vecs: Int8Array }

let ortP: Promise<Ort> | null = null;
let sessionP: Promise<import('onnxruntime-web').InferenceSession> | null = null;
let setP: Promise<EmbedSet | null> | null = null;
const base = import.meta.env.BASE_URL;

/** 全カードの特徴を読み込む。無ければ null（まだ計算されていない） */
export function loadEmbeddings(): Promise<EmbedSet | null> {
  setP ??= (async () => {
    try {
      const meta = await fetch(`${base}data/embed.json`).then((r) => (r.ok ? r.json() : null));
      if (!meta || meta.model !== MODEL_FILE) return null;
      const buf = await fetch(`${base}data/embed.bin`).then((r) => (r.ok ? r.arrayBuffer() : null));
      if (!buf || buf.byteLength !== meta.ids.length * meta.dim) return null;
      return { dim: meta.dim, ids: meta.ids, vecs: new Int8Array(buf) };
    } catch {
      return null;
    }
  })();
  return setP;
}

function session() {
  sessionP ??= (async () => {
    ortP ??= import('onnxruntime-web/wasm');
    const ort = await ortP;
    ort.env.wasm.numThreads = 1;
    return ort.InferenceSession.create(`${base}models/${MODEL_FILE}`, { executionProviders: ['wasm'] });
  })();
  sessionP.catch(() => { sessionP = null; });
  return sessionP;
}

/** 使う前に読み込みを始めておく（初回はモデルのダウンロードに時間がかかる） */
export function warmUpEmbed() {
  loadEmbeddings().then((s) => { if (s) session().catch(() => {}); });
}

async function embed(card: HTMLCanvasElement): Promise<Float32Array> {
  const s = await session();
  const c = document.createElement('canvas');
  c.width = c.height = EMBED_SIZE;
  const g = c.getContext('2d', { willReadFrequently: true })!;
  g.imageSmoothingQuality = 'high';
  g.drawImage(card, 0, 0, EMBED_SIZE, EMBED_SIZE);
  const ort = await ortP!;
  const input = new ort.Tensor('float32', toInput(g.getImageData(0, 0, EMBED_SIZE, EMBED_SIZE).data), [1, 3, EMBED_SIZE, EMBED_SIZE]);
  return pickVector((await s.run({ [s.inputNames[0]]: input })) as never);
}

/**
 * カード画像（1枚または候補の切り出し複数）に近いカードを探す。
 * 戻り値の sim は -1〜1（1に近いほど似ている）
 */
export async function matchEmbed(cards: HTMLCanvasElement[], limit = 24): Promise<{ top: { id: string; sim: number }[]; simOf: (id: string) => number } | null> {
  const set = await loadEmbeddings();
  if (!set) return null;
  const { dim, ids, vecs } = set;
  const best = new Float32Array(ids.length).fill(-1);
  for (const card of cards) {
    const q = await embed(card);
    for (let i = 0; i < ids.length; i++) {
      let s = 0;
      const o = i * dim;
      for (let k = 0; k < dim; k++) s += q[k] * vecs[o + k];
      s /= 127;
      if (s > best[i]) best[i] = s;
    }
  }
  const index = new Map(ids.map((id, i) => [id, i]));
  const order = Array.from(best.keys()).sort((a, b) => best[b] - best[a]).slice(0, limit);
  return { top: order.map((i) => ({ id: ids[i], sim: best[i] })), simOf: (id) => { const i = index.get(id); return i == null ? 0 : best[i]; } };
}
