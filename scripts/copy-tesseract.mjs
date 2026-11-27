// Tesseract.js の worker・wasm・英数字の学習データを public/tesseract にコピーする。
// CDN に頼らず自前で配信するので、オフラインでも（2回目以降）OCR が動く。
import { copyFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const out = join(root, 'public', 'tesseract');
mkdirSync(join(out, 'lang'), { recursive: true });
const nm = join(root, 'node_modules');
const files = [
  ['tesseract.js/dist/worker.min.js', 'worker.min.js'],
  ['tesseract.js-core/tesseract-core-lstm.wasm.js', 'tesseract-core-lstm.wasm.js'],
  ['tesseract.js-core/tesseract-core-simd-lstm.wasm.js', 'tesseract-core-simd-lstm.wasm.js'],
  ['tesseract.js-core/tesseract-core-relaxedsimd-lstm.wasm.js', 'tesseract-core-relaxedsimd-lstm.wasm.js'],
  ['@tesseract.js-data/eng/4.0.0_best_int/eng.traineddata.gz', 'lang/eng.traineddata.gz'],
  ['@tesseract.js-data/jpn/4.0.0_best_int/jpn.traineddata.gz', 'lang/jpn.traineddata.gz'],
];
for (const [from, to] of files) copyFileSync(join(nm, from), join(out, to));
console.log('copied tesseract assets to public/tesseract');

