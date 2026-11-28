/**
 * 写真の中からカードの輪郭（四隅）を見つけて、正面から見た形にまっすぐ直す。
 *
 * 1. 縮小してエッジ（明るさが急に変わるところ）を求める
 * 2. ほぼ縦の線・ほぼ横の線をハフ変換で探し、左右上下それぞれ有力な線をいくつか残す
 * 3. 左右上下の組み合わせのうち、「4辺に沿ってエッジがあり、カードの縦横比(63:88)に近く、大きい」ものを選ぶ
 * 4. 四隅から射影変換でカードを切り出す
 */

export type Pt = { x: number; y: number };
export interface Detection {
  /** 元画像の座標での四隅（左上・右上・右下・左下） */
  corners: [Pt, Pt, Pt, Pt];
  /** 0〜1。0.5 未満なら当てにしない方がよい */
  confidence: number;
}

type Src = HTMLCanvasElement | HTMLImageElement | HTMLVideoElement;

function srcSize(src: Src) {
  if (src instanceof HTMLImageElement) return { w: src.naturalWidth, h: src.naturalHeight };
  if (src instanceof HTMLVideoElement) return { w: src.videoWidth, h: src.videoHeight };
  return { w: src.width, h: src.height };
}

const ASPECT = 63 / 88;
const MAXDIM = 420;
const MAX_SLOPE = Math.tan((18 * Math.PI) / 180);
const SLOPES = 25;

interface Line { a: number; b: number; votes: number }

/**
 * prior: カメラの枠など、カードがだいたいこのあたりにあるはずという位置（0〜1の比率）。
 * あれば、そこから大きく外れた候補を選びにくくする。
 */
export function detectCard(src: Src, prior?: { x: number; y: number; w: number; h: number }, debug?: unknown[], opts: { nested?: boolean } = {}): Detection | null {
  const { w: W0, h: H0 } = srcSize(src);
  if (!W0 || !H0) return null;
  const s = Math.min(1, MAXDIM / Math.max(W0, H0));
  const W = Math.round(W0 * s), H = Math.round(H0 * s);
  const cv = document.createElement('canvas');
  cv.width = W; cv.height = H;
  const ctx = cv.getContext('2d', { willReadFrequently: true })!;
  ctx.drawImage(src, 0, 0, W, H);
  const px = ctx.getImageData(0, 0, W, H).data;

  // 明るさと色の差の両方でエッジを取る（背景とカードの枠の色が近い場合に備える）
  const g = new Float32Array(W * H);
  const cr = new Float32Array(W * H);
  for (let i = 0; i < W * H; i++) {
    const r = px[i * 4], gg = px[i * 4 + 1], b = px[i * 4 + 2];
    g[i] = 0.299 * r + 0.587 * gg + 0.114 * b;
    cr[i] = (Math.max(r, gg, b) - Math.min(r, gg, b));
  }
  const blur = (a: Float32Array) => {
    const t = new Float32Array(a.length), o = new Float32Array(a.length);
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const i = y * W + x;
      t[i] = (a[i - (x > 0 ? 1 : 0)] + 2 * a[i] + a[i + (x < W - 1 ? 1 : 0)]) / 4;
    }
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const i = y * W + x;
      o[i] = (t[i - (y > 0 ? W : 0)] + 2 * t[i] + t[i + (y < H - 1 ? W : 0)]) / 4;
    }
    return o;
  };
  const gb = blur(blur(g)), cb = blur(blur(cr));
  const gx = new Float32Array(W * H), gy = new Float32Array(W * H), mag = new Float32Array(W * H);
  for (let y = 1; y < H - 1; y++) for (let x = 1; x < W - 1; x++) {
    const i = y * W + x;
    let ax = 0, ay = 0;
    for (const a of [gb, cb]) {
      const sx = a[i - W + 1] + 2 * a[i + 1] + a[i + W + 1] - a[i - W - 1] - 2 * a[i - 1] - a[i + W - 1];
      const sy = a[i + W - 1] + 2 * a[i + W] + a[i + W + 1] - a[i - W - 1] - 2 * a[i - W] - a[i - W + 1];
      // 明るさと色差のうち強い方を使う
      if (sx * sx + sy * sy > ax * ax + ay * ay) { ax = sx; ay = sy; }
    }
    gx[i] = ax; gy[i] = ay; mag[i] = Math.hypot(ax, ay);
  }
  // 強めのエッジだけ使う（上位およそ20%）。カードの縁が背景と似た色でも拾えるよう、低めにしておく
  const sorted = Float32Array.from(mag).sort();
  const thr = Math.max(12, sorted[Math.floor(sorted.length * 0.8)]);
  const low = Math.max(6, thr * 0.3);

  // ハフ変換。縦の線は x = a + b*(y - H/2)、横の線は y = a + b*(x - W/2)
  const slopes = Array.from({ length: SLOPES }, (_, k) => -MAX_SLOPE + (2 * MAX_SLOPE * k) / (SLOPES - 1));
  const accV = new Float32Array(SLOPES * W), accH = new Float32Array(SLOPES * H);
  for (let y = 1; y < H - 1; y++) for (let x = 1; x < W - 1; x++) {
    const i = y * W + x;
    const m = mag[i];
    if (m < thr) continue;
    const ax = Math.abs(gx[i]), ay = Math.abs(gy[i]);
    const wgt = Math.min(m, thr * 3);
    if (ax > ay * 1.2) {
      for (let k = 0; k < SLOPES; k++) {
        const a = Math.round(x - slopes[k] * (y - H / 2));
        if (a >= 0 && a < W) accV[k * W + a] += wgt;
      }
    } else if (ay > ax * 1.2) {
      for (let k = 0; k < SLOPES; k++) {
        const a = Math.round(y - slopes[k] * (x - W / 2));
        if (a >= 0 && a < H) accH[k * H + a] += wgt;
      }
    }
  }
  const peaks = (acc: Float32Array, n: number, lo: number, hi: number): Line[] => {
    const out: Line[] = [];
    for (let k = 0; k < SLOPES; k++) for (let a = Math.max(0, lo); a < Math.min(n, hi); a++) {
      const v = acc[k * n + a];
      if (v <= 0) continue;
      let isMax = true;
      for (let dk = -2; dk <= 2 && isMax; dk++) for (let da = -4; da <= 4; da++) {
        const kk = k + dk, aa = a + da;
        if ((dk || da) && kk >= 0 && kk < SLOPES && aa >= 0 && aa < n && acc[kk * n + aa] > v) { isMax = false; break; }
      }
      if (isMax) out.push({ a, b: slopes[k], votes: v });
    }
    return out.sort((p, q) => q.votes - p.votes).slice(0, 10);
  };
  const lefts = peaks(accV, W, 0, Math.round(W * 0.5));
  const rights = peaks(accV, W, Math.round(W * 0.5), W);
  const tops = peaks(accH, H, 0, Math.round(H * 0.5));
  const bottoms = peaks(accH, H, Math.round(H * 0.5), H);
  if (!lefts.length || !rights.length || !tops.length || !bottoms.length) return null;

  // 縦線 x = av + bv*(y-H/2) と 横線 y = ah + bh*(x-W/2) の交点
  const cross = (v: Line, h: Line): Pt => {
    // x = av + bv*(ah + bh*(x - W/2) - H/2)
    const x = (v.a + v.b * (h.a - h.b * W / 2 - H / 2)) / (1 - v.b * h.b);
    return { x, y: h.a + h.b * (x - W / 2) };
  };
  // 辺に沿って、辺と同じ向きのエッジがどれだけ続いているか（0〜1）。
  // 明暗の向き（内側が明るいか暗いか）がそろっているほど、本物の縁らしい
  const support = (p: Pt, q: Pt, vertical: boolean) => {
    const len = Math.hypot(q.x - p.x, q.y - p.y);
    const n = Math.max(10, Math.min(120, Math.round(len / 2)));
    const nx = -(q.y - p.y) / len, ny = (q.x - p.x) / len;
    let pos = 0, neg = 0;
    for (let t = 0; t < n; t++) {
      // 角は丸いので、両端の少しは見ない
      const f = 0.07 + (0.86 * (t + 0.5)) / n;
      const x0 = p.x + (q.x - p.x) * f, y0 = p.y + (q.y - p.y) * f;
      let bestDot = 0;
      for (let d = -2; d <= 2; d++) {
        const x = Math.round(vertical ? x0 + d : x0), y = Math.round(vertical ? y0 : y0 + d);
        if (x < 1 || y < 1 || x >= W - 1 || y >= H - 1) continue;
        const i = y * W + x;
        if (mag[i] < low) continue;
        const dot = (gx[i] * nx + gy[i] * ny) / mag[i];
        if (Math.abs(dot) > 0.9 && Math.abs(dot) * Math.min(1, mag[i] / thr) > Math.abs(bestDot)) bestDot = dot * Math.min(1, mag[i] / thr);
      }
      if (bestDot > 0) pos += 0.5 + 0.5 * bestDot; else if (bestDot < 0) neg += 0.5 - 0.5 * bestDot;
    }
    return (pos + neg) / n;
  };
  const priorCorners = prior && [
    { x: prior.x * W, y: prior.y * H }, { x: (prior.x + prior.w) * W, y: prior.y * H },
    { x: (prior.x + prior.w) * W, y: (prior.y + prior.h) * H }, { x: prior.x * W, y: (prior.y + prior.h) * H },
  ];
  const diag = Math.hypot(W, H);

  type Cand = { score: number; corners: [Pt, Pt, Pt, Pt]; sup: number; aErr: number; area: number };
  let best: Cand | null = null;
  const all: Cand[] = [];
  for (const L of lefts) for (const R of rights) for (const T of tops) for (const B of bottoms) {
    const tl = cross(L, T), tr = cross(R, T), br = cross(R, B), bl = cross(L, B);
    const wTop = tr.x - tl.x, wBot = br.x - bl.x, hL = bl.y - tl.y, hR = br.y - tr.y;
    if (wTop < W * 0.2 || wBot < W * 0.2 || hL < H * 0.2 || hR < H * 0.2) continue;
    // 四隅が画像から大きくはみ出すものは除く
    if ([tl, tr, br, bl].some((p) => p.x < -W * 0.05 || p.y < -H * 0.05 || p.x > W * 1.05 || p.y > H * 1.05)) continue;
    const aspect = ((wTop + wBot) / 2) / ((hL + hR) / 2);
    const aErr = Math.abs(Math.log(aspect / ASPECT));
    if (aErr > 0.35) continue;
    // 遠近で台形になるのは許すが、極端なものは除く
    const persp = Math.abs(Math.log(wTop / wBot)) + Math.abs(Math.log(hL / hR));
    if (persp > 0.5) continue;
    const sup = (support(tl, tr, false) + support(bl, br, false) + support(tl, bl, true) + support(tr, br, true)) / 4;
    const area = (((wTop + wBot) / 2) * ((hL + hR) / 2)) / (W * H);
    let score = sup - 1.2 * aErr - 0.3 * persp + 1.0 * Math.min(area, 0.8);
    if (priorCorners) score -= 1.5 * [tl, tr, br, bl].reduce((s2, p, j) => s2 + Math.hypot(p.x - priorCorners[j].x, p.y - priorCorners[j].y), 0) / 4 / diag;
    if (debug) debug.push({ score, sup, aErr, persp, area, corners: [tl, tr, br, bl].map((p) => ({ x: p.x / s, y: p.y / s })) });
    const cand: Cand = { score, corners: [tl, tr, br, bl], sup, aErr, area };
    all.push(cand);
    if (!best || score > best.score) best = cand;
  }
  if (!best) return null;
  // カードケース（スクリューダウンなど）に入っていると、ケースの外形もカードと同じような長方形に見える。
  // 選んだ四角形の内側に、縁がはっきりしたカードの形の四角形があれば、そちらを本物のカードとみなす
  for (let round = 0; round < (opts.nested === false ? 0 : 3); round++) {
    const outer: Cand = best;
    const ox = (outer.corners[1].x - outer.corners[0].x) * 0.015, oy = (outer.corners[3].y - outer.corners[0].y) * 0.015;
    const inside = (p: Pt) => p.x > Math.min(outer.corners[0].x, outer.corners[3].x) + ox && p.x < Math.max(outer.corners[1].x, outer.corners[2].x) - ox
      && p.y > Math.min(outer.corners[0].y, outer.corners[1].y) + oy && p.y < Math.max(outer.corners[2].y, outer.corners[3].y) - oy;
    const inner = all
      .filter((c) => c !== outer && c.area >= outer.area * 0.4 && c.area < outer.area * 0.95 && c.aErr < 0.12 && c.sup >= Math.max(0.8, outer.sup - 0.12) && c.corners.every(inside))
      .sort((a, b) => b.score - a.score)[0];
    if (!inner) break;
    best = inner;
  }
  const k = 1 / s;
  return {
    corners: best.corners.map((p) => ({ x: p.x * k, y: p.y * k })) as [Pt, Pt, Pt, Pt],
    confidence: Math.max(0, Math.min(1, (best.sup - 0.3) / 0.5)),
  };
}

/** 四隅から、正面から見たカード画像を作る（射影変換） */
export function warpCard(src: Src, corners: [Pt, Pt, Pt, Pt], width = 650): HTMLCanvasElement {
  const { w: W0, h: H0 } = srcSize(src);
  const height = Math.round(width / ASPECT);
  // 元画像の必要な範囲だけ読み出す
  const minX = Math.max(0, Math.floor(Math.min(...corners.map((p) => p.x))) - 2);
  const minY = Math.max(0, Math.floor(Math.min(...corners.map((p) => p.y))) - 2);
  const maxX = Math.min(W0, Math.ceil(Math.max(...corners.map((p) => p.x))) + 2);
  const maxY = Math.min(H0, Math.ceil(Math.max(...corners.map((p) => p.y))) + 2);
  const sw = Math.max(1, maxX - minX), sh = Math.max(1, maxY - minY);
  const sc = document.createElement('canvas');
  sc.width = sw; sc.height = sh;
  const sctx = sc.getContext('2d', { willReadFrequently: true })!;
  sctx.drawImage(src, minX, minY, sw, sh, 0, 0, sw, sh);
  const sp = sctx.getImageData(0, 0, sw, sh).data;

  // 出力 (u,v) → 入力 (x,y) の射影変換を求める
  const Hm = homography(
    [{ x: 0, y: 0 }, { x: width, y: 0 }, { x: width, y: height }, { x: 0, y: height }],
    corners.map((p) => ({ x: p.x - minX, y: p.y - minY })),
  );
  const out = document.createElement('canvas');
  out.width = width; out.height = height;
  const octx = out.getContext('2d')!;
  const od = octx.createImageData(width, height);
  const o = od.data;
  for (let v = 0; v < height; v++) for (let u = 0; u < width; u++) {
    const d = Hm[6] * u + Hm[7] * v + 1;
    const x = (Hm[0] * u + Hm[1] * v + Hm[2]) / d;
    const y = (Hm[3] * u + Hm[4] * v + Hm[5]) / d;
    const x0 = Math.max(0, Math.min(sw - 2, Math.floor(x))), y0 = Math.max(0, Math.min(sh - 2, Math.floor(y)));
    const fx = Math.max(0, Math.min(1, x - x0)), fy = Math.max(0, Math.min(1, y - y0));
    const i00 = (y0 * sw + x0) * 4, i10 = i00 + 4, i01 = i00 + sw * 4, i11 = i01 + 4;
    const j = (v * width + u) * 4;
    for (let c = 0; c < 3; c++) {
      o[j + c] = (sp[i00 + c] * (1 - fx) + sp[i10 + c] * fx) * (1 - fy) + (sp[i01 + c] * (1 - fx) + sp[i11 + c] * fx) * fy;
    }
    o[j + 3] = 255;
  }
  octx.putImageData(od, 0, 0);
  return out;
}

/** 4点の対応から射影変換行列（8要素、h33=1）を求める */
function homography(from: Pt[], to: Pt[]): number[] {
  const A: number[][] = [];
  for (let i = 0; i < 4; i++) {
    const { x, y } = from[i], { x: X, y: Y } = to[i];
    A.push([x, y, 1, 0, 0, 0, -x * X, -y * X, X]);
    A.push([0, 0, 0, x, y, 1, -x * Y, -y * Y, Y]);
  }
  // ガウスの消去法
  for (let c = 0; c < 8; c++) {
    let p = c;
    for (let r = c + 1; r < 8; r++) if (Math.abs(A[r][c]) > Math.abs(A[p][c])) p = r;
    [A[c], A[p]] = [A[p], A[c]];
    for (let r = 0; r < 8; r++) {
      if (r === c) continue;
      const f = A[r][c] / A[c][c];
      for (let k = c; k < 9; k++) A[r][k] -= f * A[c][k];
    }
  }
  return A.map((row, i) => row[8] / row[i]);
}
