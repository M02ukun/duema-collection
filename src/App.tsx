import { useEffect, useState } from 'react';
import { CollectionList } from './components/CollectionList';
import { AddPanel } from './components/AddPanel';
import { loadCardDb, type CardDb } from './carddb';
import { Settings } from './components/Settings';
import { Boxes } from './components/Boxes';
import { Decks } from './components/Decks';
import { useStorage } from './storage';
import type { Box } from './types';
import { IconBox, IconCamera, IconCollection, IconDeck, IconSettings } from './components/Icons';

type Tab = 'list' | 'add' | 'box' | 'deck' | 'settings';
const TABS: [Tab, string, () => React.JSX.Element][] = [
  ['list', 'コレクション', IconCollection],
  ['add', '登録', IconCamera],
  ['box', 'ストレージ', IconBox],
  ['deck', 'デッキ', IconDeck],
  ['settings', '設定', IconSettings],
];
const TITLES: Record<Tab, string> = { list: 'コレクション', add: 'カード登録', box: 'ストレージ', deck: 'デッキ', settings: '設定' };

type Route = { tab: Tab; box: string | null; deck: string | null };

/** URL の # から画面を決める。#box=xxxx は QRコードから開くストレージ */
function parseRoute(): Route {
  const [k, v = ''] = location.hash.slice(1).split('=');
  const id = /^[\w-]+$/.test(v) ? v : null;
  if (k === 'box') return { tab: 'box', box: id, deck: null };
  if (k === 'deck') return { tab: 'deck', box: null, deck: id };
  if (k === 'add' || k === 'settings') return { tab: k, box: null, deck: null };
  return { tab: 'list', box: null, deck: null };
}
function routeUrl(r: Route) {
  if (r.tab === 'box') return r.box ? `#box=${r.box}` : '#box';
  if (r.tab === 'deck') return r.deck ? `#deck=${r.deck}` : '#deck';
  if (r.tab === 'list') return location.pathname + location.search;
  return `#${r.tab}`;
}

export default function App() {
  const [route, setRoute] = useState<Route>(parseRoute);
  const { tab, box: openBox, deck: openDeck } = route;
  const [targetBox, setTargetBox] = useState<Box | null>(null);
  const st = useStorage();
  useEffect(() => {
    const sync = () => setRoute((r) => { const n = parseRoute(); return n.tab === r.tab && n.box === r.box && n.deck === r.deck ? r : n; });
    window.addEventListener('popstate', sync);
    window.addEventListener('hashchange', sync);
    return () => { window.removeEventListener('popstate', sync); window.removeEventListener('hashchange', sync); };
  }, []);
  /** 画面を移る。ブラウザの履歴に積むので「戻る」で一つ前に戻れる */
  function go(tab: Tab, id: string | null = null) {
    const r: Route = { tab, box: tab === 'box' ? id : null, deck: tab === 'deck' ? id : null };
    const url = routeUrl(r);
    const now = routeUrl(parseRoute());
    if (url !== now) { try { history.pushState(null, '', url); } catch { /* 無視 */ } }
    setRoute(r);
    window.scrollTo(0, 0);
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
        <span className="logo" aria-hidden />
        <h1>{TITLES[tab]}</h1>
        {st && tab === 'list' && <span className="head-note">{st.cards.filter((c) => c.count > 0).length}種 / {st.cards.reduce((n, c) => n + Math.max(0, c.count), 0)}枚</span>}
      </header>
      <main>
        {tab === 'list' && <CollectionList notify={notify} st={st} onOpenPlace={(k, id) => go(k === 'box' ? 'box' : 'deck', id)} />}
        {tab === 'add' && <AddPanel cardDb={cardDb} lockedSet={lockedSet} setLockedSet={setLockedSet} notify={notify}
          targetBox={targetBox} onClearTarget={() => setTargetBox(null)} />}
        {tab === 'box' && st && <Boxes cardDb={cardDb} st={st} openId={openBox} setOpenId={(id) => go('box', id)} notify={notify}
          onRegisterInto={(b) => { setTargetBox(b); go('add'); }} />}
        {tab === 'deck' && st && <Decks cardDb={cardDb} st={st} openId={openDeck} setOpenId={(id) => go('deck', id)} notify={notify}
          onOpenBox={(id) => go('box', id)} />}
        {tab === 'settings' && <Settings notify={notify} cardDb={cardDb} onCardDb={setCardDb} />}
      </main>
      {toast && <div className="toast">{toast}</div>}
      <nav className="tabs">
        {TABS.map(([key, label, Icon]) => (
          <button key={key} className={tab === key ? 'on' : ''} onClick={() => go(key)} aria-current={tab === key ? 'page' : undefined}>
            <Icon /><span>{label}</span>
          </button>
        ))}
      </nav>
    </div>
  );
}
