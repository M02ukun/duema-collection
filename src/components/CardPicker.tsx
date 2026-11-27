import { useMemo, useState } from 'react';
import type { CardDb, MasterCard } from '../carddb';
import { CardGroups } from './CardGroups';

/** 名前・番号で探して、イラストごとに −/＋ で枚数を変える（箱やデッキに入れるとき用） */
export function CardPicker({ cardDb, owned, counts, countLabel, onChange, note, placeholder, ownedOnly }: {
  cardDb: CardDb;
  owned?: Map<string, number>;
  counts: Map<string, number>;
  countLabel: string;
  onChange: (m: MasterCard, delta: number) => void;
  note?: (m: MasterCard) => string;
  placeholder?: string;
  /** 持っているカードだけ探す（初期値） */
  ownedOnly?: boolean;
}) {
  const [query, setQuery] = useState('');
  const [onlyOwned, setOnlyOwned] = useState(!!ownedOnly);
  const groups = useMemo(() => {
    if (!query.trim()) return [];
    let hits = cardDb.search(query, 400);
    if (onlyOwned && owned) {
      hits = hits.filter((c) => (owned.get(c.id) ?? 0) > 0);
      return cardDb.groupByName(hits).map((g) => ({ ...g, cards: g.cards.filter((c) => (owned.get(c.id) ?? 0) > 0 || g.first.has(c.id)) }));
    }
    return cardDb.groupByName(hits);
  }, [cardDb, query, onlyOwned, owned]);
  return (
    <div className="stack">
      <input type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder={placeholder ?? 'カード名・パック番号で探す'} />
      {ownedOnly !== undefined && (
        <label className="check"><input type="checkbox" checked={onlyOwned} onChange={(e) => setOnlyOwned(e.target.checked)} /> 持っているカードだけ</label>
      )}
      {query && !groups.length && <p className="hint">見つかりませんでした。</p>}
      {groups.length > 0 && (
        <CardGroups groups={groups} cardDb={cardDb} owned={owned} counts={counts} countLabel={countLabel} onChange={onChange} note={note} />
      )}
    </div>
  );
}
