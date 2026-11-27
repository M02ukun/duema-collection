// 全カードの公式サムネイル画像から「色の配置の特徴」を計算し、public/data/features.bin に保存する。
// 画像そのものは保存しない（計算に使ったらすぐ捨てる）。前回計算済みのカードは取り直さない。
//
// 出力:
//   public/data/features.json … { dim, ids: [カードID...] }
//   public/data/features.bin  … ids の順に dim バイトずつの特徴（Int8）
import sharp from 'sharp';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { fingerprint, FP_DIM } from '../shared/fingerprint.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const dataDir = join(root, 'public', 'data');
const IMG_BASE = 'https://dm.takaratomy.co.jp/wp-content/card/cardthumb/';
const UA = 'Mozilla/5.0 (compatible; duema-collection card list fetcher)';
const CONCURRENCY = 3;
const DELAY_MS = 250;
const args = process.argv.slice(2);
const maxNew = Number(args[args.indexOf('--max') + 1] ?? Infinity) || Infinity;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const { cards } = JSON.parse(readFileSync(join(dataDir, 'cards.json'), 'utf8'));
const have = new Map();
if (existsSync(join(dataDir, 'features.json')) && existsSync(join(dataDir, 'features.bin'))) {
  const meta = JSON.parse(readFileSync(join(dataDir, 'features.json'), 'utf8'));
  const bin = readFileSync(join(dataDir, 'features.bin'));
  if (meta.dim === FP_DIM) meta.ids.forEach((id, i) => have.set(id, bin.subarray(i * FP_DIM, (i + 1) * FP_DIM)));
}

export async function featureOf(buf) {
  const { data, info } = await sharp(buf).removeAlpha().ensureAlpha().resize(325, 454, { fit: 'fill' }).raw().toBuffer({ resolveWithObject: true });
  return Buffer.from(fingerprint(data, info.width, info.height).buffer);
}

async function download(url) {
  for (let i = 0; ; i++) {
    try {
      const res = await fetch(url, { headers: { 'User-Agent': UA } });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return Buffer.from(await res.arrayBuffer());
    } catch (e) {
      if (i >= 3) throw new Error(`${url}: ${e.message}`);
      await sleep(2000 * (i + 1));
    }
  }
}

const todo = cards.filter((c) => c.img && !have.has(c.id)).slice(0, maxNew);
console.log(`features: have ${have.size}, new ${todo.length}`);
let done = 0, failed = 0, next = 0;
await Promise.all(Array.from({ length: CONCURRENCY }, async () => {
  while (next < todo.length) {
    const c = todo[next++];
    try {
      have.set(c.id, await featureOf(await download(IMG_BASE + c.img)));
    } catch (e) {
      failed++;
      console.warn(String(e));
    }
    if (++done % 500 === 0) console.log(`  ${done}/${todo.length}`);
    await sleep(DELAY_MS);
  }
}));

const ids = cards.map((c) => c.id).filter((id) => have.has(id));
writeFileSync(join(dataDir, 'features.json'), JSON.stringify({ dim: FP_DIM, ids }));
writeFileSync(join(dataDir, 'features.bin'), Buffer.concat(ids.map((id) => have.get(id))));
console.log(`saved ${ids.length} features (failed ${failed})`);
if (failed > todo.length * 0.2 && todo.length > 20) process.exit(1);
