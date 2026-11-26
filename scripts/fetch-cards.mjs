// 公式カード検索（dm.takaratomy.co.jp/card/）からカードリストを取得して public/data/cards.json に保存する。
//
// - 保存するのは、名前・コスト・文明・種類・種族・パワー・レアリティ・収録番号などの基本情報だけ。
//   カードの画像・能力テキスト・フレーバーテキストは保存しない。
// - 前回の cards.json にあるカードは取り直さない（新しいパックの分だけ取りに行く）。
// - 公式サイトに負担をかけないよう、同時接続数を絞り、間隔をあけて取得する。
//
// 使い方: node scripts/fetch-cards.mjs [--products 25sd1,rp01] [--max-details 100] [--refresh]
import { load } from 'cheerio';
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const BASE = 'https://dm.takaratomy.co.jp';
const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const outPath = join(root, 'public', 'data', 'cards.json');
const args = process.argv.slice(2);
const argVal = (k) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : undefined; };
const onlyProducts = argVal('--products')?.split(',');
const maxDetails = Number(argVal('--max-details') ?? Infinity);
const refresh = args.includes('--refresh');
const CONCURRENCY = 3;
const DELAY_MS = 250;
const UA = 'Mozilla/5.0 (compatible; duema-collection card list fetcher)';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function get(url, init = {}, tries = 4) {
  for (let i = 0; ; i++) {
    try {
      const res = await fetch(url, { ...init, headers: { 'User-Agent': UA, ...(init.headers ?? {}) } });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.text();
    } catch (e) {
      if (i >= tries - 1) throw new Error(`${url}: ${e.message}`);
      await sleep(2000 * (i + 1));
    }
  }
}

async function listProducts() {
  const $ = load(await get(`${BASE}/card/`));
  return $('select[name=products] option')
    .map((_, o) => ({ value: $(o).attr('value'), name: $(o).text().trim() }))
    .get()
    .filter((p) => p.value);
}

async function listIds(product) {
  const ids = [];
  for (let page = 1; page < 100; page++) {
    const body = new URLSearchParams();
    body.append('suggest', 'on');
    for (const k of ['card_name', 'card_ruby', 'card_text']) body.append('keyword_type[]', k);
    for (const c of ['単色', '多色']) body.append('culture_cond[]', c);
    body.set('products', product);
    body.set('pagenum', String(page));
    body.set('samename', 'show');
    const $ = load(await get(`${BASE}/card/`, { method: 'POST', body, headers: { 'Content-Type': 'application/x-www-form-urlencoded' } }));
    const pageIds = $('#cardlist a[data-href]').map((_, a) => $(a).attr('data-href').split('id=')[1]).get();
    const fresh = pageIds.filter((id) => !ids.includes(id));
    ids.push(...fresh);
    const hasNext = $('.wp-pagenavi a').toArray().some((a) => Number($(a).attr('data-page')) > page);
    await sleep(DELAY_MS);
    if (!fresh.length || !hasNext) break;
  }
  return ids;
}

const num = (s) => {
  const m = String(s ?? '').replace(/[０-９]/g, (d) => String.fromCharCode(d.charCodeAt(0) - 0xfee0)).match(/\d+/);
  return m ? Number(m[0]) : null;
};

async function fetchDetail(id, product) {
  const $ = load(await get(`${BASE}/card/detail/?id=${encodeURIComponent(id)}`));
  const sides = $('.card-itself').toArray().map((el) => {
    const c = $(el);
    const pack = c.find('.packname').first().text().trim();
    const name = c.find('h3.card-name').first().clone().children('.packname').remove().end().text().trim();
    const cell = (cls) => c.find(`td.${cls}`).first().text().trim();
    return {
      name, pack,
      type: cell('type'), civ: cell('civil'), rarity: cell('rarelity'),
      power: cell('power'), cost: cell('cost'), race: cell('race'),
    };
  });
  // ツインパクトなどで同じ面が2回出てくることがあるので、重複を除く
  const seen = new Set();
  const uniq = sides.filter((x) => {
    const k = `${x.name}|${x.cost}|${x.type}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
  sides.length = 0;
  sides.push(...uniq);
  if (!sides.length) return null;
  const first = sides[0];
  // "(DMRP01 S4/S10)" → set: DMRP01, no: S4/S10
  const pm = (sides.find((s) => s.pack)?.pack ?? '').replace(/[()（）]/g, '').trim().match(/^(\S+)\s+(\S+)$/);
  const civs = [...new Set(sides.flatMap((s) => s.civ.split(/[/／・]/).map((x) => x.trim()).filter(Boolean)))];
  return {
    id,
    p: product,
    set: pm?.[1] ?? '',
    no: pm?.[2] ?? '',
    name: dedupeName(sides.map((s) => s.name).filter(Boolean).join(' / ')),
    cost: num(first.cost),
    costs: sides.length > 1 ? sides.map((s) => num(s.cost)) : undefined,
    civ: civs,
    type: sides.length > 1 ? sides.map((s) => s.type).join(' / ') : first.type,
    race: [...new Set(sides.map((s) => s.race).filter(Boolean))].join(' / '),
    power: num(first.power),
    rarity: first.rarity,
  };
}

/** "A / B / A / B" のように面の名前が重なったものを "A / B" にする */
function dedupeName(name) {
  return [...new Set(name.split(/\s+\/\s+/))].join(' / ');
}

async function pool(items, worker) {
  let i = 0;
  const run = async () => {
    while (i < items.length) {
      const idx = i++;
      await worker(items[idx], idx);
      await sleep(DELAY_MS);
    }
  };
  await Promise.all(Array.from({ length: CONCURRENCY }, run));
}

const prev = existsSync(outPath) && !refresh ? JSON.parse(readFileSync(outPath, 'utf8')) : { products: [], cards: [] };
const known = new Map(prev.cards.map((c) => [c.id, c]));

const products = await listProducts();
console.log(`products: ${products.length}`);
const targets = onlyProducts ? products.filter((p) => onlyProducts.includes(p.value)) : products;

const todo = [];
const productIds = new Map();
for (const [i, p] of targets.entries()) {
  const ids = await listIds(p.value);
  productIds.set(p.value, ids);
  const missing = ids.filter((id) => !known.has(id));
  todo.push(...missing.map((id) => ({ id, product: p.value })));
  console.log(`[${i + 1}/${targets.length}] ${p.value}: ${ids.length} cards, new ${missing.length}`);
}

const limited = todo.slice(0, maxDetails);
console.log(`fetching ${limited.length} details (of ${todo.length} new)`);
let done = 0, failed = 0;
await pool(limited, async ({ id, product }) => {
  try {
    const c = await fetchDetail(id, product);
    if (c) known.set(id, c);
  } catch (e) {
    failed++;
    console.warn(String(e));
  }
  if (++done % 200 === 0) console.log(`  ${done}/${limited.length}`);
});

for (const c of known.values()) c.name = dedupeName(c.name);
const productMeta = new Map(prev.products.map((p) => [p.value, p]));
for (const p of products) productMeta.set(p.value, { value: p.value, name: p.name });
const order = new Map(products.map((p, i) => [p.value, i]));
const cards = [...known.values()].sort((a, b) => (order.get(a.p) ?? 1e9) - (order.get(b.p) ?? 1e9) || a.id.localeCompare(b.id));
mkdirSync(dirname(outPath), { recursive: true });
writeFileSync(outPath, JSON.stringify({
  source: 'https://dm.takaratomy.co.jp/card/',
  updatedAt: new Date().toISOString(),
  products: products.map((p) => productMeta.get(p.value)),
  cards,
}));
console.log(`saved ${cards.length} cards (failed ${failed}) to ${outPath}`);
if (failed > limited.length * 0.2 && limited.length > 20) process.exit(1);
