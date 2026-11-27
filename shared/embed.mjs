// 画像認識AI（DINOv2-small）でカード画像を「特徴の数値」に変換するための共通処理。
// GitHub Actions（Node）とブラウザで同じ前処理をするためにここにまとめる。

export const EMBED_SIZE = 224;
export const MODEL_FILE = 'dinov2-small-q.onnx';
export const MODEL_URL = 'https://huggingface.co/Xenova/dinov2-small/resolve/main/onnx/model_quantized.onnx';
const MEAN = [0.485, 0.456, 0.406];
const STD = [0.229, 0.224, 0.225];

/** 224x224 の RGBA を、モデルの入力（1x3x224x224, 正規化済み）にする */
export function toInput(rgba) {
  const n = EMBED_SIZE * EMBED_SIZE;
  const out = new Float32Array(3 * n);
  for (let i = 0; i < n; i++) {
    for (let c = 0; c < 3; c++) out[c * n + i] = (rgba[i * 4 + c] / 255 - MEAN[c]) / STD[c];
  }
  return out;
}

/** モデルの出力から、長さ1に正規化したベクトルを取り出す */
export function pickVector(outputs) {
  const t = outputs.pooler_output ?? outputs.last_hidden_state ?? Object.values(outputs)[0];
  const dim = t.dims[t.dims.length - 1];
  const v = Float32Array.from(t.data.subarray ? t.data.subarray(0, dim) : t.data.slice(0, dim));
  let s = 0;
  for (const x of v) s += x * x;
  s = Math.sqrt(s) || 1;
  for (let i = 0; i < dim; i++) v[i] /= s;
  return v;
}

/** 保存用に Int8 にする（長さ1のベクトルなので ±127 倍） */
export function quantize(v) {
  const q = new Int8Array(v.length);
  for (let i = 0; i < v.length; i++) q[i] = Math.max(-127, Math.min(127, Math.round(v[i] * 127)));
  return q;
}
