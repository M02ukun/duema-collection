import { useMemo, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../db';
import { CARD_TYPES, CIVILIZATIONS, CIV_COLORS, type Card, type Civilization } from '../types';
import { CardForm } from './CardForm';
import { civBg } from './CostBadge';
import { cardImageUrl } from '../carddb';
import { placeLabel, type Storage } from '../storage';
import { Places } from './Places';

type SortKey = 'cost' | 'name' | 'createdAt' | 'count' | 'number' | 'power';
const SORT_LABELS: Record<SortKey, string> = {
  cost: 'コスト', name: '名前', createdAt: '登録日', count: '枚数', number: 'パック・番号', power: 'パワー',
};
type CivMode = 'any' | 'all' | 'mono' | 'multi';

const collator = new Intl.Collator('ja');

function numberSortKey(c: Card) {
  const m = c.number.match(/^([A-Z]*)(\d+)/);
  return { prefix: m?.[1] ?? '', n: m ? Number(m[2]) : 9999 };
}

export function CollectionList({ notify, st, onOpenPlace }: {
  notify: (m: string) => void;
  st?: Storage;
  onOpenPlace?: (kind: 'box' | 'deck', id: string) => void;
}) {
  const cards = useLiveQuery(() => db.cards.toArray(), []);
  const [q, setQ] = useState('');
  const [civs, setCivs] = useState<Civilization[]>([]);
  const [civMode, setCivMode] = useState<CivMode>('any');
  const [costMin, setCostMin] = useState('');
  const [costMax, setCostMax] = useState('');
  const [type, setType] = useState('');
  const [setCode, setSetCode] = useState('');
  const [showZero, setShowZero] = useState(false);
  const [place, setPlace] = useState('');
  const [sortKey, setSortKey] = useState<SortKey>('cost');
  const [desc, setDesc] = useState(false);
  const [editing, setEditing] = useState<Card | null>(null);
  const [showFilters, setShowFilters] = useState(false);
  const [view, setViewState] = useState<'grid' | 'list'>(() => {
    try { return localStorage.getItem('view') === 'list' ? 'list' : 'grid'; } catch { return 'grid'; }
  });
  const setView = (v: 'grid' | 'list') => {
    setViewState(v);
    try { localStorage.setItem('view', v); } catch { /* 保存できなくても問題ない */ }
  };

  const types = useMemo(() => {
    const all = new Set<string>(CARD_TYPES.filter((t) => t !== 'その他'));
    for (const c of cards ?? []) for (const t of c.type.split(/\s*\/\s*/)) if (t) all.add(t);
    return [...all];
  }, [cards]);
  const sets = useMemo(() => [...new Set((cards ?? []).map((c) => c.setCode).filter(Boolean))].sort(), [cards]);

  const list = useMemo(() => {
    if (!cards) return [];
    const kw = q.trim().toLowerCase();
    const min = costMin === '' ? -Infinity : Number(costMin);
    const max = costMax === '' ? Infinity : Number(costMax);
    const out = cards.filter((c) => {
      if (!showZero && c.count <= 0) return false;
      if (place && st) {
        if (place === 'loose') { if (st.looseOf(c.id) <= 0) return false; }
        else if (!st.placesOf(c.id).some((p) => `${p.kind}:${p.id}` === place)) return false;
      }
      if (kw && ![c.name, c.race, c.memo, c.setCode, c.number].some((s) => s.toLowerCase().includes(kw))) return false;
      if (costMin !== '' || costMax !== '') {
        if (c.cost == null || c.cost < min || c.cost > max) return false;
      }
      if (type && !c.type.split(/\s*\/\s*/).includes(type)) return false;
      if (setCode && c.setCode !== setCode) return false;
      if (civMode === 'mono' && c.civilizations.length !== 1) return false;
      if (civMode === 'multi' && c.civilizations.length < 2) return false;
      if (civs.length) {
        if (civMode === 'all') {
          if (!civs.every((x) => c.civilizations.includes(x))) return false;
        } else if (!civs.some((x) => c.civilizations.includes(x))) return false;
      }
      return true;
    });
    const dir = desc ? -1 : 1;
    out.sort((a, b) => {
      let r = 0;
      switch (sortKey) {
        case 'cost': r = (a.cost ?? 999) - (b.cost ?? 999); break;
        case 'power': r = (a.power ?? -1) - (b.power ?? -1); break;
        case 'count': r = a.count - b.count; break;
        case 'createdAt': r = a.createdAt - b.createdAt; break;
        case 'name': r = 0; break;
        case 'number': {
          r = collator.compare(a.setCode, b.setCode);
          if (!r) {
            const ka = numberSortKey(a), kb = numberSortKey(b);
            r = collator.compare(ka.prefix, kb.prefix) || ka.n - kb.n;
          }
          break;
        }
      }
      return r * dir || collator.compare(a.name, b.name);
    });
    return out;
  }, [cards, q, civs, civMode, costMin, costMax, type, setCode, showZero, sortKey, desc, place, st]);

  const totalKinds = list.length;
  const totalCount = list.reduce((s, c) => s + Math.max(0, c.count), 0);
  const activeFilters = [q, costMin, costMax, type, setCode, place].filter(Boolean).length + civs.length + (civMode !== 'any' ? 1 : 0);

  async function bump(c: Card, d: number) {
    await db.cards.update(c.id, { count: Math.max(0, c.count + d), updatedAt: Date.now() });
  }

  function reset() {
    setQ(''); setCivs([]); setCivMode('any'); setCostMin(''); setCostMax(''); setType(''); setSetCode(''); setPlace('');
  }

  if (editing) {
    return (
      <>
        <CardForm key={editing.id} initial={{}} editing={editing} onCancel={() => setEditing(null)}
          onSaved={(m) => { notify(m); setEditing(null); }} />
        {st && <div className="panel"><Places st={st} cardId={editing.id} onOpen={onOpenPlace} /></div>}
        <div className="panel">
          <button className="btn danger" onClick={async () => {
            if (!confirm(`「${editing.name}」を削除しますか？`)) return;
            await db.cards.delete(editing.id);
            notify(`「${editing.name}」を削除しました`);
            setEditing(null);
          }}>このカードを削除</button>
        </div>
      </>
    );
  }

  return (
    <>
      <section className="panel filters">
        <div className="row">
          <input className="grow" type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="名前・種族・メモで検索" />
          <button className={`btn ${showFilters ? 'primary' : ''}`} onClick={() => setShowFilters((s) => !s)}>
            絞り込み{activeFilters ? `(${activeFilters})` : ''}
          </button>
        </div>
        <div className="civ-toggle">
          {CIVILIZATIONS.map((c) => (
            <button key={c} className={civs.includes(c) ? 'on' : ''} style={{ '--civ': CIV_COLORS[c] } as React.CSSProperties}
              onClick={() => setCivs((p) => (p.includes(c) ? p.filter((x) => x !== c) : [...p, c]))}>{c}</button>
          ))}
        </div>
        {showFilters && (
          <div className="filter-more">
            <label>文明の条件
              <select value={civMode} onChange={(e) => setCivMode(e.target.value as CivMode)}>
                <option value="any">選んだ文明のどれかを含む</option>
                <option value="all">選んだ文明をすべて含む</option>
                <option value="mono">単色のみ</option>
                <option value="multi">多色のみ</option>
              </select>
            </label>
            <div className="grid2">
              <label>コスト（下限）<input inputMode="numeric" value={costMin} onChange={(e) => setCostMin(e.target.value.replace(/\D/g, ''))} /></label>
              <label>コスト（上限）<input inputMode="numeric" value={costMax} onChange={(e) => setCostMax(e.target.value.replace(/\D/g, ''))} /></label>
            </div>
            <div className="grid2">
              <label>種類
                <select value={type} onChange={(e) => setType(e.target.value)}>
                  <option value="">すべて</option>
                  {types.map((t) => <option key={t}>{t}</option>)}
                </select>
              </label>
              <label>パック
                <select value={setCode} onChange={(e) => setSetCode(e.target.value)}>
                  <option value="">すべて</option>
                  {sets.map((s) => <option key={s}>{s}</option>)}
                </select>
              </label>
            </div>
            {st && (st.boxes.length > 0 || st.decks.some((d) => d.built)) && (
              <label>置き場所
                <select value={place} onChange={(e) => setPlace(e.target.value)}>
                  <option value="">すべて</option>
                  <option value="loose">未整理</option>
                  {st.boxes.map((b) => <option key={b.id} value={`box:${b.id}`}>ストレージ: {b.name}</option>)}
                  {st.decks.filter((d) => d.built).map((d) => <option key={d.id} value={`deck:${d.id}`}>デッキ: {d.name}</option>)}
                </select>
              </label>
            )}
            <label className="check"><input type="checkbox" checked={showZero} onChange={(e) => setShowZero(e.target.checked)} /> 0枚のカードも表示</label>
            <button className="btn" onClick={reset}>条件をリセット</button>
          </div>
        )}
        <div className="row sort-row">
          <span>並び替え</span>
          <select value={sortKey} onChange={(e) => setSortKey(e.target.value as SortKey)}>
            {(Object.keys(SORT_LABELS) as SortKey[]).map((k) => <option key={k} value={k}>{SORT_LABELS[k]}</option>)}
          </select>
          <button className="btn small" onClick={() => setDesc((d) => !d)}>{desc ? '↓ 降順' : '↑ 昇順'}</button>
          <span className="view-toggle">
            <button className={view === 'grid' ? 'on' : ''} onClick={() => setView('grid')} aria-label="イラストで表示">▦</button>
            <button className={view === 'list' ? 'on' : ''} onClick={() => setView('list')} aria-label="リストで表示">☰</button>
          </span>
          <span className="summary">{totalKinds}種 / {totalCount}枚</span>
        </div>
      </section>

      {cards && cards.length === 0 && (
        <p className="empty">カードがありません</p>
      )}
      {view === 'grid' ? (
        <ul className="card-grid">
          {list.map((c) => {
            const url = cardImageUrl(c);
            return (
              <li key={c.id} className={c.count <= 0 ? 'zero' : ''}>
                <button className="grid-card" onClick={() => setEditing(c)}>
                  {url ? (
                    <img src={url} alt={c.name} loading="lazy" referrerPolicy="no-referrer"
                      onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = 'none'; }} />
                  ) : null}
                  <span className="grid-fallback" style={{ background: civBg(c.civilizations) }}>
                    <b>{c.cost ?? '-'}</b><span>{c.name}</span>
                  </span>
                  <span className="grid-count">×{c.count}</span>
                </button>
              </li>
            );
          })}
        </ul>
      ) : (
      <ul className="card-list">
        {list.map((c) => (
          <li key={c.id} className={c.count <= 0 ? 'zero' : ''}>
            <button className="card-main" onClick={() => setEditing(c)}>
              <span className="cost" style={{ background: civBg(c.civilizations) }}>{c.cost ?? '-'}</span>
              <span className="info">
                <span className="name">{c.name}</span>
                <span className="meta">
                  {[c.civilizations.join('/') || '文明未設定', c.type, c.race, c.power != null ? `${c.power}` : '', c.rarity].filter(Boolean).join('・')}
                </span>
                {(c.setCode || c.number) && <span className="code">{c.setCode} {c.number}</span>}
                {st && st.placesOf(c.id).length > 0 && <span className="code">{st.placesOf(c.id).map(placeLabel).join('　')}</span>}
              </span>
            </button>
            <span className="counter">
              <button onClick={() => bump(c, -1)} aria-label="1枚減らす">−</button>
              <b>{c.count}</b>
              <button onClick={() => bump(c, 1)} aria-label="1枚増やす">＋</button>
            </span>
          </li>
        ))}
      </ul>
      )}
    </>
  );
}
