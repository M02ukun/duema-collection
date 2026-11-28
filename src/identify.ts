/**
 * まっすぐに直したカード画像1枚から、どのカードかを判別する（1枚撮り・まとめ撮りで共通）。
 * 右下の番号が読めればそれで確定。読めなければ、名前の文字・イラストの色の配置・AIの特徴・コストと文明を合わせて順位をつける。
 */
import type { CardDb, MasterCard } from './carddb';
import { recognizeCardByName, type NameIndex, type NameRecResult } from './namerec';
import { recognizeCode } from './ocr';
import { loadFeatures, matchImage } from './imagerec';
import { matchEmbed } from './embed';
import { costCivScore, readCostCiv, type CostCiv } from './costciv';

export interface IdentifyResult extends NameRecResult {
  exact: MasterCard[];
  ranked: { card: MasterCard; score: number }[];
  costCiv: CostCiv | null;
  /** AIでいちばん似ていたカードとの似ている度合い（0〜1）。低ければデュエマのカードではないかもしれない */
  topSim: number;
}

export async function identifyCard(card: HTMLCanvasElement, o: {
  cardDb: CardDb;
  nameIndex: NameIndex;
  knownSets: string[];
  lockedSet?: string;
  /** 輪郭が取れなかった写真のときに試す切り出し */
  crops?: HTMLCanvasElement[];
  onStage?: (s: string) => void;
}): Promise<IdentifyResult> {
  const { cardDb, nameIndex, lockedSet = '' } = o;
  const stage = o.onStage ?? (() => {});
  stage('コストを読み取っています…');
  const cc = await readCostCiv(card).catch(() => null);
  stage('番号を読み取っています…');
  const code = await recognizeCode(card, { x: 0, y: 0.84, w: 1, h: 0.16 }, {
    knownSets: o.knownSets, quick: true, targetHeight: 300,
    isValid: (p) => !!p.number && cardDb.findByCode(lockedSet || p.setCode, p.number).length > 0,
  }).catch(() => null);
  const exact = code?.valid ? cardDb.findByCode(lockedSet || code.setCode, code.number) : [];
  const r = await recognizeCardByName(card, { x: 0, y: 0, w: 1, h: 1 }, nameIndex, stage);

  stage('イラストを照合しています…');
  const fs = await loadFeatures();
  const score = new Map<string, { card: MasterCard; name: number; img: number; ai: number }>();
  for (const cand of r.candidates) for (const c of cand.cards) {
    const prev = score.get(c.id);
    if (!prev || prev.name < cand.score) score.set(c.id, { card: c, name: cand.score, img: 0, ai: 0 });
  }
  const crops = o.crops ?? [card];
  const addTop = (ids: string[]) => {
    for (const id of ids) {
      const c = cardDb.byId.get(id);
      if (c && !score.has(c.id)) score.set(c.id, { card: c, name: 0, img: 0, ai: 0 });
    }
  };
  let simImg: ((id: string) => number) | null = null;
  if (fs) {
    const m = matchImage(crops, fs);
    addTop(m.top.map((t) => t.id));
    simImg = m.simOf;
  }
  // 画像認識AI（Googleレンズのような方式）で照合する
  const em = await matchEmbed(crops).catch((e) => { console.warn(e); return null; });
  if (em) addTop(em.top.map((t) => t.id));
  for (const v of score.values()) {
    if (simImg) v.img = Math.max(0, Math.min(1, (simImg(v.card.id) - 0.3) / 0.6));
    // AIの似ている度合いは、どのカードでもそれなりに高く出るので、いちばん似ているカードとの差で見る
    if (em) v.ai = Math.max(0, Math.min(1, 1 - (em.top[0].sim - em.simOf(v.card.id)) / 0.12));
  }
  const ranked = [...score.values()]
    .map((v) => ({
      card: v.card,
      score: em
        ? 0.35 * v.name + 0.1 * v.img + 0.55 * v.ai + (v.name > 0.6 && v.ai > 0.6 ? 0.2 : 0)
        : fs ? 0.5 * v.name + 0.5 * v.img + (v.name > 0.6 && v.img > 0.6 ? 0.2 : 0) : v.name,
    }))
    // 左上のコストと枠の色が合うカードを上げ、合わないカードを下げる
    .map((x) => (cc ? { ...x, score: x.score + 0.25 * costCivScore(cc, x.card) } : x))
    .sort((a, b) => b.score - a.score)
    .slice(0, 12);
  return { ...r, exact, ranked, costCiv: cc, topSim: em?.top[0]?.sim ?? 0 };
}
