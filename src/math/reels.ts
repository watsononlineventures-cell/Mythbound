import { REELS, ROWS, STRIP_SEED, type OrbLayout, type StripRecipe, type Sym } from './config';
import { randInt, seededRng, type Rng } from './rng';

/** Build a fixed reel strip from a recipe using a seeded shuffle of symbol blocks. */
export function buildStrip(recipe: StripRecipe, seed: number, orbs?: OrbLayout): Sym[] {
  const rng = seededRng(seed);
  const blocks: Sym[][] = [];
  for (const [sym, count, height] of recipe) {
    for (let i = 0; i < count; i++) blocks.push(Array<Sym>(height).fill(sym));
  }
  for (let i = blocks.length - 1; i > 0; i--) {
    const j = randInt(rng, i + 1);
    [blocks[i], blocks[j]] = [blocks[j], blocks[i]];
  }
  // Avoid two identical stacked blocks touching (keeps stacks honest).
  for (let i = 1; i < blocks.length; i++) {
    if (blocks[i][0] === blocks[i - 1][0] && blocks[i].length > 1) {
      const k = (i + 2) % blocks.length;
      [blocks[i], blocks[k]] = [blocks[k], blocks[i]];
    }
  }
  // Moon Gates: at most one per visible reel. Orbs: never two touching, so feature odds don't hinge on shuffle luck.
  if (orbs) placeOrbs(blocks, orbs, rng);
  return spaceOut(blocks.flat(), 'S', ROWS, rng);
}

/**
 * Insert orbs at evenly spaced block boundaries, so feature odds depend on the counts, not on shuffle luck.
 * A "pair" is orb, low symbol, orb: the only way one reel can show two orbs at once.
 * Singles and pairs are interleaved evenly, and units are at least two blocks apart, so orbs
 * from different units never share a reel window.
 */
function placeOrbs(blocks: Sym[][], { singles, pairs }: OrbLayout, rng: ReturnType<typeof seededRng>) {
  const units = singles + pairs;
  if (units === 0) return;
  if (blocks.length / units < 2) throw new Error('Too many orbs for this strip');
  const kinds: ('single' | 'pair')[] = [];
  for (let u = 0; u < units; u++) {
    // Bresenham-style interleave of pairs among singles.
    kinds.push(Math.floor(((u + 1) * pairs) / units) > Math.floor((u * pairs) / units) ? 'pair' : 'single');
  }
  const lows: Sym[] = ['L1', 'L2', 'L3', 'L4'];
  const offset = randInt(rng, Math.max(1, Math.floor(blocks.length / units)));
  for (let u = units - 1; u >= 0; u--) {
    const at = (Math.floor((u * blocks.length) / units) + offset) % blocks.length;
    const unit: Sym[][] = kinds[u] === 'pair' ? [['O'], [lows[randInt(rng, 4)]], ['O']] : [['O']];
    blocks.splice(at, 0, ...unit);
  }
}

/**
 * Move copies of `sym` apart so any window of `gap` consecutive stops shows at most one.
 * Scatters count once per reel, so a reel must never show two at the same time.
 */
export function spaceOut(strip: Sym[], sym: Sym, gap: number, rng: ReturnType<typeof seededRng>): Sym[] {
  const n = strip.length;
  const at = (i: number) => strip[((i % n) + n) % n];
  const near = (i: number, skip: number) => {
    for (let d = -(gap - 1); d <= gap - 1; d++) {
      const j = (((i + d) % n) + n) % n;
      if (d !== 0 && j !== skip && strip[j] === sym) return true;
    }
    return false;
  };
  for (let guard = 0; guard < 10_000; guard++) {
    const bad = strip.findIndex((x, i) => x === sym && near(i, -1));
    if (bad < 0) return strip;
    // Swap it with a lone (unstacked) symbol that has no copy of `sym` nearby.
    const spots: number[] = [];
    for (let p = 0; p < n; p++) {
      const x = strip[p];
      // Only swap with low/mid symbols; wild and beast stacks stay intact.
      if (!(x.startsWith('L') || x.startsWith('M'))) continue;
      if (!near(p, bad)) spots.push(p);
    }
    if (!spots.length) throw new Error(`Cannot space out ${sym}: strip too crowded`);
    const p = spots[randInt(rng, spots.length)];
    [strip[bad], strip[p]] = [strip[p], strip[bad]];
  }
  throw new Error(`Could not space out ${sym}`);
}

export function buildReelSet(recipes: StripRecipe[], salt: number, orbs?: OrbLayout): Sym[][] {
  return recipes.map((r, i) => buildStrip(r, STRIP_SEED + salt * 101 + i, orbs));
}

/** Grid is column-major: grid[reel][row], row 0 = top. */
export type Grid = Sym[][];

export function spinReels(rng: Rng, strips: Sym[][]): { grid: Grid; stops: number[] } {
  const grid: Grid = [];
  const stops: number[] = [];
  for (let r = 0; r < REELS; r++) {
    const strip = strips[r];
    const stop = randInt(rng, strip.length);
    stops.push(stop);
    const col: Sym[] = [];
    for (let row = 0; row < ROWS; row++) col.push(strip[(stop + row) % strip.length]);
    grid.push(col);
  }
  return { grid, stops };
}
