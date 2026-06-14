/**
 * Mode-unlock progression — ported from presenter/game.py.
 *
 *  - Size: 4×4 is always open. 5×5 needs ≥3 wins in 4×4 (same difficulty);
 *    6×6 needs ≥3 wins in 5×5 (same difficulty).
 *  - Difficulty: Easy is always open. Normal needs ≥3 wins in EVERY size of
 *    Easy; Hard needs ≥3 wins in every size of Normal.
 *
 * `unlockAll` (the debug flag, toggled with U in the menu) opens everything.
 */
import { Stats, SIZES } from './stats';

export const UNLOCK_THRESHOLD = 3;

// 7×7 is a hidden bonus mode — it must not gate difficulty unlocks.
const DIFF_UNLOCK_SIZES = [4, 5, 6] as const;

export function sizeUnlocked(stats: Stats, difficulty: number, size: number, unlockAll: boolean): boolean {
  if (unlockAll) return true;
  if (size === 4) return true;
  const prev = size - 1;
  return stats.winsFor(difficulty, prev) >= UNLOCK_THRESHOLD;
}

export function diffUnlocked(stats: Stats, difficulty: number, unlockAll: boolean): boolean {
  if (unlockAll || difficulty === 0) return true;
  const prev = difficulty - 1;
  return DIFF_UNLOCK_SIZES.every((s) => stats.winsFor(prev, s) >= UNLOCK_THRESHOLD);
}

/** Per-size lock flags against a selected difficulty (true = locked). */
export function sizeLocks(stats: Stats, difficulty: number, unlockAll: boolean): boolean[] {
  return SIZES.map((s) => !sizeUnlocked(stats, difficulty, s, unlockAll));
}

/** Per-difficulty lock flags (true = locked). */
export function diffLocks(stats: Stats, unlockAll: boolean): boolean[] {
  return [0, 1, 2].map((d) => !diffUnlocked(stats, d, unlockAll));
}
