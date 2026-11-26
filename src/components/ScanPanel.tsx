import { useEffect, useRef, useState } from 'react';
import { DEFAULT_CROP, recognizeCode, warmUpOcr, type CropRect, type OcrResult } from '../ocr';
import { CameraScanner } from './CameraScanner';

interface Props {
  knownSets: string[];
  /** パック記号を固定しているときは、番号だけ読めれば十分 */
  setLocked: boolean;
  onResult: (r: OcrResult) => void;
}

export function ScanPanel({ knownSets, setLocked, onResult }: Props) {
  const [mode, setMode] = useState<'idle' | 'camera' | 'photo'>('idle');
  const [src, setSrc] = useState<string | null>(null);
  const [crop, setCrop] = useState<CropRect>(DEFAULT_CROP);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(0);
  const [result, setResult] = useState<OcrResult | null>(null);
  const [error, setError] = useState('');
  const imgRef = useRef<HTMLImageElement>(null);
  const boxRef = useRef<HTMLDivElement>(null);
  const dragStart = useRef<{ x: number; y: number } | null>(null);
  const goodScore = setLocked ? 3 : 6;
  const canCamera = typeof navigator !== 'undefined' && !!navigator.mediaDevices?.getUserMedia;

  useEffect(() => { warmUpOcr(); }, []);
  useEffect(() => () => { if (src) URL.revokeObjectURL(src); }, [src]);

  function handle(r: OcrResult) {
    setResult(r);
    setMode((m) => (m === 'camera' ? 'idle' : m));
    if (!r.number && !r.setCode) {
      setError('番号を読み取れませんでした。もう一度試すか、下のフォームに直接入力してください。');
    } else {
      setError('');
    }
    onResult(r);
  }

  function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    e.target.value = '';
    if (!f) return;
    setSrc(URL.createObjectURL(f));
    setMode('photo');
    setResult(null);
    setError('');
    setCrop(DEFAULT_CROP);
  }

  function rel(e: React.PointerEvent) {
    const r = boxRef.current!.getBoundingClientRect();
    return {
      x: Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)),
      y: Math.min(1, Math.max(0, (e.clientY - r.top) / r.height)),
    };
  }
  function onDown(e: React.PointerEvent) {
    (e.target as Element).setPointerCapture(e.pointerId);
    dragStart.current = rel(e);
  }
  function onMove(e: React.PointerEvent) {
    if (!dragStart.current) return;
    const p = rel(e), s = dragStart.current;
    const w = Math.abs(p.x - s.x), h = Math.abs(p.y - s.y);
    if (w < 0.02 || h < 0.01) return;
    setCrop({ x: Math.min(s.x, p.x), y: Math.min(s.y, p.y), w, h });
  }
  const onUp = () => { dragStart.current = null; };

  async function runPhoto(area: CropRect) {
    if (!imgRef.current) return;
    setBusy(true);
    setError('');
    setProgress(0);
    try {
      const full = area.w === 1 && area.h === 1;
      handle(await recognizeCode(imgRef.current, area, { knownSets, goodScore, onProgress: setProgress, targetHeight: full ? 400 : 220 }));
    } catch (err) {
      setError('読み取りに失敗しました: ' + String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="panel">
      <h2>カードを読み取る</h2>
      {mode === 'camera' ? (
        <CameraScanner knownSets={knownSets} goodScore={goodScore} onResult={handle} onClose={() => setMode('idle')} />
      ) : (
        <div className="stack">
          {canCamera && (
            <button className="btn primary" onClick={() => { setMode('camera'); setResult(null); setError(''); }}>
              📷 カメラで読み取る（おすすめ）
            </button>
          )}
          <label className="btn file-btn">
            🖼 写真を撮る / 選ぶ
            <input type="file" accept="image/*" capture="environment" onChange={onFile} hidden />
          </label>
          {canCamera && <p className="hint">カメラを右下の文字に近づけて、枠いっぱいに文字を入れると自動で読み取ります。</p>}
        </div>
      )}
      {mode === 'photo' && src && (
        <>
          <p className="hint">右下の文字を指でなぞって囲んでください。右下だけを近くで撮った写真なら「写真全体で読む」が使えます。</p>
          <div className="crop-box" ref={boxRef} onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp}>
            <img ref={imgRef} src={src} alt="撮影したカード" draggable={false} />
            <div className="crop-rect" style={{ left: `${crop.x * 100}%`, top: `${crop.y * 100}%`, width: `${crop.w * 100}%`, height: `${crop.h * 100}%` }} />
          </div>
          <div className="row">
            <button className="btn primary" onClick={() => runPhoto(crop)} disabled={busy}>
              {busy ? `読み取り中… ${Math.round(progress * 100)}%` : '🔍 囲んだ範囲を読む'}
            </button>
            <button className="btn" onClick={() => runPhoto({ x: 0, y: 0, w: 1, h: 1 })} disabled={busy}>写真全体で読む</button>
          </div>
        </>
      )}
      {error && <p className="error">{error}</p>}
      {result && (result.number || result.setCode) && (
        <p className="ok">読み取り結果: {[result.setCode, result.rarity, result.number].filter(Boolean).join(' ')}（違っていたら下で直してください）</p>
      )}
      {result && (
        <details className="ocr-debug">
          <summary>読み取った文字: {result.rawText || '（なし）'}</summary>
          <img src={result.preview} alt="読み取りに使った画像" />
        </details>
      )}
    </section>
  );
}
