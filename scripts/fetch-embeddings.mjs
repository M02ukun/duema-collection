// 全カードの公式サムネイル画像を画像認識AI（DINOv2-small）で「特徴の数値」に変換し、
// public/data/embed.bin に保存する。画像そのものは保存しない。前回計算済みのカードは取り直さない。
// モデルが public/models に無ければ Hugging Face から取ってくる（アプリはここから読み込む）。
//
// 出力:
//   public/data/embed.json … { dim, model, ids: [カードID...] }
//   public/data/embed.bin  … ids の順に dim バイトずつ（Int8）
import sharp from 'sharp';
import * as ort from 'onnxruntime-node';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { EMBED_SIZE, MODEL_FILE, MODEL_URL, pickVector, quantize, toInput } from '../shared/embed.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const dataDir = join(root, 'public', 'data');
const modelPath = join(root, 'public', 'models', MODEL_FILE);
const IMG_BASE = 'https://dm.takaratomy.co.jp/wp-content/card/cardthumb/';
const UA = 'Mozilla/5.0 (compatible; duema-collection card list fetcher)';
const CONCURRENCY = 3;
const DELAY_MS = 250;
const args = process.argv.slice(2);
const maxNew = Number(args[args.indexOf('--max') + 1] ?? Infinity) || Infinity;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function download(url, headers = { 'User-Agent': UA }) {
  for (let i = 0; ; i++) {
    try {
      const res = await fetch(url, { headers });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return Buffer.from(await res.arrayBuffer());
    } catch (e) {
      if (i >= 3) throw new Error(`${url}: ${e.message}`);
      await sleep(2000 * (i + 1));
    }
  }
}

if (!existsSync(modelPath)) {
  mkdirSync(dirname(modelPath), { recursive: true });
  console.log('downloading model', MODEL_URL);
  writeFileSync(modelPath, await download(MODEL_URL, {}));
}
const session = await ort.InferenceSession.create(modelPath);
const inputName = session.inputNames[0];

export async function embedOf(buf) {
  const { data } = await sharp(buf).removeAlpha().ensureAlpha().resize(EMBED_SIZE, EMBED_SIZE, { fit: 'fill' }).raw().toBuffer({ resolveWithObject: true });
  const input = new ort.Tensor('float32', toInput(data), [1, 3, EMBED_SIZE, EMBED_SIZE]);
  return pickVector(await session.run({ [inputName]: input }));
}

const { cards } = JSON.parse(readFileSync(join(dataDir, 'cards.json'), 'utf8'));
let dim = 0;
const have = new Map();
if (existsSync(join(dataDir, 'embed.json')) && existsSync(join(dataDir, 'embed.bin'))) {
  const meta = JSON.parse(readFileSync(join(dataDir, 'embed.json'), 'utf8'));
  const bin = readFileSync(join(dataDir, 'embed.bin'));
  if (meta.model === MODEL_FILE) {
    dim = meta.dim;
    meta.ids.forEach((id, i) => have.set(id, bin.subarray(i * dim, (i + 1) * dim)));
  }
}

const todo = cards.filter((c) => c.img && !have.has(c.id)).slice(0, maxNew);
console.log(`embeddings: have ${have.size}, new ${todo.length}`);
let done = 0, failed = 0, next = 0;
// 画像の取得は並行、AIの計算は1枚ずつ
let chain = Promise.resolve();
await Promise.all(Array.from({ length: CONCURRENCY }, async () => {
  while (next < todo.length) {
    const c = todo[next++];
    try {
      const buf = await download(IMG_BASE + c.img);
      await (chain = chain.then(async () => {
        const v = await embedOf(buf);
        dim = v.length;
        have.set(c.id, Buffer.from(quantize(v).buffer));
      }));
    } catch (e) {
      failed++;
      console.warn(String(e));
    }
    done++;
    if (done % 500 === 0) { console.log(`${done}/${todo.length}`); save(); }
    await sleep(DELAY_MS);
  }
}));

function save() {
  // cards.json の順に並べ、もう無いカードは落とす
  const ids = cards.map((c) => c.id).filter((id) => have.has(id));
  writeFileSync(join(dataDir, 'embed.json'), JSON.stringify({ dim, model: MODEL_FILE, ids }));
  writeFileSync(join(dataDir, 'embed.bin'), Buffer.concat(ids.map((id) => have.get(id))));
  return ids.length;
}
console.log(`saved ${save()} embeddings (failed ${failed})`);
