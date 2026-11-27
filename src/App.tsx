import { useEffect, useState } from 'react';
import { CollectionList } from './components/CollectionList';
import { AddPanel } from './components/AddPanel';
import { loadCardDb, type CardDb } from './carddb';
import { Settings } from './components/Settings';
import { Boxes } from './components/Boxes';
import { Decks } from './components/Decks';
import { useStorage } from './storage';
import type { Box } from './types';

type Tab = 'list' | 'add' | 'box' | 'deck' | 'settings';

/** QRコードのURL（#box=xxxx）から開く箱 */
function boxFromHash() {
  const m = location.hash.match(/box=([\w-]+)/);
  return m ? m[1] : null;
}

export default function App() {
  const [tab, setTab] = useState<Tab>(() => (boxFromHash() ? 'box' : 'list'));
  const [openBox, setOpenBox] = useState<string | null>(boxFromHash);
  const [openDeck, setOpenDeck] = useState<string | null>(null);
  const [targetBox, setTargetBox] = useState<Box | null>(null);
  const st = useStorage();
  useEffect(() => {
    const onHash = () => { const id = boxFromHash(); if (id) { setOpenBox(id); setTab('box'); } };
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);
  function openBoxAt(id: string | null) {
    setOpenBox(id);
    try { history.replaceState(null, '', id ? `#box=${id}` : location.pathname + location.search); } catch { /* 無視 */ }
  }
  const [toast, setToast] = useState('');
  const [cardDb, setCardDb] = useState<CardDb | null>(null);
  useEffect(() => { loadCardDb().then(setCardDb).catch(() => {}); }, []);

  const [lockedSet, setLockedSetState] = useState(() => {
    try { return localStorage.getItem('lockedSet') ?? ''; } catch { return ''; }
  });
  function setLockedSet(s: string) {
    setLockedSetState(s);
    try { localStorage.setItem('lockedSet', s); } catch { /* 保存できなくても動作には影響しない */ }
  }

  function notify(m: string) {
    setToast(m);
    setTimeout(() => setToast(''), 2500);
  }

  return (
    <div className="app">
      <header>
        <h1>デュエマ所持カード</h1>
      </header>
      <main>
        {tab === 'list' && <CollectionList notify={notify} st={st} onOpenPlace={(k, id) => { if (k === 'box') { openBoxAt(id); setTab('box'); } else { setOpenDeck(id); setTab('deck'); } }} />}
        {tab === 'add' && <AddPanel cardDb={cardDb} lockedSet={lockedSet} setLockedSet={setLockedSet} notify={notify}
          targetBox={targetBox} onClearTarget={() => setTargetBox(null)} />}
        {tab === 'box' && st && <Boxes cardDb={cardDb} st={st} openId={openBox} setOpenId={openBoxAt} notify={notify}
          onRegisterInto={(b) => { setTargetBox(b); setTab('add'); }} />}
        {tab === 'deck' && st && <Decks cardDb={cardDb} st={st} openId={openDeck} setOpenId={setOpenDeck} notify={notify}
          onOpenBox={(id) => { openBoxAt(id); setTab('box'); }} />}
        {tab === 'settings' && <Settings notify={notify} cardDb={cardDb} onCardDb={setCardDb} />}
      </main>
      {toast && <div className="toast">{toast}</div>}
      <nav className="tabs">
        <button className={tab === 'list' ? 'on' : ''} onClick={() => setTab('list')}>📚<span>一覧</span></button>
        <button className={tab === 'add' ? 'on' : ''} onClick={() => setTab('add')}>📷<span>登録</span></button>
        <button className={tab === 'box' ? 'on' : ''} onClick={() => setTab('box')}>📦<span>箱</span></button>
        <button className={tab === 'deck' ? 'on' : ''} onClick={() => setTab('deck')}>🃏<span>デッキ</span></button>
        <button className={tab === 'settings' ? 'on' : ''} onClick={() => setTab('settings')}>⚙️<span>データ</span></button>
      </nav>
    </div>
  );
}
