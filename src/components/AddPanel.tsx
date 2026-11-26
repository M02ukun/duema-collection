import { useMemo, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { addCard, db } from '../db';
import { normNo, normSet, type CardDb, type MasterCard } from '../carddb';
import type { OcrResult } from '../ocr';
import { CIVILIZATIONS, type Civilization } from '../types';
import { ScanPanel } from './ScanPanel';
import { CardForm, type FormValues } from './CardForm';
import { CostBadge } from './CostBadge';

interface Props {
  cardDb: CardDb | null;
  lockedSet: string;
  setLockedSet: (s: string) => void;
  notify: (m: string) => void;
}

/** 公式カードリストのカードを、所持カードとして1枚追加する */
export async function addMaster(m: MasterCard, n = 1) {
  await addCard(
    {
      id: m.id,
      setCode: m.set,
      number: m.no,
      name: m.name,
      cost: m.cost,
      civilizations: CIVILIZATIONS.filter((c) => m.civ.includes(c)),
      type: m.type,
      race: m.race,
      power: m.power,
      rarity: m.rarity,
      memo: '',
    },
    n,
  );
}

export function AddPanel({ cardDb, lockedSet, setLockedSet, notify }: Props) {
  const owned = useLiveQuery(async () => new Map((await db.cards.toArray()).map((c) => [c.id, c.count])), []);
  const ownedSets = useLiveQuery(() => db.cards.orderBy('setCode').uniqueKeys(), []) as string[] | undefined;
  const [scan, setScan] = useState<OcrResult | null>(null);
  const [query, setQuery] = useState('');
  const [manual, setManual] = useState<{ key: number; values: Partial<FormValues> } | null>(null);

  const knownSets = useMemo(
    () => [...new Set([...(cardDb?.sets ?? []), ...(ownedSets ?? []).filter(Boolean).map(normSet)])],
    [cardDb, ownedSets],
  );

  const isValid = cardDb
    ? (p: { setCode: string; number: string }) => !!p.number && cardDb.findByCode(lockedSet || p.setCode, p.number).length > 0
    : undefined;

  // 読み取った番号に一致するカード。見つからなければ、同じパックの同じ番号あたりを候補に出す
  const scanHits = useMemo(() => {
    if (!scan || !cardDb) return { exact: [] as MasterCard[], near: [] as MasterCard[] };
    const set = lockedSet || scan.setCode;
    const exact = scan.number ? cardDb.findByCode(set, scan.number) : [];
    if (exact.length) return { exact, near: [] };
    const n = normNo(scan.number).split('/')[0];
    const inSet = set ? cardDb.cardsOfSet(set) : [];
    const near = inSet.length
      ? inSet.filter((c) => !n || normNo(c.no).split('/')[0] === n || normNo(c.no).split('/')[1] === normNo(scan.number).split('/')[1]).slice(0, 30)
      : scan.number
        ? cardDb.list.cards.filter((c) => normNo(c.no) === normNo(scan.number)).slice(0, 30)
        : [];
    return { exact, near };
  }, [scan, cardDb, lockedSet]);

  const results = useMemo(() => (cardDb && query ? cardDb.search(query) : []), [cardDb, query]);

  async function add(m: MasterCard) {
    await addMaster(m);
    notify(`「${m.name}」を登録しました（${(owned?.get(m.id) ?? 0) + 1}枚目）`);
  }

  function onScan(r: OcrResult) {
    setScan(r);
    setManual(null);
    if (!cardDb) setManual({ key: Date.now(), values: { setCode: lockedSet || r.setCode, number: r.number, rarity: r.rarity } });
  }

  const scannedSet = scan ? lockedSet || scan.setCode : '';

  return (
    <>
      <ScanPanel knownSets={knownSets} setLocked={!!lockedSet} isValid={isValid} onResult={onScan} />

      {cardDb && scan && (
        <section className="panel">
          {scanHits.exact.length > 0 ? (
            <>
              <h2>見つかりました</h2>
              <MasterList cards={scanHits.exact} owned={owned} onAdd={add} big />
            </>
          ) : (
            <>
              <h2>{scan.number || scan.setCode ? `「${[scannedSet, scan.number].filter(Boolean).join(' ')}」は見つかりませんでした` : '読み取れませんでした'}</h2>
              <p className="hint">番号の読み間違いかもしれません。{scanHits.near.length ? '近い候補から選ぶか、' : ''}下の検索で名前を入れて探してください。</p>
              {scanHits.near.length > 0 && <MasterList cards={scanHits.near} owned={owned} onAdd={add} />}
            </>
          )}
          {scannedSet && (
            <label className="check">
              <input type="checkbox" checked={!!lockedSet} onChange={(e) => setLockedSet(e.target.checked ? scannedSet : '')} />
              パック「{lockedSet || scannedSet}」を固定する（同じパックを続けて登録するとき。番号だけ読めればOKになります）
            </label>
          )}
        </section>
      )}

      {cardDb ? (
        <section className="panel">
          <h2>名前・番号で探す</h2>
          <input type="search" value={query} onChange={(e) => setQuery(e.target.value)}
            placeholder="例: ジャシン、ボルシャック、25SD1 2" />
          {query && !results.length && <p className="hint">見つかりませんでした。</p>}
          {results.length > 0 && <MasterList cards={results} owned={owned} onAdd={add} />}
          <p className="hint">カードリスト: {cardDb.size.toLocaleString()}枚（{new Date(cardDb.list.updatedAt).toLocaleDateString('ja-JP')} 時点）</p>
        </section>
      ) : (
        <section className="panel">
          <p className="hint">公式カードリストがまだ読み込まれていないので、カード情報は手で入力します。「データ」タブからカードリストのファイルを読み込むこともできます。</p>
        </section>
      )}

      <details className="panel manual" open={!cardDb || !!manual}>
        <summary>手入力で登録する</summary>
        <CardForm key={manual?.key ?? 0} initial={manual?.values ?? {}} onSaved={notify} lockedSet={lockedSet} onLockChange={setLockedSet} />
      </details>
    </>
  );
}

export function MasterList({ cards, owned, onAdd, big }: {
  cards: MasterCard[];
  owned?: Map<string, number>;
  onAdd: (m: MasterCard) => void;
  big?: boolean;
}) {
  return (
    <ul className={`card-list master ${big ? 'big' : ''}`}>
      {cards.map((m) => {
        const n = owned?.get(m.id) ?? 0;
        return (
          <li key={m.id}>
            <CostBadge cost={m.cost} civs={m.civ as Civilization[]} />
            <span className="info">
              <span className="name">{m.name}</span>
              <span className="meta">{[m.civ.join('/'), m.type, m.rarity].filter(Boolean).join('・')}</span>
              <span className="code">{m.set} {m.no}{n ? `　所持 ${n}枚` : ''}</span>
            </span>
            <button className="btn primary add-btn" onClick={() => onAdd(m)} aria-label={`${m.name}を1枚登録`}>
              {big ? '＋ 登録' : '＋'}
            </button>
          </li>
        );
      })}
    </ul>
  );
}
