import { useLiveQuery } from 'dexie-react-hooks';
import { db } from './db';
import { normName, type CardDb, type MasterCard } from './carddb';
import { addCard } from './db';
import { CIVILIZATIONS, type Box, type BoxItem, type Card, type Deck, type DeckItem } from './types';

/** 公式カードリストのカードを、所持カードとして1枚追加する */
export async function addMaster(m: MasterCard, n = 1) {
  await addCard(
    {
      id: m.id,
      setCode: m.set,
      number: m.no,
      name: m.name,
      cost: m.cost,
      civilizations: CIVILIZATIONS.filter((c) => m.civ.includes(c)),
      type: m.type,
      race: m.race,
      power: m.power,
      rarity: m.rarity,
      memo: '',
      img: m.img,
    },
    n,
  );
}



/** 箱に入れる・出す。入れた枚数が所持枚数を超えたら、所持枚数も増やす（箱に入っている＝持っている） */
export async function changeBoxItem(boxId: string, card: MasterCard | Card, delta: number, syncOwned = true) {
  const id = `${boxId}|${card.id}`;
  const cur = (await db.boxItems.get(id))?.count ?? 0;
  const next = Math.max(0, cur + delta);
  if (next === 0) await db.boxItems.delete(id);
  else await db.boxItems.put({ id, boxId, cardId: card.id, name: card.name, count: next });
  if (delta > 0 && syncOwned) {
    const owned = (await db.cards.get(card.id))?.count ?? 0;
    const placed = (await db.boxItems.where('cardId').equals(card.id).toArray()).reduce((s, b) => s + b.count, 0);
    if (placed > owned) {
      if ('civ' in card) await addMaster(card, placed - owned);
      else await db.cards.update(card.id, { count: placed, updatedAt: Date.now() });
    }
  }
  return next;
}

export async function changeDeckItem(deckId: string, card: { id: string; name: string }, delta: number) {
  const id = `${deckId}|${card.id}`;
  const cur = (await db.deckItems.get(id))?.count ?? 0;
  const next = Math.max(0, cur + delta);
  if (next === 0) await db.deckItems.delete(id);
  else await db.deckItems.put({ id, deckId, cardId: card.id, name: card.name, count: next });
  await db.decks.update(deckId, { updatedAt: Date.now() });
  return next;
}

export async function deleteBox(id: string) {
  await db.transaction('rw', db.boxes, db.boxItems, async () => {
    await db.boxItems.where('boxId').equals(id).delete();
    await db.boxes.delete(id);
  });
}

export async function deleteDeck(id: string) {
  await db.transaction('rw', db.decks, db.deckItems, async () => {
    await db.deckItems.where('deckId').equals(id).delete();
    await db.decks.delete(id);
  });
}

export interface Place {
  kind: 'box' | 'deck';
  id: string;
  name: string;
  count: number;
}

export interface Storage {
  cards: Card[];
  boxes: Box[];
  decks: Deck[];
  boxItems: BoxItem[];
  deckItems: DeckItem[];
  owned: Map<string, number>;
  /** カードごとの置き場所（箱と、組んであるデッキ） */
  placesOf: (cardId: string) => Place[];
  /** 箱にも組んであるデッキにも入っていない枚数 */
  looseOf: (cardId: string) => number;
  /** 名前ごとの所持枚数（イラスト違いをまとめる） */
  ownedByName: Map<string, number>;
  /** 名前ごとの置き場所 */
  placesOfName: (name: string) => Place[];
}

/** 箱・デッキ・所持カードをまとめて読み、置き場所を引けるようにする */
export function useStorage(): Storage | undefined {
  const raw = useLiveQuery(async () => ({
    cards: await db.cards.toArray(),
    boxes: await db.boxes.orderBy('createdAt').toArray(),
    decks: (await db.decks.orderBy('updatedAt').reverse().toArray()),
    boxItems: await db.boxItems.toArray(),
    deckItems: await db.deckItems.toArray(),
  }), []);
  if (!raw) return undefined;
  return buildStorage(raw.cards, raw.boxes, raw.decks, raw.boxItems, raw.deckItems);
}

function buildStorage(cards: Card[], boxes: Box[], decks: Deck[], boxItems: BoxItem[], deckItems: DeckItem[]): Storage {
  const owned = new Map(cards.map((c) => [c.id, c.count]));
  const ownedByName = new Map<string, number>();
  for (const c of cards) ownedByName.set(normName(c.name), (ownedByName.get(normName(c.name)) ?? 0) + Math.max(0, c.count));
  const boxName = new Map(boxes.map((b) => [b.id, b.name]));
  const builtDeck = new Map(decks.filter((d) => d.built).map((d) => [d.id, d.name]));
  const byCard = new Map<string, Place[]>();
  const byName = new Map<string, Place[]>();
  const push = (m: Map<string, Place[]>, k: string, p: Place) => {
    const arr = m.get(k) ?? [];
    const same = arr.find((x) => x.kind === p.kind && x.id === p.id);
    if (same) same.count += p.count;
    else arr.push({ ...p });
    m.set(k, arr);
  };
  for (const it of boxItems) {
    const name = boxName.get(it.boxId);
    if (name == null) continue;
    const p: Place = { kind: 'box', id: it.boxId, name, count: it.count };
    push(byCard, it.cardId, p);
    push(byName, normName(it.name), p);
  }
  // 組んであるデッキは、実際に持っている枚数の分だけ置き場所として数える（足りない分は数えない）
  const remaining = new Map(owned);
  for (const it of boxItems) remaining.set(it.cardId, (remaining.get(it.cardId) ?? 0) - it.count);
  for (const it of deckItems) {
    const name = builtDeck.get(it.deckId);
    if (name == null) continue;
    const have = Math.max(0, Math.min(it.count, remaining.get(it.cardId) ?? 0));
    if (!have) continue;
    remaining.set(it.cardId, (remaining.get(it.cardId) ?? 0) - have);
    const p: Place = { kind: 'deck', id: it.deckId, name, count: have };
    push(byCard, it.cardId, p);
    push(byName, normName(it.name), p);
  }
  return {
    cards, boxes, decks, boxItems, deckItems, owned, ownedByName,
    placesOf: (id) => byCard.get(id) ?? [],
    looseOf: (id) => (owned.get(id) ?? 0) - (byCard.get(id) ?? []).reduce((s, p) => s + p.count, 0),
    placesOfName: (name) => byName.get(normName(name)) ?? [],
  };
}

export function placeLabel(p: Place) {
  return `${p.name} ${p.count}枚`;
}

/** デッキの不足を名前ごとに計算する */
export interface DeckLine {
  name: string;
  items: DeckItem[];
  need: number;
  owned: number;
  /** ほかの組んであるデッキで使っている枚数 */
  usedElsewhere: { name: string; count: number }[];
  available: number;
  short: number;
  boxes: Place[];
}

export function deckLines(deck: Deck, st: Storage): DeckLine[] {
  const items = st.deckItems.filter((i) => i.deckId === deck.id);
  const groups = new Map<string, DeckItem[]>();
  for (const it of items) {
    const k = normName(it.name);
    groups.set(k, [...(groups.get(k) ?? []), it]);
  }
  const deckName = new Map(st.decks.map((d) => [d.id, d]));
  return [...groups.entries()].map(([k, its]) => {
    const need = its.reduce((s, i) => s + i.count, 0);
    const owned = st.ownedByName.get(k) ?? 0;
    const used = new Map<string, number>();
    for (const i of st.deckItems) {
      if (i.deckId === deck.id || normName(i.name) !== k) continue;
      const d = deckName.get(i.deckId);
      if (d?.built) used.set(d.name, (used.get(d.name) ?? 0) + i.count);
    }
    const usedElsewhere = [...used.entries()].map(([name, count]) => ({ name, count }));
    const available = owned - usedElsewhere.reduce((s, u) => s + u.count, 0);
    return {
      name: its[0].name, items: its, need, owned, usedElsewhere, available,
      short: Math.max(0, need - Math.max(0, available)),
      boxes: st.placesOfName(its[0].name).filter((p) => p.kind === 'box'),
    };
  });
}

/** 「4 ボルシャック・ドラゴン」「ボルシャック・ドラゴン ×4」のような行を読む */
export function parseDeckText(text: string): { name: string; count: number }[] {
  const out: { name: string; count: number }[] = [];
  for (let line of text.split(/\r?\n/)) {
    line = line.normalize('NFKC').trim();
    if (!line || /^[#＃【\[]/.test(line)) continue;
    let m = line.match(/^(\d{1,2})\s*(?:[x×*枚]\s*)?(.+)$/i);
    if (m) { out.push({ name: m[2].trim(), count: Number(m[1]) }); continue; }
    m = line.match(/^(.+?)\s*[x×*]\s*(\d{1,2})\s*(?:枚)?$/i) ?? line.match(/^(.+?)\s+(\d{1,2})\s*枚?$/);
    if (m) { out.push({ name: m[1].trim(), count: Number(m[2]) }); continue; }
    out.push({ name: line, count: 1 });
  }
  return out;
}

/** カードIDから表示用のカード情報を引く。公式リストに無い手入力カードは所持カードから作る */
export function resolveCard(id: string, cardDb: CardDb | null, st: Storage, name = ''): MasterCard {
  const m = cardDb?.byId.get(id);
  if (m) return m;
  const c = st.cards.find((x) => x.id === id);
  return {
    id, p: '', set: c?.setCode ?? '', no: c?.number ?? '', name: c?.name ?? name, cost: c?.cost ?? null,
    civ: c?.civilizations ?? [], type: c?.type ?? '', race: c?.race ?? '', power: c?.power ?? null, rarity: c?.rarity ?? '', img: c?.img,
  } as MasterCard;
}
