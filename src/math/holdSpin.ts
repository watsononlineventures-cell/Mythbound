import {
  AWAKENED_COIN_MULT, GRAND_AWAKENED, HS_LAND_BASE, HS_LAND_DECAY, HS_MAX_ROWS,
  HS_MAX_ROWS_AWAKENED, HS_RESPINS, HS_ROW_THRESHOLDS, HS_TRIGGER, JACKPOT_PAY,
  ORB_PRIZES, REELS, ROWS, SPECIAL_CHANCE, SPECIALS, type OrbPrize, type Special,
} from './config';
import { weighted, type Rng } from './rng';

export interface Orb {
  prize: OrbPrize;
  /** Current coin value (x total bet). Jackpot orbs have 0 here. */
  value: number;
  special?: Special;
}

export function drawOrbPrize(rng: Rng, awakened: boolean): Orb {
  const prize = weighted(rng, ORB_PRIZES);
  const value = prize.kind === 'coin' ? prize.value * (awakened ? AWAKENED_COIN_MULT : 1) : 0;
  return { prize, value };
}

export interface HoldSpinStep {
  landed: { cell: number; orb: Orb }[];
  /** Cells whose values changed this step (doublers/collectors), with the new value. */
  changed: { cell: number; value: number }[];
  unlockedRows: number;
  respinsLeft: number;
}

export interface HoldSpinResult {
  awakened: boolean;
  maxRows: number;
  /** Board cells, index = row * 5 + reel. Rows 0-2 are the base grid; higher rows unlock above. */
  initial: (Orb | null)[];
  steps: HoldSpinStep[];
  final: (Orb | null)[];
  jackpots: { cell: number; jackpot: 'MINI' | 'MINOR' | 'MAJOR' }[];
  grand: boolean;
  /** Total win, x total bet. */
  pay: number;
}

/** Rows open on a board holding `count` orbs (before any Row Breakers). */
export function rowsForCount(count: number, maxRows: number): number {
  return Math.min(maxRows, ROWS + HS_ROW_THRESHOLDS.filter((t) => count >= t).length);
}

const neighbors = (cell: number, rows: number): number[] => {
  const r = Math.floor(cell / REELS), c = cell % REELS;
  const out: number[] = [];
  if (r > 0) out.push(cell - REELS);
  if (r < rows - 1) out.push(cell + REELS);
  if (c > 0) out.push(cell - 1);
  if (c < REELS - 1) out.push(cell + 1);
  return out;
};

/**
 * Play out a hold & spin feature.
 * @param startOrbs map of base-grid cell (row * 5 + reel) -> orb; must be >= HS_TRIGGER.
 */
export function playHoldSpin(rng: Rng, startOrbs: Map<number, Orb>, awakened: boolean): HoldSpinResult {
  if (startOrbs.size < HS_TRIGGER) throw new Error('Not enough orbs to trigger hold & spin');
  const maxRows = awakened ? HS_MAX_ROWS_AWAKENED : HS_MAX_ROWS;
  const board: (Orb | null)[] = Array(maxRows * REELS).fill(null);
  for (const [cell, orb] of startOrbs) board[cell] = { ...orb };
  const initial = board.map((o) => (o ? { ...o } : null));

  let respinMax = HS_RESPINS;
  let respins = respinMax;
  let breakerRows = 0;
  let filled = startOrbs.size;
  const startCount = startOrbs.size;
  const rowsFor = () => {
    const met = HS_ROW_THRESHOLDS.filter((t) => filled >= t).length;
    return Math.min(maxRows, ROWS + met + breakerRows);
  };
  let unlocked = rowsFor();
  const steps: HoldSpinStep[] = [];
  const isFull = () => unlocked === maxRows && filled === maxRows * REELS;

  while (respins > 0 && !isFull()) {
    // Expected orbs landing this respin, spread over the empty cells, so the odds of a dry respin
    // don't depend on board size; it tapers as the feature adds orbs, so boards don't run away.
    const empties = unlocked * REELS - filled;
    const expected = HS_LAND_BASE * Math.pow(HS_LAND_DECAY, filled - startCount);
    const p = Math.min(0.9, expected / Math.max(1, empties));
    const landed: HoldSpinStep['landed'] = [];
    const changed = new Map<number, number>();
    for (let cell = 0; cell < unlocked * REELS; cell++) {
      if (board[cell] || rng.next() >= p) continue;
      const orb = drawOrbPrize(rng, awakened);
      if (rng.next() < SPECIAL_CHANCE) orb.special = weighted(rng, SPECIALS);
      board[cell] = orb;
      filled++;
      landed.push({ cell, orb });
    }
    // Resolve specials in landing order.
    for (const { cell, orb } of landed) {
      switch (orb.special) {
        case 'DOUBLER':
          for (const n of neighbors(cell, unlocked)) {
            const o = board[n];
            if (o && o.prize.kind === 'coin') { o.value *= 2; changed.set(n, o.value); }
          }
          break;
        case 'COLLECTOR': {
          let sum = 0;
          board.forEach((o, i) => { if (o && i !== cell && o.prize.kind === 'coin') sum += o.value; });
          if (orb.prize.kind === 'coin') { orb.value += sum; changed.set(cell, orb.value); }
          else { orb.value = sum; changed.set(cell, sum); }
          break;
        }
        case 'ROW_BREAKER':
          breakerRows++;
          break;
        case 'EXTRA_RESPIN':
          respinMax = HS_RESPINS + 1;
          break;
      }
    }
    unlocked = rowsFor();
    respins = landed.length > 0 ? respinMax : respins - 1;
    steps.push({
      landed: landed.map((l) => ({ cell: l.cell, orb: { ...l.orb } })),
      changed: [...changed].map(([cell, value]) => ({ cell, value })),
      unlockedRows: unlocked,
      respinsLeft: respins,
    });
  }

  const grand = isFull();
  const jackpots: HoldSpinResult['jackpots'] = [];
  let pay = 0;
  board.forEach((o, cell) => {
    if (!o) return;
    pay += o.value;
    if (o.prize.kind === 'jackpot') {
      jackpots.push({ cell, jackpot: o.prize.jackpot });
      pay += JACKPOT_PAY[o.prize.jackpot];
    }
  });
  if (grand) pay += awakened ? GRAND_AWAKENED : JACKPOT_PAY.GRAND;

  return { awakened, maxRows, initial, steps, final: board, jackpots, grand, pay };
}
