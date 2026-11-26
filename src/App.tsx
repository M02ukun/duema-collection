import { useEffect, useState } from 'react';
import { CollectionList } from './components/CollectionList';
import { AddPanel } from './components/AddPanel';
import { loadCardDb, type CardDb } from './carddb';
import { Settings } from './components/Settings';

type Tab = 'list' | 'add' | 'settings';

export default function App() {
  const [tab, setTab] = useState<Tab>('list');
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
        {tab === 'list' && <CollectionList notify={notify} />}
        {tab === 'add' && <AddPanel cardDb={cardDb} lockedSet={lockedSet} setLockedSet={setLockedSet} notify={notify} />}
        {tab === 'settings' && <Settings notify={notify} cardDb={cardDb} onCardDb={setCardDb} />}
      </main>
      {toast && <div className="toast">{toast}</div>}
      <nav className="tabs">
        <button className={tab === 'list' ? 'on' : ''} onClick={() => setTab('list')}>📚<span>一覧</span></button>
        <button className={tab === 'add' ? 'on' : ''} onClick={() => setTab('add')}>📷<span>登録</span></button>
        <button className={tab === 'settings' ? 'on' : ''} onClick={() => setTab('settings')}>⚙️<span>データ</span></button>
      </nav>
    </div>
  );
}
