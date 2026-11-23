import { LINE_COUNT, PAYTABLE, REELS, ROWS, type Sym } from './config';
import type { Grid } from './reels';

/**
 * 50 paylines: every path across the reels that moves at most one row per reel,
 * ordered smoothest first (the three straight rows are lines 1-3).
 */
export const LINES: number[][] = (() => {
  const paths: number[][] = [];
  const walk = (path: number[]) => {
    if (path.length === REELS) return void paths.push(path);
    const last = path[path.length - 1];
    for (let r = 0; r < ROWS; r++) if (Math.abs(r - last) <= 1) walk([...path, r]);
  };
  for (const start of [1, 0, 2]) walk([start]);
  const cost = (p: number[]) => p.slice(1).reduce((s, r, i) => s + Math.abs(r - p[i]), 0);
  return paths
    .map((p, i) => ({ p, i, c: cost(p) }))
    .sort((a, b) => a.c - b.c || a.i - b.i)
    .slice(0, LINE_COUNT)
    .map((x) => x.p);
})();

export interface LineWin {
  line: number; // 0-based line index
  symbol: Sym;
  count: number;
  pay: number; // x line bet
}

/** Left-to-right line evaluation. Wilds never land on reel 1, so reel 1 sets the symbol. */
export function evaluateLines(grid: Grid): LineWin[] {
  const wins: LineWin[] = [];
  for (let li = 0; li < LINES.length; li++) {
    const line = LINES[li];
    const sym = grid[0][line[0]];
    const pays = PAYTABLE[sym];
    if (!pays) continue;
    let count = 1;
    while (count < REELS) {
      const s = grid[count][line[count]];
      if (s !== sym && s !== 'W') break;
      count++;
    }
    if (count >= 3) wins.push({ line: li, symbol: sym, count, pay: pays[count - 3] });
  }
  return wins;
}

export function countSymbol(grid: Grid, sym: Sym): number {
  let n = 0;
  for (const col of grid) for (const s of col) if (s === sym) n++;
  return n;
}

/** Number of reels showing at least one of the symbol (scatters pay once per reel). */
export function countReelsWith(grid: Grid, sym: Sym): number {
  return grid.filter((col) => col.includes(sym)).length;
}
