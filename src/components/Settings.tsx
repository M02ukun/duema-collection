import { useLiveQuery } from 'dexie-react-hooks';
import { db, exportJson, importJson } from '../db';
import { importCardList, type CardDb } from '../carddb';

export function Settings({ notify, cardDb, onCardDb }: { notify: (m: string) => void; cardDb: CardDb | null; onCardDb: (d: CardDb) => void }) {
  const count = useLiveQuery(() => db.cards.count(), []);

  async function doExport() {
    const blob = new Blob([await exportJson()], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `duema-collection-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  async function doImport(e: React.ChangeEvent<HTMLInputElement>, mode: 'merge' | 'replace') {
    const f = e.target.files?.[0];
    e.target.value = '';
    if (!f) return;
    if (mode === 'replace' && !confirm('いまのデータをすべて消して、ファイルの内容に置き換えます。よろしいですか？')) return;
    try {
      const n = await importJson(await f.text(), mode);
      notify(`${n} 件を読み込みました`);
    } catch (err) {
      notify('読み込みに失敗しました: ' + String(err));
    }
  }

  async function doImportCardList(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    e.target.value = '';
    if (!f) return;
    try {
      const d = await importCardList(await f.text());
      onCardDb(d);
      notify(`カードリスト ${d.size.toLocaleString()} 枚を読み込みました`);
    } catch (err) {
      notify('読み込みに失敗しました: ' + String(err));
    }
  }

  return (
    <>
    <section className="panel">
      <h2>公式カードリスト</h2>
      <p>{cardDb ? `${cardDb.size.toLocaleString()} 枚（${new Date(cardDb.list.updatedAt).toLocaleDateString('ja-JP')} 時点）` : 'まだありません'}</p>
      <p className="hint">公式カード検索から週1回自動で取り込んだものを使います。手元の cards.json を読み込むこともできます。</p>
      <label className="btn file-btn">カードリスト（cards.json）を読み込む
        <input type="file" accept="application/json,.json" hidden onChange={doImportCardList} />
      </label>
    </section>
    <section className="panel">
      <h2>データ</h2>
      <p>登録しているカード: {count ?? '…'} 種類</p>
      <p className="hint">データはこの端末のブラウザの中だけに保存されています。機種変更やブラウザのデータ削除に備えて、ときどき書き出しておいてください。</p>
      <div className="stack">
        <button className="btn primary" onClick={doExport}>JSON に書き出す（バックアップ）</button>
        <label className="btn file-btn">JSON を読み込む（追加・上書き）
          <input type="file" accept="application/json,.json" hidden onChange={(e) => doImport(e, 'merge')} />
        </label>
        <label className="btn danger file-btn">JSON で全部置き換える
          <input type="file" accept="application/json,.json" hidden onChange={(e) => doImport(e, 'replace')} />
        </label>
      </div>
    </section>
    </>
  );
}
