import gsap from 'gsap';
import { GRAND_AWAKENED, JACKPOT_PAY, METER_MAX, MHB_TIERS } from '../math/config';
import type { MhbState } from '../math/mhb';
import type { MeterState } from '../math/game';
import { fmtCoins, fmtDenom, fmtFull, wait } from './fmt';
import { audio } from './audio';
import { artUrl } from './art';

export interface FeatureCard {
  cls?: string;
  kicker?: string;
  title: string;
  sub?: string;
  /** Count the sub line up to this number of coins. */
  countTo?: number;
  detail?: string;
  /** Art file shown above the title, e.g. 'orb_grand.webp'. */
  img?: string;
  button?: string;
  /** Continue on its own after this many ms (used by autoplay). */
  auto?: number;
}

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;

export class Hud {
  private winValue = { v: 0 };
  private balValue = { v: 0 };
  speed = 1;

  setBalance(n: number, animate = false) {
    const el = $('balance');
    gsap.killTweensOf(this.balValue);
    if (!animate) { this.balValue.v = n; el.textContent = fmtFull(n); return; }
    gsap.to(this.balValue, { v: n, duration: 0.8, ease: 'power1.out', onUpdate: () => { el.textContent = fmtFull(this.balValue.v); } });
  }

  setWin(n: number, duration = 0.4) {
    const el = $('win');
    gsap.killTweensOf(this.winValue);
    if (n === 0 || duration === 0) { this.winValue.v = n; el.textContent = fmtFull(n); return; }
    return gsap.to(this.winValue, { v: n, duration, ease: 'power1.out', onUpdate: () => { el.textContent = fmtFull(this.winValue.v); audio.tick(); } });
  }

  setBet(bet: number, denom: number, mult: number, canDown: boolean, canUp: boolean) {
    $('bet').textContent = fmtCoins(bet);
    $('bet-label').textContent = `BET ${mult}x`;
    $('denom-btn').innerHTML = `<small>DENOM</small>${fmtDenom(denom)}`;
    $<HTMLButtonElement>('bet-down').disabled = !canDown;
    $<HTMLButtonElement>('bet-up').disabled = !canUp;
  }

  setJackpots(bet: number, awakened: boolean) {
    for (const k of ['MINI', 'MINOR', 'MAJOR'] as const) $(`jp-${k}`).textContent = fmtCoins(JACKPOT_PAY[k] * bet);
    $('jp-GRAND').textContent = fmtCoins((awakened ? GRAND_AWAKENED : JACKPOT_PAY.GRAND) * bet);
    document.querySelector('.jp.grand')!.classList.toggle('awakened', awakened);
  }

  private mhbShown: Record<string, { v: number }> = {};
  /** Must Hit By meters: current value, cap and how close it is (all shown at the current bet). */
  setMustHitBy(state: MhbState, bet: number, animate = false) {
    for (const t of MHB_TIERS) {
      const el = $(`mhb-${t.id}`);
      const m = state[t.id];
      const value = Math.floor(m.value * bet);
      const shown = (this.mhbShown[t.id] ??= { v: value });
      const b = el.querySelector('b')!;
      gsap.killTweensOf(shown);
      if (animate) gsap.to(shown, { v: value, duration: 0.6, onUpdate: () => { b.textContent = fmtCoins(Math.floor(shown.v)); } });
      else { shown.v = value; b.textContent = fmtCoins(value); }
      el.querySelector('i')!.textContent = fmtCoins(t.cap * bet);
      const pct = (m.value - t.seed) / (t.cap - t.seed);
      (el.querySelector('.fill') as HTMLElement).style.width = `${Math.min(100, pct * 100)}%`;
      el.classList.toggle('near', pct > 0.85);
      el.title = `${t.name}: grows with every spin and is guaranteed to pay before it reaches ${fmtCoins(t.cap * bet)}.`;
    }
  }

  mhbFlash(id: string) {
    const el = $(`mhb-${id}`);
    el.classList.remove('hit'); void el.offsetWidth; el.classList.add('hit');
  }

  setMeter(m: MeterState) {
    const pct = m.charged ? 100 : Math.floor((100 * m.points) / METER_MAX);
    $('meter-fill').style.width = `${pct}%`;
    $('meter-label').textContent = m.charged ? 'THE BEAST IS AWAKE — NEXT HOLD & SPIN' : `BEAST AWAKENING ${pct}%`;
    $('meter').classList.toggle('charged', m.charged);
    $('meter-row').classList.toggle('charged', m.charged);
    const hero = $<HTMLImageElement>('meter-hero');
    const want = artUrl(m.charged ? 'hero_awakened.webp' : 'hero_dormant.webp');
    if (hero.src !== want) hero.src = want;
  }

  status(text: string | null) {
    const el = $('status');
    el.hidden = !text;
    el.className = '';
    if (text) el.textContent = text;
  }

  /** Big respin lights for hold & spin. reset = an orb landed and the count went back up. */
  respins(n: number, rows: number, maxRows: number, reset = false) {
    const el = $('status');
    const pips = Array.from({ length: Math.max(3, n) }, (_, i) => `<i class="pip${i < n ? ' on' : ''}"></i>`).join('');
    el.innerHTML = `<span class="lbl">RESPINS</span>${pips}<span class="rows">ROWS ${rows}/${maxRows}</span>`;
    el.className = `hs${n <= 1 ? ' last' : ''}`;
    if (reset) { void el.offsetWidth; el.classList.add('reset'); }
    el.hidden = false;
  }

  /** Show a center banner for a moment. Tap to skip. */
  async banner(title: string, sub = '', ms = 1600, cls = '') {
    const el = $('banner');
    $('banner-title').textContent = title;
    $('banner-sub').textContent = sub;
    el.className = cls;
    el.hidden = false;
    // Restart the pop animation.
    const t = $('banner-title');
    t.style.animation = 'none'; void t.offsetWidth; t.style.animation = '';
    await new Promise<void>((resolve) => {
      const done = () => { el.removeEventListener('pointerdown', done); clearTimeout(timer); resolve(); };
      const timer = setTimeout(done, ms * this.speed);
      el.addEventListener('pointerdown', done);
    });
    el.hidden = true;
  }

  /** Big win celebration with a counting total. */
  async bigWin(amount: number, bet: number) {
    const x = amount / bet;
    const tier = x >= 150 ? 'EPIC WIN' : x >= 50 ? 'MEGA WIN' : 'BIG WIN';
    const el = $('banner');
    $('banner-title').textContent = tier;
    el.className = '';
    el.hidden = false;
    const sub = $('banner-sub');
    const counter = { v: 0 };
    const dur = Math.min(6, 1.5 + x / 40) * this.speed;
    let skip = false;
    const onTap = () => { skip = true; };
    el.addEventListener('pointerdown', onTap);
    const tween = gsap.to(counter, { v: amount, duration: dur, ease: 'power1.out', onUpdate: () => { sub.textContent = fmtFull(counter.v); audio.tick(); } });
    while (!skip && tween.isActive()) await wait(50);
    tween.progress(1);
    sub.textContent = fmtFull(amount);
    await wait((skip ? 500 : 1200) * this.speed);
    el.removeEventListener('pointerdown', onTap);
    el.hidden = true;
  }

  /** Shrink a title until its longest word fits the card (titles may wrap between words, never inside one). */
  private fitTitle(title: HTMLElement, card: HTMLElement) {
    title.style.fontSize = '';
    const avail = card.clientWidth - 40;
    let size = parseFloat(getComputedStyle(title).fontSize);
    const words = (title.textContent ?? '').split(/\s+/);
    const probe = document.createElement('span');
    probe.style.cssText = 'position:absolute;visibility:hidden;white-space:nowrap;font-weight:900;letter-spacing:1px;';
    probe.style.fontFamily = getComputedStyle(title).fontFamily;
    document.body.appendChild(probe);
    const widest = () => Math.max(...words.map((w) => { probe.textContent = w; probe.style.fontSize = `${size}px`; return probe.offsetWidth; }));
    while (size > 22 && widest() * 1.1 > avail) size -= 2;
    probe.remove();
    title.style.fontSize = `${size}px`;
  }

  /** Full-screen feature intro/outro. Waits for a tap (or the auto timer). */
  async feature(o: FeatureCard) {
    const el = $('feature');
    const q = (c: string) => el.querySelector(c) as HTMLElement;
    el.className = `modal feature ${o.cls ?? ''}`;
    q('.f-kicker').textContent = o.kicker ?? '';
    const title = q('.f-title');
    title.textContent = o.title;
    q('.f-sub').textContent = o.countTo !== undefined ? '0' : (o.sub ?? '');
    q('.f-detail').innerHTML = o.detail ?? '';
    const img = q('.f-img') as HTMLImageElement;
    img.hidden = !o.img;
    if (o.img) img.src = artUrl(o.img);
    const btn = q('.f-go');
    btn.textContent = o.button ?? 'TAP TO CONTINUE';
    btn.style.visibility = 'hidden';
    const card = q('.f-card');
    card.style.animation = 'none'; void card.offsetWidth; card.style.animation = '';
    el.hidden = false;
    this.fitTitle(title, q('.f-card'));

    let counting: gsap.core.Tween | undefined;
    if (o.countTo !== undefined) {
      const c = { v: 0 }, sub = q('.f-sub'), target = o.countTo;
      counting = gsap.to(c, {
        v: target, duration: Math.min(3.5, 1 + target / 20000), ease: 'power1.out', delay: 0.4,
        onUpdate: () => { sub.textContent = fmtFull(c.v); audio.tick(); },
      });
    }
    await wait(700);
    btn.style.visibility = 'visible';
    await new Promise<void>((resolve) => {
      let timer = 0;
      const done = () => {
        if (counting?.isActive()) { counting.progress(1); return; } // first tap finishes the count
        el.removeEventListener('pointerdown', done);
        clearTimeout(timer);
        resolve();
      };
      el.addEventListener('pointerdown', done);
      if (o.auto) timer = window.setTimeout(() => { counting?.progress(1); counting = undefined; done(); }, o.auto);
    });
    audio.click();
    el.hidden = true;
  }

  /** Turn the spin button into a glowing RESPIN button (or back to SPIN). */
  setRespinMode(on: boolean, last = false, label = 'RESPIN') {
    const b = $<HTMLButtonElement>('spin');
    b.textContent = on ? label : 'SPIN';
    b.classList.toggle('two', on && label.includes(' '));
    b.classList.toggle('respin', on);
    b.classList.toggle('last', on && last);
    b.disabled = !on && b.disabled;
    if (on) b.disabled = false;
  }

  /** While reels spin the button reads STOP and a tap slams them to a halt. */
  setStopMode(on: boolean) {
    const b = $<HTMLButtonElement>('spin');
    if (b.classList.contains('respin')) return;
    b.textContent = on ? 'STOP' : 'SPIN';
    b.classList.toggle('stop', on);
    b.disabled = !on;
  }

  setSpinEnabled(on: boolean) {
    $<HTMLButtonElement>('spin').disabled = !on;
  }
}
