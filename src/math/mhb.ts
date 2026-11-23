import { MHB_TIERS, type MhbTier } from './config';
import type { Rng } from './rng';

export type MhbId = MhbTier['id'];
export interface MhbMeter {
  /** Current value, x total bet. */
  value: number;
  /** Hidden point where it pays, between seed and cap. */
  hitAt: number;
}
export type MhbState = Record<MhbId, MhbMeter>;

const fresh = (t: MhbTier, rng: Rng): MhbMeter => ({ value: t.seed, hitAt: t.seed + rng.next() * (t.cap - t.seed) });

export function newMhb(rng: Rng): MhbState {
  return Object.fromEntries(MHB_TIERS.map((t) => [t.id, fresh(t, rng)])) as MhbState;
}

/** Make sure a saved state is valid (new tiers added, bad values), without changing healthy meters. */
export function repairMhb(state: Partial<MhbState> | undefined, rng: Rng): MhbState {
  const out = {} as MhbState;
  for (const t of MHB_TIERS) {
    const m = state?.[t.id];
    const ok = m && m.value >= t.seed && m.hitAt >= m.value && m.hitAt <= t.cap;
    out[t.id] = ok ? { ...m } : fresh(t, rng);
  }
  return out;
}

export interface MhbAward { id: MhbId; name: string; /** x total bet */ x: number }

/**
 * Grow every meter for one paid spin; any meter reaching its hit point pays and reseeds.
 * `step` is the bet multiplier: a 5x bet grows the meters five times as fast.
 */
export function stepMhb(state: MhbState, rng: Rng, step = 1): { state: MhbState; awards: MhbAward[] } {
  const next = {} as MhbState;
  const awards: MhbAward[] = [];
  for (const t of MHB_TIERS) {
    const m = state[t.id];
    const value = m.value + t.rate * step;
    if (value >= m.hitAt) {
      awards.push({ id: t.id, name: t.name, x: m.hitAt });
      next[t.id] = fresh(t, rng);
    } else {
      next[t.id] = { value, hitAt: m.hitAt };
    }
  }
  return { state: next, awards };
}
