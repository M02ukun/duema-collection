import { useEffect, useRef, useState } from 'react';
import type { CardRect } from '../namerec';

interface Props {
  busy: boolean;
  onCapture: (src: HTMLCanvasElement, rect: CardRect) => void;
  onClose: () => void;
}

/** 映像の中央に置く、カードの形（63:88）の枠を割合で返す */
function cardGuide(vw: number, vh: number): CardRect {
  const aspect = 63 / 88;
  let h = 0.86;
  let w = (h * vh * aspect) / vw;
  if (w > 0.86) {
    w = 0.86;
    h = (w * vw) / aspect / vh;
  }
  return { x: (1 - w) / 2, y: (1 - h) / 2, w, h };
}

/** カード全体を枠に合わせて撮影する */
export function CardScanner({ busy, onCapture, onClose }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [guide, setGuide] = useState<CardRect>(cardGuide(9, 16));
  const [error, setError] = useState('');
  /** 撮影した瞬間の画像（撮影後はカメラを止めてこれを表示する） */
  const [frozen, setFrozen] = useState<string | null>(null);

  useEffect(() => {
    let stopped = false;
    (async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: { ideal: 'environment' }, width: { ideal: 1920 }, height: { ideal: 1440 } },
          audio: false,
        });
        if (stopped) return stream.getTracks().forEach((t) => t.stop());
        streamRef.current = stream;
        const v = videoRef.current!;
        v.srcObject = stream;
        await v.play();
        setGuide(cardGuide(v.videoWidth || 9, v.videoHeight || 16));
        const track = stream.getVideoTracks()[0];
        const caps = (track.getCapabilities?.() ?? {}) as { focusMode?: string[] };
        if (caps.focusMode?.includes('continuous')) {
          track.applyConstraints({ advanced: [{ focusMode: 'continuous' } as MediaTrackConstraintSet] }).catch(() => {});
        }
      } catch (e) {
        setError('カメラを使えませんでした。ブラウザのカメラ許可を確認するか、「写真を撮る / 選ぶ」を使ってください。（' + String(e) + '）');
      }
    })();
    return () => {
      stopped = true;
      streamRef.current?.getTracks().forEach((t) => t.stop());
    };
  }, []);

  function capture() {
    const v = videoRef.current;
    if (!v?.videoWidth) return;
    const snap = document.createElement('canvas');
    snap.width = v.videoWidth;
    snap.height = v.videoHeight;
    snap.getContext('2d')!.drawImage(v, 0, 0);
    // 撮った時点の画像で判別するので、カメラを止めて静止画を表示する（もう枠に合わせ続けなくてよい）
    setFrozen(snap.toDataURL('image/jpeg', 0.8));
    v.pause();
    onCapture(snap, guide);
  }

  return (
    <div className="scanner">
      <div className="scanner-view">
        <video ref={videoRef} playsInline muted style={frozen ? { visibility: 'hidden' } : undefined} />
        {frozen && <img className="frozen" src={frozen} alt="撮影した画像" />}
        <div className="scanner-guide card-guide"
          style={{ left: `${guide.x * 100}%`, top: `${guide.y * 100}%`, width: `${guide.w * 100}%`, height: `${guide.h * 100}%` }} />
        <p className="scanner-tip">{frozen ? '撮影しました。カメラは動かして大丈夫です' : 'カード全体を緑の枠に合わせて撮影してください'}</p>
      </div>
      {error && <p className="error">{error}</p>}
      <div className="row">
        {frozen && !busy ? (
          <button className="btn primary grow" onClick={() => { setFrozen(null); videoRef.current?.play(); }}>撮り直す</button>
        ) : (
          <button className="btn primary grow" onClick={capture} disabled={busy || !!frozen}>{busy ? '判別中…' : '📸 撮影して判別'}</button>
        )}
        <button className="btn" onClick={onClose}>閉じる</button>
      </div>
    </div>
  );
}
