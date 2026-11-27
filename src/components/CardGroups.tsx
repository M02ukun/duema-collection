import type { CardDb, MasterCard } from '../carddb';
import { CIV_COLORS, type Civilization } from '../types';
import { CardThumb } from './AddPanel';
import { CostBadge } from './CostBadge';

export interface Group {
  name: string;
  cards: MasterCard[];
  /** 検索・判別で当たったカード（枠を強調する） */
  first: Set<string>;
}

/**
 * 同じ名前のカードを1行にまとめ、イラストを横スクロールで選べるようにする。
 * イラストごとに −/＋ で枚数を増減できる。
 */
export function CardGroups({ groups, cardDb, owned, counts, countLabel = '所持', onChange, highlight, note }: {
  groups: Group[];
  cardDb: CardDb;
  owned?: Map<string, number>;
  /** −/＋で増減する枚数（箱やデッキの中の枚数）。省略時は所持枚数 */
  counts?: Map<string, number>;
  countLabel?: string;
  onChange: (m: MasterCard, delta: number) => void;
  /** 当たったカードを強調表示する */
  highlight?: boolean;
  /** カードごとの補足（点数など） */
  note?: (m: MasterCard) => string;
}) {
  return (
    <div className="groups">
      {groups.map((g) => {
        const cnt = counts ?? owned;
        const total = g.cards.reduce((s, c) => s + (cnt?.get(c.id) ?? 0), 0);
        const ownedTotal = counts ? g.cards.reduce((s, c) => s + (owned?.get(c.id) ?? 0), 0) : 0;
        const head = g.cards[0];
        return (
          <div key={g.name} className="group">
            <div className="group-head">
              <span className="cand-label">{g.name}</span>
              <span className="group-meta">
                {head.civ.map((c) => <i key={c} className="civ-dot" style={{ background: CIV_COLORS[c as Civilization] }} title={c} />)}
                {[head.cost != null ? `コスト${head.cost}` : '', g.cards.length > 1 ? `${g.cards.length}種` : '', total ? `${countLabel}${total}` : '', ownedTotal ? `所持${ownedTotal}` : ''].filter(Boolean).join(' · ')}
              </span>
            </div>
            <div className="cand-row">
              {g.cards.map((m) => {
                const n = cnt?.get(m.id) ?? 0;
                const hit = highlight && g.first.has(m.id);
                return (
                  <div key={m.id} className={`group-card ${hit ? 'hit' : ''} ${n ? 'owned' : ''}`}>
                    <button className="cand-card" onClick={() => onChange(m, 1)} title={`${m.name} ${m.set} ${m.no}`}>
                      <CardThumb card={m} big fallback={<CostBadge cost={m.cost} civs={m.civ as Civilization[]} />} />
                      {n > 0 && <span className="grid-count">×{n}</span>}
                    </button>
                    <span className="group-code" title={cardDb.productName.get(m.p) ?? ''}>
                      {m.set} {m.no}{m.rarity ? ` ${m.rarity}` : ''}{note ? note(m) : ''}
                    </span>
                    <span className="counter">
                      <button disabled={!n} onClick={() => onChange(m, -1)} aria-label={`${m.name}（${m.set} ${m.no}）を1枚減らす`}>−</button>
                      <b>{n}</b>
                      <button className="plus" onClick={() => onChange(m, 1)} aria-label={`${m.name}（${m.set} ${m.no}）を1枚増やす`}>＋</button>
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        );
      })}
    </div>
  );
}
