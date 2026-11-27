import { useEffect, useMemo, useState } from 'react';
import QRCode from 'qrcode';
import { db } from '../db';
import type { CardDb, MasterCard } from '../carddb';
import { changeBoxItem, deleteBox, resolveCard, type Storage } from '../storage';
import { newId, type Box } from '../types';
import { CardGroups, type Group } from './CardGroups';
import { CardPicker } from './CardPicker';

export function boxUrl(id: string) {
  return `${location.origin}${location.pathname}#box=${id}`;
}

export function Boxes({ cardDb, st, openId, setOpenId, notify, onRegisterInto }: {
  cardDb: CardDb | null;
  st: Storage;
  openId: string | null;
  setOpenId: (id: string | null) => void;
  notify: (m: string) => void;
  /** 登録タブで、写真判別したカードをこの箱に入れる */
  onRegisterInto: (box: Box) => void;
}) {
  const [name, setName] = useState('');
  const open = st.boxes.find((b) => b.id === openId);

  async function create(e: React.FormEvent) {
    e.preventDefault();
    const n = name.trim() || `箱${st.boxes.length + 1}`;
    const id = newId();
    await db.boxes.put({ id, name: n, memo: '', createdAt: Date.now() });
    setName('');
    setOpenId(id);
  }

  if (openId && !open) {
    return (
      <section className="panel">
        <p>この箱は見つかりませんでした。QRコードを作った端末とは別の端末で読み込んだか、箱を削除したかもしれません。</p>
        <button className="btn" onClick={() => setOpenId(null)}>箱の一覧へ</button>
      </section>
    );
  }
  if (open) return <BoxDetail box={open} cardDb={cardDb} st={st} onBack={() => setOpenId(null)} notify={notify} onRegisterInto={onRegisterInto} />;

  return (
    <>
      <section className="panel">
        <h2>箱（収納ケース）</h2>
        <p className="hint">箱ごとにQRコードを作って貼っておくと、スマホのカメラで読むだけで中身が見られます。</p>
        <form className="row" onSubmit={create}>
          <input className="grow" value={name} onChange={(e) => setName(e.target.value)} placeholder={`新しい箱の名前（例: 箱${st.boxes.length + 1}、赤のカード）`} />
          <button className="btn primary" type="submit">作る</button>
        </form>
      </section>
      {st.boxes.length > 0 && (
        <ul className="place-list">
          {st.boxes.map((b) => {
            const items = st.boxItems.filter((i) => i.boxId === b.id);
            return (
              <li key={b.id}>
                <button onClick={() => setOpenId(b.id)}>
                  <span className="name">📦 {b.name}</span>
                  <span className="hint">{items.length}種類・{items.reduce((s, i) => s + i.count, 0)}枚</span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </>
  );
}

function BoxDetail({ box, cardDb, st, onBack, notify, onRegisterInto }: {
  box: Box;
  cardDb: CardDb | null;
  st: Storage;
  onBack: () => void;
  notify: (m: string) => void;
  onRegisterInto: (box: Box) => void;
}) {
  const [qr, setQr] = useState('');
  const [showQr, setShowQr] = useState(false);
  const [adding, setAdding] = useState(false);
  const items = st.boxItems.filter((i) => i.boxId === box.id);
  const counts = useMemo(() => new Map(items.map((i) => [i.cardId, i.count])), [items]);
  const total = items.reduce((s, i) => s + i.count, 0);

  useEffect(() => {
    QRCode.toDataURL(boxUrl(box.id), { width: 512, margin: 2 }).then(setQr).catch(() => setQr(''));
  }, [box.id]);

  const groups: Group[] = useMemo(() => {
    const g = new Map<string, Group>();
    for (const it of [...items].sort((a, b) => a.name.localeCompare(b.name, 'ja'))) {
      const c = resolveCard(it.cardId, cardDb, st, it.name);
      const x = g.get(c.name) ?? { name: c.name, cards: [], first: new Set<string>() };
      x.cards.push(c);
      g.set(c.name, x);
    }
    return [...g.values()];
  }, [items, cardDb, st]);

  async function change(m: MasterCard, d: number) {
    const n = await changeBoxItem(box.id, m, d);
    notify(`「${m.name}」を${d > 0 ? '入れました' : '出しました'}（この箱に${n}枚）`);
  }

  async function downloadQr() {
    // QRコードの下に箱の名前を入れた画像を作って保存する
    const img = new Image();
    img.src = qr;
    await img.decode();
    const c = document.createElement('canvas');
    c.width = 512; c.height = 600;
    const g = c.getContext('2d')!;
    g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height);
    g.drawImage(img, 0, 0, 512, 512);
    g.fillStyle = '#000'; g.font = 'bold 44px sans-serif'; g.textAlign = 'center';
    g.fillText(box.name, 256, 570, 490);
    const a = document.createElement('a');
    a.href = c.toDataURL('image/png');
    a.download = `QR-${box.name}.png`;
    a.click();
  }

  return (
    <>
      <section className="panel">
        <button className="btn small" onClick={onBack}>← 箱の一覧</button>
        <input className="title-input" defaultValue={box.name} aria-label="箱の名前"
          onBlur={(e) => { const v = e.target.value.trim(); if (v && v !== box.name) db.boxes.update(box.id, { name: v }); }} />
        <p className="hint">{groups.length}種類・{total}枚</p>
        <div className="row wrap">
          <button className="btn" onClick={() => setShowQr((s) => !s)}>{showQr ? 'QRコードを閉じる' : 'QRコードを表示'}</button>
          <button className="btn" onClick={() => setAdding((s) => !s)}>{adding ? '探すのをやめる' : '＋ 名前で探して入れる'}</button>
          <button className="btn" onClick={() => onRegisterInto(box)}>📷 写真で判別して入れる</button>
        </div>
        {showQr && qr && (
          <div className="qr">
            <img src={qr} alt={`${box.name} のQRコード`} />
            <b>{box.name}</b>
            <p className="hint">印刷するか、画像を保存してシールにして箱に貼ってください。スマホのカメラで読むとこの箱が開きます（この端末のデータです）。</p>
            <button className="btn primary" onClick={downloadQr}>QRコードの画像を保存</button>
          </div>
        )}
      </section>
      {adding && cardDb && (
        <section className="panel">
          <h2>この箱に入れる</h2>
          <CardPicker cardDb={cardDb} owned={st.owned} counts={counts} countLabel="この箱に" onChange={change} ownedOnly
            note={(m) => { const l = st.looseOf(m.id); return l > 0 ? `・未整理${l}` : ''; }} />
        </section>
      )}
      <section className="panel">
        <h2>中身</h2>
        {groups.length ? (
          cardDb ? <CardGroups groups={groups} cardDb={cardDb} owned={st.owned} counts={counts} countLabel="この箱に" onChange={change} />
            : <ul>{items.map((i) => <li key={i.id}>{i.name} ×{i.count}</li>)}</ul>
        ) : <p className="hint">まだ何も入っていません。</p>}
      </section>
      <section className="panel">
        <button className="btn danger" onClick={async () => {
          if (!confirm(`箱「${box.name}」を削除しますか？（中のカードの所持枚数はそのまま残ります）`)) return;
          await deleteBox(box.id);
          notify(`箱「${box.name}」を削除しました`);
          onBack();
        }}>この箱を削除</button>
      </section>
    </>
  );
}
