import Dexie, { type EntityTable } from 'dexie';
import type { Card } from './types';

// 端末内（IndexedDB）に保存する。サーバーは使わない。
export const db = new Dexie('duema-collection') as Dexie & {
  cards: EntityTable<Card, 'id'>;
};

db.version(1).stores({
  cards: 'id, setCode, name, cost, type, count, createdAt, updatedAt',
});

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
  const cards = await db.cards.toArray();
  return JSON.stringify({ app: 'duema-collection', version: 1, exportedAt: new Date().toISOString(), cards }, null, 2);
}

export async function importJson(text: string, mode: 'merge' | 'replace'): Promise<number> {
  const data = JSON.parse(text);
  const cards: Card[] = Array.isArray(data) ? data : data.cards;
  if (!Array.isArray(cards)) throw new Error('カードデータが見つかりません');
  await db.transaction('rw', db.cards, async () => {
    if (mode === 'replace') await db.cards.clear();
    await db.cards.bulkPut(cards);
  });
  return cards.length;
}
