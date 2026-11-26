# デュエマ所持カード管理

デュエル・マスターズの所持カードを管理する、スマホ向けの Web アプリ（PWA）です。

- カードを撮影し、右下の **パック記号と番号** を端末内の OCR（Tesseract.js）で読み取って登録
- 一度登録したカードは、次から番号を読み取るだけで名前・コスト・文明などが自動で入る
- カード名からの手入力にも対応
- 一覧で文明・コスト・種類・パックの絞り込み、コスト・名前・登録日・枚数・番号・パワーで並び替え
- データは端末のブラウザ内（IndexedDB）に保存。JSON で書き出し・読み込みできる
- カード画像は保存しない（文字データのみ）

## 動かし方

```bash
npm install
npm run dev -- --host   # 同じ Wi-Fi のスマホから http://<PCのIP>:5173 で開ける
npm run build           # dist/ に本番用ファイルを出力
```

`npm run dev` / `npm run build` の前に `scripts/copy-tesseract.mjs` が自動で走り、
OCR に必要なファイルを `public/tesseract/` にコピーします（CDN を使わないので、2回目以降はオフラインでも動きます）。

## 公開（GitHub Pages）

`main` に push すると `.github/workflows/pages.yml` がビルドして GitHub Pages に公開します。
リポジトリの Settings → Pages → Source を「GitHub Actions」にしてください。
ホーム画面に追加するとアプリのように使えます（HTTPS で開く必要があります）。

## ファイル構成

- `src/parse.ts` … OCR の文字列からパック記号・番号を取り出す
- `src/ocr.ts` … 画像の切り抜き・二値化と Tesseract.js の呼び出し
- `src/db.ts` … IndexedDB（Dexie）への保存、JSON 入出力
- `src/components/` … 画面（撮影、登録フォーム、一覧、データ）
