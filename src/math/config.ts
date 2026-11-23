/**
 * Mythbound game math configuration.
 * All tunable numbers live here; the simulation (npm run sim) verifies RTP.
 */

export const SYMBOLS = [
  'H1', // Thunderbird
  'H2', // Kraken
  'H3', // Golden Stag
  'H4', // Storm Wyrm
  'M1', // Runestone
  'M2', // Horn of the Deep
  'M3', // Feathered Crown
  'L1', 'L2', 'L3', 'L4', // Elemental glyphs: fire, water, storm, earth
  'W',  // Sigil Wild (reels 2-5)
  'S',  // Moon Gate scatter (reels 1, 3, 5)
  'O',  // Beast Orb
  'D',  // Mystery temple doors (free games only): all doors open to the same symbol
] as const;
export type Sym = (typeof SYMBOLS)[number];

export const REELS = 5;
export const ROWS = 3;
export const LINE_COUNT = 50;
/** Denominations in cents: 1¢, 2¢, 5¢, 10¢, $1, $2. */
export const DENOMS = [1, 2, 5, 10, 100, 200] as const;
/** Credits per spin at 1x; the bet multiplier runs 1x to 5x. */
export const BASE_CREDITS = 50;
export const BET_MULTS = [1, 2, 3, 4, 5] as const;
/** Every possible bet, in cents. */
export const BET_LEVELS = [...new Set(DENOMS.flatMap((d) => BET_MULTS.map((m) => d * BASE_CREDITS * m)))].sort((a, b) => a - b);

// ---- Hot and cold streaks (hidden, one per denomination) ----
/** Per spin played on a denom: chance a normal denom turns hot or cold, and a streak ends. */
export const STREAK_START = 1 / 250;
export const STREAK_END = 1 / 150;
/** Hot: a quiet spin is replayed this often. Cold: a feature spin is replayed this often. */
export const HOT_REROLL = 0.42;
export const COLD_REROLL = 0.4;

/** Line pays as multiples of line bet (total bet / 50), indexed by match count 3, 4, 5. */
export const PAYTABLE: Partial<Record<Sym, [number, number, number]>> = {
  H1: [31, 124, 620],
  H2: [24, 93, 372],
  H3: [19, 62, 248],
  H4: [16, 50, 186],
  M1: [11, 31, 124],
  M2: [9, 24, 100],
  M3: [8, 19, 74],
  L1: [6, 13, 55],
  L2: [6, 13, 55],
  L3: [5, 11, 43],
  L4: [5, 11, 43],
};

/** Reel strip recipe: [symbol, number of blocks, block (stack) height]. */
export type StripRecipe = ReadonlyArray<readonly [Sym, number, number]>;

const LOWS_MIDS: StripRecipe = [
  ['M1', 3, 2], ['M2', 4, 2], ['M3', 4, 2],
  ['L1', 5, 2], ['L2', 5, 2], ['L3', 6, 2], ['L4', 6, 2],
];

const HIGHS_BASE: StripRecipe = [
  ['H1', 2, 2], ['H2', 2, 2], ['H3', 3, 2], ['H4', 3, 2],
];

export const BASE_REELS: StripRecipe[] = [
  [...HIGHS_BASE, ...LOWS_MIDS, ['S', 10, 1]],
  [...HIGHS_BASE, ...LOWS_MIDS, ['W', 16, 1]],
  [...HIGHS_BASE, ...LOWS_MIDS, ['W', 16, 1], ['S', 10, 1]],
  [...HIGHS_BASE, ...LOWS_MIDS, ['W', 16, 1]],
  [...HIGHS_BASE, ...LOWS_MIDS, ['W', 16, 1], ['S', 10, 1]],
];

/** Free games: stacked highs and stacked wilds, more orbs. */
/** Free games: stacked beasts, stacks of mystery doors, single wilds that stick. */
const HIGHS_FREE: StripRecipe = [
  ['H1', 3, 2], ['H2', 3, 2], ['H3', 4, 2], ['H4', 4, 2],
];
const DOORS: StripRecipe = [['D', 2, 3]];
/** Free games use fewer low symbols, so line wins land far more often. */
const LOWS_MIDS_FREE: StripRecipe = [
  ['M1', 5, 2], ['M2', 5, 2],
  ['L1', 6, 2], ['L2', 6, 2], ['L3', 6, 2],
];
export const FREE_REELS: StripRecipe[] = [
  [...HIGHS_FREE, ...LOWS_MIDS_FREE, ...DOORS, ['S', 4, 1]],
  [...HIGHS_FREE, ...LOWS_MIDS_FREE, ...DOORS, ['W', 1, 1]],
  [...HIGHS_FREE, ...LOWS_MIDS_FREE, ...DOORS, ['W', 1, 1], ['S', 4, 1]],
  [...HIGHS_FREE, ...LOWS_MIDS_FREE, ...DOORS, ['W', 1, 1]],
  [...HIGHS_FREE, ...LOWS_MIDS_FREE, ...DOORS, ['W', 1, 1], ['S', 4, 1]],
];

/** What the mystery doors open to (all doors on screen reveal the same symbol). */
export const DOOR_REVEALS: ReadonlyArray<readonly [Sym, number]> = [
  ['H1', 10], ['H2', 12], ['H3', 14], ['H4', 16],
  ['M1', 6], ['M2', 6], ['M3', 6],
  ['W', 3], ['O', 15],
];

/** Orbs per reel strip: singles, plus pairs (orb, symbol, orb) that let one reel show two orbs. */
export interface OrbLayout { singles: number; pairs: number }
export const BASE_ORBS: OrbLayout = { singles: 12, pairs: 6 };
export const FREE_ORBS: OrbLayout = { singles: 2, pairs: 0 };

export const STRIP_SEED = 0x4d797468; // "Myth" — strips are fixed for every build

// ---- Scatter / free games ----
export const SCATTER_TRIGGER = 3;
export const SCATTER_PAY = 1; // x total bet
export const FREE_GAMES_AWARD = 10;
export const FREE_GAMES_CAP = 80;
/** In free games each Moon Gate adds this many spins; three on one spin add FREE_GAMES_AWARD instead. */
export const FREE_GAMES_SPINS_PER_GATE = 1;
/** A free games round always pays at least this much (x total bet), topped up at the end. */
export const FREE_GAMES_MIN_WIN = 5;
/** Orbs landed during free games are banked; this many or more start a Hold & Spin when the round ends. */
export const ORB_BANK_TRIGGER = 6;
/** Most banked orbs that can start the end-of-round Hold & Spin. */
export const ORB_BANK_MAX = 30;
/** Line wins during free games are multiplied. */
export const FREE_GAMES_LINE_MULT = 1;

// ---- Hold & spin ----
export const HS_TRIGGER = 6;
export const HS_RESPINS = 3;
export const HS_MAX_ROWS = 8;
export const HS_MAX_ROWS_AWAKENED = 12;
/** Total orbs needed to unlock rows 4, 5, 6, ... */
export const HS_ROW_THRESHOLDS = [8, 11, 14, 17, 20, 24, 28, 32, 36];
/** Expected orbs landing per respin: base * decay^(orbs added so far), spread across the empty cells. */
export const HS_LAND_BASE = 1.24;
export const HS_LAND_DECAY = 0.82;

export type Jackpot = 'MINI' | 'MINOR' | 'MAJOR' | 'GRAND';
export const JACKPOT_PAY: Record<Jackpot, number> = {
  MINI: 10,
  MINOR: 25,
  MAJOR: 250,
  GRAND: 2500,
};
export const GRAND_AWAKENED = 5000;

/** Orb prize table: coin values are x total bet. */
export type OrbPrize = { kind: 'coin'; value: number } | { kind: 'jackpot'; jackpot: Exclude<Jackpot, 'GRAND'> };
export const ORB_PRIZES: ReadonlyArray<readonly [OrbPrize, number]> = [
  [{ kind: 'coin', value: 0.25 }, 405],
  [{ kind: 'coin', value: 0.5 }, 330],
  [{ kind: 'coin', value: 1 }, 230],
  [{ kind: 'coin', value: 2 }, 90],
  [{ kind: 'coin', value: 3 }, 35],
  [{ kind: 'coin', value: 5 }, 12],
  [{ kind: 'coin', value: 8 }, 4],
  [{ kind: 'coin', value: 10 }, 2.5],
  [{ kind: 'coin', value: 15 }, 1],
  [{ kind: 'jackpot', jackpot: 'MINI' }, 7],
  [{ kind: 'jackpot', jackpot: 'MINOR' }, 2],
  [{ kind: 'jackpot', jackpot: 'MAJOR' }, 0.1],
];
export const AWAKENED_COIN_MULT = 1.5;

/** Special orbs that can land during respins (chance per landed orb). */
export type Special = 'DOUBLER' | 'COLLECTOR' | 'ROW_BREAKER' | 'EXTRA_RESPIN';
export const SPECIAL_CHANCE = 0.18;
export const SPECIALS: ReadonlyArray<readonly [Special, number]> = [
  ['DOUBLER', 30],
  ['COLLECTOR', 12],
  ['ROW_BREAKER', 33],
  ['EXTRA_RESPIN', 25],
];

// ---- Beast awakening meter ----
export const METER_MAX = 2500; // one point per orb landing in the base game

// ---- Wallet ----
export const START_BALANCE = 100_000; // cents ($1,000)
export const REFILL_AMOUNT = 50_000; // cents ($500)
export const REFILL_DELAY_MS = 2 * 60 * 60 * 1000;

// ---- Must Hit By progressive jackpots ----
/**
 * Each meter grows by `rate` (x total bet) on every paid spin and pays out at a hidden point,
 * picked at random between `seed` and `cap` when the meter resets — so it always hits before `cap`.
 * Values are in bet multiples, so the odds are the same at every bet and the prize scales with it.
 */
export interface MhbTier { id: 'STORM' | 'THUNDER'; name: string; seed: number; cap: number; rate: number }
export const MHB_TIERS: readonly MhbTier[] = [
  { id: 'STORM', name: 'Storm Jackpot', seed: 10, cap: 25, rate: 0.01 },
  { id: 'THUNDER', name: 'Thunder Jackpot', seed: 50, cap: 150, rate: 0.005 },
];

// ---- Thunderbird's Hoard (pick bonus) ----
/** Chance per base spin (with no other feature) that the Hoard opens. */
export const HOARD_CHANCE = 1 / 500;
/** Which jackpot the Hoard awards. The 12 hidden orbs hold 3 of each; picks stop when one is matched 3 times. */
export const HOARD_WEIGHTS: ReadonlyArray<readonly [Jackpot, number]> = [
  ['MINI', 72],
  ['MINOR', 26],
  ['MAJOR', 1.9],
  ['GRAND', 0.1],
];
