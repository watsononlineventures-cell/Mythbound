import { Application, Container, Graphics, Rectangle, Sprite, Text, TilingSprite, type Texture } from 'pixi.js';
import { art } from './art';
import gsap from 'gsap';
import { JACKPOT_PAY, REELS, ROWS, type Sym } from '../math/config';
import { drawOrbPrize, type HoldSpinResult, type Orb } from '../math/holdSpin';
import { LINES, type LineWin } from '../math/lines';
import type { Grid } from '../math/reels';
import { cryptoRng } from '../math/rng';
import { CELL, makeEmptySlot, makeOrb, makeSymbol, orbText, setOrbValue } from './symbols';
import { rowsForCount } from '../math/holdSpin';
import { buzz } from './haptics';
import { fmtCoins, wait } from './fmt';
import { Fx } from './fx';
import { audio } from './audio';

const LINE_COLORS = [0xffd34d, 0x3aa7ff, 0xff4fa3, 0x2fd3b0, 0x9b7bff, 0xe8664a];

export interface HoldSpinHooks {
  respins(n: number, rows: number, maxRows: number, reset: boolean): void;
  /** Resolves when the player asks for the next respin. */
  nextRespin(left: number): Promise<void>;
  /** A special orb landed: show its call-out (resolves when it's done). */
  special(kind: string): Promise<void>;
  collected(totalCoins: number): void;
  jackpot(name: string, coins: number): Promise<void>;
}

/** Visual row for a hold & spin board row: base rows sit at the bottom, unlocked rows stack above. */
const visualRow = (r: number, unlocked: number) => (r < ROWS ? unlocked - ROWS + r : unlocked - 1 - r);

export class Board {
  app = new Application();
  private root = new Container();
  private base = new Container();
  private reelCols: Container[] = [];
  private views: Container[][] = []; // [reel][row]
  private lines = new Graphics();
  private hs = new Container();
  private contentRows = ROWS;
  private grid: Grid = [];
  private glow = new Graphics();
  /** Wilds stuck in place during free games, keyed by cell (row * 5 + reel). */
  private stickyLayer = new Container();
  private sticky = new Map<number, Container>(); // cell -> its tile (stacked cells share one)
  private stickyCells = new Set<number>();
  private floatLayer = new Container();
  fx!: Fx;
  speed = 1;

  async init(el: HTMLElement) {
    await this.app.init({
      resizeTo: el, backgroundAlpha: 0, antialias: true,
      resolution: Math.min(window.devicePixelRatio || 1, 2), autoDensity: true,
    });
    el.appendChild(this.app.canvas);
    this.app.stage.addChild(this.root);
    this.root.addChild(this.base, this.hs);

    this.base.addChild(makeFrame(REELS * CELL, ROWS * CELL));
    for (let r = 0; r < REELS; r++) {
      const reel = new Container();
      reel.x = r * CELL;
      const mask = new Graphics().rect(0, 0, CELL, ROWS * CELL).fill(0xffffff);
      const col = new Container();
      reel.addChild(mask, col);
      reel.mask = mask;
      this.base.addChild(reel);
      this.reelCols.push(col);
      this.views.push([]);
    }
    this.base.addChild(this.stickyLayer, this.lines, this.glow, this.floatLayer);
    this.fx = new Fx(this.app);
    this.fx.init();
    new ResizeObserver(() => { this.app.resize(); this.fit(false); }).observe(el);
    this.fit(false);
  }

  /** Scale and center the board in the stage. */
  fit(animate = true) {
    const { width, height } = this.app.screen;
    const top = 44; // room for the status pill
    const w = REELS * CELL + 44, h = this.contentRows * CELL + 44;
    const s = Math.min(width / w, (height - top) / h, 1.6);
    const x = (width - REELS * CELL * s) / 2;
    const y = top + (height - top - this.contentRows * CELL * s) / 2;
    if (animate) gsap.to(this.root, { x, y, duration: 0.4, ease: 'power2.out' }), gsap.to(this.root.scale, { x: s, y: s, duration: 0.4 });
    else { this.root.position.set(x, y); this.root.scale.set(s); }
  }

  private place(view: Container, x: number, y: number) {
    view.pivot.set(CELL / 2);
    view.position.set(x + CELL / 2, y + CELL / 2);
  }

  /** Draw a static grid (used at startup). */
  showGrid(grid: Grid, orbs: Map<number, Orb>, bet: number) {
    this.grid = grid;
    for (let r = 0; r < REELS; r++) {
      const col = this.reelCols[r];
      col.removeChildren().forEach((c) => c.destroy({ children: true }));
      col.y = 0;
      this.views[r] = grid[r].map((sym, row) => {
        const v = makeSymbol(sym, orbs.get(row * REELS + r), bet);
        this.place(v, 0, row * CELL);
        col.addChild(v);
        return v;
      });
    }
  }

  /** Spin the reels to land on the given grid. */
  async spin(
    grid: Grid, orbs: Map<number, Orb>, bet: number, strips: Sym[][],
    opts: { anticipate?: number; onStop?: (reel: number) => void } = {},
  ) {
    this.lines.clear();
    this.grid = grid;
    const extra = 1.9; // seconds of anticipation on the teased reel
    const rng = cryptoRng();
    const tweens: Promise<unknown>[] = [];
    for (let r = 0; r < REELS; r++) {
      const col = this.reelCols[r];
      const old = [...col.children];
      const finals = grid[r].map((sym, row) => makeSymbol(sym, orbs.get(row * REELS + r), bet));
      const teased = opts.anticipate === r;
      const fillerCount = Math.round((8 + r * 4) * this.speed) + (teased ? 22 : 0);
      const strip = strips[r];
      const start = Math.floor(rng.next() * strip.length);
      const filler = Array.from({ length: fillerCount }, (_, i) => {
        const sym = strip[(start + i) % strip.length];
        return makeSymbol(sym, sym === 'O' ? drawOrbPrize(rng, false) : undefined, bet);
      });
      const stack = [...finals, ...filler];
      stack.forEach((v, i) => { this.place(v, 0, i * CELL); col.addChild(v); });
      old.forEach((v, i) => { v.y = (stack.length + i) * CELL + CELL / 2; });
      col.y = -stack.length * CELL;
      const tw = gsap.to(col, {
        y: 0, duration: (0.55 + r * 0.17) * this.speed + (teased ? extra : 0), ease: 'back.out(0.55)',
      });
      this.spinTweens.push(tw);
      tweens.push(
        tw.then(() => {
          [...filler, ...old].forEach((v) => { col.removeChild(v); v.destroy({ children: true }); });
          if (teased) this.stopGlow();
          opts.onStop?.(r);
        }),
      );
      this.views[r] = finals;
    }
    this.hurry = false;
    this.spinning = true;
    if (opts.anticipate !== undefined) {
      const r = opts.anticipate;
      this.glowCall = gsap.delayedCall((0.55 + (r - 1) * 0.17) * this.speed, () => { if (!this.hurry) this.startGlow(r, extra); });
    }
    await Promise.all(tweens);
    this.spinning = false;
    this.spinTweens = [];
    this.applyStacks();
  }

  /** A reel showing three wilds becomes one tall pillar of wild energy. */
  private applyStacks() {
    const tall = art('sym_wild_stack');
    if (!tall) return;
    this.grid.forEach((col, r) => {
      if (!col.every((s) => s === 'W')) return;
      const reel = this.reelCols[r];
      const pillar = new Container();
      const sp = new Sprite(tall);
      sp.anchor.set(0.5);
      sp.scale.set(Math.min((CELL - 4) / tall.width, (ROWS * CELL - 6) / tall.height));
      sp.position.set(CELL / 2, (ROWS * CELL) / 2);
      const plate = new Graphics().roundRect(CELL / 2 - 34, ROWS * CELL - 36, 68, 24, 12).fill({ color: 0x3a0a28, alpha: 0.92 }).stroke({ color: 0xff4fa3, width: 2 });
      const word = new Text({ text: 'WILD', style: { fontFamily: 'system-ui, sans-serif', fontSize: 16, fontWeight: '900', fill: 0xffe3f2, letterSpacing: 2 } });
      word.anchor.set(0.5);
      word.position.set(CELL / 2, ROWS * CELL - 24);
      pillar.addChild(sp, plate, word);
      for (const v of this.views[r]) v.visible = false;
      reel.addChild(pillar);
      pillar.alpha = 0;
      gsap.to(pillar, { alpha: 1, duration: 0.25 });
      const p = sp.getGlobalPosition();
      this.fx.sparks(p.x, p.y, 20, 0xff4fa3, 260);
      this.fx.ring(p.x, p.y, 0xff4fa3, 90 * this.root.scale.x);
    });
  }

  private glowTween?: gsap.core.Tween;
  private glowCall?: gsap.core.Tween;
  private spinTweens: gsap.core.Tween[] = [];
  /** True while reels are moving (a tap then stops them). */
  spinning = false;
  /** Set by a slam-stop: skip the long win-line tour for this spin. */
  private hurry = false;

  /** Tap to stop: every reel still moving races to its stop. */
  slam() {
    if (!this.spinning) return;
    this.hurry = true;
    this.glowCall?.kill();
    for (const t of this.spinTweens) if (t.isActive()) t.timeScale(Math.max(6, t.duration() / 0.12));
  }
  private startGlow(reel: number, seconds: number) {
    this.glow.clear()
      .roundRect(reel * CELL - 4, -6, CELL + 8, ROWS * CELL + 12, 14).stroke({ color: 0xffd34d, width: 8, alpha: 0.9 })
      .roundRect(reel * CELL - 10, -12, CELL + 20, ROWS * CELL + 24, 18).stroke({ color: 0xff8a00, width: 5, alpha: 0.5 });
    this.glow.alpha = 1;
    this.glowTween = gsap.to(this.glow, { alpha: 0.35, duration: 0.18, yoyo: true, repeat: -1 });
    audio.anticipation(seconds);
  }
  private stopGlow() {
    this.glowTween?.kill();
    this.glow.clear();
  }

  /** The view showing a cell: a sticky wild if one sits there, otherwise the reel symbol. */
  private viewAt(reel: number, row: number): Container {
    return this.sticky.get(row * REELS + reel) ?? this.views[reel][row];
  }

  /** Open every mystery door on screen to reveal the same symbol. */
  async openDoors(revealed: Grid, orbs: Map<number, Orb>, bet: number) {
    const doors: { reel: number; row: number; v: Container }[] = [];
    this.views.forEach((col, reel) => col.forEach((v, row) => { if (v.label === 'door') doors.push({ reel, row, v }); }));
    if (!doors.length) return;
    // Doors rumble, the seams blaze, then every door swings open at once.
    audio.doorRumble();
    for (const { v } of doors) {
      gsap.to(v, { x: v.x + 3, duration: 0.05, yoyo: true, repeat: 9, ease: 'none' });
      const seam = v.getChildByLabel('seam');
      if (seam) gsap.to(seam, { alpha: 1, duration: 0.5 });
    }
    this.fx.shake(4);
    await wait(650);
    audio.doorOpen();
    const k = this.root.scale.x;
    for (const { reel, row, v } of doors) {
      const col = this.reelCols[reel];
      const sym = revealed[reel][row];
      const nv = makeSymbol(sym, orbs.get(row * REELS + reel), bet);
      this.place(nv, 0, row * CELL);
      col.addChildAt(nv, col.getChildIndex(v));
      this.views[reel][row] = nv;
      nv.scale.set(0.7);
      gsap.to(nv.scale, { x: 1, y: 1, duration: 0.45, ease: 'back.out(2)', delay: 0.15 });
      for (const side of ['L', 'R']) {
        const leaf = v.getChildByLabel(side);
        if (leaf) gsap.to(leaf.scale, { x: 0, duration: 0.45, ease: 'power2.in' });
      }
      gsap.to(v, { alpha: 0, duration: 0.2, delay: 0.4, onComplete: () => { col.removeChild(v); v.destroy({ children: true }); } });
      const p = v.getGlobalPosition();
      this.fx.sparks(p.x, p.y, 10, 0xffe9a8, 220);
    }
    // One light burst over the middle door.
    const mid = doors[Math.floor(doors.length / 2)].v.getGlobalPosition();
    this.fx.ring(mid.x, mid.y, 0xffe9a8, 110 * k);
    this.grid = revealed;
    await wait(700);
  }

  /**
   * Lock new wilds in place; they stay over the spinning reels until the round ends.
   * Each sticky sits on a solid tile so the reels can't be seen moving behind it, and wilds
   * stacked in the same reel merge into one tall sticky.
   */
  async addSticky(cells: number[]) {
    for (const cell of cells) {
      if (this.stickyCells.has(cell)) continue;
      this.stickyCells.add(cell);
      const reel = cell % REELS, row = Math.floor(cell / REELS);
      const merged = this.buildStickyReel(reel, row);
      const p = this.sticky.get(cell)!.getGlobalPosition();
      const cp = this.views[reel][row].getGlobalPosition();
      this.fx.ring(p.x, p.y, 0xff4fa3, (merged ? 110 : 75) * this.root.scale.x);
      this.fx.sparks(cp.x, cp.y, merged ? 22 : 14, 0xff4fa3, 240);
      audio.sticky();
      this.floatText(reel, row, merged ? 'STACKED WILD' : 'STICKY', 0xff9ad0);
      await wait(merged ? 320 : 180);
    }
  }

  /** Redraw one reel's stickies as runs of stacked wilds; returns true if `newRow` joined a stack. */
  private buildStickyReel(reel: number, newRow: number): boolean {
    // Remove this reel's current sticky tiles.
    const old = new Set<Container>();
    for (let row = 0; row < ROWS; row++) {
      const v = this.sticky.get(row * REELS + reel);
      if (v) { old.add(v); this.sticky.delete(row * REELS + reel); }
    }
    for (const v of old) this.destroySticky(v);
    let merged = false;
    for (let row = 0; row < ROWS; row++) {
      if (!this.stickyCells.has(row * REELS + reel)) continue;
      let len = 1;
      while (row + len < ROWS && this.stickyCells.has((row + len) * REELS + reel)) len++;
      const tile = this.makeStickyTile(reel, row, len);
      for (let k = 0; k < len; k++) this.sticky.set((row + k) * REELS + reel, tile);
      const isNew = newRow >= row && newRow < row + len;
      if (isNew) {
        merged = len > 1;
        tile.scale.set(merged ? 1.12 : 1.4);
        tile.alpha = merged ? 1 : 0;
        gsap.to(tile, { alpha: 1, duration: 0.15 });
        gsap.to(tile.scale, { x: 1, y: 1, duration: merged ? 0.5 : 0.4, ease: 'back.out(2.5)' });
      }
      row += len - 1;
    }
    return merged;
  }

  /** A sticky wild spanning `len` rows: a solid tile, the wild art, and a pulsing lock ring. */
  private makeStickyTile(reel: number, row: number, len: number): Container {
    const h = len * CELL;
    const c = new Container();
    c.pivot.set(CELL / 2, h / 2);
    c.position.set(reel * CELL + CELL / 2, row * CELL + h / 2);
    // Solid backing hides the spinning reel underneath.
    c.addChild(new Graphics().roundRect(2, 2, CELL - 4, h - 4, 16).fill({ color: 0x14071f }).stroke({ color: 0x5a1640, width: 2 }));
    c.addChild(new Graphics().roundRect(6, 6, CELL - 12, h - 12, 14).fill({ color: 0x3a0a28, alpha: 0.55 }));
    const tall = art('sym_wild_stack');
    if (len > 1 && tall) {
      const sp = new Sprite(tall);
      sp.anchor.set(0.5);
      sp.scale.set(Math.min((CELL - 6) / tall.width, (h - 8) / tall.height));
      sp.position.set(CELL / 2, h / 2);
      const plate = new Graphics().roundRect(CELL / 2 - 34, h - 36, 68, 24, 12).fill({ color: 0x3a0a28, alpha: 0.92 }).stroke({ color: 0xff4fa3, width: 2 });
      const word = new Text({ text: 'WILD', style: { fontFamily: 'system-ui, sans-serif', fontSize: 16, fontWeight: '900', fill: 0xffe3f2, letterSpacing: 2 } });
      word.anchor.set(0.5);
      word.position.set(CELL / 2, h - 24);
      c.addChild(sp, plate, word);
    } else {
      c.addChild(makeSymbol('W'));
    }
    const lock = new Graphics().roundRect(4, 4, CELL - 8, h - 8, 16).stroke({ color: 0xff4fa3, width: 4 });
    lock.label = 'lock';
    c.addChild(lock);
    gsap.to(lock, { alpha: 0.35, duration: 0.7, yoyo: true, repeat: -1, ease: 'sine.inOut' });
    this.stickyLayer.addChild(c);
    return c;
  }

  private destroySticky(v: Container) {
    gsap.killTweensOf(v); gsap.killTweensOf(v.scale);
    const lock = v.getChildByLabel('lock');
    if (lock) gsap.killTweensOf(lock);
    v.destroy({ children: true });
  }

  clearSticky() {
    for (const v of new Set(this.sticky.values())) this.destroySticky(v);
    this.sticky.clear();
    this.stickyCells.clear();
    this.stickyLayer.removeChildren();
  }

  /** The collector's total: the orb swells and its number rolls up, then slams in with a burst. */
  private async revealCollector(v: Container, total: number, bet: number) {
    const t = v.getChildByLabel('value') as Text | null;
    const cents = Math.round(total * bet);
    const p = v.getGlobalPosition();
    const k = this.root.scale.x;
    // Wind-up: the orb tightens and glows while the "?" shakes.
    audio.anticipation(1.1);
    gsap.to(v.scale, { x: 1.25, y: 1.25, duration: 1.1, ease: 'power2.in' });
    if (t) gsap.to(t, { x: '+=2', duration: 0.04, yoyo: true, repeat: 13, ease: 'none' });
    this.fx.sparks(p.x, p.y, 18, 0xffd34d, 140);
    await wait(1100);
    // Roll up from zero.
    const shown = { c: 0 };
    await new Promise<void>((done) => {
      gsap.to(shown, {
        c: cents, duration: 0.9, ease: 'power3.out',
        onUpdate: () => { if (t) t.text = fmtCoins(Math.floor(shown.c)); audio.tick(); },
        onComplete: () => done(),
      });
    });
    if (t) t.text = fmtCoins(cents);
    // Slam.
    gsap.fromTo(v.scale, { x: 1.7, y: 1.7 }, { x: 1, y: 1, duration: 0.45, ease: 'back.out(3)' });
    if (t) gsap.fromTo(t.scale, { x: 1.6, y: 1.6 }, { x: 1, y: 1, duration: 0.5, ease: 'elastic.out(1, 0.5)' });
    audio.orbLand(14);
    audio.fanfare('small');
    buzz([40, 30, 90]);
    this.fx.flash(0xffd34d, 0.35, 0.35);
    this.fx.ring(p.x, p.y, 0xffd34d, 120 * k, 5);
    this.fx.ring(p.x, p.y, 0xffffff, 80 * k, 3);
    this.fx.coinBurst(p.x, p.y, 22);
    this.fx.shake(10);
    await wait(700);
  }

  /** A short label that floats up from a cell ("+1 SPIN", "+1 ORB"...). */
  floatText(reel: number, row: number, text: string, color = 0xffffff) {
    const t = new Text({
      text,
      style: { fontFamily: 'system-ui, sans-serif', fontSize: 22, fontWeight: '900', fill: color, stroke: { color: 0x000000, width: 5 } },
    });
    t.anchor.set(0.5);
    t.position.set(reel * CELL + CELL / 2, row * CELL + CELL / 2);
    this.floatLayer.addChild(t);
    gsap.to(t, { y: t.y - 60, duration: 1.1, ease: 'power1.out' });
    gsap.to(t, { alpha: 0, duration: 0.4, delay: 0.8, onComplete: () => t.destroy() });
  }

  /** Screen position of a base-grid cell's center. */
  cellCenter(reel: number, row: number) {
    return this.views[reel][row].getGlobalPosition();
  }

  /** Light up every scatter on screen. */
  async celebrateScatters() {
    const hits: Container[] = [];
    const stops: (() => void)[] = [];
    this.grid.forEach((col, reel) => col.forEach((sym, row) => {
      const v = this.views[reel][row];
      if (sym === 'S') hits.push(v); else gsap.to(v, { alpha: 0.3, duration: 0.3 });
    }));
    audio.fanfare('small');
    for (const [i, v] of hits.entries()) {
      const p = v.getGlobalPosition();
      stops.push(this.fx.rays(p.x, p.y, 130 * this.root.scale.x));
      this.fx.ring(p.x, p.y, 0xc8d4ff, 70 * this.root.scale.x);
      this.fx.sparks(p.x, p.y, 26, 0xe6ecff, 320);
      gsap.to(v.scale, { x: 1.1, y: 1.1, duration: 0.35, yoyo: true, repeat: 5, ease: 'sine.inOut', delay: i * 0.12 });
    }
    this.fx.shake(6);
    await wait(2100);
    stops.forEach((f) => f());
    this.views.flat().forEach((v) => gsap.to(v, { alpha: 1, duration: 0.3 }));
  }

  /** Ring each orb on screen before hold & spin starts. */
  async celebrateOrbs() {
    const orbs: Container[] = [];
    this.grid.forEach((col, reel) => col.forEach((sym, row) => {
      const v = this.views[reel][row];
      if (sym === 'O') orbs.push(v); else gsap.to(v, { alpha: 0.3, duration: 0.3 });
    }));
    for (const [i, v] of orbs.entries()) {
      const p = v.getGlobalPosition();
      this.fx.ring(p.x, p.y, 0xffb020, 65 * this.root.scale.x);
      this.fx.sparks(p.x, p.y, 10, 0xffc21a);
      this.pulse(v, 1.15);
      audio.orbLand(i);
      await wait(180);
    }
    await wait(500);
    this.views.flat().forEach((v) => gsap.to(v, { alpha: 1, duration: 0.3 }));
  }

  private pulse(v: Container, scale = 1.12) {
    return gsap.to(v.scale, { x: scale, y: scale, duration: 0.18 * this.speed, yoyo: true, repeat: 1, ease: 'power1.inOut' });
  }

  private drawLine(index: number, color: number, alpha = 1) {
    const pts = LINES[index].map((row, reel) => [reel * CELL + CELL / 2, row * CELL + CELL / 2]);
    this.lines.moveTo(pts[0][0] - CELL / 2 + 6, pts[0][1]);
    for (const [x, y] of pts) this.lines.lineTo(x, y);
    this.lines.lineTo(pts[4][0] + CELL / 2 - 6, pts[4][1]);
    this.lines.stroke({ color, width: 6, alpha, cap: 'round', join: 'round' });
  }

  /** Show all winning lines, then cycle through the biggest few. */
  async showLineWins(wins: LineWin[]) {
    if (!wins.length) return;
    this.lines.clear();
    wins.forEach((w, i) => this.drawLine(w.line, LINE_COLORS[i % LINE_COLORS.length], 0.85));
    const cells = new Set<Container>();
    for (const w of wins) for (let reel = 0; reel < w.count; reel++) cells.add(this.viewAt(reel, LINES[w.line][reel]));
    cells.forEach((v) => {
      this.pulse(v);
      const p = v.getGlobalPosition();
      this.fx.sparks(p.x, p.y, 6, 0xffe9a8, 160);
    });
    audio.lineWin(wins.reduce((s, w) => s + w.pay, 0) >= 100);
    await wait(700 * this.speed);
    if (this.speed < 1 || this.hurry) return;
    const top = [...wins].sort((a, b) => b.pay - a.pay).slice(0, 3);
    for (const [i, w] of top.entries()) {
      this.lines.clear();
      this.drawLine(w.line, LINE_COLORS[i % LINE_COLORS.length]);
      for (let reel = 0; reel < w.count; reel++) this.pulse(this.viewAt(reel, LINES[w.line][reel]), 1.15);
      await wait(550);
    }
    this.lines.clear();
  }

  // ---------------- Hold & spin ----------------

  private tileTex?: { blank: Texture; ghost: Texture; streak: Texture };
  private tiles() {
    if (this.tileTex) return this.tileTex;
    const r = this.app.renderer;
    const slot = art('slot_empty'), orb = art('orb');
    const base = (): Container => {
      if (slot) {
        const c = new Container();
        const sp = new Sprite(slot);
        sp.width = sp.height = CELL - 4;
        sp.position.set(2, 2);
        c.addChild(sp);
        return c;
      }
      return new Graphics().roundRect(5, 5, CELL - 10, CELL - 10, 16).fill({ color: 0x0b1024 }).stroke({ color: 0x2b3566, width: 2 });
    };
    const ghost = base();
    if (orb) {
      const o = new Sprite(orb);
      o.anchor.set(0.5);
      o.position.set(CELL / 2, CELL / 2);
      o.scale.set((CELL - 24) / orb.width);
      o.alpha = 0.35;
      ghost.addChild(o);
    } else ghost.addChild(new Graphics().circle(CELL / 2, CELL / 2, 36).stroke({ color: 0xffb020, width: 3, alpha: 0.4 }));
    const streak = base();
    streak.addChild(new Graphics().rect(CELL / 2 - 3, 14, 6, CELL - 28).fill({ color: 0xffd34d, alpha: 0.18 }));
    const bounds = { frame: new Rectangle(0, 0, CELL, CELL) };
    this.tileTex = {
      blank: r.generateTexture({ target: base(), ...bounds }),
      ghost: r.generateTexture({ target: ghost, ...bounds }),
      streak: r.generateTexture({ target: streak, ...bounds }),
    };
    return this.tileTex;
  }

  /** One empty cell spinning like its own little reel. Resolves when it stops. */
  private spinCell(x: number, y: number, duration: number, onStop: () => void): Promise<void> {
    const t = this.tiles();
    const c = new Container();
    c.position.set(x - CELL / 2, y - CELL / 2);
    const mask = new Graphics().rect(0, 0, CELL, CELL).fill(0xffffff);
    const strip = new Container();
    const n = 7 + Math.round(duration * 10);
    for (let i = 0; i < n; i++) {
      const tex = i === 0 ? t.blank : Math.random() < 0.3 ? t.ghost : i % 2 ? t.streak : t.blank;
      const sp = new Sprite(tex);
      sp.y = i * CELL;
      strip.addChild(sp);
    }
    strip.y = -(n - 1) * CELL;
    c.addChild(mask, strip);
    c.mask = mask;
    this.hsSpin.addChild(c);
    return new Promise((resolve) => {
      gsap.to(strip, {
        y: 0, duration, ease: 'back.out(1.1)',
        onComplete: () => { onStop(); c.destroy({ children: true }); resolve(); },
      });
    });
  }

  private hsSpin = new Container();
  private hsFrame = new Container();
  private drawHsFrame(rows: number, danger: boolean) {
    this.hsFrame.removeChildren().forEach((c) => c.destroy({ children: true }));
    this.hsFrame.addChild(makeFrame(REELS * CELL, rows * CELL, danger));
  }

  async playHoldSpin(hs: HoldSpinResult, bet: number, hooks: HoldSpinHooks) {
    this.lines.clear();
    let unlocked = ROWS;
    const cells = new Map<number, Container>();
    const idle: gsap.core.Tween[] = [];
    const target = (cell: number) => ({
      x: (cell % REELS) * CELL + CELL / 2,
      y: visualRow(Math.floor(cell / REELS), unlocked) * CELL + CELL / 2,
    });
    const layout = (animate: boolean) => {
      for (const [cell, v] of cells) {
        const { x, y } = target(cell);
        if (animate) gsap.to(v.position, { x, y, duration: 0.45, ease: 'power2.out' });
        else v.position.set(x, y);
      }
    };
    const kill = (v: Container) => {
      gsap.killTweensOf(v); gsap.killTweensOf(v.scale); gsap.killTweensOf(v.position);
      const g = v.getChildByLabel('glow');
      if (g) { gsap.killTweensOf(g); gsap.killTweensOf(g.scale); }
    };
    const breathe = (v: Container) => {
      const g = v.getChildByLabel('glow');
      if (!g) return;
      const d = 0.7 + Math.random() * 0.5;
      idle.push(gsap.to(g, { alpha: 1, duration: d, yoyo: true, repeat: -1, ease: 'sine.inOut' }));
      idle.push(gsap.to(g.scale, { x: 1.12, y: 1.12, duration: d, yoyo: true, repeat: -1, ease: 'sine.inOut' }));
    };
    const setView = (cell: number, v: Container) => {
      const old = cells.get(cell);
      if (old) { kill(old); this.hs.removeChild(old); old.destroy({ children: true }); }
      v.pivot.set(CELL / 2);
      cells.set(cell, v);
      this.hs.addChild(v);
    };
    const isEmpty = (v: Container) => !v.getChildByLabel('value');
    const addRows = (from: number, to: number) => {
      for (let cell = from * REELS; cell < to * REELS; cell++) setView(cell, makeEmptySlot());
    };

    // The note walk continues from the trigger orbs and climbs through every respin.
    let walk = hs.initial.filter(Boolean).length;
    this.hs.addChild(this.hsFrame, this.hsSpin);
    unlocked = Math.max(ROWS, rowsForCount(hs.initial.filter(Boolean).length, hs.maxRows));
    this.drawHsFrame(unlocked, false);
    addRows(0, unlocked);
    hs.initial.forEach((o, cell) => { if (o) { const v = makeOrb(o, bet); setView(cell, v); breathe(v); } });
    layout(false);
    this.contentRows = unlocked;
    this.fit(false);
    this.base.visible = false;
    this.hs.visible = true;
    this.hs.alpha = 0;
    await gsap.to(this.hs, { alpha: 1, duration: 0.4 });
    let left = 3;
    hooks.respins(left, unlocked, hs.maxRows, false);
    for (const v of cells.values()) if (!isEmpty(v)) this.pulse(v, 1.1);
    await wait(900 * this.speed);

    for (const step of hs.steps) {
      const lastChance = left === 1;
      if (lastChance) this.drawHsFrame(unlocked, true);
      await hooks.nextRespin(left);
      hooks.respins(left - 1, unlocked, hs.maxRows, false);
      this.drawHsFrame(unlocked, lastChance);
      audio.spinStart();
      if (lastChance) this.fx.shake(3);

      // Every empty cell spins; columns stop left to right, a little slower on the last respin.
      const landing = new Map(step.landed.map((l) => [l.cell, l.orb]));
      const spins: Promise<void>[] = [];
      const base = (lastChance ? 0.9 : 0.5) * this.speed;
      const perCol = (lastChance ? 0.28 : 0.14) * this.speed;
      for (const [cell, v] of cells) {
        if (!isEmpty(v)) continue;
        const { x, y } = target(cell);
        const col = cell % REELS;
        const vr = visualRow(Math.floor(cell / REELS), unlocked);
        const duration = base + col * perCol + vr * 0.03 + Math.random() * 0.05;
        v.alpha = 0;
        spins.push(this.spinCell(x, y, duration, () => {
          const orb = landing.get(cell);
          if (!orb) {
            v.alpha = 1;
            audio.cellStop();
            return;
          }
          // An orb drops into the cell and slams down.
          const ov = makeOrb(orb, bet);
          // A collector's total stays hidden until its beams have gathered everything.
          if (orb.special === 'COLLECTOR') setOrbValue(ov, '?');
          setView(cell, ov);
          ov.position.set(x, y - CELL * 1.1);
          ov.scale.set(1.3);
          ov.alpha = 0;
          gsap.to(ov, { alpha: 1, duration: 0.08 });
          gsap.to(ov.scale, { x: 1, y: 1, duration: 0.35, ease: 'back.out(2)' });
          gsap.to(ov.position, {
            y, duration: 0.42, ease: 'bounce.out',
            onComplete: () => breathe(ov),
          });
          const k = this.root.scale.x;
          audio.orbLand(walk++);
          buzz(orb.special ? 40 : 18);
          gsap.delayedCall(0.16, () => {
            const p = ov.getGlobalPosition();
            this.fx.ring(p.x, p.y, orb.special ? 0x00f0ff : 0xffb020, 75 * k);
            this.fx.sparks(p.x, p.y, orb.special ? 26 : 16, orb.special ? 0x00f0ff : 0xffc21a, 300);
            this.fx.shake(orb.prize.kind === 'jackpot' ? 9 : 5);
            if (orb.special) audio.special();
            if (orb.prize.kind === 'jackpot') { this.fx.ring(p.x, p.y, 0xffffff, 100 * k, 4); this.fx.flash(0xffffff, 0.25, 0.3); }
          });
        }));
      }
      await Promise.all(spins);

      // Special orbs: each gets a call-out and shows what it does.
      const revealed = new Set<number>(); // collector totals already shown by their own reveal
      for (const { cell, orb } of step.landed) {
        if (!orb.special) continue;
        const v = cells.get(cell);
        if (!v) continue;
        await wait(250);
        this.pulse(v, 1.35);
        this.fx.flash(0x00f0ff, 0.25, 0.5);
        await hooks.special(orb.special);
        const from = v.getGlobalPosition();
        const changedCells = new Set(step.changed.map((c) => c.cell));
        if (orb.special === 'DOUBLER') {
          const r = Math.floor(cell / REELS), c = cell % REELS;
          const near = [cell - REELS, cell + REELS, c > 0 ? cell - 1 : -1, c < REELS - 1 ? cell + 1 : -1]
            .filter((n) => n >= 0 && changedCells.has(n) && Math.floor(n / REELS) < unlocked && Math.abs(Math.floor(n / REELS) - r) <= 1);
          for (const n of near) {
            const to = cells.get(n)!.getGlobalPosition();
            this.fx.beam(from.x, from.y, to.x, to.y, 0x00f0ff);
          }
          if (!near.length) this.fx.ring(from.x, from.y, 0x00f0ff, 90 * this.root.scale.x);
          await wait(600);
        } else if (orb.special === 'COLLECTOR') {
          for (const [n, nv] of cells) {
            if (n === cell || isEmpty(nv)) continue;
            const to = nv.getGlobalPosition();
            this.fx.beam(to.x, to.y, from.x, from.y, 0xffd34d);
            await wait(60);
          }
          await wait(350);
          const total = step.changed.find((c) => c.cell === cell)?.value ?? orb.value;
          await this.revealCollector(v, total, bet);
          revealed.add(cell);
        } else if (orb.special === 'EXTRA_RESPIN') {
          this.fx.ring(from.x, from.y, 0x00f0ff, 110 * this.root.scale.x);
          await wait(300);
        } else {
          this.fx.ring(from.x, from.y, 0x00f0ff, 110 * this.root.scale.x);
        }
      }

      if (step.landed.length) {
        await wait(450);
        audio.respinReset();
      } else {
        await wait(250 * this.speed);
      }

      if (step.changed.some((c) => !revealed.has(c.cell))) await wait(250 * this.speed);
      for (const { cell, value } of step.changed) {
        const v = cells.get(cell);
        if (!v || revealed.has(cell)) continue;
        setOrbValue(v, orbText({ prize: { kind: 'coin', value }, value }, bet));
        this.pulse(v, 1.25);
        const p = v.getGlobalPosition();
        this.fx.sparks(p.x, p.y, 14, 0x00f0ff, 200);
      }
      if (step.unlockedRows > unlocked) {
        await wait(250);
        const from = unlocked;
        unlocked = step.unlockedRows;
        addRows(from, unlocked);
        for (let cell = from * REELS; cell < unlocked * REELS; cell++) {
          const v = cells.get(cell)!, t = target(cell);
          v.position.set(t.x, t.y - CELL);
          v.alpha = 0;
          gsap.to(v, { alpha: 1, duration: 0.5 });
        }
        this.contentRows = unlocked;
        layout(true);
        this.drawHsFrame(unlocked, false);
        this.fit(true);
        audio.rowUnlock();
        buzz([30, 30, 60]);
        this.fx.shake(14);
        this.fx.flash(0xffd34d, 0.3, 0.6);
      }
      left = step.respinsLeft;
      audio.intensity = left <= 1 ? 2 : left === 2 ? 1 : 0;
      this.drawHsFrame(unlocked, false);
      hooks.respins(left, unlocked, hs.maxRows, step.landed.length > 0);
      await wait((step.landed.length ? 450 : 250) * this.speed);
    }

    // Collect, top to bottom.
    const order = [...cells.keys()]
      .filter((cell) => hs.final[cell])
      .sort((a, b) => {
        const va = visualRow(Math.floor(a / REELS), unlocked), vb = visualRow(Math.floor(b / REELS), unlocked);
        return va - vb || (a % REELS) - (b % REELS);
      });
    let total = 0;
    for (const cell of order) {
      const orb = hs.final[cell]!;
      const v = cells.get(cell)!;
      this.pulse(v, 1.2);
      const p = v.getGlobalPosition();
      this.fx.sparks(p.x, p.y, 8, 0xffe9a8, 180);
      audio.tick();
      total += Math.round(orb.value * bet);
      if (orb.prize.kind === 'jackpot') {
        const coins = JACKPOT_PAY[orb.prize.jackpot] * bet;
        total += coins;
        hooks.collected(total);
        await hooks.jackpot(orb.prize.jackpot, coins);
      } else {
        hooks.collected(total);
        await wait(120 * this.speed);
      }
    }
    if (hs.grand) {
      const coins = Math.round(hs.pay * bet) - total;
      total += coins;
      hooks.collected(total);
      await hooks.jackpot('GRAND', coins);
    }
    audio.intensity = 0;
    await wait(600);

    await gsap.to(this.hs, { alpha: 0, duration: 0.35 });
    idle.forEach((t) => t.kill());
    for (const v of cells.values()) { kill(v); v.destroy({ children: true }); }
    this.hs.removeChildren();
    this.hsSpin.removeChildren();
    this.hs.visible = false;
    this.base.visible = true;
    this.contentRows = ROWS;
    this.fit(true);
  }
}

/**
 * Ornate gold frame built from the corner and edge art, sized to any board.
 * danger tints it red (last respin).
 */
export function makeFrame(w: number, h: number, danger = false): Container {
  const c = new Container();
  c.addChild(new Graphics().roundRect(-12, -12, w + 24, h + 24, 18).fill({ color: 0x050816, alpha: 0.86 }));
  const edge = art('frame_edge'), corner = art('frame_corner');
  const tint = danger ? 0xff6b5a : 0xffffff;
  if (!edge || !corner) {
    c.addChild(new Graphics().roundRect(-14, -14, w + 28, h + 28, 26).stroke({ color: danger ? 0xff3a2a : 0xc89b3c, width: 4 }));
    return c;
  }
  const T = 22, off = 13;
  const strip = (len: number) => {
    const t = new TilingSprite({ texture: edge, width: len, height: T });
    t.tileScale.set(T / edge.height);
    t.tint = tint;
    return t;
  };
  const top = strip(w + off * 2); top.position.set(-off, -off - T / 2);
  const bottom = strip(w + off * 2); bottom.position.set(-off, h + off - T / 2);
  const left = strip(h + off * 2); left.rotation = Math.PI / 2; left.position.set(-off + T / 2, -off);
  const right = strip(h + off * 2); right.rotation = Math.PI / 2; right.position.set(w + off + T / 2, -off);
  c.addChild(top, bottom, left, right);
  const K = 84, o = off + T / 2 + 3;
  const place = (x: number, y: number, sx: number, sy: number) => {
    const sp = new Sprite(corner);
    sp.scale.set((K / corner.width) * sx, (K / corner.height) * sy);
    sp.position.set(x, y);
    sp.tint = tint;
    c.addChild(sp);
  };
  place(-o, -o, 1, 1);
  place(w + o, -o, -1, 1);
  place(-o, h + o, 1, -1);
  place(w + o, h + o, -1, -1);
  return c;
}
