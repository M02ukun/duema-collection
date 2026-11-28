/**
 * 1枚の写真に並べた複数のカードを見つける。
 *
 * 1. 縮小してエッジを求め、少し太らせる
 * 2. 画像のふちからエッジをまたがずに行ける所を「背景」とする（机など）
 * 3. 背景以外のかたまりのうち、カードの形（63:88 の長方形）に近いものを選ぶ
 * 4. かたまりの周りを少し広めに切り出し、1枚用の輪郭検出（detectCard）で四隅を正確に決める
 */
import { detectCard, type Pt } from './cardDetect';

type Src = HTMLCanvasElement | HTMLImageElement;
const MAXDIM = 640;

export interface Found {
  corners: [Pt, Pt, Pt, Pt];
  confidence: number;
  /** 大まかな位置（元画像の座標） */
  box: { x: number; y: number; w: number; h: number };
}

function size(src: Src) {
  return src instanceof HTMLImageElement ? { w: src.naturalWidth, h: src.naturalHeight } : { w: src.width, h: src.height };
}

export function findCardRegions(src: Src, debug?: { mask?: Uint8Array; W?: number; H?: number; comps?: unknown[] }) {
  const { w: W0, h: H0 } = size(src);
  const s = Math.min(1, MAXDIM / Math.max(W0, H0));
  const W = Math.round(W0 * s), H = Math.round(H0 * s);
  const cv = document.createElement('canvas');
  cv.width = W; cv.height = H;
  const ctx = cv.getContext('2d', { willReadFrequently: true })!;
  ctx.drawImage(src, 0, 0, W, H);
  const px = ctx.getImageData(0, 0, W, H).data;
  const N = W * H;
  const lum = new Float32Array(N), chr = new Float32Array(N);
  for (let i = 0; i < N; i++) {
    const r = px[i * 4], g = px[i * 4 + 1], b = px[i * 4 + 2];
    lum[i] = 0.299 * r + 0.587 * g + 0.114 * b;
    chr[i] = Math.max(r, g, b) - Math.min(r, g, b);
  }
  const mag = new Float32Array(N);
  for (let y = 1; y < H - 1; y++) for (let x = 1; x < W - 1; x++) {
    const i = y * W + x;
    let m = 0;
    for (const a of [lum, chr]) {
      const sx = a[i - W + 1] + 2 * a[i + 1] + a[i + W + 1] - a[i - W - 1] - 2 * a[i - 1] - a[i + W - 1];
      const sy = a[i + W - 1] + 2 * a[i + W] + a[i + W + 1] - a[i - W - 1] - 2 * a[i - W] - a[i - W + 1];
      m = Math.max(m, Math.hypot(sx, sy));
    }
    mag[i] = m;
  }
  // 背景の明るさのばらつき（机の木目やムラ）より強いところをエッジにする
  const sorted = Float32Array.from(mag).sort();
  const thr = Math.max(40, sorted[Math.floor(N * 0.5)] * 3);
  let edge = new Uint8Array(N);
  for (let i = 0; i < N; i++) edge[i] = mag[i] > thr ? 1 : 0;
  // 縁の切れ目をふさぐため、エッジを太らせる
  const R = 2;
  for (const horiz of [true, false]) {
    const o = new Uint8Array(N);
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      if (!edge[y * W + x]) continue;
      for (let d = -R; d <= R; d++) {
        const xx = horiz ? x + d : x, yy = horiz ? y : y + d;
        if (xx >= 0 && yy >= 0 && xx < W && yy < H) o[yy * W + xx] = 1;
      }
    }
    edge = o;
  }
  // ふちから塗りつぶして背景を決める
  const bg = new Uint8Array(N);
  const stack: number[] = [];
  const push = (i: number) => { if (!bg[i] && !edge[i]) { bg[i] = 1; stack.push(i); } };
  for (let x = 0; x < W; x++) { push(x); push((H - 1) * W + x); }
  for (let y = 0; y < H; y++) { push(y * W); push(y * W + W - 1); }
  while (stack.length) {
    const i = stack.pop()!;
    const x = i % W, y = (i / W) | 0;
    if (x > 0) push(i - 1);
    if (x < W - 1) push(i + 1);
    if (y > 0) push(i - W);
    if (y < H - 1) push(i + W);
  }
  // 背景以外のかたまりを数える
  const lab = new Int32Array(N);
  const out: { box: Found['box']; fill: number; aspect: number; area: number; id: number; quad: Found['corners'] }[] = [];
  let id = 0;
  for (let i0 = 0; i0 < N; i0++) {
    if (bg[i0] || lab[i0]) continue;
    id++;
    let n = 0, sx = 0, sy = 0, sxx = 0, syy = 0, sxy = 0, x0 = W, y0 = H, x1 = 0, y1 = 0;
    const st = [i0];
    lab[i0] = id;
    const pts: number[] = [];
    while (st.length) {
      const i = st.pop()!;
      const x = i % W, y = (i / W) | 0;
      n++; sx += x; sy += y; sxx += x * x; syy += y * y; sxy += x * y;
      pts.push(i);
      if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
      for (const j of [x > 0 ? i - 1 : -1, x < W - 1 ? i + 1 : -1, y > 0 ? i - W : -1, y < H - 1 ? i + W : -1]) {
        if (j >= 0 && !bg[j] && !lab[j]) { lab[j] = id; st.push(j); }
      }
    }
    if (n < N * 0.01) continue;
    // 傾いていても測れるよう、かたまりの向きを求めてその向きでの縦横を測る
    const mx = sx / n, my = sy / n;
    const cxx = sxx / n - mx * mx, cyy = syy / n - my * my, cxy = sxy / n - mx * my;
    const th = 0.5 * Math.atan2(2 * cxy, cxx - cyy);
    const c = Math.cos(th), sn = Math.sin(th);
    let a0 = Infinity, a1 = -Infinity, b0 = Infinity, b1 = -Infinity;
    for (const i of pts) {
      const x = i % W - mx, y = ((i / W) | 0) - my;
      const u = x * c + y * sn, v = -x * sn + y * c;
      if (u < a0) a0 = u; if (u > a1) a1 = u; if (v < b0) b0 = v; if (v > b1) b1 = v;
    }
    // 正方形に近いかたまりは向きが定まらないので、画像の縦横に沿った外枠でも測り、よく収まる方を使う
    const lu = a1 - a0 + 1, lv = b1 - b0 + 1;
    const bw = x1 - x0 + 1, bh = y1 - y0 + 1;
    const pca = { fill: n / (lu * lv), aspect: Math.min(lu, lv) / Math.max(lu, lv) };
    const axis = { fill: n / (bw * bh), aspect: Math.min(bw, bh) / Math.max(bw, bh) };
    const { fill, aspect } = axis.fill >= pca.fill ? axis : pca;
    debug?.comps?.push({ n, fill, aspect, box: [x0, y0, x1, y1] });
    // 斜めから撮ると奥のカードは縦が縮んで正方形に近づくので、縦横比はゆるめに見る
    if (fill < 0.8 || aspect < 0.5 || aspect > 1) continue;
    const k = 1 / s;
    // かたまりの四隅（左上・右上・右下・左下）。x+y と x−y がいちばん大きい・小さい点
    let tl = 0, tr = 0, br = 0, bl = 0;
    let vtl = Infinity, vtr = -Infinity, vbr = -Infinity, vbl = Infinity;
    for (const i of pts) {
      const x = i % W, y = (i / W) | 0;
      if (x + y < vtl) { vtl = x + y; tl = i; }
      if (x + y > vbr) { vbr = x + y; br = i; }
      if (x - y > vtr) { vtr = x - y; tr = i; }
      if (x - y < vbl) { vbl = x - y; bl = i; }
    }
    const pt = (i: number): Pt => ({ x: ((i % W) + 0.5) * k, y: (((i / W) | 0) + 0.5) * k });
    out.push({ box: { x: x0 * k, y: y0 * k, w: (x1 - x0 + 1) * k, h: (y1 - y0 + 1) * k }, fill, aspect, area: n / N, id, quad: [pt(tl), pt(tr), pt(br), pt(bl)] as Found['corners'] });
  }
  if (debug) { debug.mask = bg; debug.W = W; debug.H = H; }
  const regions = out.map((o) => ({ ...o, lab, W, H, scale: s }));
  // 極端に小さいもの（大きいかたまりの半分未満の3割以下）は除く
  const maxA = Math.max(0, ...out.map((o) => o.area));
  return regions.filter((o) => o.area > maxA * 0.3)
    // 上の段から、左から右の順に並べる
    .sort((a, b) => (Math.abs(a.box.y - b.box.y) < Math.min(a.box.h, b.box.h) * 0.5 ? a.box.x - b.box.x : a.box.y - b.box.y));
}

/** 写真の中のカードをすべて見つけ、それぞれの四隅を返す */
export function detectCards(src: Src): Found[] {
  const { w: W0, h: H0 } = size(src);
  const res: Found[] = [];
  for (const r of findCardRegions(src)) {
    // 周りを少し広めに切り出す。隣のカードの縁に引っぱられないよう、かたまりの外は塗りつぶす
    const m = 0.06 * Math.max(r.box.w, r.box.h);
    const x = Math.max(0, r.box.x - m), y = Math.max(0, r.box.y - m);
    const w = Math.min(W0, r.box.x + r.box.w + m) - x, h = Math.min(H0, r.box.y + r.box.h + m) - y;
    const c = document.createElement('canvas');
    const cs = Math.min(1, 900 / Math.max(w, h));
    c.width = Math.round(w * cs); c.height = Math.round(h * cs);
    const g = c.getContext('2d', { willReadFrequently: true })!;
    g.drawImage(src, x, y, w, h, 0, 0, c.width, c.height);
    const im = g.getImageData(0, 0, c.width, c.height);
    const d = im.data;
    const pad = 3; // かたまりの縁より少し外までは残す（マスクの粗さの分）
    const inBlob = (px: number, py: number) => {
      const mx = Math.round(((px / cs + x) * r.scale)), my = Math.round(((py / cs + y) * r.scale));
      for (let dy = -pad; dy <= pad; dy++) for (let dx = -pad; dx <= pad; dx++) {
        const xx = mx + dx, yy = my + dy;
        if (xx >= 0 && yy >= 0 && xx < r.W && yy < r.H && r.lab[yy * r.W + xx] === r.id) return true;
      }
      return false;
    };
    for (let py = 0; py < c.height; py++) for (let px = 0; px < c.width; px++) {
      if (inBlob(px, py)) continue;
      const i = (py * c.width + px) * 4;
      d[i] = d[i + 1] = d[i + 2] = 128;
    }
    g.putImageData(im, 0, 0);
    const prior = {
      x: Math.min(r.quad[0].x, r.quad[3].x) - x, y: Math.min(r.quad[0].y, r.quad[1].y) - y,
      w: 0, h: 0,
    };
    prior.w = Math.max(r.quad[1].x, r.quad[2].x) - x - prior.x;
    prior.h = Math.max(r.quad[2].y, r.quad[3].y) - y - prior.y;
    const det = detectCard(c, { x: prior.x / w, y: prior.y / h, w: prior.w / w, h: prior.h / h }, undefined, { nested: false });
    const quadArea = (q: Pt[]) => Math.abs(q.reduce((s2, p, j) => { const n2 = q[(j + 1) % 4]; return s2 + p.x * n2.y - n2.x * p.y; }, 0)) / 2;
    const blobArea = quadArea(r.quad);
    const corners = det && det.confidence >= 0.4
      ? det.corners.map((p) => ({ x: p.x / cs + x, y: p.y / cs + y })) as Found['corners']
      : null;
    // 輪郭検出の結果が、かたまりと大きさが大きく違うときは、かたまりの四隅を使う
    if (corners && Math.abs(Math.log(quadArea(corners) / blobArea)) < 0.2) res.push({ corners, confidence: det!.confidence, box: r.box });
    else res.push({ corners: r.quad, confidence: 0.4, box: r.box });
  }
  return res;
}
