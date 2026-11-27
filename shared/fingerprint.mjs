// カード画像の「色の配置」の特徴（指紋）を計算する。
// ブラウザ（撮影した写真）と Node（公式画像からの事前計算）の両方で同じ計算を使う。
//
// - カード全体を 4x6、イラスト部分を 7x5 のマスに分け、マスごとの平均色を求める
// - 色は「明るさ」「赤−緑」「黄−青」の3成分にし、成分ごとに平均0・ばらつき1にそろえる
//   （照明の明るさや色味が違っても比べられるように）
// - 最後に -127〜127 の整数にする（1枚 177 バイト）

export const FP_DIM = (4 * 6 + 7 * 5) * 3;

const REGIONS = [
  // [x0, y0, x1, y1, 横マス, 縦マス]
  [0, 0, 1, 1, 4, 6],
  [0.06, 0.1, 0.94, 0.56, 7, 5],
];

/**
 * @param {Uint8Array | Uint8ClampedArray} rgba 幅 w・高さ h の RGBA 画素（カードだけを切り出したもの）
 * @param {number} w
 * @param {number} h
 * @returns {Int8Array}
 */
export function fingerprint(rgba, w, h) {
  const out = new Int8Array(FP_DIM);
  let o = 0;
  for (const [x0, y0, x1, y1, gx, gy] of REGIONS) {
    const n = gx * gy;
    const ch = [new Float64Array(n), new Float64Array(n), new Float64Array(n)];
    for (let cy = 0; cy < gy; cy++) {
      for (let cx = 0; cx < gx; cx++) {
        const px0 = Math.floor((x0 + ((x1 - x0) * cx) / gx) * w);
        const px1 = Math.max(px0 + 1, Math.floor((x0 + ((x1 - x0) * (cx + 1)) / gx) * w));
        const py0 = Math.floor((y0 + ((y1 - y0) * cy) / gy) * h);
        const py1 = Math.max(py0 + 1, Math.floor((y0 + ((y1 - y0) * (cy + 1)) / gy) * h));
        let r = 0, g = 0, b = 0, cnt = 0;
        // 全画素だと遅いので、マスの中を2画素おきに見る
        for (let y = py0; y < py1; y += 2) {
          for (let x = px0; x < px1; x += 2) {
            const i = (y * w + x) * 4;
            r += rgba[i]; g += rgba[i + 1]; b += rgba[i + 2]; cnt++;
          }
        }
        r /= cnt; g /= cnt; b /= cnt;
        const k = cy * gx + cx;
        ch[0][k] = (r + g + b) / 3;
        ch[1][k] = r - g;
        ch[2][k] = (r + g) / 2 - b;
      }
    }
    for (const c of ch) {
      let mean = 0;
      for (const v of c) mean += v;
      mean /= n;
      let sd = 0;
      for (const v of c) sd += (v - mean) ** 2;
      sd = Math.sqrt(sd / n) || 1;
      for (let k = 0; k < n; k++) out[o++] = Math.max(-127, Math.min(127, Math.round(((c[k] - mean) / sd) * 40)));
    }
  }
  return out;
}
