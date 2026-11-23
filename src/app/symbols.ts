import { Container, Graphics, Sprite, Text } from 'pixi.js';
import { art, type ArtName } from './art';
import type { Sym } from '../math/config';
import type { Orb } from '../math/holdSpin';
import { fmtCoins } from './fmt';

export const CELL = 120;
const PAD = 5;

/** Placeholder look for each symbol until real art arrives. */
const LOOK: Record<Sym, { label: string; glyph: string; color: number }> = {
  H1: { label: 'THUNDERBIRD', glyph: '🦅', color: 0x3aa7ff },
  H2: { label: 'KRAKEN', glyph: '🐙', color: 0x2fd3b0 },
  H3: { label: 'GOLDEN STAG', glyph: '🦌', color: 0xf2c14e },
  H4: { label: 'STORM WYRM', glyph: '🐉', color: 0x9b7bff },
  M1: { label: 'RUNESTONE', glyph: '🪨', color: 0x7fb7a6 },
  M2: { label: 'HORN', glyph: '📯', color: 0xc9935a },
  M3: { label: 'CROWN', glyph: '👑', color: 0xe0c060 },
  L1: { label: 'FIRE', glyph: '🔥', color: 0xe8664a },
  L2: { label: 'WATER', glyph: '💧', color: 0x4a9be8 },
  L3: { label: 'STORM', glyph: '⚡', color: 0xd8d24a },
  L4: { label: 'EARTH', glyph: '🌿', color: 0x5bbf5b },
  W: { label: 'WILD', glyph: '✦', color: 0xff4fa3 },
  S: { label: 'MOON GATE', glyph: '🌕', color: 0xc8d4ff },
  O: { label: 'ORB', glyph: '', color: 0xffb020 },
  D: { label: 'MYSTERY', glyph: '🚪', color: 0xc89b3c },
};

const EMOJI_FONT = 'system-ui, "Apple Color Emoji", "Segoe UI Emoji", "Noto Color Emoji", sans-serif';
const LABEL_FONT = 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';

export const JACKPOT_COLOR: Record<string, number> = {
  MINI: 0x5bbf5b, MINOR: 0x3aa7ff, MAJOR: 0xff4fa3, GRAND: 0xffd34d,
};

function tile(color: number, fill = 0x141a33): Graphics {
  return new Graphics()
    .roundRect(PAD, PAD, CELL - PAD * 2, CELL - PAD * 2, 16)
    .fill({ color: fill })
    .stroke({ color, width: 3, alpha: 0.9 });
}

const SYMBOL_ART: Partial<Record<Sym, ArtName>> = {
  H1: 'sym_thunderbird', H2: 'sym_kraken', H3: 'sym_stag', H4: 'sym_wyrm',
  M1: 'sym_runestone', M2: 'sym_horn', M3: 'sym_crown',
  L1: 'sym_fire', L2: 'sym_water', L3: 'sym_storm', L4: 'sym_earth',
  W: 'sym_wild', S: 'sym_moongate',
};

/** A sprite centered in a cell, sized to `size`. */
function cellSprite(name: ArtName, size: number): Sprite | null {
  const t = art(name);
  if (!t) return null;
  const sp = new Sprite(t);
  sp.anchor.set(0.5);
  sp.position.set(CELL / 2, CELL / 2);
  const k = size / Math.max(t.width, t.height);
  sp.scale.set(k);
  return sp;
}

/**
 * Mystery temple doors: two stone leaves that swing open (scale to 0 toward the frame).
 * Children labelled 'L' and 'R' are the leaves; 'seam' is the glowing crack between them.
 */
export function makeDoor(): Container {
  const c = new Container();
  c.label = 'door';
  const doorArt = art('sym_door');
  // Dark opening behind the leaves, seen as they swing apart.
  c.addChild(new Graphics().roundRect(PAD + 8, PAD + 8, CELL - PAD * 2 - 16, CELL - PAD * 2 - 12, 10).fill({ color: 0x120c06 }));
  if (!doorArt) c.addChild(new Graphics().roundRect(PAD, PAD, CELL - PAD * 2, CELL - PAD * 2, 14).stroke({ color: 0xc89b3c, width: 3 }));
  const half = (CELL - PAD * 2) / 2;
  const leaf = (side: 1 | -1) => {
    // Left leaf hinges at its left edge and spans [0, half]; right leaf hinges at its right edge and spans [-half, 0].
    const l = new Container();
    l.label = side === 1 ? 'L' : 'R';
    const g = new Graphics();
    const x0 = side === 1 ? 0 : -half;
    const h = CELL - PAD * 2;
    g.roundRect(x0 + 1, 2, half - 2, h - 4, 6).fill({ color: 0x5a4a32 }).stroke({ color: 0x2a1e10, width: 2 });
    for (const y of [20, h / 2, h - 20]) {
      g.rect(x0 + 3, y - 3, half - 6, 6).fill({ color: 0xc89b3c });
      g.circle(side === 1 ? 9 : -9, y, 3).fill({ color: 0xfff1a8 });
    }
    // Half of a gold emblem on each leaf, meeting at the seam.
    const ex = side === 1 ? half : -half;
    const [a0, a1] = side === 1 ? [Math.PI / 2, Math.PI * 1.5] : [-Math.PI / 2, Math.PI / 2];
    g.moveTo(ex, h / 2).arc(ex, h / 2, 19, a0, a1).closePath().fill({ color: 0x3a2808 });
    g.arc(ex, h / 2, 19, a0, a1).stroke({ color: 0xffd34d, width: 3 });
    l.addChild(g);
    l.position.set(side === 1 ? PAD : CELL - PAD, PAD);
    return l;
  };
  if (doorArt) {
    // With real art, each leaf is one half of the door image.
    for (const side of [1, -1] as const) {
      const l = new Container();
      l.label = side === 1 ? 'L' : 'R';
      const sp = new Sprite(doorArt);
      sp.height = sp.width = CELL - PAD * 2;
      const m = new Graphics().rect(side === 1 ? 0 : -half, 0, half, CELL - PAD * 2).fill(0xffffff);
      sp.x = side === 1 ? 0 : -half * 2;
      l.addChild(sp, m);
      sp.mask = m;
      l.position.set(side === 1 ? PAD : CELL - PAD, PAD);
      c.addChild(l);
    }
  } else {
    c.addChild(leaf(1), leaf(-1));
  }
  const seam = new Graphics().rect(CELL / 2 - 1.5, PAD + 6, 3, CELL - PAD * 2 - 12).fill({ color: 0xffe9a8 });
  seam.blendMode = 'add';
  seam.alpha = 0.5;
  seam.label = 'seam';
  c.addChild(seam);
  return c;
}

export function makeSymbol(sym: Sym, orb?: Orb, bet = 0): Container {
  if (sym === 'O') return makeOrb(orb, bet);
  if (sym === 'D') return makeDoor();
  const name = SYMBOL_ART[sym];
  const sp = name ? cellSprite(name, CELL - 6) : null;
  if (sp) {
    const c = new Container();
    c.addChild(sp);
    if (sym === 'W') {
      // The art is the sigil alone; the game adds the word.
      const plate = new Graphics().roundRect(CELL / 2 - 34, CELL - 34, 68, 24, 12).fill({ color: 0x3a0a28, alpha: 0.92 }).stroke({ color: 0xff4fa3, width: 2 });
      const word = new Text({ text: 'WILD', style: { fontFamily: LABEL_FONT, fontSize: 16, fontWeight: '900', fill: 0xffe3f2, letterSpacing: 2 } });
      word.anchor.set(0.5);
      word.position.set(CELL / 2, CELL - 22);
      c.addChild(plate, word);
    }
    return c;
  }
  const look = LOOK[sym];
  const c = new Container();
  c.addChild(tile(look.color, sym === 'W' ? 0x3a1030 : 0x141a33));
  const glyph = new Text({
    text: look.glyph,
    style: { fontFamily: EMOJI_FONT, fontSize: sym === 'W' ? 64 : 54, fill: look.color },
  });
  glyph.anchor.set(0.5);
  glyph.position.set(CELL / 2, CELL / 2 - 10);
  const label = new Text({
    text: look.label,
    style: { fontFamily: LABEL_FONT, fontSize: 13, fontWeight: '800', fill: look.color, letterSpacing: 1 },
  });
  label.anchor.set(0.5);
  label.position.set(CELL / 2, CELL - 22);
  c.addChild(glyph, label);
  return c;
}

export function orbText(orb: Orb | undefined, bet: number): string {
  if (!orb) return '';
  if (orb.prize.kind === 'jackpot') return orb.prize.jackpot;
  return fmtCoins(Math.round(orb.value * bet));
}

const SPECIAL_LABEL: Record<string, string> = {
  DOUBLER: '×2', COLLECTOR: 'COLLECT', ROW_BREAKER: 'ROW+', EXTRA_RESPIN: '+1 SPIN',
};

export function makeOrb(orb: Orb | undefined, bet: number): Container {
  const c = new Container();
  const jackpot = orb?.prize.kind === 'jackpot' ? orb.prize.jackpot : undefined;
  // Special orbs glow cyan so they stand out on the board.
  const ring = jackpot ? JACKPOT_COLOR[jackpot] : orb?.special ? 0x00f0ff : 0xffb020;
  // Soft halo behind the orb; animated while the orb sits locked on the board.
  const glow = new Graphics()
    .circle(0, 0, CELL / 2 - 2).fill({ color: ring, alpha: 0.18 })
    .circle(0, 0, CELL / 2 - 10).fill({ color: ring, alpha: 0.22 });
  glow.position.set(CELL / 2, CELL / 2);
  glow.blendMode = 'add';
  glow.alpha = 0.6;
  glow.label = 'glow';
  c.addChild(glow);
  const orbArt = cellSprite(jackpot ? (`orb_${jackpot.toLowerCase()}` as ArtName) : 'orb', CELL - 6);
  if (orbArt) c.addChild(orbArt);
  else {
    c.addChild(new Graphics()
      .circle(CELL / 2, CELL / 2, CELL / 2 - 12).fill({ color: 0x3a1c00 })
      .circle(CELL / 2, CELL / 2, CELL / 2 - 12).stroke({ color: ring, width: 5 })
      .circle(CELL / 2, CELL / 2, CELL / 2 - 22).fill({ color: 0xff8a00, alpha: 0.35 }));
  }
  const value = new Text({
    text: orbText(orb, bet) || '?',
    style: {
      fontFamily: LABEL_FONT, fontSize: jackpot ? 18 : 26, fontWeight: '900',
      fill: jackpot ? ring : 0xfff3c4, stroke: { color: 0x1a0800, width: 5 },
      dropShadow: { color: 0x000000, alpha: 0.6, blur: 3, distance: 1 },
    },
  });
  value.anchor.set(0.5);
  value.position.set(CELL / 2, CELL / 2);
  value.label = 'value';
  c.addChild(value);
  const BADGE: Record<string, ArtName> = {
    DOUBLER: 'badge_doubler', COLLECTOR: 'badge_collector', ROW_BREAKER: 'badge_rowbreaker', EXTRA_RESPIN: 'badge_extraspin',
  };
  const badge = orb?.special ? art(BADGE[orb.special]) : undefined;
  if (orb?.special && badge) {
    const b = new Sprite(badge);
    b.anchor.set(0.5);
    b.scale.set(60 / Math.max(badge.width, badge.height));
    b.position.set(CELL - 28, CELL - 28);
    c.addChild(b);
  } else if (orb?.special) {
    const tag = new Text({
      text: SPECIAL_LABEL[orb.special],
      style: { fontFamily: LABEL_FONT, fontSize: 12, fontWeight: '900', fill: 0x00f0ff, stroke: { color: 0x000000, width: 3 } },
    });
    tag.anchor.set(0.5);
    tag.position.set(CELL / 2, CELL - 18);
    c.addChild(tag);
  }
  return c;
}

/** Update the value label on an orb container. */
export function setOrbValue(c: Container, text: string): void {
  const t = c.getChildByLabel('value') as Text | null;
  if (t) t.text = text;
}

export function makeEmptySlot(): Container {
  const c = new Container();
  const slot = art('slot_empty');
  if (slot) {
    const sp = new Sprite(slot);
    sp.width = sp.height = CELL - 4;
    sp.position.set(2, 2);
    c.addChild(sp);
    return c;
  }
  c.addChild(
    new Graphics()
      .roundRect(PAD, PAD, CELL - PAD * 2, CELL - PAD * 2, 16)
      .fill({ color: 0x0b1024 })
      .stroke({ color: 0x2b3566, width: 2 }),
  );
  return c;
}
