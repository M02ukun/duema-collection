/** OCR の生テキストからパック記号とカード番号を取り出す */
export interface ParsedCode {
  setCode: string;
  number: string;
}

// OCR でよく起きる取り違えを数字に寄せる
function toDigits(s: string): string {
  return s.replace(/[OQD]/g, '0').replace(/[IL|]/g, '1').replace(/Z/g, '2').replace(/S/g, '5').replace(/B/g, '8');
}

export function parseCodeText(raw: string): ParsedCode {
  const text = raw.toUpperCase().replace(/[‐－—–]/g, '-').replace(/／/g, '/').replace(/[^\S\n]+/g, ' ');

  // 番号: 12/77, S1/S11, SP2/SP5, M3/M10, T1/T10 など
  let number = '';

  const numRe = /([A-Z]{0,3})\s?([0-9OQIL|]{1,3})\s?\/\s?([A-Z]{0,3})\s?([0-9OQIL|]{1,3})/g;
  for (const m of text.matchAll(numRe)) {
    const pre1 = m[1].replace(/[^A-Z]/g, '');
    const pre2 = m[3].replace(/[^A-Z]/g, '');
    const a = toDigits(m[2]);
    const b = toDigits(m[4]);
    if (!/^\d+$/.test(a) || !/^\d+$/.test(b)) continue;
    // 先頭の記号は前後で一致するときだけ採用（例: S1/S11）
    const prefix = pre1 && pre1 === pre2 ? pre1 : '';
    if (Number(a) > Number(b) && !prefix) continue;
    number = `${prefix}${Number(a)}/${prefix}${Number(b)}`;

    break;
  }

  // パック記号: DM24-RP1, DMRP-22, DMEX-17, DM23-BD3, DMSD-21, DMBD-20, P12/Y21 など
  let setCode = '';
  const before = text;
  const setRe = /\b(DM[A-Z0-9]{0,5}(?:-[A-Z0-9]{1,5})?)\b/g;
  const candidates = [...before.matchAll(setRe)].map((m) => m[1]).filter((s) => /\d/.test(s));
  if (candidates.length) {
    setCode = candidates.sort((x, y) => y.length - x.length)[0];
  } else {
    const generic = [...before.matchAll(/\b([A-Z]{1,4}[0-9]{1,3}(?:-[A-Z]{1,4}[0-9]{0,3})?)\b/g)]
      .map((m) => m[1])
      .filter((s) => !number.includes(s));
    if (generic.length) setCode = generic[0];
  }
  return { setCode, number };
}
