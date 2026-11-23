/** Random source returning floats in [0, 1). */
export interface Rng {
  next(): number;
}

/** Seeded sfc32 PRNG — deterministic, for simulation and tests. */
export function seededRng(seed: number): Rng {
  let a = 0x9e3779b9, b = 0x243f6a88, c = 0xb7e15162, d = seed >>> 0;
  const step = () => {
    a >>>= 0; b >>>= 0; c >>>= 0; d >>>= 0;
    const t = (a + b + d) >>> 0;
    d = (d + 1) >>> 0;
    a = b ^ (b >>> 9);
    b = (c + (c << 3)) >>> 0;
    c = (c << 21) | (c >>> 11);
    c = (c + t) >>> 0;
    return t / 4294967296;
  };
  for (let i = 0; i < 15; i++) step();
  return { next: step };
}

/** Cryptographic RNG for live play. */
export function cryptoRng(): Rng {
  const buf = new Uint32Array(256);
  let i = buf.length;
  return {
    next() {
      if (i >= buf.length) {
        crypto.getRandomValues(buf);
        i = 0;
      }
      return buf[i++] / 4294967296;
    },
  };
}

export function randInt(rng: Rng, n: number): number {
  return Math.floor(rng.next() * n);
}

/** Pick a key from a weight table. */
export function weighted<T>(rng: Rng, table: ReadonlyArray<readonly [T, number]>): T {
  let total = 0;
  for (const [, w] of table) total += w;
  let r = rng.next() * total;
  for (const [v, w] of table) {
    r -= w;
    if (r < 0) return v;
  }
  return table[table.length - 1][0];
}
