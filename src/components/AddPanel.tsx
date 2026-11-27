import { useMemo, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../db';
import { addMaster, changeBoxItem } from '../storage';
import type { Box } from '../types';
import { cardImageUrl, normNo, normSet, type CardDb, type MasterCard } from '../carddb';
import type { OcrResult } from '../ocr';
import { ScanPanel } from './ScanPanel';
import { CardScanner } from './CardScanner';
import { cropCard, NameIndex, recognizeCardByName, warmUpNameOcr, type CardRect, type NameRecResult } from '../namerec';
import { recognizeCode } from '../ocr';
import { loadFeatures, matchImage } from '../imagerec';
import { matchEmbed, warmUpEmbed } from '../embed';
import { costCivScore, readCostCiv, warmUpCostCiv, type CostCiv } from '../costciv';
import { detectCard, warpCard } from '../cardDetect';
import { useEffect } from 'react';
import { CardForm, type FormValues } from './CardForm';
import { CardGroups } from './CardGroups';
import { IconCamera, IconCheck, IconImage, IconSearch } from './Icons';

interface Props {
  cardDb: CardDb | null;
  lockedSet: string;
  setLockedSet: (s: string) => void;
  notify: (m: string) => void;
  /** 登録したカードを入れる箱 */
  targetBox?: Box | null;
  onClearTarget?: () => void;
}

export { addMaster } from '../storage';

export function AddPanel({ cardDb, lockedSet, setLockedSet, notify, targetBox, onClearTarget }: Props) {
  const owned = useLiveQuery(async () => new Map((await db.cards.toArray()).map((c) => [c.id, c.count])), []);
  const ownedSets = useLiveQuery(() => db.cards.orderBy('setCode').uniqueKeys(), []) as string[] | undefined;
  const [scan, setScan] = useState<OcrResult | null>(null);
  const [query, setQuery] = useState('');
  const [manual, setManual] = useState<{ key: number; values: Partial<FormValues> } | null>(null);

  const nameIndex = useMemo(() => (cardDb ? new NameIndex(cardDb) : null), [cardDb]);
  const [whole, setWhole] = useState<'idle' | 'camera'>('idle');
  const [busy, setBusy] = useState(false);
  const [stage, setStage] = useState('');
  const [nameRes, setNameRes] = useState<(NameRecResult & { exact: MasterCard[]; ranked: { card: MasterCard; score: number }[] }) | null>(null);
  const [wholeError, setWholeError] = useState('');
  const [warped, setWarped] = useState('');
  const [costCiv, setCostCiv] = useState<CostCiv | null>(null);
  useEffect(() => { if (cardDb) { warmUpNameOcr(); loadFeatures(); warmUpEmbed(); warmUpCostCiv(); } }, [cardDb]);
  const byId = useMemo(() => new Map((cardDb?.list.cards ?? []).map((c) => [c.id, c])), [cardDb]);

  /** カード全体の画像から判別する。右下の番号が読めればそれで確定、だめならカード名で候補を出す */
  async function identify(src: HTMLCanvasElement | HTMLImageElement, rect: CardRect, isPhoto = false) {
    if (!cardDb || !nameIndex) return;
    setBusy(true);
    setWholeError('');
    setNameRes(null);
    try {
      setStage('カードを切り出しています…');
      // カードの四隅が見つかれば、まっすぐに直して切り出す。見つからなければ枠（写真なら全体）で切り出す
      const det = detectCard(src, isPhoto ? undefined : rect);
      const found = !!det && det.confidence >= 0.5;
      const card = found ? warpCard(src, det!.corners, 1300) : cropCard(src, rect, 1300);
      setWarped(card.toDataURL('image/jpeg', 0.7));
      setStage('コストを読み取っています…');
      const cc = await readCostCiv(card).catch(() => null);
      setCostCiv(cc);
      setStage('番号を読み取っています…');
      const code = await recognizeCode(card, { x: 0, y: 0.84, w: 1, h: 0.16 }, {
        knownSets, quick: true, targetHeight: 300,
        isValid: (p) => !!p.number && cardDb.findByCode(lockedSet || p.setCode, p.number).length > 0,
      }).catch(() => null);
      const exact = code?.valid ? cardDb.findByCode(lockedSet || code.setCode, code.number) : [];
      const r = await recognizeCardByName(card, { x: 0, y: 0, w: 1, h: 1 }, nameIndex, setStage);

      // イラストの色の配置で照合し、カード名の結果と合わせて順位をつける
      setStage('イラストを照合しています…');
      const fs = await loadFeatures();
      const score = new Map<string, { card: MasterCard; name: number; img: number; ai: number }>();
      for (const cand of r.candidates) for (const c of cand.cards) {
        const prev = score.get(c.id);
        if (!prev || prev.name < cand.score) score.set(c.id, { card: c, name: cand.score, img: 0, ai: 0 });
      }
      // 写真から選んで輪郭が見つからなかったときは、中央からいくつかの大きさで切り出して試す
      const crops = isPhoto && !found ? photoCrops(src) : [card];
      const addTop = (ids: string[]) => {
        for (const id of ids) {
          const c = byId.get(id);
          if (c && !score.has(c.id)) score.set(c.id, { card: c, name: 0, img: 0, ai: 0 });
        }
      };
      let simImg: ((id: string) => number) | null = null;
      if (fs) {
        const m = matchImage(crops, fs);
        addTop(m.top.map((t) => t.id));
        simImg = m.simOf;
      }
      // 画像認識AI（Googleレンズのような方式）で照合する
      setStage('イラストを照合しています…');
      const em = await matchEmbed(crops).catch((e) => { console.warn(e); return null; });
      if (em) addTop(em.top.map((t) => t.id));
      for (const v of score.values()) {
        if (simImg) v.img = Math.max(0, Math.min(1, (simImg(v.card.id) - 0.3) / 0.6));
        // AIの似ている度合いは、どのカードでもそれなりに高く出るので、いちばん似ているカードとの差で見る
        if (em) v.ai = Math.max(0, Math.min(1, 1 - (em.top[0].sim - em.simOf(v.card.id)) / 0.12));
      }
      const ranked = [...score.values()]
        .map((v) => ({
          card: v.card,
          score: em
            ? 0.35 * v.name + 0.1 * v.img + 0.55 * v.ai + (v.name > 0.6 && v.ai > 0.6 ? 0.2 : 0)
            : fs ? 0.5 * v.name + 0.5 * v.img + (v.name > 0.6 && v.img > 0.6 ? 0.2 : 0) : v.name,
        }))
        // 左上のコストと枠の色が合うカードを上げ、合わないカードを下げる
        .map((x) => (cc ? { ...x, score: x.score + 0.25 * costCivScore(cc, x.card) } : x))
        .sort((a, b) => b.score - a.score)
        .slice(0, 12);
      setNameRes({ ...r, exact, ranked });
      setWhole('idle');
      if (!exact.length && !ranked.length) setWholeError('見つかりませんでした。明るい場所で撮り直してみてください');
    } catch (e) {
      setWholeError('読み取りに失敗しました');
      console.error(e);
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
    img.onload = () => { identify(img, { x: 0, y: 0, w: 1, h: 1 }, true); URL.revokeObjectURL(img.src); };
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

  /** イラストごとの −/＋。0枚になっても記録は残す（一覧の「0枚も表示」で見える） */
  async function change(m: MasterCard, delta: number) {
    const n = owned?.get(m.id) ?? 0;
    if (delta > 0) {
      await addMaster(m, delta);
      if (targetBox) await changeBoxItem(targetBox.id, m, delta, false);
      notify(`${m.name} を追加（${n + delta}枚）${targetBox ? ` → ${targetBox.name}` : ''}`);
    } else if (n > 0) {
      await db.cards.update(m.id, { count: Math.max(0, n + delta), updatedAt: Date.now() });
      if (targetBox) await changeBoxItem(targetBox.id, m, delta, false);
      notify(`${m.name} を減らしました（${Math.max(0, n + delta)}枚）`);
    }
  }

  const photoGroups = useMemo(() => {
    if (!cardDb || !nameRes) return [];
    return cardDb.groupByName([...nameRes.exact, ...nameRes.ranked.map((r) => r.card)], nameRes.exact.length ? 3 : 6);
  }, [cardDb, nameRes]);
  const scanGroups = useMemo(
    () => (cardDb ? cardDb.groupByName(scanHits.exact.length ? scanHits.exact : scanHits.near) : []),
    [cardDb, scanHits],
  );
  const resultGroups = useMemo(() => (cardDb ? cardDb.groupByName(results) : []), [cardDb, results]);

  function onScan(r: OcrResult) {
    setScan(r);
    setManual(null);
    if (!cardDb) setManual({ key: Date.now(), values: { setCode: lockedSet || r.setCode, number: r.number, rarity: r.rarity } });
  }

  const scannedSet = scan ? lockedSet || scan.setCode : '';

  return (
    <>
      {targetBox && (
        <div className="target-box">
          <span>登録先: <b>{targetBox.name}</b></span>
          <button className="btn small" onClick={onClearTarget}>解除</button>
        </div>
      )}
      {cardDb && (
        <section className="panel">
          {whole === 'camera' ? (
            <CardScanner busy={busy} onCapture={identify} onClose={() => setWhole('idle')} />
          ) : (
            <div className="big-actions">
              <button className="btn primary" disabled={busy} onClick={() => { setWhole('camera'); setNameRes(null); setWholeError(''); }}>
                <IconCamera />カメラで撮る
              </button>
              <label className="btn file-btn">
                <IconImage />写真から選ぶ
                <input type="file" accept="image/*" capture="environment" onChange={onWholePhoto} hidden />
              </label>
            </div>
          )}
          {busy && <p className="progress-line"><span className="spinner" />{stage || '判別中…'}</p>}
          {wholeError && <p className="error">{wholeError}</p>}
          {nameRes && photoGroups.length > 0 && (
            <>
              {nameRes.exact.length > 0 ? <p className="match-badge"><IconCheck />番号で一致</p> : <p className="section-label">候補</p>}
              {cardDb && <CardGroups groups={photoGroups} cardDb={cardDb} owned={owned} onChange={change} highlight />}
            </>
          )}
          {nameRes && (
            <details className="ocr-debug">
              <summary>読み取り結果</summary>
              <p className="hint">名前: {nameRes.lines.slice(0, 6).join(' / ') || '—'}</p>
              {costCiv && <p className="hint">コスト: {costCiv.cost ?? '—'}　文明: {costCiv.civConfidence > 0.3 ? Object.entries(costCiv.civ).filter(([, v]) => v >= 0.5).map(([k]) => k).join('/') : '—'}</p>}
              {warped && <img className="warped" src={warped} alt="切り出したカード" />}
            </details>
          )}
        </section>
      )}

      {cardDb ? (
        <section className="panel">
          <div className="search-box">
            <IconSearch />
            <input type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="カード名・パック番号で検索" />
          </div>
          {query && !results.length && <p className="hint">該当するカードがありません</p>}
          {results.length > 0 && (
            <CardGroups groups={resultGroups} cardDb={cardDb} owned={owned} onChange={change} highlight={/^[A-Za-z0-9-]{3,10}(\s|$)/.test(query.trim())} />
          )}
        </section>
      ) : (
        <section className="panel">
          <p className="hint">カードリストを読み込めていません。手入力で登録できます。</p>
        </section>
      )}

      <details className="panel manual" open={!cardDb}>
        <summary>番号で読み取る</summary>
        <ScanPanel knownSets={knownSets} setLocked={!!lockedSet} isValid={isValid} onResult={onScan} />

      {cardDb && scan && (
        <section className="panel">
          {scanHits.exact.length > 0 ? (
            <CardGroups groups={scanGroups} cardDb={cardDb} owned={owned} onChange={change} highlight />
          ) : (
            <>
              <h2>{scan.number || scan.setCode ? `「${[scannedSet, scan.number].filter(Boolean).join(' ')}」は見つかりません` : '読み取れませんでした'}</h2>
              {scanHits.near.length > 0 && <CardGroups groups={scanGroups} cardDb={cardDb} owned={owned} onChange={change} highlight />}
            </>
          )}
          {scannedSet && (
            <label className="check">
              <input type="checkbox" checked={!!lockedSet} onChange={(e) => setLockedSet(e.target.checked ? scannedSet : '')} />
              パック「{lockedSet || scannedSet}」に固定
            </label>
          )}
        </section>
      )}
      </details>

      <details className="panel manual" open={!cardDb || !!manual}>
        <summary>手入力で登録</summary>
        <CardForm key={manual?.key ?? 0} initial={manual?.values ?? {}} onSaved={notify} lockedSet={lockedSet} onLockChange={setLockedSet} />
      </details>
    </>
  );
}

/** 公式サイトのカード画像。読み込めないときは代わりの表示を出す */
export function CardThumb({ card, fallback, big }: { card: { id: string; img?: string; name: string }; fallback: React.ReactNode; big?: boolean }) {
  const url = cardImageUrl(card);
  const [failed, setFailed] = useState(false);
  if (!url || failed) return <>{fallback}</>;
  return <img className={`thumb ${big ? 'big' : ''}`} src={url} alt={card.name} loading="lazy" referrerPolicy="no-referrer" onError={() => setFailed(true)} />;
}

/** 写真の中央から、カードの縦横比（63:88）でいくつかの大きさに切り出す */
function photoCrops(src: HTMLCanvasElement | HTMLImageElement): HTMLCanvasElement[] {
  const W = src instanceof HTMLImageElement ? src.naturalWidth : src.width;
  const H = src instanceof HTMLImageElement ? src.naturalHeight : src.height;
  const aspect = 63 / 88;
  return [1, 0.85, 0.72, 0.6].map((s) => {
    let h = H * s, w = h * aspect;
    if (w > W * s) { w = W * s; h = w / aspect; }
    return cropCard(src, { x: (W - w) / 2 / W, y: (H - h) / 2 / H, w: w / W, h: h / H }, 650);
  });
}
