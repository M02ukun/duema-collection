export const CIVILIZATIONS = ['光', '水', '闇', '火', '自然', 'ゼロ'] as const;
export type Civilization = (typeof CIVILIZATIONS)[number];

export const CIV_COLORS: Record<Civilization, string> = {
  光: '#e8c22e',
  水: '#2f7fd6',
  闇: '#4b4b55',
  火: '#e0453a',
  自然: '#2e9e4f',
  ゼロ: '#9a9aa5',
};

export const CARD_TYPES = [
  'クリーチャー',
  '呪文',
  'ツインパクト',
  'タマシード',
  'クロスギア',
  'D2フィールド',
  'フィールド',
  'オーラ',
  '城',
  'その他',
];

export interface Card {
  /** 収録番号から作るキー（例: "DM24RP1#12/77"）。番号が無い手入力カードは "manual:..." */
  id: string;
  /** パック記号（例: DM24-RP1） */
  setCode: string;
  /** カードリスト番号（例: 12/77、S1/S11） */
  number: string;
  name: string;
  cost: number | null;
  civilizations: Civilization[];
  type: string;
  race: string;
  power: number | null;
  rarity: string;
  memo: string;
  /** 公式サイトのサムネイル画像ファイル名（公式カードリストから登録したとき） */
  img?: string;
  /** 所持枚数 */
  count: number;
  createdAt: number;
  updatedAt: number;
}

export function normalizeSetCode(s: string): string {
  return s.toUpperCase().replace(/[\s\-‐－ー_]/g, '');
}

export function normalizeNumber(s: string): string {
  return s.toUpperCase().replace(/\s/g, '').replace(/／/g, '/');
}

export function makeCardId(setCode: string, number: string, name: string): string {
  const sc = normalizeSetCode(setCode);
  const no = normalizeNumber(number);
  if (sc && no) return `${sc}#${no}`;
  return `manual:${name.trim()}`;
}
