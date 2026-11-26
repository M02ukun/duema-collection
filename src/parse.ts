/**
 * OCR の生テキストからパック記号・レアリティ・カード番号を取り出す。
 *
 * カード右下の表記は時期によって3種類ある:
 *   古い:  DMX22-b ○ 159/???   DMR13 ☆ 16/110   （レアリティは記号）
 *   中期:  RP01 C 80/93        EX11 R 7/42      （レアリティは英字）
 *   最近:  24RP3 R 19/76       26EX4 VR 34/99   （頭に年号2桁）
 */
export interface ParsedCode {
  setCode: string;
  number: string;
  rarity: string;
  /** 読み取り結果の確からしさ（大きいほど良い） */
  score: number;
  /** パック記号だけの確からしさ（0〜3） */
  setStrength: number;
  /** 番号だけの確からしさ */
  numberScore: number;
}

export const RARITIES = ['C', 'U', 'UC', 'R', 'VR', 'SR', 'MR', 'OR', 'DM', 'DMR', 'KGM', 'SP', 'LEG', 'GR', 'T', 'TD'];

const DIGIT_FIX: Record<string, string> = { O: '0', Q: '0', D: '0', U: '0', I: '1', L: '1', '|': '1', J: '1', T: '7', Z: '2', S: '5', B: '8', G: '6', A: '4' };
const LETTER_FIX: Record<string, string> = { '0': 'O', '1': 'I', '5': 'S', '8': 'B', '2': 'Z', '6': 'G', '4': 'A' };

const toDigits = (s: string) => s.replace(/./g, (c) => DIGIT_FIX[c] ?? c);
const toLetters = (s: string) => s.replace(/./g, (c) => LETTER_FIX[c] ?? c);

/**
 * パック記号らしさを判定し、OCR の取り違えを直した形を返す。
 * 3: 形がはっきり当てはまる / 0: 当てはまらない
 */
export function fixSetCode(token: string): { code: string; strength: number } {
  const t = token.toUpperCase().replace(/[^A-Z0-9-]/g, '');
  if (t.length < 3 || t.length > 10) return { code: t, strength: 0 };

  // 最近: 2桁の年号 + 英字 + 数字（24RP3, 26EX4, 25BD12）
  let m = t.match(/^([0-9OQDILZSBG]{2})([A-Z0-9]{2,3}?)([0-9OQDILZSB]{1,2})$/);
  if (m && /[A-Z]/.test(toLetters(m[2])) && /^\d{2}$/.test(toDigits(m[1]))) {
    const year = Number(toDigits(m[1]));
    if (year >= 23 && year <= 40) return { code: `${toDigits(m[1])}${toLetters(m[2])}${toDigits(m[3])}`, strength: 3 };
  }

  // 古い: DM で始まる（DMR13, DMX22-B, DM-01, DMC-12, DMBD-01）
  m = t.match(/^(DM|0M|DN|OM)([A-Z0-9]{0,3}?)-?([0-9OQDILZSB]{1,3})(-[A-Z0-9]{1,3})?$/);
  if (m) {
    const mid = toLetters(m[2]);
    const hyphen = t.includes('-') && !m[4] ? '-' : '';
    return { code: `DM${mid}${hyphen}${toDigits(m[3])}${m[4] ?? ''}`, strength: 3 };
  }

  // 中期: 英字2〜4 + 数字2桁（RP01, EX11, BD01, SD12, GR02）
  m = t.match(/^([A-Z0-9]{2,4}?)([0-9OQDILZSB]{2})$/);
  if (m) {
    const head = toLetters(m[1]);
    if (/^[A-Z]{2,4}$/.test(head)) {
      const known = ['RP', 'EX', 'BD', 'SD', 'GR', 'SP', 'PR'].includes(head);
      return { code: `${head}${toDigits(m[2])}`, strength: known ? 3 : 2 };
    }
  }

  // その他: 英字と数字が混ざっていればとりあえず候補にする
  if (/[A-Z]/.test(t) && /\d/.test(t)) return { code: t, strength: 1 };
  return { code: t, strength: 0 };
}

const NUM_RE = /(?<![A-Z0-9])([A-Z]{0,2})([0-9OQDILZSB|]{1,3})\s?\/\s?([A-Z]{0,2})([0-9OQDILZSB|]{1,3}|\?{1,3})(?![0-9])/;

/** "/" が読めず "19776" のように数字がつながったときに、"7" か "1" を区切りとみなして分ける */
function splitGlued(line: string): string {
  if (line.includes('/')) return line;
  return line.replace(/(?<![A-Z0-9])(\d{3,7})(?![0-9])/g, (run) => {
    let best = '';
    for (let i = 1; i < run.length - 1; i++) {
      if (run[i] !== '7' && run[i] !== '1') continue;
      const a = Number(run.slice(0, i)), b = Number(run.slice(i + 1));
      if (a >= 1 && b >= a && b <= 300 && run[i + 1] !== '0') {
        if (!best || run[i] === '7') best = `${run.slice(0, i)}/${run.slice(i + 1)}`;
      }
    }
    return best ? best + ' ' : run;
  });
}

function parseLine(line: string, knownSets: string[]): ParsedCode | null {
  // 番号: 16/110, S1/S11, 159/??? など
  let best: ParsedCode | null = null;
  const guessedSlash = !line.includes('/');
  line = splitGlued(line);
  const re = new RegExp(NUM_RE.source, 'g');
  for (const m of line.matchAll(re)) {
    // 前後で同じ英字が付いていれば記号（S1/S11 など）、違えば数字の読み間違いとみなす
    const samePrefix = m[1] === m[3];
    const pre1 = samePrefix ? m[1] : '', pre2 = pre1;
    const a = toDigits(samePrefix ? m[2] : m[1] + m[2]);
    let b = m[4].startsWith('?') ? '???' : toDigits(samePrefix ? m[4] : m[3] + m[4]);
    // "???" は "777" や "272" と読まれやすい（2と7だけの3桁＝222枚以上のパックは無い）
    if (/^[27?]{3}$/.test(m[4])) b = '???';
    if (!/^\d+$/.test(a) || !(b === '???' || /^\d+$/.test(b))) continue;
    const prefix = pre1 && pre1 === pre2 ? pre1 : '';
    let score = guessedSlash ? 1 : 3;
    if (b !== '???' && !prefix && Number(a) > Number(b)) score -= 2;
    if (Number(a) === 0) score -= 2;
    const number = `${prefix}${Number(a)}/${prefix}${b === '???' ? b : Number(b)}`;

    // 番号より前の部分からパック記号とレアリティを探す
    const before = line.slice(0, m.index).trim();
    const tokens = before.split(/\s+/).filter(Boolean);
    let setCode = '';
    let setStrength = 0;
    let rarity = '';
    for (let i = tokens.length - 1; i >= 0 && i >= tokens.length - 4; i--) {
      const tk = tokens[i].replace(/[^A-Z0-9-]/g, '');
      if (!rarity && RARITIES.includes(tk) && i === tokens.length - 1) { rarity = tk; continue; }
      const f = fixSetCode(tokens[i]);
      if (f.strength > setStrength) { setCode = f.code; setStrength = f.strength; }
    }
    // トークンの区切りがおかしいとき用に、くっついた文字列からも探す
    if (setStrength < 2) {
      const glued = before.replace(/\s+/g, '');
      for (const cand of glued.match(/(\d{2}[A-Z]{2,3}\d{1,2}|DM[A-Z0-9-]{2,7}|[A-Z]{2,3}\d{2})/g) ?? []) {
        const f = fixSetCode(cand);
        if (f.strength > setStrength) { setCode = f.code; setStrength = f.strength; }
      }
    }
    // 登録済みのパックと1文字違いなら、そちらに寄せる
    const snapped = snapToKnown(setCode, knownSets);
    if (snapped) { setCode = snapped; setStrength = Math.max(setStrength, 3); }

    const numberScore = score;
    score += setStrength + (rarity ? 1 : 0);
    const cand = { setCode, number, rarity, score, setStrength, numberScore };
    if (!best || cand.score > best.score) best = cand;
  }
  return best;
}

export function parseCodeText(raw: string, knownSets: string[] = []): ParsedCode {
  const text = raw
    .toUpperCase()
    .replace(/[‐－—–ー]/g, '-')
    .replace(/[／]/g, '/')
    .replace(/[？]/g, '?')
    // "159???" のように "/" が抜けたとき
    .replace(/(\d)\s?(\?{2,3})/g, '$1/$2')
    .replace(/[^\S\n]+/g, ' ');
  let best: ParsedCode | null = null;
  // 1行ずつ、と全体をつなげたもの、の両方で試す
  for (const line of [...text.split('\n'), text.replace(/\n/g, ' ')]) {
    const r = parseLine(line, knownSets);
    if (r && (!best || r.score > best.score)) best = r;
  }
  if (best) return best;
  // 番号が無くてもパック記号だけ拾えることがある
  for (const tk of text.split(/\s+/)) {
    const f = fixSetCode(tk);
    if (f.strength >= 2) return { setCode: snapToKnown(f.code, knownSets) ?? f.code, number: '', rarity: '', score: f.strength - 2, setStrength: f.strength, numberScore: -99 };
  }
  return { setCode: '', number: '', rarity: '', score: -1, setStrength: 0, numberScore: -99 };
}

function norm(s: string) {
  return s.toUpperCase().replace(/[^A-Z0-9]/g, '');
}

function snapToKnown(code: string, known: string[]): string | null {
  if (!code) return null;
  const n = norm(code);
  let hit: string | null = null;
  for (const k of known) {
    const kn = norm(k);
    if (kn === n) return k;
    if (Math.abs(kn.length - n.length) <= 1 && editDistance(kn, n) === 1) {
      if (hit) return null; // 候補が複数あるときは寄せない
      hit = k;
    }
  }
  return hit;
}

function editDistance(a: string, b: string): number {
  const dp = Array.from({ length: a.length + 1 }, (_, i) => [i, ...new Array(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) dp[0][j] = j;
  for (let i = 1; i <= a.length; i++)
    for (let j = 1; j <= b.length; j++)
      dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  return dp[a.length][b.length];
}
