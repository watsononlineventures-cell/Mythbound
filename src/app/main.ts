import { BET_LEVELS, BET_MULTS, DENOMS, FREE_GAMES_MIN_WIN, METER_MAX, ORB_BANK_TRIGGER, REFILL_AMOUNT } from '../math/config';
import { baseBet, betFor, playDenomSpin, type Streak } from '../math/denom';
import type { HoldSpinResult } from '../math/holdSpin';
import { BASE_STRIPS, emptyMeter, FREE_STRIPS, playSpin, type MeterState, type ScreenResult, type SpinOutcome } from '../math/game';
import { cryptoRng } from '../math/rng';
import { newMhb, repairMhb, type MhbState } from '../math/mhb';
import { canBet, earlyRefill, newWallet, settleSpin, tickRefill, type Wallet } from '../math/wallet';
import { Board } from './board';
import { Hud } from './hud';
import { wait } from './fmt';
import { audio } from './audio';
import { buzz } from './haptics';
import { artUrl, loadArt, preloadImages } from './art';
import { rulesHtml } from './rules';
import { playHoardUi } from './hoardUi';
import { fmtDenom, fmtFull } from './fmt';
import { renderDenoms } from './denomUi';
import type { Theme } from './fx';
import { login, newProgress, record, rollDay, type Progress } from '../math/progress';
import { registerOffline, setupAttract } from './cabinet';
import { openModal, renderBestiary, renderGoals, toast } from './progressUi';

// ---------------- Persistence ----------------
const KEY = 'mythbound.v2';
/** Everything a denomination remembers: its Must Hit By jackpots, hidden streak and recent results. */
interface DenomSave { mhb: MhbState; streak: Streak; /** Last 100 spins: [win / bet, had a feature (1/0)]. */ hist: [number, number][] }
interface Saved {
  v: 2; wallet: Wallet; denom: number; mult: number; turbo: boolean; sound?: boolean;
  /** Sound per screen (base game, free games, Hold & Spin, awakened). Missing means on. */
  soundBy?: Partial<Record<Theme, boolean>>;
  denoms: Record<number, DenomSave>;
  /** One Beast meter per denom and bet multiplier, keyed "denom-mult". */
  meters: Record<string, MeterState>;
}
interface State extends Saved { bet: number; meter: MeterState; mhb: MhbState }

const freshDenom = (): DenomSave => ({ mhb: newMhb(cryptoRng()), streak: 'normal', hist: [] });
function load(): Saved {
  try {
    const s = JSON.parse(localStorage.getItem(KEY) ?? 'null');
    if (s?.v === 2 && s.wallet) {
      for (const d of DENOMS) s.denoms[d] = s.denoms[d] ? { ...s.denoms[d], mhb: repairMhb(s.denoms[d].mhb, cryptoRng()) } : freshDenom();
      return s;
    }
  } catch { /* storage unavailable */ }
  const denoms = Object.fromEntries(DENOMS.map((d) => [d, freshDenom()]));
  // Bring an older coins save forward: 1 coin = 2 cents, so the old 50,000 start becomes $1,000.
  try {
    const old = JSON.parse(localStorage.getItem('mythbound.v1') ?? 'null');
    if (old?.wallet) {
      return { v: 2, wallet: { ...old.wallet, balance: Math.round(old.wallet.balance * 2) }, denom: 1, mult: 1, turbo: !!old.turbo, sound: old.sound, denoms, meters: { '1-1': old.meter ?? emptyMeter() } };
    }
  } catch { /* ignore */ }
  return { v: 2, wallet: newWallet(), denom: 1, mult: 1, turbo: false, denoms, meters: {} };
}
const meterKey = (d: number, m: number) => `${d}-${m}`;
const saved = load();
const state: State = { ...saved, bet: 0, meter: emptyMeter(), mhb: saved.denoms[saved.denom].mhb };
/** Switch to a denom and multiplier, putting the current meter away and loading theirs. */
function select(denom: number, mult: number) {
  state.meters[meterKey(state.denom, state.mult)] = state.meter;
  state.denoms[state.denom].mhb = state.mhb;
  state.denom = denom;
  state.mult = mult;
  state.bet = betFor(denom, mult);
  state.meter = state.meters[meterKey(denom, mult)] ?? emptyMeter();
  state.mhb = state.denoms[denom].mhb;
}
select(state.denom, state.mult);
const PKEY = 'mythbound.progress';
let progress: Progress = (() => {
  try { const p = JSON.parse(localStorage.getItem(PKEY) ?? 'null'); if (p?.caught) return p as Progress; } catch { /* ignore */ }
  return newProgress();
})();
const saveProgress = () => { try { localStorage.setItem(PKEY, JSON.stringify(progress)); } catch { /* ignore */ } };
const save = () => {
  state.meters[meterKey(state.denom, state.mult)] = state.meter;
  state.denoms[state.denom].mhb = state.mhb;
  const { bet: _b, meter: _m, mhb: _h, ...out } = state;
  try { localStorage.setItem(KEY, JSON.stringify(out)); } catch { /* ignore */ }
};

const today = () => new Date().toLocaleDateString('en-CA');
const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;

const board = new Board();
const hud = new Hud();
const rng = cryptoRng();
let busy = false;
/** Set while hold & spin is waiting for the player to start the next respin. */
let respinWaiter: (() => void) | null = null;
/** When the current wait began; taps in the first moment are ignored so a double tap can't skip a spin. */
let waitStartedAt = 0;
const waitReady = () => performance.now() - waitStartedAt > 350;

function waitForRespin(left: number): Promise<void> {
  return waitForTap(left === 1 ? 'LAST RESPIN — TAP TO SPIN' : 'TAP TO RESPIN', 'RESPIN', left === 1);
}

/** Wait for the player (spin button, spacebar or a tap on the board) before the next feature spin. */
function waitForTap(hint: string, label: string, last = false): Promise<void> {
  return new Promise((resolve) => {
    let timer = 0;
    const go = () => {
      if (!respinWaiter) return;
      respinWaiter = null;
      clearTimeout(timer);
      hud.setRespinMode(false);
      hud.setSpinEnabled(false);
      $('tap-hint').hidden = true;
      audio.click();
      resolve();
    };
    respinWaiter = go;
    waitStartedAt = performance.now();
    hud.setRespinMode(true, last, label);
    $('tap-hint').textContent = hint;
    $('tap-hint').hidden = false;
    // Autoplay keeps going on its own, with time to take in each result.
    if (auto) timer = window.setTimeout(go, 1600);
  });
}

/** Spin button, spacebar and board taps all route here. */
function press() {
  if (respinWaiter) { if (waitReady()) respinWaiter(); }
  else if (board.spinning) board.slam();
  else spin();
}
let auto = false;

function refreshHud() {
  hud.setBalance(state.wallet.balance);
  hud.setBet(state.bet, state.denom, state.mult, state.mult > 1 && !busy, state.mult < BET_MULTS.length && !busy);
  hud.setJackpots(state.bet, state.meter.charged);
  hud.setMeter(state.meter);
  hud.setMustHitBy(state.mhb, baseBet(state.denom));
  setSpeed(state.turbo);
}

function setSpeed(turbo: boolean) {
  board.speed = hud.speed = turbo ? 0.45 : 1;
  $('turbo').classList.toggle('on', turbo);
}

// ---------------- Refill ----------------
function checkRefill() {
  if (busy) return;
  state.wallet = tickRefill(state.wallet, Date.now());
  const broke = state.wallet.refillAt !== null;
  $('refill').hidden = !broke;
  if (broke) {
    const ms = Math.max(0, state.wallet.refillAt! - Date.now());
    const h = Math.floor(ms / 3.6e6), m = Math.floor((ms % 3.6e6) / 6e4), s = Math.floor((ms % 6e4) / 1000);
    $('refill-time').textContent = h ? `${h}h ${String(m).padStart(2, '0')}m` : `${m}:${String(s).padStart(2, '0')}`;
    const used = state.wallet.earlyRefillDay === today();
    $<HTMLButtonElement>('wake').disabled = used;
    $('wake-note').textContent = used ? 'Already woken today. Come back tomorrow or wait it out.' : 'You can wake it early once a day.';
  }
  save();
  refreshHud();
}

// ---------------- Spin flow ----------------
const orbMap = (s: ScreenResult) => new Map(s.orbs.map((o) => [o.cell, o.orb]));
const coins = (x: number, bet: number) => Math.round(x * bet);
const autoMs = (ms: number) => (auto ? ms : undefined);

let screen: Theme = 'base';
/** Sound is on for every screen unless the player turned it off the last time they were there. */
function applySound() {
  const on = state.soundBy?.[screen] !== false;
  audio.setMuted(!on);
  $('sound').classList.toggle('off', !on);
  $('sound').textContent = on ? '🔊' : '🔇';
}

function setMode(t: Theme) {
  screen = t;
  board.fx.theme(t);
  audio.music(t);
  applySound();
}

/** Which reel (if any) to tease: the last reel when a feature is one reel away. */
function anticipation(s: ScreenResult): number | undefined {
  const scat = (r: number) => s.reelGrid[r].includes('S');
  if (scat(0) && scat(2)) return 4;
  const orbsBeforeLast = s.reelGrid.slice(0, 4).flat().filter((x) => x === 'O').length;
  if (orbsBeforeLast >= 4) return 4;
}

/** Play one Hold & Spin (base game or orb bank): intro card, the feature, then the collected total. */
async function runHoldSpin(hs: HoldSpinResult, bet: number, runningIn: number, kicker: string, after: Theme): Promise<number> {
  const fx = board.fx;
  const { width, height } = fx.size;
  if (hs.awakened) {
    setMode('awake');
    audio.thunder();
    audio.roar();
    for (let i = 0; i < 3; i++) setTimeout(() => {
      fx.lightning(Math.random() * width, 0, Math.random() * width, height * (0.5 + Math.random() * 0.4));
      fx.flash(0xffffff, 0.6, 0.35);
    }, i * 260);
    fx.shake(20);
    await hud.feature({
      cls: 'awake', kicker: 'Hold & Spin', title: 'THE BEAST AWAKENS', img: 'hero_awakened.webp',
      detail: 'Board grows to <b>12 rows</b><br>Orbs are worth <b>1.5×</b><br>The Grand pays <b>5,000×</b>',
      button: 'UNLEASH', auto: autoMs(3500),
    });
  } else {
    setMode('hold');
    audio.fanfare('feature');
    fx.flash(0xffd34d, 0.45, 0.6);
    fx.shake(10);
    await hud.feature({
      kicker, title: 'HOLD & SPIN', img: 'orb.webp',
      detail: 'Every new orb resets respins to <b>3</b><br>More orbs unlock more rows<br>Fill the whole board to win the <b>GRAND</b>',
      button: 'START', auto: autoMs(3500),
    });
  }
  const before = runningIn;
  await board.playHoldSpin(hs, bet, {
    respins: (n, rows, max, reset) => hud.respins(n, rows, max, reset),
    nextRespin: (left) => waitForRespin(left),
    special: (kind) => {
      const info: Record<string, [string, string]> = {
        DOUBLER: ['DOUBLER!', 'Doubles the orbs next to it'],
        COLLECTOR: ['COLLECTOR!', 'Collects every coin orb on the board'],
        ROW_BREAKER: ['ROW BREAKER!', 'A new row opens'],
        EXTRA_RESPIN: ['EXTRA RESPIN!', 'Respins now reset to 4'],
      };
      const [title, sub] = info[kind] ?? [kind, ''];
      audio.fanfare('small');
      return hud.banner(title, sub, 1500, 'SPECIAL');
    },
    collected: (t) => hud.setWin(before + t, 0.15),
    jackpot: async (name, amount) => {
      audio.fanfare('jackpot');
      buzz([80, 40, 80, 40, 160]);
      fx.coinRain(name === 'GRAND' ? 4 : 2, name === 'GRAND' ? 90 : 50);
      fx.flash(name === 'GRAND' ? 0xffd34d : 0xffffff, 0.5, 0.7);
      fx.shake(name === 'GRAND' ? 24 : 12);
      await hud.banner(name, fmtFull(amount), name === 'GRAND' ? 4500 : 2400, name);
    },
  });
  hud.status(null);
  const hsWin = coins(hs.pay, bet);
  const running = before + hsWin;
  hud.setWin(running);
  if (hs.awakened) { hud.setMeter(state.meter); hud.setJackpots(bet, state.meter.charged); }
  audio.fanfare('big');
  fx.coinRain(2.5, hsWin >= bet * 50 ? 80 : 40);
  await hud.feature({
    cls: hs.awakened ? 'awake' : '', kicker: 'Hold & Spin complete', title: 'COLLECTED', img: 'orb_grand.webp',
    countTo: hsWin, button: 'CONTINUE', auto: autoMs(4000),
  });
  setMode(after);
  return running;
}

async function playScreen(s: ScreenResult, bet: number, strips: typeof BASE_STRIPS, runningIn: number, inFree: boolean): Promise<number> {
  let running = runningIn;
  let scatters = 0;
  let orbWalk = 0;
  const fx = board.fx;
  // A cell under a sticky wild doesn't count for what physically landed there.
  const covered = (r: number, row: number) => s.reelGrid[r][row] !== s.grid[r][row] && s.reelGrid[r][row] !== 'D';
  audio.spinStart();
  hud.setStopMode(true);
  const spinning = board.spin(s.reelGrid, orbMap(s), bet, strips, {
    anticipate: anticipation(s),
    onStop: (r) => {
      audio.reelStop(r);
      buzz(8);
      // Each orb this spin rings one scale step higher than the last, top to bottom within a reel.
      s.reelGrid[r].forEach((sym, row) => {
        if (sym !== 'O' || covered(r, row)) return;
        const delay = row * 0.07;
        audio.orbLand(orbWalk++, delay);
        setTimeout(() => {
          const p = board.cellCenter(r, row);
          fx.ring(p.x, p.y, 0xffb020, 55);
          if (inFree) board.floatText(r, row, '+1 ORB', 0xffc84d);
        }, delay * 1000);
      });
      const row = s.reelGrid[r].indexOf('S');
      if (row >= 0 && !covered(r, row)) {
        scatters++;
        audio.scatter(scatters);
        buzz(25);
        const p = board.cellCenter(r, row);
        fx.ring(p.x, p.y, 0xc8d4ff, 60);
        fx.sparks(p.x, p.y, 12, 0xe6ecff);
        if (inFree && s.scatters < 3) board.floatText(r, row, '+1 SPIN', 0xd9e2ff);
      }
    },
  });
  await spinning;
  hud.setStopMode(false);
  if (s.free?.door) {
    await board.openDoors(s.revealed, orbMap(s), bet);
    // Orbs the doors revealed go to the bank too.
    s.revealed.forEach((col, r) => col.forEach((sym, row) => {
      if (s.reelGrid[r][row] === 'D' && sym === 'O' && s.grid[r][row] === 'O') {
        audio.orbLand(orbWalk++, 0);
        board.floatText(r, row, '+1 ORB', 0xffc84d);
      }
    }));
  }
  if (s.free?.newSticky.length) await board.addSticky(s.free.newSticky);
  if (s.lineWins.length) {
    running += coins(s.linePay, bet);
    hud.setWin(running);
    await board.showLineWins(s.lineWins);
  }
  if (s.scatters >= 3) {
    await board.celebrateScatters();
    running += coins(s.scatterPay, bet);
    hud.setWin(running);
  }
  if (s.holdSpin) {
    await board.celebrateOrbs();
    running = await runHoldSpin(s.holdSpin, bet, running, `${s.orbs.length} orbs locked`, inFree ? 'free' : 'base');
  }
  return running;
}

async function play(outcome: SpinOutcome, streak?: Streak) {
  const bet = outcome.bet;
  const mhbBase = baseBet(state.denom);
  const d = state.denoms[state.denom];
  if (streak) d.streak = streak;
  d.hist = [...d.hist, [Math.round((outcome.win / bet) * 100) / 100, outcome.base.holdSpin || outcome.freeGames.length || outcome.hoard ? 1 : 0] as [number, number]].slice(-100);
  const fx = board.fx;
  const startBalance = state.wallet.balance;
  state.wallet = settleSpin(state.wallet, bet, outcome.win, Date.now());
  state.meter = outcome.meterAfter;
  if (outcome.mhbAfter) state.mhb = outcome.mhbAfter;
  save();

  busy = true;
  hud.setSpinEnabled(false);
  refreshHud();
  hud.setBalance(startBalance - bet);
  hud.setWin(0);
  // Jackpots keep their pre-spin state until a feature uses the charged meter.
  hud.setJackpots(bet, outcome.meterBefore.charged);
  // A Must Hit By meter that pays this spin shows full until its award plays.
  const shownMhb = { ...state.mhb };
  for (const a of outcome.mhbAwards) shownMhb[a.id] = { value: a.x, hitAt: a.x };
  hud.setMustHitBy(shownMhb, mhbBase, true);

  let running = await playScreen(outcome.base, bet, BASE_STRIPS, 0, false);
  if (!outcome.base.holdSpin) {
    hud.setMeter(outcome.meterAfter);
    hud.setJackpots(bet, outcome.meterAfter.charged);
    if (!outcome.meterBefore.charged && outcome.meterAfter.charged) {
      audio.thunder();
      fx.flash(0xff6b5a, 0.45, 0.8);
      fx.shake(12);
      await hud.banner('THE BEAST STIRS', 'Next Hold & Spin is awakened', 2200, 'MAJOR');
    }
  }

  if (outcome.freeGames.length) {
    const n = outcome.base.freeGamesAwarded;
    setMode('free');
    audio.fanfare('feature');
    fx.flash(0xc8a0ff, 0.55, 0.8);
    await hud.feature({
      cls: 'free', kicker: 'The Moon Gates open', title: `${n} FREE GAMES`, img: 'sym_moongate.webp',
      detail: `<b>Wilds stick</b> for the rest of the round<br>Every Moon Gate adds <b>+1 spin</b><br>Mystery doors all open to the <b>same symbol</b><br>Bank <b>${ORB_BANK_TRIGGER} orbs</b> for a Hold &amp; Spin at the end<br>Guaranteed at least <b>${fmtFull(FREE_GAMES_MIN_WIN * bet)}</b>`,
      button: 'START FREE GAMES', auto: autoMs(4500),
    });
    let awarded = n;
    let banked = 0;
    const fgStart = running;
    const status = (i: number) => hud.status(
      `FREE GAME ${i} OF ${awarded}  ·  ORBS ${banked}/${ORB_BANK_TRIGGER}  ·  WON ${fmtFull(running - fgStart)}`);
    for (const [i, fg] of outcome.freeGames.entries()) {
      status(i + 1);
      const left = awarded - i;
      await waitForTap(left === 1 ? 'LAST FREE GAME — TAP TO SPIN' : `TAP TO SPIN · ${left} LEFT`, 'FREE SPIN', left === 1);
      running = await playScreen(fg, bet, FREE_STRIPS, running, true);
      banked = fg.free?.bank ?? banked;
      if (fg.freeGamesAwarded) {
        awarded += fg.freeGamesAwarded;
        if (fg.scatters >= 3) {
          audio.fanfare('small');
          await hud.feature({ cls: 'free', kicker: 'More gates open', title: `+${fg.freeGamesAwarded} FREE GAMES`, button: 'CONTINUE', auto: 2500 });
        } else {
          audio.respinReset();
        }
      }
      status(i + 1);
      await wait(350 * board.speed);
    }
    hud.status(null);
    await wait(400);
    board.clearSticky();

    // Orb bank: 6 or more orbs collected during the round start a Hold & Spin.
    const bank = outcome.bank;
    if (bank?.holdSpin) {
      running = await runHoldSpin(bank.holdSpin, bet, running, `${bank.orbs.length} orbs banked`, 'free');
    } else if (bank && bank.orbs.length) {
      await hud.banner('ORB BANK', `${bank.orbs.length} of ${ORB_BANK_TRIGGER} orbs`, 1400);
    }

    // Guaranteed minimum.
    const topUp = coins(outcome.freeGamesTopUp, bet);
    if (topUp > 0) {
      running += topUp;
      hud.setWin(running);
      await hud.banner('GUARANTEED WIN', `+${fmtFull(topUp)}`, 1600);
    }
    const fgWin = running - fgStart;
    audio.fanfare('big');
    fx.coinRain(3, fgWin >= bet * 30 ? 80 : 40);
    await hud.feature({ cls: 'free', kicker: 'Free games complete', title: 'TOTAL WIN', img: 'sym_moongate.webp', countTo: fgWin, button: 'CONTINUE', auto: autoMs(4500) });
    setMode('base');
  }

  // Thunderbird's Hoard: a pick bonus that can open on a quiet base spin.
  if (outcome.hoard) {
    const { width, height } = fx.size;
    audio.thunder();
    audio.roar();
    for (let i = 0; i < 2; i++) setTimeout(() => { fx.lightning(Math.random() * width, 0, Math.random() * width, height * 0.7); fx.flash(0xffffff, 0.5, 0.35); }, i * 280);
    fx.shake(14);
    buzz([60, 40, 120]);
    await hud.feature({
      cls: 'awake', kicker: 'A mystery bonus', title: "THE THUNDERBIRD'S HOARD", img: 'hero_awakened.webp',
      detail: 'Twelve orbs hide the four jackpots.<br>Pick until you find <b>3 of the same</b>, and that jackpot is yours.',
      button: 'OPEN THE HOARD', auto: autoMs(3500),
    });
    await playHoardUi(outcome.hoard, bet, auto);
    running += coins(outcome.hoard.pay, bet);
    hud.setWin(running);
    fx.coinRain(outcome.hoard.tier === 'MINI' ? 1.5 : 3, 70);
  }

  // Must Hit By: a mystery award on top of everything else this spin.
  for (const a of outcome.mhbAwards) {
    const coins = Math.round(a.x * mhbBase);
    const { width, height } = fx.size;
    audio.thunder();
    for (let i = 0; i < 2; i++) setTimeout(() => { fx.lightning(Math.random() * width, 0, Math.random() * width, height * 0.7); fx.flash(0xffffff, 0.5, 0.35); }, i * 300);
    fx.shake(16);
    hud.mhbFlash(a.id);
    await wait(900);
    audio.fanfare('jackpot');
    fx.coinRain(3, 80);
    running += coins;
    hud.setWin(running);
    await hud.feature({
      cls: a.id === 'THUNDER' ? 'awake' : 'free', kicker: 'Must Hit By', title: a.name.toUpperCase(),
      img: a.id === 'THUNDER' ? 'hero_awakened.webp' : 'orb_grand.webp', countTo: coins, button: 'COLLECT', auto: autoMs(4500),
    });
  }
  hud.setMustHitBy(state.mhb, mhbBase, true);

  const hadFeature = !!outcome.base.holdSpin || outcome.freeGames.length > 0 || outcome.mhbAwards.length > 0 || !!outcome.hoard;
  if (!hadFeature && outcome.win >= bet * 15) {
    audio.fanfare('big');
    buzz([60, 40, 60]);
    fx.coinRain(Math.min(6, 1.5 + outcome.win / bet / 40), 70);
    await hud.bigWin(outcome.win, bet);
  }
  hud.setWin(outcome.win);
  // Bestiary captures and daily goals pay on top of the spin.
  const prog = record(progress, outcome, today());
  progress = prog.p;
  saveProgress();
  for (const r of prog.rewards) { grant(r.coins); toast(r); }
  renderGoals(progress);
  hud.setBalance(state.wallet.balance, true);
  busy = false;
  hud.setSpinEnabled(true);
  checkRefill();
}

async function spin(forced?: SpinOutcome) {
  if (busy) return;
  checkRefill();
  if (!canBet(state.wallet, state.bet)) {
    // Drop the multiplier first, then the denomination, to the biggest bet still affordable.
    const opts = DENOMS.filter((dn) => dn <= state.denom).flatMap((dn) => BET_MULTS.map((m) => [dn, m] as const))
      .filter(([dn, m]) => betFor(dn, m) <= state.wallet.balance && (dn < state.denom || m < state.mult));
    const pick = opts.sort((x, y) => (y[0] - x[0]) || (y[1] - x[1]))[0];
    if (!pick) { stopAuto(); return; }
    const switched = pick[0] !== state.denom;
    select(pick[0], pick[1]);
    refreshHud();
    if (switched) { stopAuto(); hud.banner('DENOM LOWERED', `Now playing ${fmtDenom(pick[0])}`, 1600); return; }
  }
  if (forced) { await play(forced); }
  else {
    const r = playDenomSpin(rng, state.denom, state.mult, state.meter, state.mhb, state.denoms[state.denom].streak);
    await play(r.outcome, r.streak);
  }
  if (auto) setTimeout(() => auto && spin(), 300);
}

/** Coins from the Bestiary, goals and streak go straight to the wallet. */
function grant(c: number) {
  const balance = state.wallet.balance + c;
  state.wallet = { ...state.wallet, balance, refillAt: balance >= BET_LEVELS[0] ? null : state.wallet.refillAt };
  save();
}

function dailyVisit() {
  progress = rollDay(progress, today());
  const r = login(progress, today());
  progress = r.p;
  saveProgress();
  renderGoals(progress);
  if (r.reward) { grant(r.reward); toast({ kind: 'streak', title: `Day ${progress.streak} streak`, coins: r.reward }); checkRefill(); }
}

function stopAuto() { auto = false; $('auto').classList.remove('on'); }

// ---------------- Playtest helpers (?debug) ----------------
function find(pred: (o: SpinOutcome) => boolean, meter: MeterState = state.meter): SpinOutcome | undefined {
  for (let i = 0; i < 2_000_000; i++) {
    const o = playDenomSpin(rng, state.denom, state.mult, meter, state.mhb, 'normal').outcome;
    if (pred(o)) return o;
  }
}

function force(kind: string) {
  if (busy) return;
  if (kind === 'coins') { state.wallet = { ...state.wallet, balance: state.wallet.balance + 50_000, refillAt: null }; checkRefill(); return; }
  if (kind === 'storm' || kind === 'thunder') {
    // Move the hidden hit point so this tier pays on the next spin.
    const id = kind === 'storm' ? 'STORM' : 'THUNDER';
    state.mhb = { ...state.mhb, [id]: { ...state.mhb[id], hitAt: state.mhb[id].value + 0.001 } };
    spin();
    return;
  }
  const charged = { points: METER_MAX, charged: true };
  const o =
    kind === 'hs' ? find((o) => !!o.base.holdSpin && !o.freeGames.length)
    : kind === 'hsbig' ? find((o) => (o.base.holdSpin?.steps.at(-1)?.unlockedRows ?? 0) >= 6)
    : kind === 'awake' ? find((o) => !!o.base.holdSpin, charged)
    : kind === 'fg' ? find((o) => o.freeGames.length > 0)
    : kind === 'doors' ? find((o) => !!o.freeGames[0]?.free?.door)
    : kind === 'hoard' ? find((o) => !!o.hoard)
    : kind === 'special' ? find((o) => new Set(o.base.holdSpin?.steps.flatMap((st) => st.landed.map((l) => l.orb.special).filter(Boolean)) ?? []).size >= 3)
    : kind === 'bank' ? find((o) => !!o.bank?.holdSpin)
    : kind === 'collector' ? find((o) => !!o.base.holdSpin?.steps.some((st) => st.landed.some((l) => l.orb.special === 'COLLECTOR')) && (o.base.holdSpin?.steps.length ?? 0) > 2)
    : undefined;
  if (o) spin(o);
}

// ---------------- Boot ----------------
/** Point each background layer at the portrait or landscape art for the current screen. */
function setBackgrounds() {
  const o = window.innerHeight >= window.innerWidth ? 'portrait' : 'landscape';
  document.querySelectorAll<HTMLElement>('.bgl').forEach((el) => {
    el.style.backgroundImage = `url("${artUrl(`bg_${el.dataset.t}_${o}.webp`)}")`;
  });
}

async function boot() {
  document.querySelectorAll<HTMLImageElement>('img[data-art]').forEach((img) => { img.src = artUrl(img.dataset.art!); });
  setBackgrounds();
  window.addEventListener('resize', setBackgrounds);
  preloadImages(['hero_awakened.webp', 'orb.webp', 'orb_grand.webp', 'sym_moongate.webp',
    ...['free', 'hold', 'awake'].map((t) => `bg_${t}_${window.innerHeight >= window.innerWidth ? 'portrait' : 'landscape'}.webp`)]);
  await loadArt((p) => { $('load-bar').style.width = `${Math.round(p * 100)}%`; });
  await board.init($('stage'));
  $('loading').classList.add('done');
  setTimeout(() => $('loading').remove(), 600);
  const first = playSpin(rng, state.bet, emptyMeter());
  board.showGrid(first.base.grid, orbMap(first.base), state.bet);

  // Audio can only start from a user gesture.
  const unlock = () => audio.unlock();
  window.addEventListener('pointerdown', unlock);
  window.addEventListener('keydown', unlock);
  // Coming back to the app: wake the audio again (phones suspend it in the background).
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') audio.unlock(); });
  $('sound').addEventListener('click', () => {
    const on = state.soundBy?.[screen] !== false;
    state.soundBy = { ...state.soundBy, [screen]: !on };
    applySound();
    save();
  });
  setMode('base');

  // Game rules: rebuilt each time so every prize shows at the current bet.
  $('bestiary-btn').addEventListener('click', () => { audio.click(); renderBestiary(progress); openModal('bestiary'); });
  $('goals-btn').addEventListener('click', () => { audio.click(); dailyVisit(); renderGoals(progress); openModal('goals'); });
  for (const id of ['bestiary', 'goals']) {
    $(id).addEventListener('click', (e) => {
      if (e.target === $(id) || (e.target as HTMLElement).closest('.pg-close')) { audio.click(); $(id).hidden = true; }
    });
  }
  dailyVisit();
  setupAttract({
    idle: () => !busy && !auto && [...document.querySelectorAll<HTMLElement>('.modal')].every((m) => m.hidden),
    jackpots: () => Object.fromEntries((['MINI', 'MINOR', 'MAJOR', 'GRAND'] as const).map((k) => [k, $(`jp-${k}`).textContent ?? ''])) as Record<'MINI' | 'MINOR' | 'MAJOR' | 'GRAND', string>,
    flourish: () => {
      const { width, height } = board.fx.size;
      board.fx.lightning(Math.random() * width, 0, Math.random() * width, height * 0.6);
      board.fx.coinBurst(width / 2, height / 2, 18);
    },
    onWake: () => audio.click(),
  });
  registerOffline(() => !busy && !auto);
  // A new day while the game is open still brings new goals and the streak bonus.
  setInterval(() => { if (!busy && progress.day !== today()) dailyVisit(); }, 60_000);
  $('rules-btn').addEventListener('click', () => {
    $('rules-body').innerHTML = rulesHtml(state.denom, state.mult);
    $('rules-body').scrollTop = 0;
    $('rules').hidden = false;
    audio.click();
  });
  $('rules-close').addEventListener('click', () => { $('rules').hidden = true; audio.click(); });
  $('rules').addEventListener('pointerdown', (e) => { if (e.target === $('rules')) $('rules').hidden = true; });

  $('spin').addEventListener('click', () => press());
  // Tapping the board also takes the next respin.
  $('stage').addEventListener('pointerdown', () => {
    if (respinWaiter && waitReady()) respinWaiter();
    else if (board.spinning) board.slam();
  });
  $('denom-btn').addEventListener('click', () => {
    if (busy) return;
    audio.click();
    stopAuto();
    state.meters[meterKey(state.denom, state.mult)] = state.meter;
    state.denoms[state.denom].mhb = state.mhb;
    renderDenoms({
      current: state.denom, mult: state.mult,
      mhb: (d) => state.denoms[d].mhb,
      meter: (d) => state.meters[meterKey(d, state.mult)] ?? emptyMeter(),
      hist: (d) => state.denoms[d].hist,
    });
    openModal('denoms');
  });
  $('denoms').addEventListener('click', (e) => {
    const t = e.target as HTMLElement;
    const card = t.closest<HTMLElement>('.dn');
    if (card) {
      audio.click();
      select(Number(card.dataset.d), state.mult);
      save();
      refreshHud();
      $('denoms').hidden = true;
      hud.banner(`${fmtDenom(state.denom)} DENOM`, `${fmtFull(state.bet)} per spin`, 1100);
    } else if (t === $('denoms') || t.closest('.pg-close')) { audio.click(); $('denoms').hidden = true; }
  });
  $('bet-down').addEventListener('click', () => changeBet(-1));
  $('bet-up').addEventListener('click', () => changeBet(1));
  $('turbo').addEventListener('click', () => { state.turbo = !state.turbo; save(); setSpeed(state.turbo); });
  $('auto').addEventListener('click', () => {
    auto = !auto;
    $('auto').classList.toggle('on', auto);
    if (auto) press();
  });
  $('wake').addEventListener('click', () => {
    state.wallet = earlyRefill(state.wallet, today());
    checkRefill();
  });
  window.addEventListener('keydown', (e) => {
    if (e.code === 'Escape') $('rules').hidden = true;
    if (e.code === 'Space' && $('rules').hidden) { e.preventDefault(); press(); }
  });

  // Playtest bar: tap the logo 5 times quickly to show or hide it (remembered on this device),
  // or open the page with #debug.
  $('debug').addEventListener('click', (e) => {
    const k = (e.target as HTMLElement).dataset.force;
    if (k) force(k);
  });
  const showDebug = (on: boolean) => {
    $('debug').hidden = !on;
    try { localStorage.setItem('mythbound.debug', on ? '1' : '0'); } catch { /* ignore */ }
  };
  let debugOn = location.hash === '#debug' || new URLSearchParams(location.search).has('debug');
  try { debugOn ||= localStorage.getItem('mythbound.debug') === '1'; } catch { /* ignore */ }
  $('debug').hidden = !debugOn;
  let taps: number[] = [];
  $('logo').addEventListener('pointerdown', () => {
    const now = performance.now();
    taps = [...taps.filter((t) => now - t < 2000), now];
    if (taps.length >= 5) {
      taps = [];
      showDebug($('debug').hidden === true);
      audio.click();
      hud.banner($('debug').hidden ? 'PLAYTEST OFF' : 'PLAYTEST ON', '', 900);
    }
  });

  checkRefill();
  setInterval(checkRefill, 1000);
  hud.setSpinEnabled(true);
  (window as unknown as { __mythbound: object }).__mythbound = { state, select, force, board, hud, REFILL_AMOUNT, progress: () => progress };
}

function changeBet(dir: number) {
  if (busy) return;
  select(state.denom, Math.min(BET_MULTS.length, Math.max(1, state.mult + dir)));
  save();
  refreshHud();
}

boot();
