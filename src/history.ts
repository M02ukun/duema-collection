import { useEffect, useRef } from 'react';

/**
 * カメラや編集画面など、開いている間はブラウザの「戻る」で閉じられるようにする。
 * 開いたときに履歴を1つ積み、戻るで閉じる。ボタンで閉じたときは積んだ履歴を取り消す。
 */
export function useBackLayer(open: boolean, close: () => void) {
  const closeRef = useRef(close);
  closeRef.current = close;
  useEffect(() => {
    if (!open) return;
    const token = Math.random().toString(36).slice(2);
    history.pushState({ layer: token }, '');
    let popped = false;
    const onPop = () => { popped = true; closeRef.current(); };
    window.addEventListener('popstate', onPop);
    return () => {
      window.removeEventListener('popstate', onPop);
      // 別の画面へ移った後なら履歴はそのまま（そちらの履歴を消さない）
      if (!popped && history.state?.layer === token) history.back();
    };
  }, [open]);
}
