// 画面で使う線のアイコン（絵文字の代わり）
const base = { fill: 'none', stroke: 'currentColor', strokeWidth: 1.8, strokeLinecap: 'round', strokeLinejoin: 'round', viewBox: '0 0 24 24', 'aria-hidden': true } as const;

export const IconCollection = () => (
  <svg {...base}><rect x="3" y="3" width="7.5" height="10" rx="1.5" /><rect x="13.5" y="3" width="7.5" height="10" rx="1.5" /><rect x="3" y="15.5" width="18" height="5.5" rx="1.5" /></svg>
);
export const IconCamera = () => (
  <svg {...base}><path d="M4 8.5A2.5 2.5 0 0 1 6.5 6h1.6l1.4-2h5l1.4 2h1.6A2.5 2.5 0 0 1 20 8.5v9A2.5 2.5 0 0 1 17.5 20h-11A2.5 2.5 0 0 1 4 17.5z" /><circle cx="12" cy="12.5" r="3.5" /></svg>
);
export const IconBox = () => (
  <svg {...base}><path d="M3.5 7.5 12 3l8.5 4.5v9L12 21l-8.5-4.5z" /><path d="M3.5 7.5 12 12l8.5-4.5M12 12v9" /></svg>
);
export const IconDeck = () => (
  <svg {...base}><rect x="7" y="3" width="11" height="15" rx="1.8" /><path d="M4.5 6.5v11A2.5 2.5 0 0 0 7 20h8" /></svg>
);
export const IconSettings = () => (
  <svg {...base}><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z" /></svg>
);
export const IconImage = () => (
  <svg {...base}><rect x="3" y="4" width="18" height="16" rx="2.5" /><circle cx="9" cy="9.5" r="1.6" /><path d="m21 16-5-5-9 9" /></svg>
);
export const IconQr = () => (
  <svg {...base}><rect x="3.5" y="3.5" width="6.5" height="6.5" rx="1" /><rect x="14" y="3.5" width="6.5" height="6.5" rx="1" /><rect x="3.5" y="14" width="6.5" height="6.5" rx="1" /><path d="M14 14h3v3h-3zM17 17h3.5v3.5M20.5 14v.01" /></svg>
);
export const IconSearch = () => (
  <svg {...base}><circle cx="11" cy="11" r="6.5" /><path d="m20 20-4.2-4.2" /></svg>
);
export const IconChevron = () => (
  <svg {...base} width="18" height="18"><path d="m9 6 6 6-6 6" /></svg>
);
export const IconBack = () => (
  <svg {...base} width="18" height="18"><path d="m15 6-6 6 6 6" /></svg>
);
export const IconCheck = () => (
  <svg {...base} width="16" height="16"><path d="m5 12.5 4.5 4.5L19 7.5" /></svg>
);
