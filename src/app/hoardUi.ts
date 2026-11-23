import gsap from 'gsap';
import { JACKPOT_PAY, type Jackpot } from '../math/config';
import { HOARD_TIERS, type HoardResult } from '../math/hoard';
import { artUrl } from './art';
import { audio } from './audio';
import { buzz } from './haptics';
import { fmtCoins, fmtFull, wait } from './fmt';

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const ORB_ART: Record<Jackpot, string> = {
  MINI: 'orb_mini.webp', MINOR: 'orb_minor.webp', MAJOR: 'orb_major.webp', GRAND: 'orb_grand.webp',
};

/**
 * The Thunderbird's Hoard pick screen. Every pick reveals the next jackpot in the predetermined
 * order (whichever orb is tapped), until one jackpot shows three times.
 * With `auto`, picks are made on their own.
 */
export async function playHoardUi(h: HoardResult, bet: number, auto: boolean): Promise<void> {
  const root = $('hoard');
  const grid = $('hoard-grid');
  const tally = $('hoard-tally');
  const msg = $('hoard-msg');
  const done = $<HTMLButtonElement>('hoard-done');
  const counts = new Map<Jackpot, number>(HOARD_TIERS.map((t) => [t, 0]));

  tally.innerHTML = HOARD_TIERS.map((t) => `<div class="ht ${t.toLowerCase()}" data-t="${t}">
    <span>${t}</span><b>${fmtCoins(JACKPOT_PAY[t] * bet)}</b><i class="dots"><em></em><em></em><em></em></i></div>`).join('');
  grid.innerHTML = Array.from({ length: 12 }, (_, i) => `<button class="hc" data-i="${i}" aria-label="Hidden orb">
    <div class="face"><img src="${artUrl('orb.webp')}" alt="" /><span class="q">?</span><span class="lbl"></span></div></button>`).join('');
  msg.textContent = 'Pick an orb. Find 3 of the same jackpot to win it!';
  done.hidden = true;
  root.hidden = false;
  gsap.fromTo('#hoard .hc', { scale: 0, rotate: -20 }, { scale: 1, rotate: 0, duration: 0.4, stagger: 0.04, ease: 'back.out(2)' });

  // Squash flat, swap to the jackpot art, and spring back open.
  const reveal = (btn: HTMLElement, t: Jackpot, dim = false) => {
    btn.classList.add('flipped');
    btn.setAttribute('disabled', '');
    const face = btn.querySelector('.face') as HTMLElement;
    gsap.timeline()
      .to(face, { scaleX: 0, duration: 0.14, ease: 'power2.in' })
      .add(() => {
        (face.querySelector('img') as HTMLImageElement).src = artUrl(ORB_ART[t]);
        (face.querySelector('.lbl') as HTMLElement).textContent = t;
        btn.classList.add('open', t.toLowerCase());
        if (dim) btn.classList.add('dim');
      })
      .to(face, { scaleX: 1, duration: 0.22, ease: 'back.out(2)' });
  };

  let n = 0;
  await new Promise<void>((resolve) => {
    let busy = false;
    let timer = 0;
    const pick = async (btn: HTMLElement) => {
      if (busy || btn.classList.contains('flipped') || n >= h.picks.length) return;
      busy = true;
      const t = h.picks[n++];
      reveal(btn, t);
      const c = counts.get(t)! + 1;
      counts.set(t, c);
      audio.orbLand(c * 3 + (t === 'GRAND' ? 4 : 0));
      buzz(20);
      const chip = tally.querySelector(`[data-t="${t}"]`) as HTMLElement;
      chip.querySelectorAll('em')[c - 1]?.classList.add('on');
      gsap.fromTo(chip, { scale: 1.15 }, { scale: 1, duration: 0.35 });
      if (c === 2) { chip.classList.add('hot'); msg.textContent = `One more ${t} wins it!`; }
      await wait(350);
      busy = false;
      if (n >= h.picks.length) { clearInterval(timer); resolve(); }
    };
    grid.onclick = (e) => {
      const btn = (e.target as HTMLElement).closest('.hc') as HTMLElement | null;
      if (btn) pick(btn);
    };
    if (auto) {
      timer = window.setInterval(() => {
        const free = [...grid.querySelectorAll<HTMLElement>('.hc:not(.flipped)')];
        if (free.length) pick(free[Math.floor(Math.random() * free.length)]);
      }, 750);
    }
  });

  // The match: highlight the three winners, then show what the other orbs held.
  grid.onclick = null;
  const tier = h.tier;
  grid.querySelectorAll<HTMLElement>(`.hc.open.${tier.toLowerCase()}`).forEach((b) => b.classList.add('win'));
  tally.querySelector(`[data-t="${tier}"]`)!.classList.add('won');
  audio.fanfare('jackpot');
  buzz([80, 40, 80, 40, 160]);
  msg.innerHTML = `<b>${tier}</b> — ${fmtFull(JACKPOT_PAY[tier] * bet)}`;
  await wait(900);
  const rest = [...grid.querySelectorAll<HTMLElement>('.hc:not(.flipped)')];
  rest.forEach((b, i) => setTimeout(() => reveal(b, h.rest[i], true), i * 90));
  await wait(rest.length * 90 + 500);

  done.hidden = false;
  await new Promise<void>((resolve) => {
    let timer = 0;
    const go = () => { clearTimeout(timer); done.onclick = null; resolve(); };
    done.onclick = go;
    if (auto) timer = window.setTimeout(go, 2500);
  });
  audio.click();
  root.hidden = true;
}
