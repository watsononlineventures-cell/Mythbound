import { describe, expect, it } from 'vitest';
import { HS_MAX_ROWS, HS_RESPINS, JACKPOT_PAY, METER_MAX, PAYTABLE, REFILL_AMOUNT, REFILL_DELAY_MS, START_BALANCE, type Sym } from '../src/math/config';
import { countReelsWith, evaluateLines, LINES } from '../src/math/lines';
import { drawOrbPrize, playHoldSpin, type Orb } from '../src/math/holdSpin';
import { BASE_STRIPS, emptyMeter, FREE_STRIPS, playSpin } from '../src/math/game';
import { seededRng } from '../src/math/rng';
import { newMhb, repairMhb, stepMhb } from '../src/math/mhb';
import { HOARD_TIERS, playHoard } from '../src/math/hoard';
import { FREE_GAMES_AWARD, FREE_GAMES_MIN_WIN, MHB_TIERS, ORB_BANK_MAX, ORB_BANK_TRIGGER } from '../src/math/config';
import { earlyRefill, newWallet, settleSpin, tickRefill } from '../src/math/wallet';

/** Build a column-major grid from three row strings like "H1 L1 L2 L3 L4". */
const grid = (...rows: string[]): Sym[][] => {
  const r = rows.map((x) => x.split(' ') as Sym[]);
  return [0, 1, 2, 3, 4].map((c) => [r[0][c], r[1][c], r[2][c]]);
};

describe('paylines', () => {
  it('has 50 unique lines, straight rows first', () => {
    expect(LINES).toHaveLength(50);
    expect(new Set(LINES.map((l) => l.join())).size).toBe(50);
    expect(LINES.slice(0, 3)).toEqual([[1, 1, 1, 1, 1], [0, 0, 0, 0, 0], [2, 2, 2, 2, 2]]);
    for (const l of LINES) for (let i = 1; i < 5; i++) expect(Math.abs(l[i] - l[i - 1])).toBeLessThanOrEqual(1);
  });

  it('pays five of a kind on the middle row', () => {
    const g = grid('L1 L2 L3 L4 M1', 'H1 H1 H1 H1 H1', 'L2 L3 L4 M1 M2');
    const win = evaluateLines(g).find((w) => w.line === 0)!;
    expect(win).toMatchObject({ symbol: 'H1', count: 5, pay: PAYTABLE.H1![2] });
  });

  it('lets wilds substitute but not start a line', () => {
    const g = grid('L1 L2 L3 L4 M1', 'H2 W W L4 M1', 'L2 L3 L4 M1 M2');
    expect(evaluateLines(g).find((w) => w.line === 0)).toMatchObject({ symbol: 'H2', count: 3 });
  });

  it('never pays orbs or scatters on lines', () => {
    const g = grid('O O O O O', 'S W S W S', 'O O O O O');
    expect(evaluateLines(g)).toHaveLength(0);
  });

  it('counts scatters once per reel', () => {
    const g = grid('S L1 L2 L3 L4', 'S L1 S L3 L4', 'L1 L1 L2 L3 L4');
    expect(countReelsWith(g, 'S')).toBe(2);
  });
});

describe('reel strips', () => {
  it('never shows two Moon Gates on one reel at the same time', () => {
    for (const strips of [BASE_STRIPS, FREE_STRIPS]) {
      for (const strip of strips) {
        for (let stop = 0; stop < strip.length; stop++) {
          const window = [0, 1, 2].map((k) => strip[(stop + k) % strip.length]);
          expect(window.filter((x) => x === 'S').length).toBeLessThanOrEqual(1);
        }
      }
    }
  });

  it('only puts Moon Gates on reels 1, 3 and 5', () => {
    for (const strips of [BASE_STRIPS, FREE_STRIPS]) {
      expect(strips.map((s) => s.includes('S'))).toEqual([true, false, true, false, true]);
    }
  });
});

describe('hold & spin', () => {
  const start = (rng = seededRng(7), n = 6): Map<number, Orb> =>
    new Map(Array.from({ length: n }, (_, i) => [i, drawOrbPrize(rng, false)]));

  it('follows the respin rules on every step', () => {
    for (let seed = 1; seed <= 300; seed++) {
      const rng = seededRng(seed);
      const hs = playHoldSpin(rng, start(rng), false);
      let rows = 3;
      for (const step of hs.steps) {
        expect(step.unlockedRows).toBeGreaterThanOrEqual(rows);
        expect(step.unlockedRows).toBeLessThanOrEqual(HS_MAX_ROWS);
        rows = step.unlockedRows;
        if (step.landed.length) expect(step.respinsLeft).toBeGreaterThanOrEqual(HS_RESPINS);
      }
      if (!hs.grand) expect(hs.steps.at(-1)!.respinsLeft).toBe(0);
    }
  });

  it('pays the sum of orb values plus jackpots', () => {
    const rng = seededRng(42);
    const hs = playHoldSpin(rng, start(rng), false);
    let expected = 0;
    for (const o of hs.final) {
      if (!o) continue;
      expected += o.value;
      if (o.prize.kind === 'jackpot') expected += JACKPOT_PAY[o.prize.jackpot];
    }
    if (hs.grand) expected += JACKPOT_PAY.GRAND;
    expect(hs.pay).toBeCloseTo(expected, 9);
  });

  it('awards the Grand only when the board is full', () => {
    const rng = seededRng(3);
    const full = new Map(Array.from({ length: HS_MAX_ROWS * 5 - 1 }, (_, i) => [i, drawOrbPrize(rng, false)]));
    const hs = playHoldSpin(rng, full, false);
    expect(hs.grand).toBe(hs.final.every(Boolean));
  });

  it('awakened features can grow to 12 rows', () => {
    const rng = seededRng(5);
    expect(playHoldSpin(rng, start(rng), true).maxRows).toBe(12);
  });
});

describe('game', () => {
  it('is deterministic for a seed', () => {
    const a = playSpin(seededRng(99), 100, emptyMeter());
    const b = playSpin(seededRng(99), 100, emptyMeter());
    expect(a.win).toBe(b.win);
    expect(a.base.stops).toEqual(b.base.stops);
  });

  it('charges the meter and spends it on the next hold & spin', () => {
    const rng = seededRng(11);
    let meter = { points: METER_MAX - 1, charged: false };
    let sawAwakened = false;
    for (let i = 0; i < 5000 && !sawAwakened; i++) {
      const o = playSpin(rng, 100, meter);
      if (o.base.holdSpin?.awakened) {
        expect(o.meterBefore.charged || o.meterBefore.points + o.base.orbs.length >= METER_MAX).toBe(true);
        expect(o.meterAfter).toEqual({ points: 0, charged: false });
        sawAwakened = true;
      }
      meter = o.meterAfter;
    }
    expect(sawAwakened).toBe(true);
  });

  it('pays in whole coins', () => {
    const rng = seededRng(8);
    for (let i = 0; i < 2000; i++) expect(Number.isInteger(playSpin(rng, 250, emptyMeter()).win)).toBe(true);
  });
});

describe('wallet', () => {
  it('starts the refill timer when broke and refills after the delay', () => {
    let w = { ...newWallet(), balance: 50 };
    w = settleSpin(w, 50, 0, 1000);
    expect(w.balance).toBe(0);
    expect(w.refillAt).toBe(1000 + REFILL_DELAY_MS);
    expect(tickRefill(w, 1000).balance).toBe(0);
    expect(tickRefill(w, 1000 + REFILL_DELAY_MS).balance).toBe(REFILL_AMOUNT);
  });

  it('allows one early refill per day', () => {
    let w = settleSpin({ ...newWallet(), balance: 50 }, 50, 0, 0);
    w = earlyRefill(w, '2026-11-16');
    expect(w.balance).toBe(REFILL_AMOUNT);
    w = settleSpin({ ...w, balance: 50 }, 50, 0, 0);
    expect(earlyRefill(w, '2026-11-16').balance).toBe(0);
    expect(earlyRefill(w, '2026-11-17').balance).toBe(REFILL_AMOUNT);
  });

  it('rejects invalid bets', () => {
    expect(() => settleSpin(newWallet(), 75, 0, 0)).toThrow();
    expect(newWallet().balance).toBe(START_BALANCE);
  });
});

describe('must hit by', () => {
  it('always pays before the cap and never above it', () => {
    const rng = seededRng(21);
    let state = newMhb(rng);
    const hits: Record<string, number> = { STORM: 0, THUNDER: 0 };
    for (let i = 0; i < 200_000; i++) {
      const r = stepMhb(state, rng);
      for (const a of r.awards) {
        const t = MHB_TIERS.find((x) => x.id === a.id)!;
        expect(a.x).toBeGreaterThanOrEqual(t.seed);
        expect(a.x).toBeLessThanOrEqual(t.cap);
        hits[a.id]++;
      }
      for (const t of MHB_TIERS) expect(r.state[t.id].value).toBeLessThan(t.cap);
      state = r.state;
    }
    expect(hits.STORM).toBeGreaterThan(100);
    expect(hits.THUNDER).toBeGreaterThan(5);
  });

  it('repairs a missing or broken saved state', () => {
    const rng = seededRng(4);
    const fixed = repairMhb({ STORM: { value: 999, hitAt: 1 } } as never, rng);
    for (const t of MHB_TIERS) {
      expect(fixed[t.id].value).toBe(t.seed);
      expect(fixed[t.id].hitAt).toBeLessThanOrEqual(t.cap);
    }
  });

  it('adds awards to the spin win', () => {
    const rng = seededRng(9);
    const state = newMhb(rng);
    state.STORM = { value: 24.995, hitAt: 25 };
    const o = playSpin(rng, 100, emptyMeter(), state);
    expect(o.mhbAwards.map((a) => a.id)).toContain('STORM');
    expect(o.pays.mustHitBy).toBeCloseTo(25, 9);
    expect(o.win).toBe(Math.round(o.totalX * 100));
  });
});

describe('free games', () => {
  const rng = seededRng(77);
  const rounds: ReturnType<typeof playSpin>[] = [];
  while (rounds.length < 400) {
    const o = playSpin(rng, 100, emptyMeter());
    if (o.freeGames.length) rounds.push(o);
  }

  it('keeps every wild sticky for the rest of the round', () => {
    for (const o of rounds) {
      const stuck = new Set<number>();
      for (const fg of o.freeGames) {
        expect(new Set(fg.free!.stickyBefore)).toEqual(stuck);
        for (const cell of stuck) expect(fg.grid[cell % 5][Math.floor(cell / 5)]).toBe('W');
        for (const c of fg.free!.newSticky) stuck.add(c);
      }
    }
  });

  it('opens every door to the same symbol', () => {
    let doors = 0;
    for (const o of rounds) for (const fg of o.freeGames) {
      fg.reelGrid.forEach((col, r) => col.forEach((s, row) => {
        if (s !== 'D') return;
        doors++;
        expect(fg.revealed[r][row]).toBe(fg.free!.door);
      }));
      expect(fg.revealed.flat()).not.toContain('D');
    }
    expect(doors).toBeGreaterThan(0);
  });

  it('adds a spin per Moon Gate, or a full award for three', () => {
    for (const o of rounds) for (const fg of o.freeGames) {
      expect(fg.freeGamesAwarded).toBe(fg.scatters >= 3 ? FREE_GAMES_AWARD : fg.scatters);
    }
  });

  it('pays at least the guaranteed minimum', () => {
    for (const o of rounds) expect(o.pays.freeGames).toBeGreaterThanOrEqual(FREE_GAMES_MIN_WIN - 1e-9);
  });

  it('starts a Hold & Spin from 6 or more banked orbs', () => {
    let started = 0;
    for (const o of rounds) {
      const bank = o.bank!;
      const total = o.freeGames.reduce((s, fg) => s + fg.orbs.length, 0);
      expect(bank.orbs.length).toBe(total);
      expect(!!bank.holdSpin).toBe(total >= ORB_BANK_TRIGGER);
      if (bank.holdSpin) {
        started++;
        expect(bank.holdSpin.initial.filter(Boolean).length).toBe(Math.min(total, ORB_BANK_MAX, 39));
      }
    }
    expect(started).toBeGreaterThan(0);
  });
});

describe('thunderbird hoard', () => {
  it('reaches three of the awarded jackpot first, with three of each in all', () => {
    const rng = seededRng(31);
    const tiers = new Set<string>();
    for (let i = 0; i < 5000; i++) {
      const h = playHoard(rng);
      tiers.add(h.tier);
      const all = [...h.picks, ...h.rest];
      expect(all).toHaveLength(12);
      for (const t of HOARD_TIERS) expect(all.filter((x) => x === t)).toHaveLength(3);
      expect(h.picks.at(-1)).toBe(h.tier);
      const counts = new Map<string, number>();
      h.picks.forEach((p, idx) => {
        counts.set(p, (counts.get(p) ?? 0) + 1);
        if (idx < h.picks.length - 1) expect(counts.get(p)!).toBeLessThan(3);
      });
      expect(h.pay).toBe(JACKPOT_PAY[h.tier]);
    }
    expect(tiers.has('MINI') && tiers.has('MINOR') && tiers.has('MAJOR')).toBe(true);
  });

  it('only opens on base spins with no other feature', () => {
    const rng = seededRng(32);
    let opened = 0;
    for (let i = 0; i < 400_000 && opened < 50; i++) {
      const o = playSpin(rng, 100, emptyMeter());
      if (!o.hoard) continue;
      opened++;
      expect(o.base.holdSpin).toBeUndefined();
      expect(o.freeGames).toHaveLength(0);
      expect(o.pays.hoard).toBe(o.hoard.pay);
    }
    expect(opened).toBeGreaterThan(0);
  });
});

import { goalsFor, login, newProgress, record, rollDay, BESTIARY } from '../src/math/progress';
import { playSpin as playSpin2 } from '../src/math/game';
import { seededRng as seeded2 } from '../src/math/rng';
import { emptyMeter as emptyMeter2 } from '../src/math/game';

describe('progress', () => {
  it('picks three different goals, the same for everyone each day', () => {
    const a = goalsFor('2026-11-20'), b = goalsFor('2026-11-20');
    expect(a).toEqual(b);
    expect(new Set(a.map((g) => g.kind)).size).toBe(3);
  });
  it('builds a streak on consecutive days and resets after a gap', () => {
    let p = newProgress();
    let r = login(p, '2026-11-20'); expect(r.p.streak).toBe(1); expect(r.reward).toBeGreaterThan(0);
    expect(login(r.p, '2026-11-20').reward).toBe(0);
    r = login(r.p, '2026-11-21'); expect(r.p.streak).toBe(2);
    r = login(r.p, '2026-11-23'); expect(r.p.streak).toBe(1);
    p = r.p;
    for (let d = 24; d <= 30; d++) p = login(p, `2026-11-${d}`).p;
    expect(p.streak).toBe(1); // day 8 wraps back to day 1
  });
  it('captures beasts once and counts goal progress', () => {
    const rng = seeded2(99);
    let p = rollDay(newProgress(), '2026-11-20');
    let captures = 0, spins = 0;
    for (let i = 0; i < 20000; i++) {
      const r = record(p, playSpin2(rng, 100, emptyMeter2()), '2026-11-20');
      captures += r.rewards.filter((x) => x.kind === 'beast').length;
      p = r.p; spins++;
    }
    expect(captures).toBe(Object.keys(p.caught).length);
    expect(captures).toBeLessThanOrEqual(BESTIARY.length);
    expect(p.caught.ORB).toBeTruthy();
    const spinGoal = p.goals.find((g) => g.kind === 'spins');
    if (spinGoal) expect(spinGoal.done).toBe(true);
  });
});

import { betFor, playDenomSpin, stepStreak, type Streak } from '../src/math/denom';
import { newMhb as newMhb3 } from '../src/math/mhb';
import { BET_LEVELS as LEVELS3 } from '../src/math/config';

describe('denominations', () => {
  it('prices bets as denom x 50 credits x multiplier', () => {
    expect(betFor(1, 1)).toBe(50);
    expect(betFor(200, 5)).toBe(50_000);
    expect(LEVELS3).toContain(betFor(5, 3));
  });
  it('pays wins in whole cents and keeps Must Hit By in 1x-bet units', () => {
    const rng = seeded2(5);
    let mhb = newMhb3(rng);
    for (let i = 0; i < 2000; i++) {
      const r = playDenomSpin(rng, 2, 3, emptyMeter2(), mhb, 'normal');
      expect(Number.isInteger(r.outcome.win)).toBe(true);
      expect(r.outcome.bet).toBe(300);
      mhb = r.outcome.mhbAfter!;
    }
    // A 3x bet grows the meters three times as fast as 1x.
    const a = newMhb3(seeded2(1)), b = playDenomSpin(seeded2(2), 1, 3, emptyMeter2(), { STORM: { value: 10, hitAt: 24 }, THUNDER: { value: 50, hitAt: 149 } }, 'normal');
    expect(b.outcome.mhbAfter!.STORM.value).toBeCloseTo(10.03, 6);
    expect(a.STORM.value).toBeGreaterThan(0);
  });
  it('drifts between streaks and spends similar time hot and cold', () => {
    const rng = seeded2(8);
    let s: Streak = 'normal';
    const n = { normal: 0, hot: 0, cold: 0 };
    for (let i = 0; i < 400_000; i++) { s = stepStreak(s, rng); n[s]++; }
    expect(n.hot / n.cold).toBeGreaterThan(0.85);
    expect(n.hot / n.cold).toBeLessThan(1.15);
    expect(n.normal / 400_000).toBeGreaterThan(0.4);
  });
});
