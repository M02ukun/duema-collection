import { useState } from 'react';
import type { CardDb, MasterCard } from '../carddb';
import type { NameIndex } from '../namerec';
import { warpCard } from '../cardDetect';
import { detectCards } from '../multiDetect';
import { identifyCard, type IdentifyResult } from '../identify';
import { CardThumb } from './AddPanel';
import { CostBadge } from './CostBadge';
import type { Civilization } from '../types';

interface Item {
  photo: string;
  res: IdentifyResult | null;
  /** 候補のカード名（上から順） */
  names: string[];
  pick: MasterCard | null;
  on: boolean;
}

/** 番号が読めたか、名前とイラストの両方でよく合ったときだけ「判別できた」とする */
function confident(r: IdentifyResult) {
  return r.exact.length > 0 || ((r.ranked[0]?.score ?? 0) >= 0.75 && r.topSim >= 0.8);
}

/** 机に並べた複数のカードを1枚の写真から判別して、まとめて登録する */
export function MultiPanel({ cardDb, nameIndex, knownSets, lockedSet, onRegister, notify }: {
  cardDb: CardDb;
  nameIndex: NameIndex;
  knownSets: string[];
  lockedSet: string;
  onRegister: (cards: { card: MasterCard; n: number }[]) => Promise<void>;
  notify: (m: string) => void;
}) {
  const [items, setItems] = useState<Item[]>([]);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');

  async function onPhoto(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    e.target.value = '';
    if (!f) return;
    setError('');
    setItems([]);
    setBusy('カードを探しています…');
    try {
      const img = new Image();
      img.src = URL.createObjectURL(f);
      await img.decode();
      const found = detectCards(img);
      if (!found.length) { setError('カードが見つかりませんでした。無地の机に、少し間をあけて並べて撮ってください'); return; }
      const cards = found.map((d) => warpCard(img, d.corners, 1300));
      const list: Item[] = cards.map((c) => ({ photo: c.toDataURL('image/jpeg', 0.6), res: null, names: [], pick: null, on: false }));
      setItems(list);
      for (let i = 0; i < cards.length; i++) {
        setBusy(`判別しています… ${i + 1}/${cards.length}`);
        const r = await identifyCard(cards[i], { cardDb, nameIndex, knownSets, lockedSet });
        const order = [...r.exact, ...r.ranked.map((x) => x.card)];
        const names = [...new Set(order.map((c) => c.name))].slice(0, 6);
        list[i] = { ...list[i], res: r, names, pick: order[0] ?? null, on: !!order[0] && confident(r) };
        setItems([...list]);
      }
      URL.revokeObjectURL(img.src);
    } catch (err) {
      console.error(err);
      setError('読み取りに失敗しました');
    } finally {
      setBusy('');
    }
  }

  function update(i: number, p: Partial<Item>) {
    setItems((xs) => xs.map((x, k) => (k === i ? { ...x, ...p } : x)));
  }

  const chosen = items.filter((x) => x.on && x.pick);
  async function register() {
    // 同じカードが複数写っていれば枚数にまとめる
    const m = new Map<string, { card: MasterCard; n: number }>();
    for (const x of chosen) {
      const e = m.get(x.pick!.id) ?? { card: x.pick!, n: 0 };
      e.n++;
      m.set(x.pick!.id, e);
    }
    await onRegister([...m.values()]);
    notify(`${chosen.length}枚を登録しました`);
    setItems([]);
  }

  // 同じカードが何枚写っているか
  const dup = new Map<string, number>();
  for (const x of chosen) dup.set(x.pick!.id, (dup.get(x.pick!.id) ?? 0) + 1);

  return (
    <div className="stack">
      <label className={`btn file-btn ${busy ? 'disabled' : ''}`}>
        まとめて撮る
        <input type="file" accept="image/*" onChange={onPhoto} hidden disabled={!!busy} />
      </label>
      {busy && <p className="progress-line"><span className="spinner" />{busy}</p>}
      {error && <p className="error">{error}</p>}
      {items.length > 0 && (
        <ul className="multi-list">
          {items.map((x, i) => {
            const same = x.pick ? cardDb.sameName(x.pick.name) : [];
            return (
              <li key={i} className={x.on ? 'on' : ''}>
                <img className="multi-photo" src={x.photo} alt="" />
                <div className="multi-body">
                  {!x.res ? <span className="hint">待機中</span> : !x.pick ? <span className="hint">判別できませんでした</span> : (
                    <>
                      <select value={x.pick.name} onChange={(e) => update(i, { pick: cardDb.sameName(e.target.value)[0] ?? null, on: true })}>
                        {x.names.map((n) => <option key={n} value={n}>{n}</option>)}
                      </select>
                      {!confident(x.res) && <span className="multi-warn">自信なし（デュエマ以外のカードかも）</span>}
                      {same.length > 1 && (
                        <div className="multi-ills">
                          {same.map((c) => (
                            <button key={c.id} className={c.id === x.pick!.id ? 'on' : ''} onClick={() => update(i, { pick: c, on: true })} title={`${c.set} ${c.no}`}>
                              <CardThumb card={c} fallback={<CostBadge cost={c.cost} civs={c.civ as Civilization[]} />} />
                              <span>{c.set}</span>
                            </button>
                          ))}
                        </div>
                      )}
                      <label className="check">
                        <input type="checkbox" checked={x.on} onChange={(e) => update(i, { on: e.target.checked })} /> 登録する
                        {x.on && (dup.get(x.pick.id) ?? 0) > 1 && <span className="hint"> · 同じカード{dup.get(x.pick.id)}枚</span>}
                      </label>
                    </>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}
      {items.length > 0 && !busy && (
        <button className="btn primary" disabled={!chosen.length} onClick={register}>{chosen.length}枚を登録</button>
      )}
    </div>
  );
}
