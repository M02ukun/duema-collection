import { useMemo, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { addCard, db } from '../db';
import { cardImageUrl, normNo, normSet, type CardDb, type MasterCard } from '../carddb';
import type { OcrResult } from '../ocr';
import { CIVILIZATIONS, type Civilization } from '../types';
import { ScanPanel } from './ScanPanel';
import { CardScanner } from './CardScanner';
import { cropCard, NameIndex, recognizeCardByName, warmUpNameOcr, type CardRect, type NameRecResult } from '../namerec';
import { recognizeCode } from '../ocr';
import { useEffect } from 'react';
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
      img: m.img,
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

  const nameIndex = useMemo(() => (cardDb ? new NameIndex(cardDb) : null), [cardDb]);
  const [whole, setWhole] = useState<'idle' | 'camera'>('idle');
  const [busy, setBusy] = useState(false);
  const [stage, setStage] = useState('');
  const [nameRes, setNameRes] = useState<(NameRecResult & { exact: MasterCard[] }) | null>(null);
  const [wholeError, setWholeError] = useState('');
  useEffect(() => { if (cardDb) warmUpNameOcr(); }, [cardDb]);

  /** カード全体の画像から判別する。右下の番号が読めればそれで確定、だめならカード名で候補を出す */
  async function identify(src: HTMLCanvasElement | HTMLImageElement, rect: CardRect) {
    if (!cardDb || !nameIndex) return;
    setBusy(true);
    setWholeError('');
    setNameRes(null);
    try {
      setStage('番号を探しています…');
      const card = cropCard(src, rect, 1300);
      const code = await recognizeCode(card, { x: 0, y: 0.84, w: 1, h: 0.16 }, {
        knownSets, quick: true, targetHeight: 300,
        isValid: (p) => !!p.number && cardDb.findByCode(lockedSet || p.setCode, p.number).length > 0,
      }).catch(() => null);
      const exact = code?.valid ? cardDb.findByCode(lockedSet || code.setCode, code.number) : [];
      const r = await recognizeCardByName(card, { x: 0, y: 0, w: 1, h: 1 }, nameIndex, setStage);
      setNameRes({ ...r, exact });
      setWhole('idle');
      if (!exact.length && !r.candidates.length) setWholeError('判別できませんでした。明るい場所で、カードが枠いっぱいになるように撮り直してください。');
    } catch (e) {
      setWholeError('読み取りに失敗しました（初回は文字認識データのダウンロードにネット接続が必要です）: ' + String(e));
    } finally {
      setBusy(false);
      setStage('');
    }
  }

  function onWholePhoto(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    e.target.value = '';
    if (!f) return;
    const img = new Image();
    img.onload = () => { identify(img, { x: 0, y: 0, w: 1, h: 1 }); URL.revokeObjectURL(img.src); };
    img.src = URL.createObjectURL(f);
  }

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
      {cardDb && (
        <section className="panel">
          <h2>カード全体で判別（おすすめ）</h2>
          {whole === 'camera' ? (
            <CardScanner busy={busy} onCapture={identify} onClose={() => setWhole('idle')} />
          ) : (
            <div className="stack">
              <button className="btn primary" disabled={busy} onClick={() => { setWhole('camera'); setNameRes(null); setWholeError(''); }}>
                📷 カメラでカード全体を撮る
              </button>
              <label className="btn file-btn">
                🖼 写真を撮る / 選ぶ（カードが写真いっぱいに写るように）
                <input type="file" accept="image/*" capture="environment" onChange={onWholePhoto} hidden />
              </label>
            </div>
          )}
          {busy && <p className="hint">{stage || '判別中…'}（初回は文字認識データの読み込みに少し時間がかかります）</p>}
          {wholeError && <p className="error">{wholeError}</p>}
          {nameRes && nameRes.exact.length > 0 && (
            <>
              <p className="ok">番号から特定しました</p>
              <MasterList cards={nameRes.exact} owned={owned} onAdd={add} big />
            </>
          )}
          {nameRes && nameRes.candidates.length > 0 && (
            <>
              <p className="hint">{nameRes.exact.length ? 'ほかの候補' : 'このカードですか？ イラストをタップすると1枚登録します'}</p>
              {nameRes.candidates.slice(0, nameRes.exact.length ? 3 : 6).map((cand) => (
                <div key={cand.cards[0].id} className="cand">
                  <div className="cand-name">{cand.cards[0].name}<span className="hint">（一致度 {Math.round(cand.score * 100)}%・{cand.cards.length}種類）</span></div>
                  <div className="cand-row">
                    {cand.cards.slice(0, 24).map((m) => (
                      <button key={m.id} className="cand-card" onClick={() => add(m)} title={`${m.set} ${m.no}`}>
                        <CardThumb card={m} big fallback={<CostBadge cost={m.cost} civs={m.civ as Civilization[]} />} />
                        <span>{m.set}<br />{m.no}{owned?.get(m.id) ? ` ・${owned.get(m.id)}枚` : ''}</span>
                      </button>
                    ))}
                  </div>
                </div>
              ))}
            </>
          )}
          {nameRes && (
            <details className="ocr-debug">
              <summary>読み取った文字: {nameRes.lines.slice(0, 6).join(' / ') || '（なし）'}</summary>
              <img src={nameRes.preview} alt="判別に使った画像" />
            </details>
          )}
        </section>
      )}

      <details className="panel manual" open={!cardDb}>
        <summary>右下の番号で読み取る</summary>
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
      </details>

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
            <CardThumb card={m} fallback={<CostBadge cost={m.cost} civs={m.civ as Civilization[]} />} big={big} />
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

/** 公式サイトのカード画像。読み込めないときは代わりの表示を出す */
export function CardThumb({ card, fallback, big }: { card: { id: string; img?: string; name: string }; fallback: React.ReactNode; big?: boolean }) {
  const url = cardImageUrl(card);
  const [failed, setFailed] = useState(false);
  if (!url || failed) return <>{fallback}</>;
  return <img className={`thumb ${big ? 'big' : ''}`} src={url} alt={card.name} loading="lazy" referrerPolicy="no-referrer" onError={() => setFailed(true)} />;
}
