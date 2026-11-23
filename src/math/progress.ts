import type { SpinOutcome } from './game';
import { seededRng } from './rng';

/** Beast Bestiary, daily goals and the login streak. Rewards are in cents. Pure functions; the app layer persists them. */

export type EntryId =
  | 'H1' | 'H2' | 'H3' | 'H4' | 'GATE' | 'ORB' | 'DOORS' | 'HOARD' | 'AWAKE'
  | 'MINI' | 'MINOR' | 'MAJOR' | 'GRAND' | 'STORM' | 'THUNDER';

export interface Entry { id: EntryId; name: string; art: string; how: string; reward: number }

export const BESTIARY: readonly Entry[] = [
  { id: 'H1', name: 'Thunderbird', art: 'sym_thunderbird', how: 'Line up 5 Thunderbirds', reward: 20_000 },
  { id: 'H2', name: 'Kraken', art: 'sym_kraken', how: 'Line up 5 Krakens', reward: 15_000 },
  { id: 'H3', name: 'Golden Stag', art: 'sym_stag', how: 'Line up 5 Golden Stags', reward: 10_000 },
  { id: 'H4', name: 'Storm Wyrm', art: 'sym_wyrm', how: 'Line up 5 Storm Wyrms', reward: 10_000 },
  { id: 'GATE', name: 'Moon Gate', art: 'sym_moongate', how: 'Open the free games', reward: 5_000 },
  { id: 'ORB', name: 'Thunder Orb', art: 'orb', how: 'Start a Hold & Spin', reward: 5_000 },
  { id: 'DOORS', name: 'Mystery Doors', art: 'sym_door', how: 'Open the doors in free games', reward: 5_000 },
  { id: 'HOARD', name: "Thunderbird's Hoard", art: 'coin', how: 'Find the Hoard', reward: 10_000 },
  { id: 'AWAKE', name: 'The Awakened', art: 'hero_awakened', how: 'Play an awakened Hold & Spin', reward: 20_000 },
  { id: 'MINI', name: 'Mini Jackpot', art: 'orb_mini', how: 'Win the Mini', reward: 5_000 },
  { id: 'MINOR', name: 'Minor Jackpot', art: 'orb_minor', how: 'Win the Minor', reward: 10_000 },
  { id: 'MAJOR', name: 'Major Jackpot', art: 'orb_major', how: 'Win the Major', reward: 50_000 },
  { id: 'GRAND', name: 'Grand Jackpot', art: 'orb_grand', how: 'Win the Grand', reward: 200_000 },
  { id: 'STORM', name: 'Storm Jackpot', art: 'sym_storm', how: 'Win the Storm Must Hit By', reward: 10_000 },
  { id: 'THUNDER', name: 'Thunder Jackpot', art: 'sym_crown', how: 'Win the Thunder Must Hit By', reward: 30_000 },
];
export const BESTIARY_COMPLETE_PRIZE = 500_000;

export type GoalKind = 'spins' | 'wins' | 'orbs' | 'gates' | 'hs' | 'fg' | 'jackpot' | 'bigwin' | 'feature';
interface GoalDef { kind: GoalKind; target: number; text: string; reward: number }
export const GOAL_POOL: readonly GoalDef[] = [
  { kind: 'spins', target: 100, text: 'Spin 100 times', reward: 6_000 },
  { kind: 'spins', target: 250, text: 'Spin 250 times', reward: 12_000 },
  { kind: 'wins', target: 30, text: 'Land 30 wins', reward: 6_000 },
  { kind: 'orbs', target: 60, text: 'Land 60 orbs', reward: 8_000 },
  { kind: 'gates', target: 25, text: 'Land 25 Moon Gates', reward: 8_000 },
  { kind: 'hs', target: 2, text: 'Start 2 Hold & Spins', reward: 10_000 },
  { kind: 'fg', target: 1, text: 'Open the free games', reward: 10_000 },
  { kind: 'jackpot', target: 1, text: 'Win any jackpot', reward: 12_000 },
  { kind: 'bigwin', target: 3, text: 'Win 15× your bet 3 times', reward: 10_000 },
  { kind: 'feature', target: 4, text: 'Play 4 bonus features', reward: 12_000 },
];
export const ALL_GOALS_BONUS = 20_000;
export const STREAK_REWARDS = [2_000, 4_000, 6_000, 10_000, 15_000, 20_000, 50_000] as const;

export interface Goal { kind: GoalKind; target: number; text: string; reward: number; have: number; done: boolean }
export interface Progress {
  caught: Partial<Record<EntryId, string>>; // date first caught
  complete: boolean;
  day: string;
  goals: Goal[];
  allDone: boolean;
  streak: number;
  lastLogin: string | null;
}

export const newProgress = (): Progress => ({ caught: {}, complete: false, day: '', goals: [], allDone: false, streak: 0, lastLogin: null });

/** Same three goals for everyone on a given date. */
export function goalsFor(day: string): Goal[] {
  let seed = 0;
  for (const ch of day) seed = (seed * 31 + ch.charCodeAt(0)) >>> 0;
  const rng = seededRng(seed);
  const pool = [...GOAL_POOL];
  const out: Goal[] = [];
  const kinds = new Set<GoalKind>();
  while (out.length < 3) {
    const g = pool.splice(Math.floor(rng.next() * pool.length), 1)[0];
    if (kinds.has(g.kind)) continue;
    kinds.add(g.kind);
    out.push({ ...g, have: 0, done: false });
  }
  return out;
}

const dayNum = (d: string) => Math.round(Date.parse(`${d}T00:00:00Z`) / 864e5);

/** Start a new day's goals if the date changed. */
export function rollDay(p: Progress, today: string): Progress {
  return p.day === today ? p : { ...p, day: today, goals: goalsFor(today), allDone: false };
}

/** Daily visit: returns the streak reward the first time each day (0 otherwise). */
export function login(p: Progress, today: string): { p: Progress; reward: number } {
  if (p.lastLogin === today) return { p, reward: 0 };
  const next = p.lastLogin && dayNum(today) - dayNum(p.lastLogin) === 1 ? (p.streak % 7) + 1 : 1;
  return { p: { ...p, streak: next, lastLogin: today }, reward: STREAK_REWARDS[next - 1] };
}

/** What a spin did, in Bestiary and goal terms. */
export function spinFacts(o: SpinOutcome) {
  const caught = new Set<EntryId>();
  const screens = [o.base, ...o.freeGames];
  for (const s of screens) for (const w of s.lineWins) {
    if (w.count === 5 && (w.symbol === 'H1' || w.symbol === 'H2' || w.symbol === 'H3' || w.symbol === 'H4')) caught.add(w.symbol);
  }
  const holdSpins = [o.base.holdSpin, o.bank?.holdSpin, ...o.freeGames.map((f) => f.holdSpin)].filter((h) => !!h);
  if (o.freeGames.length) caught.add('GATE');
  if (holdSpins.length) caught.add('ORB');
  if (o.freeGames.some((f) => f.free?.door)) caught.add('DOORS');
  if (o.hoard) { caught.add('HOARD'); caught.add(o.hoard.tier); }
  let jackpots = o.hoard ? 1 : 0;
  for (const h of holdSpins) {
    if (h.awakened) caught.add('AWAKE');
    if (h.grand) { caught.add('GRAND'); jackpots++; }
    for (const j of h.jackpots) { caught.add(j.jackpot); jackpots++; }
  }
  for (const a of o.mhbAwards) { caught.add(a.id); jackpots++; }
  const counts: Record<GoalKind, number> = {
    spins: 1,
    wins: o.win > 0 ? 1 : 0,
    orbs: o.base.orbs.length,
    gates: o.base.scatters,
    hs: holdSpins.length,
    fg: o.freeGames.length ? 1 : 0,
    jackpot: jackpots,
    bigwin: o.win >= o.bet * 15 ? 1 : 0,
    feature: holdSpins.length + (o.freeGames.length ? 1 : 0) + (o.hoard ? 1 : 0) + o.mhbAwards.length,
  };
  return { caught, counts };
}

export interface Reward { kind: 'beast' | 'bestiary' | 'goal' | 'allGoals'; title: string; coins: number; art?: string }

/** Apply a spin: new Bestiary captures, goal progress, and every reward earned. */
export function record(p: Progress, o: SpinOutcome, today: string): { p: Progress; rewards: Reward[] } {
  p = rollDay(p, today);
  const { caught, counts } = spinFacts(o);
  const rewards: Reward[] = [];
  const got = { ...p.caught };
  for (const e of BESTIARY) {
    if (caught.has(e.id) && !got[e.id]) {
      got[e.id] = today;
      rewards.push({ kind: 'beast', title: e.name, coins: e.reward, art: e.art });
    }
  }
  let complete = p.complete;
  if (!complete && BESTIARY.every((e) => got[e.id])) {
    complete = true;
    rewards.push({ kind: 'bestiary', title: 'Bestiary complete', coins: BESTIARY_COMPLETE_PRIZE });
  }
  const goals = p.goals.map((g) => {
    if (g.done) return g;
    const have = Math.min(g.target, g.have + counts[g.kind]);
    const done = have >= g.target;
    if (done) rewards.push({ kind: 'goal', title: g.text, coins: g.reward });
    return { ...g, have, done };
  });
  let allDone = p.allDone;
  if (!allDone && goals.length && goals.every((g) => g.done)) {
    allDone = true;
    rewards.push({ kind: 'allGoals', title: 'All daily goals', coins: ALL_GOALS_BONUS });
  }
  return { p: { ...p, caught: got, complete, goals, allDone }, rewards };
}
