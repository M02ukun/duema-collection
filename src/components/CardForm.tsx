import { useEffect, useRef, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { addCard, db } from '../db';
import { cardImageUrl } from '../carddb';
import { CARD_TYPES, CIVILIZATIONS, CIV_COLORS, makeCardId, type Card, type Civilization } from '../types';

export interface FormValues {
  setCode: string;
  number: string;
  name: string;
  cost: string;
  civilizations: Civilization[];
  type: string;
  race: string;
  power: string;
  rarity: string;
  memo: string;
}

export const EMPTY_FORM: FormValues = {
  setCode: '', number: '', name: '', cost: '', civilizations: [], type: 'クリーチャー',
  race: '', power: '', rarity: '', memo: '',
};

export function cardToForm(c: Card): FormValues {
  return {
    setCode: c.setCode, number: c.number, name: c.name,
    cost: c.cost == null ? '' : String(c.cost), civilizations: c.civilizations,
    type: c.type, race: c.race, power: c.power == null ? '' : String(c.power),
    rarity: c.rarity, memo: c.memo,
  };
}

function toNum(s: string): number | null {
  const t = s.replace(/[０-９]/g, (d) => String.fromCharCode(d.charCodeAt(0) - 0xfee0)).replace(/[^\d]/g, '');
  return t === '' ? null : Number(t);
}

interface Props {
  /** 外から（OCR など）値を流し込むとき用。key を変えると反映される */
  initial: Partial<FormValues>;
  /** 編集モードのときの元カード */
  editing?: Card;
  onSaved: (msg: string) => void;
  onCancel?: () => void;
  /** 固定しているパック記号（同じパックを続けて登録するとき用） */
  lockedSet?: string;
  onLockChange?: (setCode: string) => void;
}

export function CardForm({ initial, editing, onSaved, onCancel, lockedSet = '', onLockChange }: Props) {
  const [v, setV] = useState<FormValues>({
    ...EMPTY_FORM,
    ...(editing ? cardToForm(editing) : { setCode: lockedSet }),
    ...Object.fromEntries(Object.entries(initial).filter(([, x]) => x !== '' && x != null)),
  });
  const [addCount, setAddCount] = useState(1);
  const [ownedCount, setOwnedCount] = useState(editing?.count ?? 0);
  const autofilledId = useRef<string | null>(editing?.id ?? null);
  const names = useLiveQuery(() => db.cards.orderBy('name').uniqueKeys(), []) as string[] | undefined;

  const set = <K extends keyof FormValues>(k: K, val: FormValues[K]) => setV((p) => ({ ...p, [k]: val }));

  // パック記号＋番号が登録済みのカードと一致したら、残りの項目を自動で埋める
  useEffect(() => {
    if (editing) return;
    const id = makeCardId(v.setCode, v.number, '');
    if (id.startsWith('manual:') || id === autofilledId.current) return;
    let cancelled = false;
    db.cards.get(id).then((c) => {
      if (cancelled || !c) return;
      autofilledId.current = id;
      setV((p) => ({ ...cardToForm(c), setCode: p.setCode, number: p.number, rarity: c.rarity || p.rarity }));
      setOwnedCount(c.count);
    });
    return () => { cancelled = true; };
  }, [v.setCode, v.number, editing]);

  // 番号なしの手入力で、登録済みのカード名を選んだときも自動で埋める
  async function onNameBlur() {
    if (editing || v.setCode || v.number || !v.name) return;
    const c = await db.cards.where('name').equals(v.name).first();
    if (c) {
      setV(cardToForm(c));
      setOwnedCount(c.count);
    }
  }

  function toggleCiv(c: Civilization) {
    set('civilizations', v.civilizations.includes(c) ? v.civilizations.filter((x) => x !== c) : [...v.civilizations, c]);
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!v.name.trim()) return alertMsg('カード名を入力してください');
    const id = makeCardId(v.setCode, v.number, v.name);
    const base = {
      id,
      setCode: v.setCode.trim().toUpperCase(),
      number: v.number.trim().toUpperCase(),
      name: v.name.trim(),
      cost: toNum(v.cost),
      civilizations: CIVILIZATIONS.filter((c) => v.civilizations.includes(c)),
      type: v.type,
      race: v.race.trim(),
      power: toNum(v.power),
      rarity: v.rarity.trim().toUpperCase(),
      memo: v.memo,
    };
    if (editing) {
      if (id !== editing.id && (await db.cards.get(id))) {
        return alertMsg('同じパック記号・番号のカードがすでにあります');
      }
      await db.transaction('rw', db.cards, async () => {
        if (id !== editing.id) await db.cards.delete(editing.id);
        await db.cards.put({ ...editing, ...base, count: ownedCount, updatedAt: Date.now() });
      });
      onSaved(`「${base.name}」を更新しました`);
    } else {
      await addCard(base, addCount);
      onSaved(`「${base.name}」を ${addCount} 枚登録しました`);
      setV({ ...EMPTY_FORM, setCode: lockedSet });
      setAddCount(1);
      setOwnedCount(0);
      autofilledId.current = null;
    }
  }

  const [msg, setMsg] = useState('');
  function alertMsg(m: string) {
    setMsg(m);
    setTimeout(() => setMsg(''), 3000);
  }

  const searchQ = encodeURIComponent(['デュエマ', v.setCode, v.number, v.name].filter(Boolean).join(' '));

  return (
    <form className="panel card-form" onSubmit={submit}>
      <h2>{editing ? 'カードを編集' : 'カード情報'}</h2>
      {editing && cardImageUrl(editing) && (
        <img className="detail-img" src={cardImageUrl(editing)!} alt={editing.name} referrerPolicy="no-referrer"
          onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = 'none'; }} />
      )}
      {!editing && ownedCount > 0 && <p className="ok">登録済み（{ownedCount}枚）</p>}
      <div className="grid2">
        <label>パック記号<input value={v.setCode} onChange={(e) => set('setCode', e.target.value)} placeholder="24RP3" autoCapitalize="characters" /></label>
        <label>番号<input value={v.number} onChange={(e) => set('number', e.target.value)} placeholder="19/76" /></label>
      </div>
      {!editing && onLockChange && (
        <label className="check">
          <input type="checkbox" checked={!!lockedSet && lockedSet === v.setCode}
            disabled={!v.setCode} onChange={(e) => onLockChange(e.target.checked ? v.setCode : '')} />
          このパック記号を固定する（同じパックを続けて登録するとき。番号だけ読めればOKになります）
        </label>
      )}
      {(v.setCode || v.number || v.name) && (
        <p className="links">
          調べる: <a href="https://dm.takaratomy.co.jp/card/" target="_blank" rel="noreferrer">公式カード検索</a>
          {' / '}<a href={`https://www.google.com/search?q=${searchQ}`} target="_blank" rel="noreferrer">Google</a>
        </p>
      )}
      <label>カード名 *
        <input value={v.name} onChange={(e) => set('name', e.target.value)} onBlur={onNameBlur} list="card-names" required />
        <datalist id="card-names">{names?.map((n) => <option key={n} value={n} />)}</datalist>
      </label>
      <div className="field">
        <span>文明</span>
        <div className="civ-toggle">
          {CIVILIZATIONS.map((c) => (
            <button type="button" key={c} className={v.civilizations.includes(c) ? 'on' : ''}
              style={{ '--civ': CIV_COLORS[c] } as React.CSSProperties} onClick={() => toggleCiv(c)}>{c}</button>
          ))}
        </div>
      </div>
      <div className="grid3">
        <label>コスト<input value={v.cost} onChange={(e) => set('cost', e.target.value)} inputMode="numeric" /></label>
        <label>パワー<input value={v.power} onChange={(e) => set('power', e.target.value)} inputMode="numeric" /></label>
        <label>レアリティ<input value={v.rarity} onChange={(e) => set('rarity', e.target.value)} placeholder="SR" list="rarities" />
          <datalist id="rarities">{['C', 'U', 'R', 'VR', 'SR', 'MR', 'OR', 'DM', 'KGM', 'SP'].map((r) => <option key={r} value={r} />)}</datalist>
        </label>
      </div>
      <div className="grid2">
        <label>種類
          <input value={v.type} onChange={(e) => set('type', e.target.value)} list="card-types" />
          <datalist id="card-types">{CARD_TYPES.map((t) => <option key={t} value={t} />)}</datalist>
        </label>
        <label>種族<input value={v.race} onChange={(e) => set('race', e.target.value)} /></label>
      </div>
      <label>メモ<input value={v.memo} onChange={(e) => set('memo', e.target.value)} placeholder="デッキ用、トレード候補 など" /></label>
      {editing ? (
        <label>所持枚数<Counter value={ownedCount} onChange={setOwnedCount} min={0} /></label>
      ) : (
        <label>登録する枚数<Counter value={addCount} onChange={setAddCount} min={1} /></label>
      )}
      {msg && <p className="error">{msg}</p>}
      <div className="row">
        <button className="btn primary" type="submit">{editing ? '保存' : '登録する'}</button>
        {onCancel && <button className="btn" type="button" onClick={onCancel}>キャンセル</button>}
      </div>
    </form>
  );
}

export function Counter({ value, onChange, min = 0 }: { value: number; onChange: (n: number) => void; min?: number }) {
  return (
    <span className="counter">
      <button type="button" onClick={() => onChange(Math.max(min, value - 1))}>−</button>
      <b>{value}</b>
      <button type="button" onClick={() => onChange(value + 1)}>＋</button>
    </span>
  );
}
