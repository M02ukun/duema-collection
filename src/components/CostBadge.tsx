import { CIV_COLORS, type Civilization } from '../types';

export function civBg(civs: Civilization[]): string {
  const cs = civs.filter((c) => c in CIV_COLORS);
  if (!cs.length) return '#bbb';
  if (cs.length === 1) return CIV_COLORS[cs[0]];
  const step = 100 / cs.length;
  return `linear-gradient(135deg, ${cs.map((c, i) => `${CIV_COLORS[c]} ${i * step}% ${(i + 1) * step}%`).join(', ')})`;
}

export function CostBadge({ cost, civs }: { cost: number | null; civs: Civilization[] }) {
  return <span className="cost" style={{ background: civBg(civs) }}>{cost ?? '-'}</span>;
}
