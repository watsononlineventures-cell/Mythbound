import { HOARD_WEIGHTS, JACKPOT_PAY, type Jackpot } from './config';
import { randInt, weighted, type Rng } from './rng';

export const HOARD_TIERS: readonly Jackpot[] = ['MINI', 'MINOR', 'MAJOR', 'GRAND'];

export interface HoardResult {
  tier: Jackpot;
  /** Jackpots revealed in pick order; the last pick is the third `tier`. */
  picks: Jackpot[];
  /** What the unpicked orbs held, revealed after the win. */
  rest: Jackpot[];
  /** x total bet */
  pay: number;
}

function shuffle<T>(rng: Rng, a: T[]): T[] {
  for (let i = a.length - 1; i > 0; i--) {
    const j = randInt(rng, i + 1);
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/**
 * Twelve hidden orbs, three of each jackpot. The award is decided first, then a pick order is
 * built so that it is the first jackpot to reach three; every other jackpot shows at most two.
 */
export function playHoard(rng: Rng): HoardResult {
  const tier = weighted(rng, HOARD_WEIGHTS);
  const others = HOARD_TIERS.filter((t) => t !== tier);
  // Each other jackpot teases 0, 1 or 2 times (usually 1 or 2, for suspense).
  const teases = others.flatMap((t) => Array(weighted(rng, [[0, 1], [1, 3], [2, 4]] as const)).fill(t) as Jackpot[]);
  const picks = [...shuffle(rng, [tier, tier, ...teases]), tier];
  const left = new Map(HOARD_TIERS.map((t) => [t, 3]));
  for (const p of picks) left.set(p, left.get(p)! - 1);
  const rest = shuffle(rng, HOARD_TIERS.flatMap((t) => Array(left.get(t)!).fill(t) as Jackpot[]));
  return { tier, picks, rest, pay: JACKPOT_PAY[tier] };
}
