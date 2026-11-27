import { placeLabel, type Storage } from '../storage';

/** 1枚のカードの置き場所（箱・組んであるデッキ・未整理） */
export function Places({ st, cardId, onOpen }: { st: Storage; cardId: string; onOpen?: (kind: 'box' | 'deck', id: string) => void }) {
  const places = st.placesOf(cardId);
  const loose = st.looseOf(cardId);
  return (
    <div className="places">
      <span className="hint">置き場所</span>
      {places.map((p) => (
        <button key={p.kind + p.id} className="chip" onClick={() => onOpen?.(p.kind, p.id)}>{placeLabel(p)}</button>
      ))}
      {loose > 0 && <span className="chip plain">未整理 {loose}枚</span>}
      {loose < 0 && <span className="chip warn">所持枚数より{-loose}枚多く置かれています</span>}
      {!places.length && loose <= 0 && <span className="chip plain">なし</span>}
    </div>
  );
}
