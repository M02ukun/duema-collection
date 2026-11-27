import { useMemo, useState } from 'react';
import { db } from '../db';
import { normName, type CardDb, type MasterCard } from '../carddb';
import { changeDeckItem, deckLines, deleteDeck, parseDeckText, placeLabel, resolveCard, type DeckLine, type Storage } from '../storage';
import { newId, type Civilization, type Deck } from '../types';
import { CardThumb } from './AddPanel';
import { CostBadge } from './CostBadge';
import { DeckEditor } from './DeckEditor';
import { IconBack, IconChevron, IconDeck } from './Icons';

export function Decks({ cardDb, st, openId, setOpenId, notify, onOpenBox }: {
  cardDb: CardDb | null;
  st: Storage;
  openId: string | null;
  setOpenId: (id: string | null) => void;
  notify: (m: string) => void;
  onOpenBox: (id: string) => void;
}) {
  const [name, setName] = useState('');
  const open = st.decks.find((d) => d.id === openId);

  async function create(e: React.FormEvent) {
    e.preventDefault();
    const id = newId();
    const now = Date.now();
    await db.decks.put({ id, name: name.trim() || `デッキ${st.decks.length + 1}`, built: false, memo: '', createdAt: now, updatedAt: now });
    setName('');
    setOpenId(id);
  }

  if (open) return <DeckDetail deck={open} cardDb={cardDb} st={st} onBack={() => setOpenId(null)} notify={notify} onOpenBox={onOpenBox} />;

  return (
    <>
      <form className="panel row" onSubmit={create}>
        <input className="grow" value={name} onChange={(e) => setName(e.target.value)} placeholder="新しいデッキの名前" />
        <button className="btn primary" type="submit">追加</button>
      </form>
      {!st.decks.length && <div className="empty-state"><IconDeck />デッキを作ると、足りないカードと置き場所が分かります</div>}
      {st.decks.length > 0 && (
        <ul className="place-list">
          {st.decks.map((d) => {
            const lines = deckLines(d, st);
            const total = lines.reduce((s, l) => s + l.need, 0);
            const short = lines.reduce((s, l) => s + l.short, 0);
            return (
              <li key={d.id}>
                <button onClick={() => setOpenId(d.id)}>
                  <span className="place-icon"><IconDeck /></span>
                  <span className="place-text">
                    <span className="name">{d.name} <span className={`badge ${d.built ? 'on' : ''}`}>{d.built ? '組んである' : '組みたい'}</span></span>
                    <span className="hint">{total}/40{short ? <b className="short"> · 不足{short}</b> : total ? ' · そろっている' : ''}</span>
                  </span>
                  <span className="chev"><IconChevron /></span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </>
  );
}

function DeckDetail({ deck, cardDb, st, onBack, notify, onOpenBox }: {
  deck: Deck;
  cardDb: CardDb | null;
  st: Storage;
  onBack: () => void;
  notify: (m: string) => void;
  onOpenBox: (id: string) => void;
}) {
  const [mode, setMode] = useState<'edit' | 'check'>('edit');
  const [importing, setImporting] = useState(false);
  const [text, setText] = useState('');
  const [unmatched, setUnmatched] = useState<string[]>([]);
  const [onlyShort, setOnlyShort] = useState(false);
  const lines = useMemo(() => deckLines(deck, st).sort((a, b) => {
    const ca = resolveCard(a.items[0].cardId, cardDb, st, a.name).cost ?? 99;
    const cb = resolveCard(b.items[0].cardId, cardDb, st, b.name).cost ?? 99;
    return ca - cb || a.name.localeCompare(b.name, 'ja');
  }), [deck, st, cardDb]);
  const total = lines.reduce((s, l) => s + l.need, 0);
  const short = lines.reduce((s, l) => s + l.short, 0);

  async function change(m: { id: string; name: string }, d: number) {
    await changeDeckItem(deck.id, m, d);
  }

  /** 名前からカードを選ぶ。持っているイラストがあればそれ、無ければいちばん新しいもの */
  function pick(name: string): { id: string; name: string } | null {
    const n = normName(name);
    const ownedCards = st.cards.filter((c) => normName(c.name) === n && c.count > 0).sort((a, b) => b.count - a.count);
    if (ownedCards[0]) return ownedCards[0];
    const official = cardDb?.nameOfNorm.get(n);
    if (official) return cardDb!.sameName(official)[0];
    // ツインパクトの片面の名前だけ書かれている場合
    const half = cardDb && [...cardDb.byName.keys()].find((k) => k.split(' / ').some((p) => normName(p) === n));
    if (half) return cardDb!.sameName(half)[0];
    return null;
  }

  async function doImport() {
    const rows = parseDeckText(text);
    const miss: string[] = [];
    let added = 0;
    for (const r of rows) {
      const c = pick(r.name);
      if (!c) { miss.push(`${r.count} ${r.name}`); continue; }
      // 持っているイラストが複数あれば、持っている枚数に合わせて振り分ける
      const n = normName(c.name);
      let left = r.count;
      for (const o of st.cards.filter((x) => normName(x.name) === n && x.count > 0).sort((a, b) => b.count - a.count)) {
        const k = Math.min(left, o.count);
        if (k > 0) { await changeDeckItem(deck.id, o, k); left -= k; }
      }
      if (left > 0) await changeDeckItem(deck.id, c, left);
      added += r.count;
    }
    setUnmatched(miss);
    notify(`${added}枚を追加${miss.length ? ` · ${miss.length}行は該当なし` : ''}`);
    if (!miss.length) { setText(''); setImporting(false); }
    else setText(miss.join('\n'));
  }

  function copy(s: string, what: string) {
    navigator.clipboard?.writeText(s).then(() => notify(`${what}をコピーしました`), () => notify('コピーできませんでした'));
  }
  const listText = lines.map((l) => `${l.need} ${l.name}`).join('\n');
  const shortText = lines.filter((l) => l.short).map((l) => `${l.short} ${l.name}`).join('\n');

  return (
    <>
      <button className="back-link" onClick={onBack}><IconBack />デッキ</button>
      <section className="panel">
        <input className="title-input" defaultValue={deck.name} aria-label="デッキの名前"
          onBlur={(e) => { const v = e.target.value.trim(); if (v && v !== deck.name) db.decks.update(deck.id, { name: v }); }} />
        <div className="seg">
          <button className={!deck.built ? 'on' : ''} onClick={() => db.decks.update(deck.id, { built: false })}>組みたい</button>
          <button className={deck.built ? 'on' : ''} onClick={() => db.decks.update(deck.id, { built: true })}>組んである</button>
        </div>
        <div className="action-row">
          <button className={`btn ${importing ? 'primary' : ''}`} onClick={() => setImporting((s) => !s)}>貼り付け</button>
          {total > 0 && <button className="btn" onClick={() => copy(listText, 'デッキリスト')}>コピー</button>}
          {short > 0 && <button className="btn" onClick={() => copy(shortText, '不足リスト')}>不足をコピー</button>}
        </div>
        {importing && (
          <div className="stack">
            <textarea rows={8} value={text} onChange={(e) => setText(e.target.value)}
              placeholder={'4 ボルシャック・ドラゴン\n2 ボルメテウス・ホワイト・ドラゴン'} />
            {unmatched.length > 0 && <p className="error">上の行は見つかりませんでした</p>}
            <button className="btn primary" onClick={doImport} disabled={!text.trim()}>追加</button>
          </div>
        )}
      </section>
      <div className="seg wide">
        <button className={mode === 'edit' ? 'on' : ''} onClick={() => setMode('edit')}>カードを選ぶ</button>
        <button className={mode === 'check' ? 'on' : ''} onClick={() => setMode('check')}>不足・置き場所{short ? ` ${short}` : ''}</button>
      </div>
      {mode === 'edit' && (cardDb ? <DeckEditor deck={deck} lines={lines} cardDb={cardDb} st={st} onChange={change} /> : <p className="progress-line"><span className="spinner" />読み込み中…</p>)}
      {mode === 'check' && <section className="panel">
        {short > 0 && <label className="check"><input type="checkbox" checked={onlyShort} onChange={(e) => setOnlyShort(e.target.checked)} /> 不足のみ</label>}
        {!lines.length && <p className="hint">カードがありません</p>}
        <ul className="deck-lines">
          {lines.filter((l) => !onlyShort || l.short).map((l) => (
            <DeckRow key={l.name} line={l} cardDb={cardDb} st={st} onChange={change} onOpenBox={onOpenBox} built={deck.built} />
          ))}
        </ul>
      </section>}
      <section className="panel">
        <button className="btn danger" onClick={async () => {
          if (!confirm(`「${deck.name}」を削除しますか？ カードの所持枚数は変わりません。`)) return;
          await deleteDeck(deck.id);
          notify(`${deck.name} を削除しました`);
          onBack();
        }}>デッキを削除</button>
      </section>
    </>
  );
}

function DeckRow({ line: l, cardDb, st, onChange, onOpenBox, built }: {
  line: DeckLine;
  cardDb: CardDb | null;
  st: Storage;
  onChange: (m: MasterCard, d: number) => void;
  onOpenBox: (id: string) => void;
  built: boolean;
}) {
  const cards = l.items.map((i) => ({ item: i, card: resolveCard(i.cardId, cardDb, st, i.name) }));
  return (
    <li className={l.short ? 'is-short' : ''}>
      <div className="deck-thumbs">
        {cards.map(({ item, card }) => (
          <div key={item.id} className="deck-thumb">
            <CardThumb card={card} fallback={<CostBadge cost={card.cost} civs={card.civ as Civilization[]} />} />
            <span className="counter">
              <button onClick={() => onChange(card, -1)} aria-label={`${card.name}を1枚減らす`}>−</button>
              <b>{item.count}</b>
              <button onClick={() => onChange(card, 1)} aria-label={`${card.name}を1枚増やす`}>＋</button>
            </span>
          </div>
        ))}
      </div>
      <div className="deck-info">
        <span className="name">{l.name}</span>
        <span className="meta">
          必要{l.need} · 所持{l.owned}
          {l.usedElsewhere.map((u) => ` · ${u.name}で${u.count}`).join('')}
        </span>
        {l.short > 0 ? <b className="short">不足{l.short}</b> : <span className="ok">OK</span>}
        {!built && l.boxes.length > 0 && (
          <span className="places">
            {l.boxes.map((p) => <button key={p.id} className="chip" onClick={() => onOpenBox(p.id)}>{placeLabel(p)}</button>)}
          </span>
        )}
      </div>
    </li>
  );
}
