/**
 * Seedable pseudo-random number generator (xoshiro128**).
 *
 * - Call `seedRandom(n)` to make `random()` deterministic.
 * - Without seeding, `random()` delegates to `Math.random()`.
 */

// ── xoshiro128** core ──

function splitmix32(a: number): () => number {
  return () => {
    a |= 0;
    a = (a + 0x9e3779b9) | 0;
    let t = a ^ (a >>> 16);
    t = Math.imul(t, 0x21f0aaad);
    t = t ^ (t >>> 15);
    t = Math.imul(t, 0x735a2d97);
    t = t ^ (t >>> 15);
    return (t >>> 0) / 4294967296;
  };
}

export class SeededRandom {
  private s: Uint32Array;

  constructor(seed: number) {
    // Initialize state via splitmix32
    this.s = new Uint32Array(4);
    const init = splitmix32(seed);
    for (let i = 0; i < 4; i++) {
      this.s[i] = (init() * 4294967296) >>> 0;
    }
  }

  /** Returns a float in [0, 1). */
  next(): number {
    const s = this.s;
    const result = Math.imul(s[1] * 5, 7) >>> 0;
    const t = s[1] << 9;

    s[2] ^= s[0];
    s[3] ^= s[1];
    s[1] ^= s[2];
    s[0] ^= s[3];
    s[2] ^= t;
    s[3] = (s[3] << 11) | (s[3] >>> 21);

    return (result >>> 0) / 4294967296;
  }
}

// ── Global instance ──

let _seeded: SeededRandom | null = null;

/**
 * Seed the global PRNG. After calling this, `random()` returns a
 * deterministic sequence. Call with different seeds to get different sequences.
 */
export function seedRandom(seed: number): void {
  _seeded = new SeededRandom(seed);
}

/**
 * Clear the seed — `random()` reverts to `Math.random()`.
 */
export function clearSeed(): void {
  _seeded = null;
}

/**
 * Drop-in replacement for `Math.random()`.
 * If seeded, returns deterministic values; otherwise delegates to Math.random().
 */
export function random(): number {
  return _seeded ? _seeded.next() : Math.random();
}
