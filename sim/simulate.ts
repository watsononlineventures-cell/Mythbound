/**
 * Headless math simulation for Mythbound.
 * Usage: npm run sim -- [spins=10000000] [seed=1] [--check]
 * --check exits non-zero if RTP is outside 97.5%–98.5% (free-to-play target: 98%).
 */
import { emptyMeter, playSpin } from '../src/math/game';
import { seededRng } from '../src/math/rng';
import { newMhb } from '../src/math/mhb';

const args = process.argv.slice(2);
const check = args.includes('--check');
const nums = args.filter((a) => !a.startsWith('--')).map(Number);
const SPINS = nums[0] || 10_000_000;
const SEED = nums[1] || 1;

const rng = seededRng(SEED);
let meter = emptyMeter();
let mhb = newMhb(rng);
const mhbHits: Record<string, number> = { STORM: 0, THUNDER: 0 };
let mhbMax = 0;

let total = 0, sumSq = 0, hits = 0, lineHits = 0, maxWin = 0;
const rtp = { lines: 0, scatter: 0, holdSpin: 0, freeGames: 0, mustHitBy: 0, hoard: 0 };
const hoardHits: Record<string, number> = { MINI: 0, MINOR: 0, MAJOR: 0, GRAND: 0 };
let hoards = 0;
let hsBase = 0, hsFree = 0, hsAwakened = 0, fgTriggers = 0, fgSpins = 0, orbsSeen = 0;
let grands = 0, grandsAwakened = 0;
const jackpots = { MINI: 0, MINOR: 0, MAJOR: 0 };
let hsPaySum = 0, hsCount = 0, fgPaySum = 0, maxRowsHit = 0;
let fgRetrig = 0, fgDead = 0, fgUnder5 = 0, fgBankHs = 0, fgDeadSpins = 0, fgSpinsAll = 0;
const buckets = [0, 1, 5, 15, 50, 150, 500, Infinity];
const bucketCounts = Array(buckets.length).fill(0);

const t0 = Date.now();
for (let i = 0; i < SPINS; i++) {
  const o = playSpin(rng, 1, meter, mhb);
  meter = o.meterAfter;
  mhb = o.mhbAfter!;
  for (const a of o.mhbAwards) { mhbHits[a.id]++; if (a.x > mhbMax && a.id === 'THUNDER') mhbMax = a.x; }
  rtp.mustHitBy += o.pays.mustHitBy;
  rtp.hoard += o.pays.hoard;
  if (o.hoard) { hoards++; hoardHits[o.hoard.tier]++; }
  const x = o.totalX;
  total += x;
  sumSq += x * x;
  if (x > 0) hits++;
  if (o.base.lineWins.length) lineHits++;
  if (x > maxWin) maxWin = x;
  rtp.lines += o.pays.lines;
  rtp.scatter += o.pays.scatter;
  rtp.holdSpin += o.pays.holdSpin;
  rtp.freeGames += o.pays.freeGames;
  orbsSeen += o.base.orbs.length;
  if (o.freeGames.length) {
    fgTriggers++; fgSpins += o.freeGames.length; fgPaySum += o.pays.freeGames;
    if (o.freeGames.some((f) => f.scatters >= 3)) fgRetrig++;
    if (o.pays.freeGames === 0) fgDead++;
    if (o.pays.freeGames < 5) fgUnder5++;
    if (o.bank?.holdSpin) fgBankHs++;
    for (const f of o.freeGames) { fgSpinsAll++; if (f.linePay === 0) fgDeadSpins++; }
  }
  if (o.bank?.holdSpin) {
    const hs = o.bank.holdSpin;
    for (const j of hs.jackpots) jackpots[j.jackpot]++;
    if (hs.grand) grands++;
  }

  const screens = [o.base, ...o.freeGames];
  for (const s of screens) {
    const hs = s.holdSpin;
    if (!hs) continue;
    if (s === o.base) hsBase++; else hsFree++;
    if (hs.awakened) hsAwakened++;
    hsCount++;
    hsPaySum += hs.pay;
    const rows = hs.steps.length ? hs.steps[hs.steps.length - 1].unlockedRows : 3;
    if (rows > maxRowsHit) maxRowsHit = rows;
    for (const j of hs.jackpots) jackpots[j.jackpot]++;
    if (hs.grand) { grands++; if (hs.awakened) grandsAwakened++; }
  }
  let b = 0;
  if (x === 0) b = 0; else while (x >= buckets[b] && b < buckets.length - 1) b++;
  bucketCounts[b]++;
}
const secs = (Date.now() - t0) / 1000;

const pct = (v: number) => (100 * v / SPINS).toFixed(3) + '%';
const oneIn = (n: number) => (n ? `1 in ${Math.round(SPINS / n).toLocaleString()}` : 'never');
const mean = total / SPINS;
const sd = Math.sqrt(sumSq / SPINS - mean * mean);
const RTP = mean * 100;

console.log(`\nMythbound simulation — ${SPINS.toLocaleString()} spins, seed ${SEED}, ${secs.toFixed(1)}s\n`);
console.log(`RTP total          ${RTP.toFixed(3)}%`);
console.log(`  base lines       ${pct(rtp.lines)}`);
console.log(`  base scatter     ${pct(rtp.scatter)}`);
console.log(`  hold & spin      ${pct(rtp.holdSpin)}   (base game)`);
console.log(`  free games       ${pct(rtp.freeGames)}   (incl. hold & spin inside)`);
console.log(`  must hit by      ${pct(rtp.mustHitBy)}`);
console.log(`  hoard            ${pct(rtp.hoard)}`);
console.log(`Hit frequency      ${(100 * hits / SPINS).toFixed(2)}%  (line hits ${(100 * lineHits / SPINS).toFixed(2)}%)`);
console.log(`Volatility (SD)    ${sd.toFixed(2)}x bet`);
console.log(`Max win            ${maxWin.toFixed(1)}x bet`);
console.log(`Orbs per base spin ${(orbsSeen / SPINS).toFixed(3)}`);
console.log('');
console.log(`Hold & spin        ${oneIn(hsBase)} spins (base), ${hsFree.toLocaleString()} more inside free games`);
console.log(`  awakened         ${hsAwakened.toLocaleString()} (${(100 * hsAwakened / Math.max(1, hsCount)).toFixed(1)}% of features)`);
console.log(`  avg pay          ${(hsPaySum / Math.max(1, hsCount)).toFixed(2)}x bet, max rows reached ${maxRowsHit}`);
console.log(`Free games         ${oneIn(fgTriggers)} spins, avg ${(fgSpins / Math.max(1, fgTriggers)).toFixed(1)} games, avg pay ${(fgPaySum / Math.max(1, fgTriggers)).toFixed(2)}x`);
console.log(`  free rounds      3-gate retrigger ${(100 * fgRetrig / Math.max(1, fgTriggers)).toFixed(1)}%, orb-bank Hold & Spin ${(100 * fgBankHs / Math.max(1, fgTriggers)).toFixed(1)}%, pay 0 ${(100 * fgDead / Math.max(1, fgTriggers)).toFixed(1)}%, pay <5x ${(100 * fgUnder5 / Math.max(1, fgTriggers)).toFixed(1)}%, spins with no line win ${(100 * fgDeadSpins / Math.max(1, fgSpinsAll)).toFixed(1)}%`);
console.log(`Jackpots           Mini ${oneIn(jackpots.MINI)}, Minor ${oneIn(jackpots.MINOR)}, Major ${oneIn(jackpots.MAJOR)}`);
console.log(`                   Grand ${oneIn(grands)} (${grandsAwakened} awakened)`);
console.log(`Hoard              ${oneIn(hoards)} spins (Mini ${hoardHits.MINI}, Minor ${hoardHits.MINOR}, Major ${hoardHits.MAJOR}, Grand ${hoardHits.GRAND})`);
console.log(`Must Hit By        Storm ${oneIn(mhbHits.STORM)}, Thunder ${oneIn(mhbHits.THUNDER)} (largest Thunder ${mhbMax.toFixed(1)}x)`);
console.log('\nWin distribution (x bet)');
const labels = ['0', '<1', '1-5', '5-15', '15-50', '50-150', '150-500', '500+'];
bucketCounts.forEach((c, i) => console.log(`  ${labels[i].padEnd(8)} ${(100 * c / SPINS).toFixed(4)}%`));

if (check && (RTP < 97.5 || RTP > 98.5)) {
  console.error(`\nFAIL: RTP ${RTP.toFixed(3)}% outside 97.5–98.5%`);
  process.exit(1);
}
