import { useEffect, useRef, useState } from 'react';
import { recognizeCode, type CropRect, type OcrResult } from '../ocr';
import type { ParsedCode } from '../parse';

interface Props {
  knownSets: string[];
  goodScore: number;
  isValid?: (p: ParsedCode) => boolean;
  onResult: (r: OcrResult) => void;
  onClose: () => void;
}

/** 画面中央の、横長（約 5:1）の枠を動画に対する割合で作る */
function makeGuide(vw: number, vh: number): CropRect {
  // 少し離して撮っても文字が枠に収まるよう、枠は小さめ（横長 6:1）
  const w = 0.6;
  const h = Math.min(0.3, (w * vw) / vh / 6);
  return { x: (1 - w) / 2, y: (1 - h) / 2, w, h };
}

/**
 * カメラの映像を出し、枠の中の文字を自動で読み続ける。
 * 番号とパック記号がそろって読めたら止まって結果を返す。
 */
export function CameraScanner({ knownSets, goodScore, isValid, onResult, onClose }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [error, setError] = useState('');
  const [last, setLast] = useState('');
  const [torch, setTorch] = useState(false);
  const [torchSupported, setTorchSupported] = useState(false);
  const [manualBusy, setManualBusy] = useState(false);
  const [zoomRange, setZoomRange] = useState<{ min: number; max: number; step: number } | null>(null);
  const [zoom, setZoom] = useState(1);
  const stopped = useRef(false);
  const busy = useRef(false);
  const [GUIDE, setGuide] = useState<CropRect>(makeGuide(16, 9));
  const guideRef = useRef(GUIDE);

  useEffect(() => {
    stopped.current = false;
    (async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: { ideal: 'environment' }, width: { ideal: 1920 }, height: { ideal: 1080 } },
          audio: false,
        });
        if (stopped.current) return stream.getTracks().forEach((t) => t.stop());
        streamRef.current = stream;
        const v = videoRef.current!;
        v.srcObject = stream;
        await v.play();
        guideRef.current = makeGuide(v.videoWidth || 16, v.videoHeight || 9);
        setGuide(guideRef.current);
        const track = stream.getVideoTracks()[0];
        const caps = (track.getCapabilities?.() ?? {}) as MediaTrackCapabilities & { torch?: boolean; focusMode?: string[] };
        setTorchSupported(!!caps.torch);
        // ズームできる端末なら、少し離れた（ピントが合う）距離から文字を大きく写せるようにする
        const z = (caps as { zoom?: { min: number; max: number; step: number } }).zoom;
        if (z && z.max > 1) {
          setZoomRange(z);
          const initial = Math.min(z.max, 2);
          track.applyConstraints({ advanced: [{ zoom: initial } as MediaTrackConstraintSet] }).then(() => setZoom(initial)).catch(() => {});
        }
        if (caps.focusMode?.includes('continuous')) {
          track.applyConstraints({ advanced: [{ focusMode: 'continuous' } as MediaTrackConstraintSet] }).catch(() => {});
        }
        loop();
      } catch (e) {
        setError('カメラを使えませんでした。ブラウザのカメラ許可を確認するか、「写真を選ぶ」を使ってください。（' + String(e) + '）');
      }
    })();
    return () => {
      stopped.current = true;
      streamRef.current?.getTracks().forEach((t) => t.stop());
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function loop() {
    while (!stopped.current) {
      const v = videoRef.current;
      if (v && v.videoWidth && !busy.current) {
        busy.current = true;
        try {
          const r = await recognizeCode(v, guideRef.current, { knownSets, quick: true, targetHeight: 160, goodScore, isValid });
          setLast(r.rawText);
          // カードリストがあるときは実在する番号が読めたら、無いときは形がそろったら止める
          if ((isValid ? r.valid : r.score >= goodScore) && !stopped.current) {
            stopped.current = true;
            navigator.vibrate?.(80);
            onResult(r);
            return;
          }
        } catch (e) {
          setError('読み取りに失敗しました: ' + String(e));
          return;
        } finally {
          busy.current = false;
        }
      }
      await new Promise((res) => setTimeout(res, 150));
    }
  }

  async function captureNow() {
    const v = videoRef.current;
    if (!v?.videoWidth) return;
    // いまの映像を止めて、時間をかけて丁寧に読む
    stopped.current = true;
    setManualBusy(true);
    const snap = document.createElement('canvas');
    snap.width = v.videoWidth;
    snap.height = v.videoHeight;
    snap.getContext('2d')!.drawImage(v, 0, 0);
    while (busy.current) await new Promise((r) => setTimeout(r, 50));
    const r = await recognizeCode(snap, guideRef.current, { knownSets, targetHeight: 200, goodScore, isValid });
    setManualBusy(false);
    onResult(r);
  }

  function changeZoom(z: number) {
    setZoom(z);
    streamRef.current?.getVideoTracks()[0]
      ?.applyConstraints({ advanced: [{ zoom: z } as MediaTrackConstraintSet] })
      .catch(() => {});
  }

  async function toggleTorch() {
    const track = streamRef.current?.getVideoTracks()[0];
    if (!track) return;
    const next = !torch;
    await track.applyConstraints({ advanced: [{ torch: next } as MediaTrackConstraintSet] }).catch(() => {});
    setTorch(next);
  }

  return (
    <div className="scanner">
      <div className="scanner-view">
        <video ref={videoRef} playsInline muted />
        <div className="scanner-guide" style={{ left: `${GUIDE.x * 100}%`, top: `${GUIDE.y * 100}%`, width: `${GUIDE.w * 100}%`, height: `${GUIDE.h * 100}%` }} />
        <p className="scanner-tip">カードから10〜15cmほど離し、右下の「24RP3 R 19/76」のような文字を枠に入れてください</p>
      </div>
      {zoomRange && (
        <label className="zoom-row">ズーム {zoom.toFixed(1)}倍
          <input type="range" min={zoomRange.min} max={Math.min(zoomRange.max, 8)} step={zoomRange.step || 0.1}
            value={zoom} onChange={(e) => changeZoom(Number(e.target.value))} />
        </label>
      )}
      {error && <p className="error">{error}</p>}
      <p className="hint scanner-last">{manualBusy ? '丁寧に読み取り中…' : `読み取り中: ${last || '…'}`}</p>
      <div className="row">
        <button className="btn primary" onClick={captureNow} disabled={manualBusy}>この画面で読み取る</button>
        {torchSupported && <button className="btn" onClick={toggleTorch}>{torch ? 'ライトを消す' : 'ライト'}</button>}
        <button className="btn" onClick={onClose}>閉じる</button>
      </div>
    </div>
  );
}
