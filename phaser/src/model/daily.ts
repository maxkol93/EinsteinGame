// Seeded puzzles — daily, weekly, monthly. A TS port of model/daily.py's
// config (size/difficulty/seed/number derived from the calendar period).
//
// NOTE: the seeds here are NOT bit-identical to the pygame build — the user
// ships only the Phaser version, so cross-version sync isn't needed. Each
// period is still deterministic for every Phaser player, so times are
// comparable. The seed feeds generatePuzzle() (mulberry32), same as a normal
// random board.

export type SeededKind = 'daily' | 'weekly' | 'monthly';

export interface SeededConfig {
  kind: SeededKind;
  period: number; // a per-kind ordinal (day / week-index / month-index)
  number: number; // 1-based puzzle number since the epoch
  size: number;
  difficulty: number;
  seed: number;
}

// 2026-01-01 as a day ordinal (days since 1970-01-01, UTC).
const EPOCH_DAY = Math.floor(Date.UTC(2026, 0, 1) / 86_400_000);

// A week-long rotation so the daily varies but stays fair.
const DAILY_SIZE = [5, 6, 5, 6, 4, 6, 5];
const DAILY_DIFF = [1, 1, 2, 1, 1, 2, 1];

/** Day ordinal for a Date (default: now), in the player's local timezone. */
function dayOrdinal(d: Date = new Date()): number {
  // local midnight → ordinal
  return Math.floor(new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime() / 86_400_000)
    - Math.floor(new Date(1970, 0, 1).getTime() / 86_400_000);
}

/** Monday-anchored week ordinal (ticks once per ISO week). */
function weekOrdinal(d: Date = new Date()): number {
  const day = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const dow = (day.getDay() + 6) % 7; // Mon=0..Sun=6
  const monday = new Date(day);
  monday.setDate(day.getDate() - dow);
  return Math.floor(monday.getTime() / 86_400_000) - Math.floor(new Date(1970, 0, 1).getTime() / 86_400_000);
}

function monthOrdinal(d: Date = new Date()): number {
  return d.getFullYear() * 12 + d.getMonth();
}

// 32-bit unsigned multiply → a spread-out positive seed.
function hashSeed(n: number, mul: number): number {
  return (Math.imul(n >>> 0, mul) >>> 0) & 0x7fffffff || 1;
}

export function dailyConfig(d: Date = new Date()): SeededConfig {
  const day = dayOrdinal(d);
  const i = ((day % 7) + 7) % 7;
  return {
    kind: 'daily', period: day, number: day - EPOCH_DAY + 1,
    size: DAILY_SIZE[i], difficulty: DAILY_DIFF[i], seed: hashSeed(day, 2654435761),
  };
}

export function weeklyConfig(d: Date = new Date()): SeededConfig {
  const week = weekOrdinal(d);
  const epochWeek = weekOrdinal(new Date(2026, 0, 1));
  const idx = Math.floor((week - epochWeek) / 7);
  return {
    kind: 'weekly', period: week, number: idx + 1,
    size: 6, difficulty: 2, seed: hashSeed(week, 40503),
  };
}

export function monthlyConfig(d: Date = new Date()): SeededConfig {
  const month = monthOrdinal(d);
  const epochMonth = monthOrdinal(new Date(2026, 0, 1));
  return {
    kind: 'monthly', period: month, number: month - epochMonth + 1,
    size: 6, difficulty: 2, seed: hashSeed(month, 0x9e3779b1),
  };
}

export function seededConfig(kind: SeededKind, d: Date = new Date()): SeededConfig {
  return kind === 'daily' ? dailyConfig(d) : kind === 'weekly' ? weeklyConfig(d) : monthlyConfig(d);
}
