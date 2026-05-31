/**
 * Achievements — a fixed set of badges, ported from model/achievements.py.
 *
 * The game already tracks every number a badge needs; `evaluate()` reads a
 * context snapshot and returns the ids it satisfies. The caller diffs that
 * against what's already unlocked to find the freshly-earned ones.
 */

export interface Achievement { id: string; name: string; desc: string; }

// Order is the display order.
export const ACHIEVEMENTS: Achievement[] = [
  { id: 'first_win', name: 'First Light', desc: 'Win your first puzzle' },
  { id: 'flawless', name: 'Flawless', desc: 'Solve a board with zero mistakes' },
  { id: 'three_star', name: 'Top Marks', desc: 'Earn a three-star grade' },
  { id: 'speed', name: 'Quicksilver', desc: 'Beat the par time on a board' },
  { id: 'streak5', name: 'On a Roll', desc: 'Win five puzzles in a row' },
  { id: 'hard6', name: 'Brain Melt', desc: 'Win a 6x6 board on Hard' },
  { id: 'tutorial', name: 'Schooled', desc: 'Finish the whole tutorial' },
  { id: 'daily7', name: 'Daily Habit', desc: 'Reach a seven-day daily streak' },
  { id: 'zen', name: 'Inner Peace', desc: 'Finish a board in Zen mode' },
  { id: 'veteran', name: 'Veteran', desc: 'Win twenty-five puzzles' },
];

const INFO = new Map(ACHIEVEMENTS.map((a) => [a.id, a]));

/** (name, desc) for an id, with a safe fallback. */
export function achievementInfo(id: string): Achievement {
  return INFO.get(id) ?? { id, name: id, desc: '' };
}

export interface AchievementCtx {
  won?: boolean;
  totalWins?: number;
  mistakes?: number;
  stars?: number;
  par?: number | null;
  seconds?: number;
  winStreak?: number;
  size?: number;
  difficulty?: number;
  tutorialDone?: boolean;
  dailyStreak?: number;
  zen?: boolean;
}

/** The set of achievement ids the snapshot currently satisfies. Defensive — a
 *  partial context simply satisfies fewer badges. */
export function evaluate(ctx: AchievementCtx): Set<string> {
  const won = !!ctx.won;
  const earned = new Set<string>();
  if ((ctx.totalWins ?? 0) >= 1) earned.add('first_win');
  if ((ctx.totalWins ?? 0) >= 25) earned.add('veteran');
  if (won && (ctx.mistakes ?? 1) === 0) earned.add('flawless');
  if ((ctx.stars ?? 0) >= 3) earned.add('three_star');
  if (won && ctx.par && (ctx.seconds ?? 1e9) <= ctx.par) earned.add('speed');
  if ((ctx.winStreak ?? 0) >= 5) earned.add('streak5');
  if (won && ctx.size === 6 && ctx.difficulty === 2) earned.add('hard6');
  if (ctx.tutorialDone) earned.add('tutorial');
  if ((ctx.dailyStreak ?? 0) >= 7) earned.add('daily7');
  if (won && ctx.zen) earned.add('zen');
  return earned;
}
