import { useState } from 'react';
import { CollectionList } from './components/CollectionList';
import { CardForm, type FormValues } from './components/CardForm';
import { ScanPanel } from './components/ScanPanel';
import { Settings } from './components/Settings';

type Tab = 'list' | 'add' | 'settings';

export default function App() {
  const [tab, setTab] = useState<Tab>('list');
  const [toast, setToast] = useState('');
  const [prefill, setPrefill] = useState<{ key: number; values: Partial<FormValues> }>({ key: 0, values: {} });

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
        {tab === 'add' && (
          <>
            <ScanPanel onResult={(r) => setPrefill((p) => ({ key: p.key + 1, values: { setCode: r.setCode, number: r.number } }))} />
            <CardForm key={prefill.key} initial={prefill.values} onSaved={notify} />
          </>
        )}
        {tab === 'settings' && <Settings notify={notify} />}
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
