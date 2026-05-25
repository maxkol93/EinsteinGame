/**
 * Deterministic seeded RNG with Python-`random`-style helpers.
 *
 * NOTE: this is a mulberry32 PRNG — it does NOT reproduce CPython's Mersenne
 * Twister. That's fine for normal/random games and for "retry the same board"
 * (same seed → same board within this engine). The Daily/Weekly/Monthly puzzle
 * must additionally match the Python output bit-for-bit; that port validates
 * against shared/daily_vectors.json and may swap in a true MT then. See
 * ../../../CLAUDE.md.
 */
export class Rng {
  private s: number;

  constructor(seed: number) {
    this.s = seed >>> 0 || 1;
  }

  /** Float in [0, 1). */
  next(): number {
    this.s = (this.s + 0x6d2b79f5) | 0;
    let t = Math.imul(this.s ^ (this.s >>> 15), 1 | this.s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  /** Integer in [a, b], both ends inclusive (like Python's randint). */
  randint(a: number, b: number): number {
    return a + Math.floor(this.next() * (b - a + 1));
  }

  /** A random element (like Python's random.choice). */
  choice<T>(arr: readonly T[]): T {
    return arr[Math.floor(this.next() * arr.length)];
  }
}
