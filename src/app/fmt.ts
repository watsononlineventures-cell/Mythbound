/** Money is kept in cents. Compact form for tight spaces: $0.25, $12.50, $250, $2,500, $12.5K, $1.2M. */
export function fmtCoins(cents: number): string {
  const d = cents / 100;
  const trim = (v: number, dp: number) => v.toFixed(dp).replace(/\.0+$/, '');
  if (d >= 1_000_000) return `$${trim(d / 1_000_000, d >= 10_000_000 ? 0 : 1)}M`;
  if (d >= 10_000) return `$${trim(d / 1000, d >= 100_000 ? 0 : 1)}K`;
  if (d >= 100 || Number.isInteger(d)) return `$${Math.round(d).toLocaleString('en-US')}`;
  return `$${d.toFixed(2)}`;
}

/** Full dollars and cents: $1,234.56. */
export const fmtFull = (cents: number) =>
  `$${(Math.round(cents) / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/** A denomination label: 1¢, 10¢, $1, $2. */
export const fmtDenom = (cents: number) => (cents < 100 ? `${cents}¢` : `$${cents / 100}`);

export const wait = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
