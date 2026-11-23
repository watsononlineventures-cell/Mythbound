import { Application, Container, Graphics, Sprite, Texture, type Ticker } from 'pixi.js';
import { art } from './art';
import gsap from 'gsap';

export type Theme = 'base' | 'free' | 'hold' | 'awake';

const THEME_STARS: Record<Theme, number> = { base: 0x9fb4ff, free: 0xd9a8ff, hold: 0xffc46b, awake: 0xff6b5a };

interface Particle {
  s: Sprite;
  vx: number; vy: number; vr: number;
  g: number; life: number; max: number;
  spin?: number; // coin flip speed
  fade: boolean;
}

/** Visual effects: starfield, particles, shake, flashes, rings and rays. */
export class Fx {
  private back = new Container();
  readonly front = new Container();
  private stars: { s: Sprite; v: number; tw: number }[] = [];
  private parts: Particle[] = [];
  private coinTex!: Texture;
  private sparkTex!: Texture;
  private starTex!: Texture;
  private shakeAmt = 0;
  private flashG = new Graphics();
  private t = 0;

  constructor(private app: Application) {}

  init() {
    const r = this.app.renderer;
    const coinArt = art('coin');
    this.coinTex = coinArt ?? r.generateTexture(
      new Graphics()
        .circle(16, 16, 15).fill(0xffc21a).stroke({ color: 0x9a5a00, width: 2 })
        .circle(16, 16, 9).stroke({ color: 0xfff1a8, width: 2 }),
    );
    this.sparkTex = r.generateTexture(
      new Graphics().circle(12, 12, 12).fill({ color: 0xffffff, alpha: 0.25 }).circle(12, 12, 6).fill({ color: 0xffffff, alpha: 0.6 }).circle(12, 12, 3).fill(0xffffff),
    );
    this.starTex = r.generateTexture(new Graphics().circle(3, 3, 3).fill(0xffffff));
    this.app.stage.addChildAt(this.back, 0);
    this.app.stage.addChild(this.front, this.flashG);
    for (let i = 0; i < 90; i++) {
      const s = new Sprite(this.starTex);
      s.anchor.set(0.5);
      s.scale.set(0.3 + Math.random() * 0.7);
      s.position.set(Math.random() * this.app.screen.width, Math.random() * this.app.screen.height);
      s.tint = THEME_STARS.base;
      this.back.addChild(s);
      this.stars.push({ s, v: 4 + Math.random() * 14, tw: Math.random() * 6 });
    }
    this.app.ticker.add((tk) => this.update(tk));
  }

  theme(t: Theme) {
    document.body.dataset.theme = t;
    document.querySelectorAll<HTMLElement>('.bgl').forEach((el) => el.classList.toggle('on', el.dataset.t === t));
    for (const st of this.stars) st.s.tint = THEME_STARS[t];
  }

  private update(tk: Ticker) {
    const dt = Math.min(tk.deltaMS / 1000, 0.05);
    this.t += dt;
    const { width, height } = this.app.screen;
    for (const st of this.stars) {
      st.s.y -= st.v * dt;
      if (st.s.y < -5) { st.s.y = height + 5; st.s.x = Math.random() * width; }
      st.s.alpha = 0.35 + 0.35 * Math.sin(this.t * 1.5 + st.tw);
    }
    for (let i = this.parts.length - 1; i >= 0; i--) {
      const p = this.parts[i];
      p.life += dt;
      p.vy += p.g * dt;
      p.s.x += p.vx * dt;
      p.s.y += p.vy * dt;
      p.s.rotation += p.vr * dt;
      if (p.spin) p.s.scale.x = p.s.scale.y * Math.cos(p.life * p.spin);
      if (p.fade) p.s.alpha = Math.max(0, 1 - p.life / p.max);
      if (p.life >= p.max || p.s.y > height + 60) {
        p.s.destroy();
        this.parts.splice(i, 1);
      }
    }
    if (this.shakeAmt > 0.3) {
      this.app.stage.position.set((Math.random() - 0.5) * this.shakeAmt * 2, (Math.random() - 0.5) * this.shakeAmt * 2);
      this.shakeAmt *= Math.pow(0.02, dt);
    } else if (this.shakeAmt) {
      this.shakeAmt = 0;
      this.app.stage.position.set(0, 0);
    }
  }

  private add(tex: Texture, x: number, y: number, o: Partial<Particle> & { scale?: number; tint?: number; add?: boolean }) {
    if (this.parts.length > 600) return;
    const s = new Sprite(tex);
    s.anchor.set(0.5);
    s.position.set(x, y);
    s.scale.set(o.scale ?? 1);
    if (tex === this.coinTex && tex.width > 40) s.scale.set((o.scale ?? 1) * (32 / tex.width) * 1.15);
    if (o.tint !== undefined) s.tint = o.tint;
    if (o.add) s.blendMode = 'add';
    this.front.addChild(s);
    this.parts.push({ s, vx: o.vx ?? 0, vy: o.vy ?? 0, vr: o.vr ?? 0, g: o.g ?? 0, life: 0, max: o.max ?? 1, spin: o.spin, fade: o.fade ?? true });
  }

  /** Coins bursting up from a point. */
  coinBurst(x: number, y: number, n = 24) {
    for (let i = 0; i < n; i++) {
      const a = -Math.PI / 2 + (Math.random() - 0.5) * 1.6;
      const sp = 380 + Math.random() * 420;
      this.add(this.coinTex, x, y, {
        vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, g: 1100, vr: (Math.random() - 0.5) * 6,
        max: 2.2, spin: 8 + Math.random() * 10, scale: 0.7 + Math.random() * 0.6, fade: false,
      });
    }
  }

  /** Coins raining from the top for a while. */
  coinRain(seconds = 2, perSecond = 60) {
    const { width } = this.app.screen;
    const total = Math.floor(seconds * perSecond);
    for (let i = 0; i < total; i++) {
      gsap.delayedCall((i / total) * seconds, () => {
        this.add(this.coinTex, Math.random() * width, -30, {
          vx: (Math.random() - 0.5) * 120, vy: 100 + Math.random() * 200, g: 700, vr: (Math.random() - 0.5) * 4,
          max: 3.5, spin: 6 + Math.random() * 10, scale: 0.6 + Math.random() * 0.7, fade: false,
        });
      });
    }
  }

  sparks(x: number, y: number, n = 16, tint = 0xffd34d, speed = 260) {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const sp = speed * (0.4 + Math.random() * 0.8);
      this.add(this.sparkTex, x, y, { vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, g: 200, max: 0.5 + Math.random() * 0.5, scale: 0.4 + Math.random() * 0.8, tint, add: true });
    }
  }

  /** Expanding shockwave ring. */
  ring(x: number, y: number, tint = 0xffd34d, size = 90, width = 6) {
    const g = new Graphics().circle(0, 0, size).stroke({ color: tint, width });
    g.position.set(x, y);
    g.scale.set(0.2);
    g.blendMode = 'add';
    this.front.addChild(g);
    gsap.to(g.scale, { x: 1.4, y: 1.4, duration: 0.6, ease: 'power2.out' });
    gsap.to(g, { alpha: 0, duration: 0.6, ease: 'power1.in', onComplete: () => g.destroy() });
  }

  flash(tint = 0xffffff, alpha = 0.7, duration = 0.5) {
    const { width, height } = this.app.screen;
    this.flashG.clear().rect(-50, -50, width + 100, height + 100).fill(tint);
    this.flashG.alpha = alpha;
    gsap.killTweensOf(this.flashG);
    gsap.to(this.flashG, { alpha: 0, duration, ease: 'power2.out' });
  }

  shake(amount = 10) {
    this.shakeAmt = Math.max(this.shakeAmt, amount);
  }

  /** Rotating light rays behind a point. Returns a function that removes them. */
  rays(x: number, y: number, radius = 110, tint = 0xffe9a8): () => void {
    const g = new Graphics();
    const n = 14;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2, w = Math.PI / n / 1.6;
      g.moveTo(0, 0).lineTo(Math.cos(a - w) * radius, Math.sin(a - w) * radius).lineTo(Math.cos(a + w) * radius, Math.sin(a + w) * radius).closePath();
    }
    g.fill({ color: tint, alpha: 0.22 });
    g.position.set(x, y);
    g.blendMode = 'add';
    g.scale.set(0);
    this.front.addChildAt(g, 0);
    gsap.to(g.scale, { x: 1, y: 1, duration: 0.4, ease: 'back.out(2)' });
    const spin = gsap.to(g, { rotation: Math.PI * 2, duration: 6, ease: 'none', repeat: -1 });
    return () => {
      gsap.to(g, { alpha: 0, duration: 0.3, onComplete: () => { spin.kill(); g.destroy(); } });
    };
  }

  /** A glowing beam from one point to another that fades (doubler and collector effects). */
  beam(x1: number, y1: number, x2: number, y2: number, tint = 0x00f0ff) {
    const g = new Graphics()
      .moveTo(x1, y1).lineTo(x2, y2).stroke({ color: tint, width: 10, alpha: 0.35 })
      .moveTo(x1, y1).lineTo(x2, y2).stroke({ color: 0xffffff, width: 3 });
    g.blendMode = 'add';
    this.front.addChild(g);
    gsap.fromTo(g, { alpha: 0 }, { alpha: 1, duration: 0.12 });
    gsap.to(g, { alpha: 0, duration: 0.5, delay: 0.45, onComplete: () => g.destroy() });
    // A spark travels along the beam.
    const sp = { t: 0 };
    gsap.to(sp, { t: 1, duration: 0.4, ease: 'power1.in', onUpdate: () => this.sparks(x1 + (x2 - x1) * sp.t, y1 + (y2 - y1) * sp.t, 1, tint, 40) });
  }

  /** Lightning bolt between two points with a flash. */
  lightning(x1: number, y1: number, x2: number, y2: number) {
    const g = new Graphics();
    const pts: [number, number][] = [[x1, y1]];
    const segs = 9;
    for (let i = 1; i < segs; i++) {
      const t = i / segs;
      pts.push([x1 + (x2 - x1) * t + (Math.random() - 0.5) * 70, y1 + (y2 - y1) * t + (Math.random() - 0.5) * 20]);
    }
    pts.push([x2, y2]);
    g.moveTo(...pts[0]);
    for (const p of pts.slice(1)) g.lineTo(...p);
    g.stroke({ color: 0xbfe6ff, width: 7, alpha: 0.5 }).stroke({ color: 0xffffff, width: 2.5 });
    g.blendMode = 'add';
    this.front.addChild(g);
    gsap.to(g, { alpha: 0, duration: 0.45, ease: 'power2.in', onComplete: () => g.destroy() });
  }

  get size() { return this.app.screen; }
}
