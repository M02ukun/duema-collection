/**
 * 公式カードリスト（public/data/cards.json、またはファイルから読み込んだもの）を扱う。
 * 番号からの即検索と、名前の部分一致検索を行う。
 */
import Dexie from 'dexie';
import type { Civilization } from './types';

export interface MasterCard {
  /** 公式サイトのカードID（例: dm25sd1-002） */
  id: string;
  /** 商品の値（例: 25sd1） */
  p: string;
  /** 収録表記のパック記号（例: DM25SD1） */
  set: string;
  /** 収録表記の番号（例: 2/13、S4/S10、㊙5/㊙24） */
  no: string;
  name: string;
  cost: number | null;
  costs?: (number | null)[];
  civ: Civilization[];
  type: string;
  race: string;
  power: number | null;
  rarity: string;
  /** 公式サイトのサムネイル画像ファイル名 */
  img?: string;
}

const IMG_BASE = 'https://dm.takaratomy.co.jp/wp-content/card/cardthumb/';
/** 公式サイトにあるカード画像の URL（画像は保存せず、公式サイトのものを表示する） */
export function cardImageUrl(c: { id: string; img?: string }): string | null {
  if (c.img) return IMG_BASE + c.img;
  if (/^dm[a-z0-9]+-[A-Za-z0-9]+$/.test(c.id)) return `${IMG_BASE}${c.id}.jpg`;
  return null;
}

export interface CardList {
  updatedAt: string;
  products: { value: string; name: string }[];
  cards: MasterCard[];
}

/** パック記号をそろえる: 大文字化・記号除去・先頭の DM を外す（"DM25SD1" も "25SD1" も "25SD1" に） */
export function normSet(s: string): string {
  return s.toUpperCase().replace(/[^A-Z0-9]/g, '').replace(/^DM(?=[A-Z0-9])/, '');
}
/** 番号をそろえる: ㊙ や空白を外し、先頭のゼロを取る */
export function normNo(s: string): string {
  return s
    .toUpperCase()
    .replace(/[㊙秘\s]/g, '')
    .replace(/／/g, '/')
    .replace(/(^|\/)([A-Z]*)0+(\d)/g, '$1$2$3');
}
export const codeKey = (set: string, no: string) => `${normSet(set)}#${normNo(no)}`;

/** 名前検索用: カタカナ→ひらがな、全角英数→半角、記号・空白を除いて小文字に */
export function normName(s: string): string {
  return s
    .normalize('NFKC')
    .replace(/[ァ-ヶ]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0x60))
    .replace(/[\s・=＝\-ー〜~「」『』“”"'!！?？.,、。/]/g, '')
    .toLowerCase();
}

// 読み込んだカードリストを端末に保存しておく（オフラインでも使えるように）
const store = new Dexie('duema-cardlist') as Dexie & { lists: Dexie.Table<{ key: string; data: CardList }, string> };
store.version(1).stores({ lists: 'key' });

export class CardDb {
  readonly list: CardList;
  readonly byCode = new Map<string, MasterCard[]>();
  readonly sets: string[];
  readonly productName = new Map<string, string>();
  private readonly names: string[];
  /** 同じ名前のカード（再録・別イラスト）をまとめたもの */
  readonly byName = new Map<string, MasterCard[]>();
  readonly byId = new Map<string, MasterCard>();
  /** 表記ゆれを無くした名前 → 正式な名前 */
  readonly nameOfNorm = new Map<string, string>();

  constructor(list: CardList) {
    this.list = list;
    for (const p of list.products) this.productName.set(p.value, p.name);
    for (const c of list.cards) {
      const k = codeKey(c.set, c.no);
      const arr = this.byCode.get(k);
      if (arr) arr.push(c);
      else this.byCode.set(k, [c]);
    }
    this.sets = [...new Set(list.cards.map((c) => normSet(c.set)))];
    this.names = list.cards.map((c) => normName(c.name));
    for (const c of list.cards) {
      this.byId.set(c.id, c);
      if (!this.nameOfNorm.has(normName(c.name))) this.nameOfNorm.set(normName(c.name), c.name);
      const arr = this.byName.get(c.name);
      if (arr) arr.push(c);
      else this.byName.set(c.name, [c]);
    }
  }

  /** 同じ名前のカード（再録・別イラスト）。新しいものから並べる */
  sameName(name: string): MasterCard[] {
    return this.byName.get(name) ?? [];
  }

  /**
   * カードを名前ごとにまとめ、それぞれに同名の別イラストを全部くっつける。
   * first に入っているカードは、そのグループの先頭に並べる。
   */
  groupByName(cards: MasterCard[], maxGroups = 30): { name: string; cards: MasterCard[]; first: Set<string> }[] {
    const groups = new Map<string, { name: string; cards: MasterCard[]; first: Set<string> }>();
    for (const c of cards) {
      let g = groups.get(c.name);
      if (!g) {
        if (groups.size >= maxGroups) continue;
        g = { name: c.name, cards: [], first: new Set() };
        groups.set(c.name, g);
      }
      if (!g.first.has(c.id)) { g.first.add(c.id); g.cards.push(c); }
    }
    for (const g of groups.values()) for (const c of this.sameName(g.name)) if (!g.first.has(c.id)) g.cards.push(c);
    return [...groups.values()];
  }

  get size() {
    return this.list.cards.length;
  }

  findByCode(set: string, no: string): MasterCard[] {
    const hit = this.byCode.get(codeKey(set, no));
    if (hit) return hit;
    // "DMX22-b" のように末尾に枝番の英字が付く表記は、枝番なしでも探す
    const base = normSet(set).replace(/(\d)[A-Z]$/, '$1');
    return base !== normSet(set) ? this.byCode.get(`${base}#${normNo(no)}`) ?? [] : [];
  }

  /** そのパックに入っているカード */
  cardsOfSet(set: string): MasterCard[] {
    const n = normSet(set);
    return this.list.cards.filter((c) => normSet(c.set) === n);
  }

  /**
   * 名前・番号で検索。"25sd1 2" のようにパック記号と番号の一部でも探せる。
   * 名前が前方一致するものを先に並べる。
   */
  search(query: string, limit = 200): MasterCard[] {
    const q = query.trim();
    if (!q) return [];
    // 「パック記号 番号」形式
    const m = q.toUpperCase().match(/^([A-Z0-9-]{3,10})\s+([A-Z㊙]*\d{1,3})(?:\s*\/\s*(\d+))?$/);
    if (m) {
      const set = normSet(m[1]);
      const n = normNo(m[2]);
      const hits = this.list.cards.filter((c) => normSet(c.set) === set && normNo(c.no).split('/')[0] === n);
      if (hits.length) return hits.slice(0, limit);
    }
    if (/^[A-Za-z0-9-]{3,10}$/.test(q)) {
      const hits = this.cardsOfSet(q);
      if (hits.length) return hits.slice(0, limit * 4);
    }
    const nq = normName(q);
    if (!nq) return [];
    const exact: MasterCard[] = [];
    const prefix: MasterCard[] = [];
    const inner: MasterCard[] = [];
    const cards = this.list.cards;
    for (let i = 0; i < cards.length; i++) {
      const idx = this.names[i].indexOf(nq);
      if (idx === 0 && this.names[i].length === nq.length) exact.push(cards[i]);
      else if (idx === 0) prefix.push(cards[i]);
      else if (idx > 0) inner.push(cards[i]);
      if (prefix.length >= limit) break;
    }
    return [...exact, ...prefix, ...inner].slice(0, limit);
  }
}

/** 公開されているカードリスト（cards.json）か、端末に保存した読み込み済みのものを使う */
export async function loadCardDb(): Promise<CardDb | null> {
  let saved: CardList | null = null;
  try {
    saved = (await store.lists.get('main'))?.data ?? null;
  } catch { /* IndexedDB が使えない環境 */ }
  try {
    const res = await fetch(`${import.meta.env.BASE_URL}data/cards.json`, { cache: 'no-cache' });
    if (res.ok) {
      const remote = (await res.json()) as CardList;
      if (!saved || remote.updatedAt >= saved.updatedAt) return new CardDb(remote);
    }
  } catch { /* オフラインなど */ }
  return saved ? new CardDb(saved) : null;
}

export async function importCardList(text: string): Promise<CardDb> {
  const data = JSON.parse(text) as CardList;
  if (!Array.isArray(data.cards) || !data.cards.length || !data.cards[0].id) throw new Error('カードリストの形式ではありません');
  data.products ??= [];
  data.updatedAt ??= new Date().toISOString();
  await store.lists.put({ key: 'main', data });
  return new CardDb(data);
}
