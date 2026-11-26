import { useEffect, useRef, useState } from 'react';
import { DEFAULT_CROP, recognizeCode, type CropRect, type OcrResult } from '../ocr';

interface Props {
  onResult: (r: OcrResult) => void;
}

export function ScanPanel({ onResult }: Props) {
  const [src, setSrc] = useState<string | null>(null);
  const [crop, setCrop] = useState<CropRect>(DEFAULT_CROP);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(0);
  const [result, setResult] = useState<OcrResult | null>(null);
  const [error, setError] = useState('');
  const imgRef = useRef<HTMLImageElement>(null);
  const boxRef = useRef<HTMLDivElement>(null);
  const dragStart = useRef<{ x: number; y: number } | null>(null);

  useEffect(() => () => { if (src) URL.revokeObjectURL(src); }, [src]);

  function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    e.target.value = '';
    if (!f) return;
    setSrc(URL.createObjectURL(f));
    setCrop(DEFAULT_CROP);
    setResult(null);
    setError('');
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
    const p = rel(e);
    const s = dragStart.current;
    const w = Math.abs(p.x - s.x);
    const h = Math.abs(p.y - s.y);
    if (w < 0.02 || h < 0.01) return;
    setCrop({ x: Math.min(s.x, p.x), y: Math.min(s.y, p.y), w, h });
  }
  function onUp() {
    dragStart.current = null;
  }

  async function run() {
    if (!imgRef.current) return;
    setBusy(true);
    setError('');
    setProgress(0);
    try {
      const r = await recognizeCode(imgRef.current, crop, setProgress);
      setResult(r);
      onResult(r);
      if (!r.number && !r.setCode) setError('番号を読み取れませんでした。範囲を指で囲み直すか、下のフォームに直接入力してください。');
    } catch (err) {
      setError('読み取りに失敗しました（初回は文字認識データのダウンロードにネット接続が必要です）: ' + String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="panel">
      <h2>写真から読み取る</h2>
      <label className="btn primary file-btn">
        📷 カードを撮影 / 写真を選ぶ
        <input type="file" accept="image/*" capture="environment" onChange={onFile} hidden />
      </label>
      {src && (
        <>
          <p className="hint">右下の「パック記号」と「番号」が入るように、画像の上を指でなぞって範囲を囲んでください。</p>
          <div
            className="crop-box"
            ref={boxRef}
            onPointerDown={onDown}
            onPointerMove={onMove}
            onPointerUp={onUp}
            onPointerCancel={onUp}
          >
            <img ref={imgRef} src={src} alt="撮影したカード" draggable={false} />
            <div
              className="crop-rect"
              style={{ left: `${crop.x * 100}%`, top: `${crop.y * 100}%`, width: `${crop.w * 100}%`, height: `${crop.h * 100}%` }}
            />
          </div>
          <div className="row">
            <button className="btn primary" onClick={run} disabled={busy}>
              {busy ? `読み取り中… ${Math.round(progress * 100)}%` : '🔍 番号を読み取る'}
            </button>
            <button className="btn" onClick={() => setCrop(DEFAULT_CROP)} disabled={busy}>範囲を戻す</button>
          </div>
        </>
      )}
      {error && <p className="error">{error}</p>}
      {result && (
        <details className="ocr-debug">
          <summary>読み取った文字: {result.rawText || '（なし）'}</summary>
          <img src={result.preview} alt="読み取りに使った画像" />
        </details>
      )}
    </section>
  );
}
