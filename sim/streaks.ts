// Hot/cold streak check: plays one denom with its hidden streak moving, and reports the return
// overall and while hot, normal and cold. Usage: tsx sim/streaks.ts [spins] [seed] [mult]
import { playDenomSpin, type Streak } from '../src/math/denom';
import { emptyMeter } from '../src/math/game';
import { newMhb } from '../src/math/mhb';
import { seededRng } from '../src/math/rng';

const spins = Number(process.argv[2] ?? 2_000_000);
const rng = seededRng(Number(process.argv[3] ?? 1));
const mult = Number(process.argv[4] ?? 1);
const denom = 1;
let meter = emptyMeter(), mhb = newMhb(rng), streak: Streak = 'normal';
const by: Record<Streak, { n: number; bet: number; win: number; feat: number }> = {
  normal: { n: 0, bet: 0, win: 0, feat: 0 }, hot: { n: 0, bet: 0, win: 0, feat: 0 }, cold: { n: 0, bet: 0, win: 0, feat: 0 },
};
let runs = 0, runLen = 0, prev: Streak = 'normal';
for (let i = 0; i < spins; i++) {
  const r = playDenomSpin(rng, denom, mult, meter, mhb, streak);
  const o = r.outcome, b = by[streak];
  b.n++; b.bet += o.bet; b.win += o.win;
  if (o.base.holdSpin || o.freeGames.length || o.hoard) b.feat++;
  meter = o.meterAfter; mhb = o.mhbAfter!;
  if (r.streak !== prev && r.streak !== 'normal') { runs++; }
  prev = streak = r.streak;
  if (streak !== 'normal') runLen++;
}
const tot = Object.values(by).reduce((a, b) => ({ n: a.n + b.n, bet: a.bet + b.bet, win: a.win + b.win, feat: a.feat + b.feat }), { n: 0, bet: 0, win: 0, feat: 0 });
const line = (k: string, b: typeof tot) => `${k.padEnd(7)} ${(100 * b.n / spins).toFixed(1).padStart(5)}% of spins  RTP ${(100 * b.win / b.bet).toFixed(2)}%  feature 1 in ${(b.n / b.feat).toFixed(1)}`;
console.log(`${spins.toLocaleString()} spins at ${mult}x`);
for (const k of ['hot', 'normal', 'cold'] as Streak[]) console.log(line(k, by[k]));
console.log(line('overall', tot));
console.log(`streaks started: ${runs}, average length ${(runLen / Math.max(1, runs)).toFixed(0)} spins`);
