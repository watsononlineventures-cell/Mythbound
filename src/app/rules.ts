import {
  AWAKENED_COIN_MULT, FREE_GAMES_AWARD, FREE_GAMES_CAP, FREE_GAMES_MIN_WIN, FREE_GAMES_SPINS_PER_GATE, GRAND_AWAKENED, HS_MAX_ROWS, ORB_BANK_TRIGGER,
  HS_MAX_ROWS_AWAKENED, HS_RESPINS, HS_ROW_THRESHOLDS, HS_TRIGGER, JACKPOT_PAY, LINE_COUNT, METER_MAX, MHB_TIERS,
  ORB_PRIZES, PAYTABLE, SCATTER_PAY, BASE_CREDITS, DENOMS, type Sym,
} from '../math/config';
import { LINES } from '../math/lines';
import { artUrl } from './art';
import { fmtCoins, fmtDenom, fmtFull } from './fmt';

/** Measured by the simulation (npm run sim, 4 × 10 million spins). Update after any retune. */
const MEASURED = {
  rtp: '98.2%',
  hitRate: '1 in 4.7',
  holdSpin: 50,
  freeGames: 94,
  freeMedian: 17,
  mini: 280,
  minor: 900,
  major: 14000,
  storm: 750,
  thunder: 9700,
  hoard: 520,
};

const SYMBOLS: { sym: Sym; name: string; art: string }[] = [
  { sym: 'H1', name: 'Thunderbird', art: 'sym_thunderbird' },
  { sym: 'H2', name: 'Kraken', art: 'sym_kraken' },
  { sym: 'H3', name: 'Golden Stag', art: 'sym_stag' },
  { sym: 'H4', name: 'Storm Wyrm', art: 'sym_wyrm' },
  { sym: 'M1', name: 'Runestone', art: 'sym_runestone' },
  { sym: 'M2', name: 'Horn of the Deep', art: 'sym_horn' },
  { sym: 'M3', name: 'Feathered Crown', art: 'sym_crown' },
  { sym: 'L1', name: 'Fire', art: 'sym_fire' },
  { sym: 'L2', name: 'Water', art: 'sym_water' },
  { sym: 'L3', name: 'Storm', art: 'sym_storm' },
  { sym: 'L4', name: 'Earth', art: 'sym_earth' },
];

const img = (file: string, cls = '') => `<img class="${cls}" src="${artUrl(file)}" alt="" loading="lazy" />`;
const n = (v: number) => fmtCoins(Math.round(v));
const oneIn = (v: number) => `about 1 in ${v.toLocaleString('en-US')} spins`;

function lineSvg(line: number[], i: number): string {
  const cell = 10, w = 5 * cell, h = 3 * cell;
  const pts = line.map((row, reel) => `${reel * cell + cell / 2},${row * cell + cell / 2}`).join(' ');
  let grid = '';
  for (let r = 0; r < 3; r++) for (let c = 0; c < 5; c++) {
    grid += `<rect x="${c * cell + 0.5}" y="${r * cell + 0.5}" width="${cell - 1}" height="${cell - 1}" rx="1.5" class="${line[c] === r ? 'on' : ''}"/>`;
  }
  return `<figure class="line"><svg viewBox="0 0 ${w} ${h}">${grid}<polyline points="${pts}"/></svg><figcaption>${i + 1}</figcaption></figure>`;
}

/** Build the rules page for the given bet. Every number comes from the game's own settings. */
/** `denom` in cents and `mult` (1x to 5x) set the bet; every prize is shown at that bet. */
export function rulesHtml(denom: number, mult: number): string {
  const bet = denom * BASE_CREDITS * mult;
  const mhbBase = denom * BASE_CREDITS;
  const lineBet = bet / LINE_COUNT;
  const coinValues = ORB_PRIZES.filter(([p]) => p.kind === 'coin').map(([p]) => (p.kind === 'coin' ? p.value : 0));
  const minOrb = Math.min(...coinValues) * bet, maxOrb = Math.max(...coinValues) * bet;
  const rowList = HS_ROW_THRESHOLDS.slice(0, HS_MAX_ROWS - 3)
    .map((t, i) => `<li><b>${t}</b> orbs → row ${i + 4}</li>`).join('');

  const symbolCards = SYMBOLS.map(({ sym, name, art }) => {
    const p = PAYTABLE[sym]!;
    return `<div class="sym">${img(`${art}.webp`)}<div><h4>${name}</h4>
      <p><span>5</span>${n(p[2] * lineBet)}</p><p><span>4</span>${n(p[1] * lineBet)}</p><p><span>3</span>${n(p[0] * lineBet)}</p></div></div>`;
  }).join('');

  return `
  <section>
    <h2>How to play</h2>
    <p>Choose a <b>denomination</b> (${DENOMS.map(fmtDenom).join(', ')}) with the <b>DENOM</b> button, pick a bet multiplier from <b>1x to 5x</b> with <b>−</b> and <b>+</b>, then tap <b>SPIN</b>. Each spin is ${BASE_CREDITS} credits times your multiplier, at your denomination's value per credit.</p>
    <p>You're playing <b>${fmtDenom(denom)}</b> at <b>${mult}x</b>: <b>${fmtFull(bet)}</b> per spin. Every prize on this page is shown at that bet, and changes with it.</p>
    <p>Wins pay <b>left to right</b> on <b>${LINE_COUNT} fixed lines</b>, starting from the first reel, for <b>3, 4 or 5</b> matching symbols in a row. Only the highest win on each line pays, and wins on different lines add together.</p>
    <p class="note">Mythbound is free to play. The money in Mythbound is play money: it has no cash value and can't be bought or cashed out.</p>
  </section>

  <section>
    <h2>Symbols and payouts</h2>
    <p class="sub">Payout per line, at your bet</p>
    <div class="syms">${symbolCards}</div>
    <div class="special-sym">${img('sym_wild.webp')}<div><h4>Sigil Wild</h4>
      <p>Lands on reels 2 to 5 and stands in for every symbol except Moon Gates and orbs. In free games, every wild sticks in place until the round ends.</p></div></div>
    <div class="special-sym">${img('sym_moongate.webp')}<div><h4>Moon Gate</h4>
      <p>Lands only on reels 1, 3 and 5. One on each of those three reels starts free games.</p></div></div>
    <div class="special-sym">${img('orb.webp')}<div><h4>Beast Orb</h4>
      <p>Shows a coin prize or a jackpot. ${HS_TRIGGER} or more anywhere start Hold &amp; Spin. Orbs don't pay on lines.</p></div></div>
    <div class="special-sym">${img('sym_door.webp')}<div><h4>Mystery Doors</h4>
      <p>Free games only. Stacks of temple doors land on the reels, then all open at once to reveal the <b>same</b> symbol: a beast, a mid symbol, a wild or orbs.</p></div></div>
  </section>

  <section>
    <h2>The ${LINE_COUNT} lines</h2>
    <div class="lines">${LINES.map(lineSvg).join('')}</div>
  </section>

  <section>
    <h2>Free games</h2>
    ${img('sym_moongate.webp', 'hero-img')}
    <ul>
      <li>A Moon Gate on reels <b>1, 3 and 5</b> at the same time awards <b>${FREE_GAMES_AWARD} free games</b> and pays <b>${n(SCATTER_PAY * bet)}</b>.</li>
      <li><b>Sticky wilds:</b> every wild that lands stays in place for the rest of the round.</li>
      <li><b>Moon Gates add spins:</b> each Moon Gate adds <b>+${FREE_GAMES_SPINS_PER_GATE} free spin</b>. Three on one spin add <b>${FREE_GAMES_AWARD}</b>. Up to ${FREE_GAMES_CAP} in total.</li>
      <li><b>Mystery doors</b> open to the same symbol, which can be a whole stack of beasts, wilds or orbs.</li>
      <li><b>Orb bank:</b> every orb that lands is saved. Bank <b>${ORB_BANK_TRIGGER} or more</b> and they start a Hold &amp; Spin when the round ends; the more you bank, the bigger the board starts.</li>
      <li><b>Guaranteed win:</b> a free games round always pays at least <b>${n(FREE_GAMES_MIN_WIN * bet)}</b>.</li>
      <li>Each free game waits for your tap.</li>
    </ul>
  </section>

  <section>
    <h2>Hold &amp; Spin</h2>
    ${img('orb.webp', 'hero-img')}
    <ul>
      <li><b>${HS_TRIGGER} or more orbs</b> on any spin start the feature. Every orb locks in place.</li>
      <li>You get <b>${HS_RESPINS} respins</b>. Only the empty cells spin. Every new orb locks and <b>resets the respins to ${HS_RESPINS}</b>.</li>
      <li>The board grows as orbs build up, up to <b>${HS_MAX_ROWS} rows</b>:<ul class="rows">${rowList}</ul></li>
      <li>Coin orbs are worth <b>${n(minOrb)}</b> to <b>${n(maxOrb)}</b>. Jackpot orbs pay their jackpot.</li>
      <li>When the respins run out, every orb on the board pays. <b>Fill every cell to win the Grand.</b></li>
    </ul>
    <h3>Special orbs</h3>
    <p>Any orb that lands during respins can be special; they glow cyan. About 7 in 10 Hold &amp; Spins get at least one.</p>
    <div class="specials">
      <div>${img('badge_doubler.webp')}<p><b>Doubler</b> doubles the coin orbs right next to it.</p></div>
      <div>${img('badge_collector.webp')}<p><b>Collector</b> adds up every coin orb on the board and keeps the total.</p></div>
      <div>${img('badge_rowbreaker.webp')}<p><b>Row Breaker</b> unlocks a new row straight away.</p></div>
      <div>${img('badge_extraspin.webp')}<p><b>Extra Respin</b> resets respins to ${HS_RESPINS + 1} for the rest of the feature.</p></div>
    </div>
  </section>

  <section>
    <h2>Jackpots</h2>
    <div class="jps">
      <div class="mini">${img('orb_mini.webp')}<h4>Mini</h4><b>${n(JACKPOT_PAY.MINI * bet)}</b><span>Jackpot orb</span></div>
      <div class="minor">${img('orb_minor.webp')}<h4>Minor</h4><b>${n(JACKPOT_PAY.MINOR * bet)}</b><span>Jackpot orb</span></div>
      <div class="major">${img('orb_major.webp')}<h4>Major</h4><b>${n(JACKPOT_PAY.MAJOR * bet)}</b><span>Jackpot orb (rare)</span></div>
      <div class="grand">${img('orb_grand.webp')}<h4>Grand</h4><b>${n(JACKPOT_PAY.GRAND * bet)}</b><span>Fill the Hold &amp; Spin board</span></div>
    </div>
  </section>

  <section>
    <h2>The Thunderbird's Hoard</h2>
    <p>Any base spin that doesn't start a feature can open the Hoard. Twelve hidden orbs hold three of each jackpot. Pick orbs one at a time until <b>three of the same jackpot</b> turn up, and that jackpot is yours. <b>Every Hoard wins a jackpot</b>, from the Mini up to the Grand.</p>
  </section>

  <section>
    <h2>Beast Awakening</h2>
    ${img('hero_awakened.webp', 'hero-img')}
    <p>Every orb that lands in the base game wakes the Thunderbird a little more. After <b>${METER_MAX.toLocaleString('en-US')} orbs</b> the meter is full, and your next Hold &amp; Spin is <b>awakened</b>:</p>
    <ul>
      <li>The board can grow to <b>${HS_MAX_ROWS_AWAKENED} rows</b>.</li>
      <li>Coin orbs are worth <b>${AWAKENED_COIN_MULT}×</b>.</li>
      <li>The Grand pays <b>${n(GRAND_AWAKENED * bet)}</b>.</li>
    </ul>
  </section>

  <section>
    <h2>Must Hit By jackpots</h2>
    <p>Two progressive jackpots grow a little on every spin. Each one has a hidden payout point, and it's <b>guaranteed to pay before it reaches its Must Hit By amount</b>. When it pays, it starts over from its starting value with a new hidden point.</p>
    <div class="mhbs">
      ${MHB_TIERS.map((t) => `<div class="${t.id.toLowerCase()}"><h4>${t.name}</h4>
        <p>Starts at <b>${n(t.seed * mhbBase)}</b></p><p>Must hit by <b>${n(t.cap * mhbBase)}</b></p></div>`).join('')}
    </div>
    <p class="sub">Each denomination has its own pair, shown here for ${fmtDenom(denom)}. A jackpot is worth the same at every multiplier, but higher multipliers grow it faster, so your chance of being the one who hits it grows with your bet.</p>
  </section>

  <section>
    <h2>Denominations, hot and cold</h2>
    <p>Each denomination keeps its own <b>Must Hit By jackpots</b>, and its own <b>Beast meter at each multiplier</b>. The <b>DENOM</b> screen shows how close each one is, plus how each denomination has paid over your last 100 spins on it.</p>
    <p>Each denomination also drifts through hidden <b>hot</b> and <b>cold</b> streaks that last about 150 spins on average. A hot denomination brings features about <b>40% more often</b>; a cold one, about <b>40% less</b>. A streak only moves while you play that denomination. Hot and cold balance out, so over the long run every denomination returns the same.</p>
  </section>

  <section>
    <h2>Odds and payout</h2>
    <table>
      <tr><td>Long-run return</td><td><b>${MEASURED.rtp}</b> of coins bet</td></tr>
      <tr><td>Any win</td><td>${MEASURED.hitRate} spins</td></tr>
      <tr><td>Hold &amp; Spin</td><td>${oneIn(MEASURED.holdSpin)}</td></tr>
      <tr><td>Orbs added in a typical Hold &amp; Spin</td><td>about 7</td></tr>
      <tr><td>Free games</td><td>${oneIn(MEASURED.freeGames)}</td></tr>
      <tr><td>Typical free games round</td><td>about ${n(MEASURED.freeMedian * bet)}</td></tr>
      <tr><td>Thunderbird's Hoard</td><td>${oneIn(MEASURED.hoard)}</td></tr>
      <tr><td>Mini jackpot (Hold &amp; Spin or Hoard)</td><td>${oneIn(MEASURED.mini)}</td></tr>
      <tr><td>Minor jackpot</td><td>${oneIn(MEASURED.minor)}</td></tr>
      <tr><td>Major jackpot</td><td>${oneIn(MEASURED.major)}</td></tr>
      <tr><td>Grand</td><td>Extremely rare</td></tr>
      <tr><td>Storm Jackpot</td><td>${oneIn(MEASURED.storm)}</td></tr>
      <tr><td>Thunder Jackpot</td><td>${oneIn(MEASURED.thunder)}</td></tr>
    </table>
    <p class="sub">Measured over 40 million simulated spins. Every bet has the same odds; your bet only changes the size of wins. These figures are the long-run average across hot, normal and cold streaks. Results are random, and any session can run well above or below these averages.</p>
  </section>

  <section>
    <h2>Your balance</h2>
    <p>You start with $1,000 in play money, shared across every denomination. If you run out, $500 more arrives after 2 hours, and once a day you can wake the beast for it right away. Your balance is saved on this device.</p>
  </section>`;
}
