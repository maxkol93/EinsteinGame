/**
 * Persistent player progress — a TypeScript port of model/stats.py.
 *
 * What the player keeps between sessions:
 *  - per-(difficulty × board size) wins, losses, best time and total play time
 *    (drives the stats table's milestone stars and the mode-unlock progression:
 *    3 wins in a size unlock the next size; 3 wins in every size of a difficulty
 *    unlock the next difficulty).
 *  - the daily / weekly / monthly seeded counters (kept for when those land).
 *  - the win streak and the earned-badge set.
 *
 * Stored as JSON in localStorage under the SAME key the pygame web build used
 * (`einsteingame_stats`), so a player's browser save carries across versions.
 * Every access is defensive — no storage / private mode / bad JSON must never
 * throw, it just means stats don't persist.
 */

const STORE_KEY = 'einsteingame_stats';
const DIFF_KEY: Record<number, string> = { 0: 'easy', 1: 'normal', 2: 'hard' };
export const SIZES = [4, 5, 6] as const;
const DIFFS = [0, 1, 2] as const;

// Par time (seconds) per (board size, difficulty index) — for the "Quicksilver"
// achievement. Mirrors stats.py _PAR.
const PAR: Record<number, [number, number, number]> = {
  4: [45, 75, 120],
  5: [70, 120, 185],
  6: [95, 165, 255],
};

export function parTime(size: number, difficulty: number): number {
  const row = PAR[size] ?? PAR[6];
  return row[Math.max(0, Math.min(2, difficulty))];
}

export function modeKey(difficulty: number, size: number): string {
  return `${DIFF_KEY[difficulty] ?? 'easy'}_${size}`;
}

interface ModeEntry { levels: number; losses: number; best: number | null; total_time: number; }
interface SeededEntry { last: number; streak: number; best: number; count: number; best_time: number | null; }

interface StatsData {
  modes: Record<string, ModeEntry>;
  streak: number;
  best_streak: number;
  daily: SeededEntry;
  weekly: SeededEntry;
  monthly: SeededEntry;
  achievements: string[];
}

export interface StatsSummary {
  modes: Record<string, ModeEntry>;
  streak: number;
  best_streak: number;
  total_wins: number;
}

function emptyEntry(): ModeEntry { return { levels: 0, losses: 0, best: null, total_time: 0 }; }
function emptySeeded(): SeededEntry { return { last: 0, streak: 0, best: 0, count: 0, best_time: null }; }

function emptyData(): StatsData {
  const modes: Record<string, ModeEntry> = {};
  for (const d of DIFFS) for (const s of SIZES) modes[modeKey(d, s)] = emptyEntry();
  return {
    modes, streak: 0, best_streak: 0,
    daily: emptySeeded(), weekly: emptySeeded(), monthly: emptySeeded(),
    achievements: [],
  };
}

export class Stats {
  private data: StatsData = emptyData();

  constructor() {
    this.load();
  }

  // ---- persistence (defensive; mirrors stats.py field-by-field validation) ----
  private load(): void {
    let raw: string | null = null;
    try {
      raw = localStorage.getItem(STORE_KEY);
    } catch {
      return;
    }
    if (!raw) return;
    let stored: unknown;
    try {
      stored = JSON.parse(raw);
    } catch {
      return;
    }
    if (typeof stored !== 'object' || stored === null) return;
    const s = stored as Record<string, unknown>;

    const modes = s.modes;
    if (modes && typeof modes === 'object') {
      for (const [key, target] of Object.entries(this.data.modes)) {
        const entry = (modes as Record<string, unknown>)[key];
        if (!entry || typeof entry !== 'object') continue;
        const e = entry as Record<string, unknown>;
        for (const fld of ['levels', 'losses', 'total_time'] as const) {
          const v = e[fld];
          if (typeof v === 'number' && v >= 0) target[fld] = Math.floor(v);
        }
        const best = e.best;
        if (typeof best === 'number' && best > 0) target.best = Math.floor(best);
      }
    }
    for (const fld of ['streak', 'best_streak'] as const) {
      const v = s[fld];
      if (typeof v === 'number' && v >= 0) this.data[fld] = Math.floor(v);
    }
    for (const seeded of ['daily', 'weekly', 'monthly'] as const) {
      const block = s[seeded];
      if (!block || typeof block !== 'object') continue;
      const b = block as Record<string, unknown>;
      for (const fld of ['last', 'streak', 'best', 'count'] as const) {
        const v = b[fld];
        if (typeof v === 'number' && v >= 0) this.data[seeded][fld] = Math.floor(v);
      }
      const bt = b.best_time;
      if (typeof bt === 'number' && bt > 0) this.data[seeded].best_time = Math.floor(bt);
    }
    if (Array.isArray(s.achievements)) {
      this.data.achievements = s.achievements.map((x) => String(x));
    }
  }

  private save(): void {
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify(this.data));
    } catch {
      /* read-only / no storage — stats just don't persist */
    }
  }

  // ---- recording ----
  /** Count one solved level; returns the previous best time (or null if first). */
  recordWin(difficulty: number, size: number, seconds: number, countStreak = true): number | null {
    const entry = this.data.modes[modeKey(difficulty, size)];
    if (!entry) return null;
    const prev = entry.best;
    entry.levels += 1;
    seconds = Math.max(0, Math.floor(seconds));
    entry.total_time += seconds;
    if (seconds > 0 && (prev === null || seconds < prev)) entry.best = seconds;
    if (countStreak) {
      this.data.streak += 1;
      this.data.best_streak = Math.max(this.data.best_streak, this.data.streak);
    }
    this.save();
    return prev;
  }

  recordLoss(difficulty: number, size: number): void {
    const entry = this.data.modes[modeKey(difficulty, size)];
    if (!entry) return;
    entry.losses += 1;
    this.data.streak = 0;
    this.save();
  }

  /** Add achievement ids; return the subset that were genuinely new. */
  unlock(ids: Iterable<string>): string[] {
    const have = new Set(this.data.achievements);
    const fresh = [...ids].filter((i) => !have.has(i));
    if (fresh.length) {
      this.data.achievements.push(...fresh);
      this.save();
    }
    return fresh;
  }

  // ---- getters ----
  get winStreak(): number { return this.data.streak; }
  get bestStreak(): number { return this.data.best_streak; }
  get totalWins(): number {
    return Object.values(this.data.modes).reduce((a, m) => a + m.levels, 0);
  }
  get achievements(): string[] { return [...this.data.achievements]; }

  winsFor(difficulty: number, size: number): number {
    return this.data.modes[modeKey(difficulty, size)]?.levels ?? 0;
  }
  bestFor(difficulty: number, size: number): number | null {
    return this.data.modes[modeKey(difficulty, size)]?.best ?? null;
  }

  summary(): StatsSummary {
    const modes: Record<string, ModeEntry> = {};
    for (const [k, v] of Object.entries(this.data.modes)) modes[k] = { ...v };
    return { modes, streak: this.data.streak, best_streak: this.data.best_streak, total_wins: this.totalWins };
  }
}

/** Single shared instance — written through to localStorage, so every scene
 *  that imports it sees the same live progress. */
export const stats = new Stats();
