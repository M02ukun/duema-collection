import Dexie, { type EntityTable } from 'dexie';
import type { Box, BoxItem, Card, Deck, DeckItem } from './types';

// 端末内（IndexedDB）に保存する。サーバーは使わない。
export const db = new Dexie('duema-collection') as Dexie & {
  cards: EntityTable<Card, 'id'>;
  boxes: EntityTable<Box, 'id'>;
  boxItems: EntityTable<BoxItem, 'id'>;
  decks: EntityTable<Deck, 'id'>;
  deckItems: EntityTable<DeckItem, 'id'>;
};

db.version(1).stores({
  cards: 'id, setCode, name, cost, type, count, createdAt, updatedAt',
});
// 箱（収納ケース）とデッキ
db.version(2).stores({
  cards: 'id, setCode, name, cost, type, count, createdAt, updatedAt',
  boxes: 'id, createdAt',
  boxItems: 'id, boxId, cardId',
  decks: 'id, updatedAt',
  deckItems: 'id, deckId, cardId',
});

const TABLES = ['cards', 'boxes', 'boxItems', 'decks', 'deckItems'] as const;

/** カードを登録する。同じカードがすでにあれば枚数を足し、内容を最新に更新する */
export async function addCard(card: Omit<Card, 'createdAt' | 'updatedAt' | 'count'>, addCount: number) {
  const now = Date.now();
  await db.transaction('rw', db.cards, async () => {
    const existing = await db.cards.get(card.id);
    if (existing) {
      await db.cards.put({ ...existing, ...card, count: existing.count + addCount, updatedAt: now });
    } else {
      await db.cards.put({ ...card, count: addCount, createdAt: now, updatedAt: now });
    }
  });
}

export async function exportJson(): Promise<string> {
  const out: Record<string, unknown> = { app: 'duema-collection', version: 2, exportedAt: new Date().toISOString() };
  for (const t of TABLES) out[t] = await db[t].toArray();
  return JSON.stringify(out, null, 2);
}

export async function importJson(text: string, mode: 'merge' | 'replace'): Promise<number> {
  const data = JSON.parse(text);
  const cards: Card[] = Array.isArray(data) ? data : data.cards;
  if (!Array.isArray(cards)) throw new Error('カードデータが見つかりません');
  await db.transaction('rw', TABLES.map((t) => db[t]), async () => {
    if (mode === 'replace') for (const t of TABLES) await db[t].clear();
    await db.cards.bulkPut(cards);
    for (const t of TABLES.slice(1)) if (!Array.isArray(data) && Array.isArray(data[t])) await (db[t] as typeof db.boxes).bulkPut(data[t]);
  });
  return cards.length;
}
