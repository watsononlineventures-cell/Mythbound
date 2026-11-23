import { BASE_CREDITS, COLD_REROLL, HOT_REROLL, STREAK_END, STREAK_START } from './config';
import { playSpin, type MeterState, type SpinOutcome } from './game';
import { stepMhb, type MhbState } from './mhb';
import type { Rng } from './rng';

/**
 * Denominations. Each denom has its own Must Hit By jackpots and its own hidden streak:
 * normal, hot (more features) or cold (fewer). Streaks only move when that denom is played,
 * and hot and cold balance out, so the long-run return is the same as a normal denom.
 */
export type Streak = 'normal' | 'hot' | 'cold';

export const baseBet = (denom: number) => denom * BASE_CREDITS;
export const betFor = (denom: number, mult: number) => baseBet(denom) * mult;

const hasFeature = (o: SpinOutcome) => !!o.base.holdSpin || o.freeGames.length > 0 || !!o.hoard;

/** Advance a denom's hidden streak by one spin. */
export function stepStreak(s: Streak, rng: Rng): Streak {
  const r = rng.next();
  if (s === 'normal') return r < STREAK_START ? 'hot' : r < 2 * STREAK_START ? 'cold' : 'normal';
  return r < STREAK_END ? 'normal' : s;
}

export interface DenomSpin { outcome: SpinOutcome; streak: Streak }

/**
 * One spin on a denom at a bet multiplier. Wins are in cents (bet = denom x 50 x mult).
 * Must Hit By values are kept in units of the denom's 1x bet, so a jackpot is worth the same
 * at every multiplier; higher multipliers grow it faster.
 */
export function playDenomSpin(rng: Rng, denom: number, mult: number, meter: MeterState, mhb: MhbState, streak: Streak): DenomSpin {
  const bet = betFor(denom, mult);
  let o = playSpin(rng, bet, meter);
  if (streak === 'hot' && !hasFeature(o) && rng.next() < HOT_REROLL) o = playSpin(rng, bet, meter);
  else if (streak === 'cold' && hasFeature(o) && rng.next() < COLD_REROLL) o = playSpin(rng, bet, meter);

  const m = stepMhb(mhb, rng, mult);
  const mustHitBy = m.awards.reduce((s, a) => s + a.x, 0) / mult; // in x total bet
  const totalX = o.totalX + mustHitBy;
  const outcome: SpinOutcome = {
    ...o,
    mhbAfter: m.state,
    // Award x stays in 1x-bet units: the app pays x * baseBet.
    mhbAwards: m.awards,
    pays: { ...o.pays, mustHitBy },
    totalX,
    win: Math.round(totalX * bet),
  };
  return { outcome, streak: stepStreak(streak, rng) };
}
