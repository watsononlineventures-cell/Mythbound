/** Cabinet mode: full screen, screen kept awake, and an attract screen when nobody is playing. */
const $ = (id: string) => document.getElementById(id) as HTMLElement;

let wakeLock: { release(): Promise<void> } | null = null;
async function keepAwake(on: boolean) {
  try {
    if (on && !wakeLock && 'wakeLock' in navigator) {
      wakeLock = await (navigator as unknown as { wakeLock: { request(t: string): Promise<{ release(): Promise<void> }> } }).wakeLock.request('screen');
      (wakeLock as unknown as EventTarget).addEventListener?.('release', () => { wakeLock = null; });
    } else if (!on && wakeLock) { await wakeLock.release(); wakeLock = null; }
  } catch { wakeLock = null; }
}

const isFull = () => !!document.fullscreenElement;
export const cabinetOn = () => isFull() || matchMedia('(display-mode: fullscreen), (display-mode: standalone)').matches;

/** Called from a click: enters or leaves full screen. */
export async function toggleCabinet() {
  try {
    if (isFull()) await document.exitFullscreen();
    else await document.documentElement.requestFullscreen({ navigationUI: 'hide' });
  } catch { /* not allowed here (e.g. inside a frame); the button still toggles the attract screen */ }
  sync();
}

function sync() {
  $('cabinet-btn').classList.toggle('on', cabinetOn());
  keepAwake(cabinetOn());
}

const TAGS = ['Hold & Spin for four jackpots', 'Free games with sticky wilds', 'Two Must Hit By jackpots', "Find the Thunderbird's Hoard", 'Wake the beast'];

export interface AttractHooks { idle: () => boolean; jackpots: () => Record<'MINI' | 'MINOR' | 'MAJOR' | 'GRAND', string>; flourish: () => void; onWake: () => void }

/** Show the attract screen after `ms` with no input while idle. */
export function setupAttract(h: AttractHooks, ms = 60_000) {
  let last = Date.now();
  let tagI = 0;
  let tagTimer = 0;
  const el = $('attract');
  const bump = () => { last = Date.now(); };
  for (const ev of ['pointerdown', 'keydown', 'wheel']) window.addEventListener(ev, bump, { capture: true, passive: true });
  const show = () => {
    const j = h.jackpots();
    for (const k of ['MINI', 'MINOR', 'MAJOR', 'GRAND'] as const) $(`a-${k}`).textContent = j[k];
    el.hidden = false;
    tagTimer = window.setInterval(() => {
      const t = $('a-tag');
      t.style.opacity = '0';
      setTimeout(() => { t.textContent = TAGS[(tagI = (tagI + 1) % TAGS.length)]; t.style.opacity = '1'; }, 400);
      h.flourish();
    }, 4000);
  };
  const hide = () => { el.hidden = true; clearInterval(tagTimer); h.onWake(); };
  el.addEventListener('pointerdown', (e) => { e.stopPropagation(); hide(); bump(); });
  window.addEventListener('keydown', () => { if (!el.hidden) hide(); }, { capture: true });
  setInterval(() => { if (el.hidden && Date.now() - last > ms && h.idle()) show(); }, 2000);
  document.addEventListener('fullscreenchange', sync);
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') sync(); });
  $('cabinet-btn').addEventListener('click', toggleCabinet);
  sync();
}

/**
 * Offline install support. When a newer version has been downloaded, the game reloads into it
 * the next time it's idle. Hosts that refuse service workers (like the claude.ai preview) skip this.
 */
export function registerOffline(isIdle: () => boolean) {
  try {
    if (!('serviceWorker' in navigator) || (location.protocol !== 'https:' && location.hostname !== 'localhost')) return;
    const hadController = !!navigator.serviceWorker.controller;
    navigator.serviceWorker.register('./sw.js').catch(() => { /* not allowed on this host */ });
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (!hadController) return; // first install, nothing to update
      const tryReload = () => { if (isIdle()) location.reload(); else setTimeout(tryReload, 2000); };
      tryReload();
    });
  } catch { /* ignore */ }
}
