import {
  AWAKENED_COIN_MULT, BASE_ORBS, BASE_REELS, DOOR_REVEALS, FREE_GAMES_AWARD, FREE_GAMES_CAP, FREE_GAMES_LINE_MULT,
  FREE_GAMES_MIN_WIN, FREE_GAMES_SPINS_PER_GATE, HOARD_CHANCE, FREE_ORBS, FREE_REELS, HS_MAX_ROWS, HS_TRIGGER, LINE_COUNT, METER_MAX, ORB_BANK_MAX,
  ORB_BANK_TRIGGER, REELS, ROWS, SCATTER_PAY, SCATTER_TRIGGER, type Sym,
} from './config';
import { countReelsWith, evaluateLines, type LineWin } from './lines';
import { buildReelSet, spinReels, type Grid } from './reels';
import { drawOrbPrize, playHoldSpin, rowsForCount, type HoldSpinResult, type Orb } from './holdSpin';
import { randInt, weighted, type Rng } from './rng';
import { stepMhb, type MhbAward, type MhbState } from './mhb';
import { playHoard, type HoardResult } from './hoard';

export const BASE_STRIPS = buildReelSet(BASE_REELS, 1, BASE_ORBS);
export const FREE_STRIPS = buildReelSet(FREE_REELS, 2, FREE_ORBS);

export interface MeterState {
  points: number;
  /** True once the meter is full: the next hold & spin is awakened. */
  charged: boolean;
}
export const emptyMeter = (): MeterState => ({ points: 0, charged: false });

/** One evaluated screen (base spin or a single free game). All pays are x total bet. */
export interface ScreenResult {
  /** The screen as evaluated: doors revealed and sticky wilds applied. */
  grid: Grid;
  /** What the reels physically landed on (may include mystery doors 'D'). */
  reelGrid: Grid;
  /** reelGrid with doors opened, before sticky wilds are laid over it. */
  revealed: Grid;
  stops: number[];
  /** Orbs on screen, keyed by cell (row * 5 + reel). */
  orbs: { cell: number; orb: Orb }[];
  lineWins: LineWin[];
  linePay: number;
  scatters: number;
  scatterPay: number;
  holdSpin?: HoldSpinResult;
  freeGamesAwarded: number;
  /** Free games only. */
  free?: {
    /** Symbol the doors opened to, if any doors landed. */
    door?: Sym;
    /** Wild cells already stuck before this spin. */
    stickyBefore: number[];
    /** Wild cells that stuck on this spin. */
    newSticky: number[];
    /** Orbs banked so far this round, including this spin. */
    bank: number;
  };
}

export interface SpinOutcome {
  bet: number;
  base: ScreenResult;
  freeGames: ScreenResult[];
  /** Orbs banked during free games, and the Hold & Spin they started (6 or more). */
  bank?: { orbs: Orb[]; holdSpin?: HoldSpinResult };
  /** Top-up (x total bet) that brought a weak free games round up to the guaranteed minimum. */
  freeGamesTopUp: number;
  /** Thunderbird's Hoard pick bonus, when it opened this spin. */
  hoard?: HoardResult;
  meterBefore: MeterState;
  meterAfter: MeterState;
  /** Must Hit By meters after this spin (only when a state was passed in). */
  mhbAfter?: MhbState;
  mhbAwards: MhbAward[];
  /** Breakdown x total bet. */
  pays: { lines: number; scatter: number; holdSpin: number; freeGames: number; mustHitBy: number; hoard: number };
  totalX: number;
  /** Coins won (bet * totalX, rounded). */
  win: number;
}

const cellOf = (reel: number, row: number) => row * REELS + reel;
const cloneGrid = (g: Grid): Grid => g.map((c) => [...c]);

function collectOrbs(rng: Rng, grid: Grid): ScreenResult['orbs'] {
  const orbs: ScreenResult['orbs'] = [];
  for (let reel = 0; reel < REELS; reel++) {
    for (let row = 0; row < ROWS; row++) {
      if (grid[reel][row] === 'O') orbs.push({ cell: cellOf(reel, row), orb: drawOrbPrize(rng, false) });
    }
  }
  return orbs;
}

function playBaseScreen(rng: Rng, meter: MeterState): ScreenResult {
  const { grid, stops } = spinReels(rng, BASE_STRIPS);
  const lineWins = evaluateLines(grid);
  const linePay = lineWins.reduce((s, w) => s + w.pay, 0) / LINE_COUNT;
  const scatters = countReelsWith(grid, 'S');
  const scatterPay = scatters >= SCATTER_TRIGGER ? SCATTER_PAY : 0;
  const orbs = collectOrbs(rng, grid);

  if (!meter.charged) {
    meter.points = Math.min(METER_MAX, meter.points + orbs.length);
    if (meter.points >= METER_MAX) meter.charged = true;
  }

  let holdSpin: HoldSpinResult | undefined;
  if (orbs.length >= HS_TRIGGER) {
    const awakened = meter.charged;
    // Orbs that start an awakened feature carry the awakened multiplier.
    const start = new Map(orbs.map(({ cell, orb }) => [cell, awakened ? upgrade(orb) : orb]));
    holdSpin = playHoldSpin(rng, start, awakened);
    if (awakened) { meter.points = 0; meter.charged = false; }
  }

  return {
    grid, reelGrid: grid, revealed: grid, stops, orbs, lineWins, linePay, scatters, scatterPay, holdSpin,
    freeGamesAwarded: scatters >= SCATTER_TRIGGER ? FREE_GAMES_AWARD : 0,
  };
}

/**
 * One free game: doors open, sticky wilds are laid over the screen, new wilds stick,
 * each Moon Gate adds spins and orbs go into the bank.
 */
function playFreeScreen(rng: Rng, sticky: Set<number>, bank: Orb[]): ScreenResult {
  const { grid: reelGrid, stops } = spinReels(rng, FREE_STRIPS);
  const hasDoors = reelGrid.some((c) => c.includes('D'));
  const door = hasDoors ? weighted(rng, DOOR_REVEALS) : undefined;
  const revealed = reelGrid.map((c) => c.map((s) => (s === 'D' ? door! : s)));
  const grid = cloneGrid(revealed);
  const stickyBefore = [...sticky];
  for (const cell of sticky) grid[cell % REELS][Math.floor(cell / REELS)] = 'W';
  const newSticky: number[] = [];
  for (let reel = 0; reel < REELS; reel++) {
    for (let row = 0; row < ROWS; row++) {
      const cell = cellOf(reel, row);
      if (grid[reel][row] === 'W' && !sticky.has(cell)) { sticky.add(cell); newSticky.push(cell); }
    }
  }

  const lineWins = evaluateLines(grid);
  const linePay = (lineWins.reduce((s, w) => s + w.pay, 0) / LINE_COUNT) * FREE_GAMES_LINE_MULT;
  const scatters = countReelsWith(grid, 'S');
  const scatterPay = scatters >= SCATTER_TRIGGER ? SCATTER_PAY : 0;
  const orbs = collectOrbs(rng, grid);
  bank.push(...orbs.map((o) => o.orb));

  return {
    grid, reelGrid, revealed, stops, orbs, lineWins, linePay, scatters, scatterPay,
    freeGamesAwarded: scatters >= SCATTER_TRIGGER ? FREE_GAMES_AWARD : scatters * FREE_GAMES_SPINS_PER_GATE,
    free: { door, stickyBefore, newSticky, bank: bank.length },
  };
}

/** Lay banked orbs on a Hold & Spin board: rows open to fit them, cells picked at random. */
function bankStart(rng: Rng, orbs: Orb[]): Map<number, Orb> {
  const use = orbs.slice(0, ORB_BANK_MAX);
  const rows = rowsForCount(use.length, HS_MAX_ROWS);
  const n = Math.min(use.length, rows * REELS - 1); // never start on a full board
  const cells = Array.from({ length: rows * REELS }, (_, i) => i);
  for (let i = cells.length - 1; i > 0; i--) {
    const j = randInt(rng, i + 1);
    [cells[i], cells[j]] = [cells[j], cells[i]];
  }
  return new Map(cells.slice(0, n).map((cell, i) => [cell, use[i]]));
}

function upgrade(orb: Orb): Orb {
  return orb.prize.kind === 'coin' ? { ...orb, value: orb.value * AWAKENED_COIN_MULT } : { ...orb };
}

/**
 * Resolve one paid spin, including every feature it triggers.
 * The meter object passed in is not mutated; the new state is returned in meterAfter.
 */
export function playSpin(rng: Rng, bet: number, meterIn: MeterState, mhbIn?: MhbState): SpinOutcome {
  const meter = { ...meterIn };
  const base = playBaseScreen(rng, meter);
  const freeGames: ScreenResult[] = [];
  let bank: SpinOutcome['bank'];
  if (base.freeGamesAwarded) {
    const sticky = new Set<number>();
    const banked: Orb[] = [];
    let remaining = base.freeGamesAwarded;
    let played = 0;
    while (remaining > 0 && played < FREE_GAMES_CAP) {
      remaining--;
      played++;
      const fg = playFreeScreen(rng, sticky, banked);
      freeGames.push(fg);
      remaining = Math.min(remaining + fg.freeGamesAwarded, FREE_GAMES_CAP - played);
    }
    bank = { orbs: banked };
    if (banked.length >= ORB_BANK_TRIGGER) bank.holdSpin = playHoldSpin(rng, bankStart(rng, banked), false);
  }

  // The Hoard can open on a base spin that triggered nothing else.
  const hoard = !base.holdSpin && !base.freeGamesAwarded && rng.next() < HOARD_CHANCE ? playHoard(rng) : undefined;

  const screenPay = (s: ScreenResult) => s.linePay + s.scatterPay + (s.holdSpin?.pay ?? 0);
  let freeTotal = freeGames.reduce((s, fg) => s + screenPay(fg), 0) + (bank?.holdSpin?.pay ?? 0);
  const freeGamesTopUp = freeGames.length && freeTotal < FREE_GAMES_MIN_WIN ? FREE_GAMES_MIN_WIN - freeTotal : 0;
  freeTotal += freeGamesTopUp;
  const pays = {
    lines: base.linePay,
    scatter: base.scatterPay,
    holdSpin: base.holdSpin?.pay ?? 0,
    freeGames: freeTotal,
    mustHitBy: 0,
    hoard: hoard?.pay ?? 0,
  };
  let mhbAfter: MhbState | undefined;
  let mhbAwards: MhbAward[] = [];
  if (mhbIn) {
    const r = stepMhb(mhbIn, rng);
    mhbAfter = r.state;
    mhbAwards = r.awards;
    pays.mustHitBy = mhbAwards.reduce((s, a) => s + a.x, 0);
  }
  const totalX = pays.lines + pays.scatter + pays.holdSpin + pays.freeGames + pays.mustHitBy + pays.hoard;
  return {
    bet, base, freeGames, bank, freeGamesTopUp, hoard, meterBefore: { ...meterIn }, meterAfter: meter, mhbAfter, mhbAwards, pays, totalX,
    win: Math.round(totalX * bet),
  };
}
