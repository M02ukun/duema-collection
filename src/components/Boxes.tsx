import { useEffect, useMemo, useState } from 'react';
import QRCode from 'qrcode';
import { db } from '../db';
import type { CardDb, MasterCard } from '../carddb';
import { changeBoxItem, deleteBox, resolveCard, type Storage } from '../storage';
import { newId, type Box } from '../types';
import { CardGroups, type Group } from './CardGroups';
import { CardPicker } from './CardPicker';
import { IconBack, IconBox, IconCamera, IconChevron, IconQr, IconSearch } from './Icons';

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
        <p>この箱はこの端末に登録されていません。</p>
        <button className="btn" onClick={() => setOpenId(null)}>箱の一覧へ</button>
      </section>
    );
  }
  if (open) return <BoxDetail box={open} cardDb={cardDb} st={st} onBack={() => setOpenId(null)} notify={notify} onRegisterInto={onRegisterInto} />;

  return (
    <>
      <form className="panel row" onSubmit={create}>
        <input className="grow" value={name} onChange={(e) => setName(e.target.value)} placeholder="新しい箱の名前" />
        <button className="btn primary" type="submit">追加</button>
      </form>
      {!st.boxes.length && <div className="empty-state"><IconBox />箱を追加すると、QRコードで中身を確認できます</div>}
      {st.boxes.length > 0 && (
        <ul className="place-list">
          {st.boxes.map((b) => {
            const items = st.boxItems.filter((i) => i.boxId === b.id);
            return (
              <li key={b.id}>
                <button onClick={() => setOpenId(b.id)}>
                  <span className="place-icon"><IconBox /></span>
                  <span className="place-text">
                    <span className="name">{b.name}</span>
                    <span className="hint">{items.length}種 · {items.reduce((s, i) => s + i.count, 0)}枚</span>
                  </span>
                  <span className="chev"><IconChevron /></span>
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
    notify(`${m.name}（箱に${n}枚）`);
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
      <button className="back-link" onClick={onBack}><IconBack />箱</button>
      <section className="panel">
        <input className="title-input" defaultValue={box.name} aria-label="箱の名前"
          onBlur={(e) => { const v = e.target.value.trim(); if (v && v !== box.name) db.boxes.update(box.id, { name: v }); }} />
        <p className="hint">{groups.length}種 · {total}枚</p>
        <div className="action-row">
          <button className={`btn ${showQr ? 'primary' : ''}`} onClick={() => setShowQr((s) => !s)}><IconQr />QR</button>
          <button className={`btn ${adding ? 'primary' : ''}`} onClick={() => setAdding((s) => !s)}><IconSearch />検索して入れる</button>
          <button className="btn" onClick={() => onRegisterInto(box)}><IconCamera />撮って入れる</button>
        </div>
        {showQr && qr && (
          <div className="qr">
            <img src={qr} alt={`${box.name} のQRコード`} />
            <b>{box.name}</b>
            <p className="hint">スマホのカメラで読み取るとこの箱を開きます</p>
            <button className="btn primary" onClick={downloadQr}>画像を保存</button>
          </div>
        )}
      </section>
      {adding && cardDb && (
        <section className="panel">
          <CardPicker cardDb={cardDb} owned={st.owned} counts={counts} countLabel="箱に" onChange={change} ownedOnly
            note={(m) => { const l = st.looseOf(m.id); return l > 0 ? ` · 未整理${l}` : ''; }} />
        </section>
      )}
      <section className="panel">
        <p className="section-label">中身</p>
        {groups.length ? (
          cardDb ? <CardGroups groups={groups} cardDb={cardDb} owned={st.owned} counts={counts} countLabel="箱に" onChange={change} />
            : <ul>{items.map((i) => <li key={i.id}>{i.name} ×{i.count}</li>)}</ul>
        ) : <p className="hint">空です</p>}
      </section>
      <section className="panel">
        <button className="btn danger" onClick={async () => {
          if (!confirm(`「${box.name}」を削除しますか？ カードの所持枚数は変わりません。`)) return;
          await deleteBox(box.id);
          notify(`${box.name} を削除しました`);
          onBack();
        }}>箱を削除</button>
      </section>
    </>
  );
}
