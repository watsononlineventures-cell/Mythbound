import gsap from 'gsap';
import { ALL_GOALS_BONUS, BESTIARY, BESTIARY_COMPLETE_PRIZE, STREAK_REWARDS, type Progress, type Reward } from '../math/progress';
import { artUrl } from './art';
import { audio } from './audio';
import { buzz } from './haptics';
import { fmtCoins } from './fmt';

const $ = (id: string) => document.getElementById(id) as HTMLElement;
const n = (cents: number) => fmtCoins(cents);

export function renderBestiary(p: Progress) {
  const got = BESTIARY.filter((e) => p.caught[e.id]).length;
  $('bestiary-count').textContent = `${got} of ${BESTIARY.length} found`;
  $('bestiary-fill').style.width = `${(got / BESTIARY.length) * 100}%`;
  $('bestiary-prize').innerHTML = p.complete
    ? 'Complete! Every beast is found.'
    : `Find them all for <b>${n(BESTIARY_COMPLETE_PRIZE)}</b>`;
  $('bestiary-grid').innerHTML = BESTIARY.map((e) => {
    const when = p.caught[e.id];
    return `<div class="be ${when ? 'got' : 'locked'}">
      <div class="be-img"><img src="${artUrl(e.art + '.webp')}" alt="" />${when ? '' : '<span>?</span>'}</div>
      <h4>${when ? e.name : '???'}</h4>
      <p>${e.how}</p>
      <b>${when ? 'Found' : `+${n(e.reward)}`}</b></div>`;
  }).join('');
}

export function renderGoals(p: Progress) {
  $('goals-list').innerHTML = p.goals.map((g) => `<div class="goal ${g.done ? 'done' : ''}">
      <div class="g-top"><span>${g.text}</span><b>${g.done ? '✓' : `+${n(g.reward)}`}</b></div>
      <div class="g-bar"><i style="width:${(g.have / g.target) * 100}%"></i></div>
      <small>${n(g.have)} / ${n(g.target)}</small></div>`).join('')
    + `<div class="goal bonus ${p.allDone ? 'done' : ''}"><div class="g-top"><span>Finish all three</span><b>${p.allDone ? '✓' : `+${n(ALL_GOALS_BONUS)}`}</b></div></div>`;
  $('streak-row').innerHTML = STREAK_REWARDS.map((r, i) => {
    const cls = i + 1 < p.streak ? 'past' : i + 1 === p.streak ? 'today' : '';
    return `<div class="sd ${cls}"><span>Day ${i + 1}</span><b>${fmtCoins(r)}</b></div>`;
  }).join('');
  const left = p.goals.filter((g) => !g.done).length;
  $('goals-btn').classList.toggle('badge', left > 0);
}

let queue: Promise<void> = Promise.resolve();

/** Toasts slide in one after another at the top of the screen. */
export function toast(r: Reward | { kind: 'streak'; title: string; coins: number; art?: string }) {
  queue = queue.then(() => new Promise<void>((resolve) => {
    const el = document.createElement('div');
    el.className = `toast ${r.kind}`;
    const label = { beast: 'BESTIARY', bestiary: 'BESTIARY COMPLETE', goal: 'DAILY GOAL', allGoals: 'ALL GOALS DONE', streak: 'DAILY BONUS' }[r.kind];
    el.innerHTML = `${r.art ? `<img src="${artUrl(r.art + '.webp')}" alt="" />` : '<i>★</i>'}
      <div><small>${label}</small><span>${r.title}</span></div><b>+${n(r.coins)}</b>`;
    $('toasts').appendChild(el);
    audio.chime();
    buzz(30);
    gsap.timeline({ onComplete: () => { el.remove(); resolve(); } })
      .fromTo(el, { y: -80, opacity: 0 }, { y: 0, opacity: 1, duration: 0.4, ease: 'back.out(1.6)' })
      .to(el, { y: -80, opacity: 0, duration: 0.3, delay: 2.4 });
  }));
}

export function openModal(id: string) { $(id).hidden = false; gsap.fromTo(`#${id} > div`, { scale: 0.9, opacity: 0 }, { scale: 1, opacity: 1, duration: 0.25 }); }
