import { Fragment, useMemo, useState } from 'react';
import { normName, type CardDb, type MasterCard } from '../carddb';
import { resolveCard, type DeckLine, type Storage } from '../storage';
import { CIVILIZATIONS, CIV_COLORS, type Civilization, type Deck } from '../types';
import { CardThumb } from './AddPanel';
import { CardGroups } from './CardGroups';
import { CostBadge } from './CostBadge';

/**
 * デッキを作る画面。上にいまのデッキ（常に見える）、下でカードを探してタップで追加する。
 */
export function DeckEditor({ deck, lines, cardDb, st, onChange }: {
  deck: Deck;
  lines: DeckLine[];
  cardDb: CardDb;
  st: Storage;
  onChange: (m: MasterCard, d: number) => void;
}) {
  const [q, setQ] = useState('');
  const [civs, setCivs] = useState<Civilization[]>([]);
  const [cost, setCost] = useState('');
  const [onlyOwned, setOnlyOwned] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(null);

  const deckCounts = useMemo(() => {
    const m = new Map<string, number>();
    for (const i of st.deckItems) if (i.deckId === deck.id) m.set(i.cardId, i.count);
    return m;
  }, [st, deck.id]);
  const countByName = useMemo(() => {
    const m = new Map<string, number>();
    for (const l of lines) m.set(normName(l.name), l.need);
    return m;
  }, [lines]);
  const total = lines.reduce((s, l) => s + l.need, 0);
  const short = lines.reduce((s, l) => s + l.short, 0);

  // デッキの中身（コスト順）。イラストごとに1枚ずつ並べる
  const deckCards = useMemo(() => lines.flatMap((l) => l.items.map((it) => ({ line: l, item: it, card: resolveCard(it.cardId, cardDb, st, it.name) })))
    .sort((a, b) => (a.card.cost ?? 99) - (b.card.cost ?? 99) || a.card.name.localeCompare(b.card.name, 'ja')), [lines, cardDb, st]);

  // 探す。名前が空でも、文明やコストを選べば一覧が出る。同じ名前は1枚にまとめる
  const results = useMemo(() => {
    const kw = q.trim();
    if (!kw && !civs.length && cost === '') return [];
    const base = kw ? cardDb.search(kw, 600) : cardDb.list.cards;
    const seen = new Set<string>();
    const out: MasterCard[] = [];
    for (const c of base) {
      if (seen.has(c.name)) continue;
      if (civs.length && !civs.every((x) => c.civ.includes(x))) continue;
      if (cost !== '' && (cost === '10' ? (c.cost ?? -1) < 10 : c.cost !== Number(cost))) continue;
      const k = normName(c.name);
      if (onlyOwned && !(st.ownedByName.get(k) ?? 0)) continue;
      seen.add(c.name);
      // 持っているイラストがあればそれを代表にする
      const own = cardDb.sameName(c.name).filter((x) => (st.owned.get(x.id) ?? 0) > 0).sort((a, b) => (st.owned.get(b.id) ?? 0) - (st.owned.get(a.id) ?? 0))[0];
      out.push(own ?? c);
      if (out.length >= 90) break;
    }
    return out;
  }, [q, civs, cost, onlyOwned, cardDb, st]);

  return (
    <>
      <section className="panel deck-pane">
        <div className="deck-pane-head">
          <b className={total > 40 ? 'short' : ''}>{total} / 40枚</b>
          {short > 0 ? <span className="short">あと{short}枚足りない</span> : total > 0 ? <span className="ok">そろっています</span> : null}
          <span className="hint">タップで1枚減らす</span>
        </div>
        {deckCards.length ? (
          <div className="deck-grid">
            {deckCards.map(({ line, item, card }) => {
              const lacking = line.short > 0;
              return (
                <button key={item.id} className={`deck-cell ${lacking ? 'lacking' : ''}`} onClick={() => onChange(card, -1)}
                  title={`${card.name}（${card.set} ${card.no}）を1枚減らす`}>
                  <CardThumb card={card} fallback={<CostBadge cost={card.cost} civs={card.civ as Civilization[]} />} />
                  <span className="grid-count">×{item.count}</span>
                </button>
              );
            })}
          </div>
        ) : <p className="hint">下でカードを探して、タップするとデッキに入ります。</p>}
      </section>

      <section className="panel">
        <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="カード名で探す（空でも文明・コストで探せます）" />
        <div className="civ-toggle">
          {CIVILIZATIONS.map((c) => (
            <button key={c} className={civs.includes(c) ? 'on' : ''} style={{ '--civ': CIV_COLORS[c] } as React.CSSProperties}
              onClick={() => setCivs((p) => (p.includes(c) ? p.filter((x) => x !== c) : [...p, c]))}>{c}</button>
          ))}
        </div>
        <div className="cost-pick">
          {['', '0', '1', '2', '3', '4', '5', '6', '7', '8', '9', '10'].map((c) => (
            <button key={c} className={cost === c ? 'on' : ''} onClick={() => setCost(c)}>{c === '' ? '全' : c === '10' ? '10+' : c}</button>
          ))}
        </div>
        <label className="check"><input type="checkbox" checked={onlyOwned} onChange={(e) => setOnlyOwned(e.target.checked)} /> 持っているカードだけ</label>
        {results.length > 0 && <p className="hint">タップでデッキに1枚追加。「イラスト」で別イラストを選べます。</p>}
        <div className="pick-grid">
          {results.map((m) => {
            const inDeck = countByName.get(normName(m.name)) ?? 0;
            const own = st.ownedByName.get(normName(m.name)) ?? 0;
            const variants = cardDb.sameName(m.name).length;
            return (
              <Fragment key={m.id}>
              <div className={`pick-cell ${inDeck ? 'in-deck' : ''}`}>
                <button className="pick-card" onClick={() => onChange(m, 1)} title={`${m.name}をデッキに1枚追加`}>
                  <CardThumb card={m} fallback={<CostBadge cost={m.cost} civs={m.civ as Civilization[]} />} />
                  {inDeck > 0 && <span className="grid-count">×{inDeck}</span>}
                </button>
                <span className="pick-name">{m.name}</span>
                <span className="pick-meta">
                  所持{own}
                  {variants > 1 && <button className="link" onClick={() => setExpanded(expanded === m.name ? null : m.name)}>イラスト{variants}</button>}
                </span>
              </div>
              {expanded === m.name && (
                <div className="pick-variants">
                  <CardGroups groups={cardDb.groupByName([m])} cardDb={cardDb} owned={st.owned} counts={deckCounts} countLabel="デッキに" onChange={onChange} />
                </div>
              )}
              </Fragment>
            );
          })}
        </div>
        {(q || civs.length > 0 || cost !== '') && !results.length && <p className="hint">見つかりませんでした。</p>}
      </section>
    </>
  );
}
