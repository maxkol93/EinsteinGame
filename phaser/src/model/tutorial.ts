// The 6-block onboarding — a faithful TypeScript port of model/tutorial.py.
//
// Two things live here:
//  * `TutorialDirector` — the progress state machine (block/level, global
//    mistakes, the 6-block tracker, and what the win plaque says).
//  * the 3x3 puzzle generator — block 0 ("Entry") teaches the gestures (no
//    clues, free pops); blocks 1..5 are real solvable 3x3 puzzles with a
//    controlled rule type, verified by the game's own SelfWalkthrough engine.
//
// Generation uses Math.random (the tutorial is never seeded — it just needs a
// fresh solvable board each time), so it does not share the seeded Rng.

import { Rule } from './types';
import { SelfWalkthrough } from './selfWalkthrough';

export const TUT_SIZE = 3;
export const BLOCK_COUNT = 6;
const LEVELS_PER_BLOCK = 6; // block 0
const LOGIC_LEVELS_PER_BLOCK = 3; // blocks 1..5

export const BLOCK_NAMES = ['Entry', 'Same column', 'Neighbors', 'Left of', 'Three in a row', 'Mixed'];

const BLOCK_MARKER: Record<number, string> = { 1: '^', 2: '<->', 3: '...', 4: 'tri' };
const ALL_MARKERS = ['^', '<->', '...', 'tri'];

// ---- text ----
export const WELCOME_TEXT =
  'Welcome to Einstein! Every cell holds a few candidate symbols. Pop the wrong ones with a quick tap — when a single symbol is left, the cell solves itself. Go ahead and try it.';
export const GESTURE_HOLD_TEXT =
  'New gesture — hold the left mouse button on a candidate to instantly set the cell to that symbol. A short tap no longer counts in these levels: only a hold defines a cell.';
export const GOAL_HINT =
  'Keep popping candidates to fill the whole board with solved cells — that is the goal of the game.';
export const FINAL_TEXT =
  'Tutorial complete — well done! Every mode and board size is now available in the menu (you still unlock them one by one by playing). In a real game mistakes cost lives, the timer runs and your records are kept. Go set some times!';

const BLOCK_INTRO: Record<number, string> = {
  0: WELCOME_TEXT,
  1: 'New rule — Same column: the two linked symbols share one column. Your clues live on the CLUES panel, on the right of the board.',
  2: 'New rule — Neighbors: the two linked symbols sit in side-by-side columns.',
  3: 'New rule — Left of: the first symbol sits somewhere to the left of the second one.',
  4: 'New rule — Three in a row: the three symbols fill three columns in a row, in that order — read left-to-right or right-to-left.',
  5: 'Now the clues mix every rule type together. Read each one carefully — you already know them all.',
};

// shown as a popup on the 1st/2nd/3rd mistake, then cycled as a gentler
// reminder inside the win plaque of any mistaken level.
const MISTAKE_TEXTS = [
  'Actually, you never need to guess in this game — read the clues before you pop a symbol.',
  'To solve a cell, pop every wrong candidate around the right one. You never click the correct symbol itself.',
  'To move on you must clear all 3 levels of a block in a row without a single mistake.',
];

export function levelsInBlock(block: number): number {
  return block === 0 ? LEVELS_PER_BLOCK : LOGIC_LEVELS_PER_BLOCK;
}

function blockPraise(block: number): string {
  const name = BLOCK_NAMES[block];
  const nxt = block + 1 < BLOCK_COUNT ? BLOCK_NAMES[block + 1] : '';
  let line = `Nice work — the "${name}" block is done!`;
  if (nxt) line += `  Next up: "${nxt}".`;
  return line;
}

function replayPraise(block: number): string {
  return `The "${BLOCK_NAMES[block]}" block — revisited and cleared. Nicely done!`;
}

// ---- random helpers (Math.random — tutorial is unseeded) ----
function randrange(n: number): number {
  return Math.floor(Math.random() * n);
}
function choice<T>(arr: T[]): T {
  return arr[randrange(arr.length)];
}
function shuffle<T>(arr: T[]): T[] {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = randrange(i + 1);
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}
/** k distinct values from 0..n-1 (like random.sample(range(n), k)). */
function sample(n: number, k: number): number[] {
  const pool: number[] = [];
  for (let i = 0; i < n; i++) pool.push(i);
  shuffle(pool);
  return pool.slice(0, k);
}

// ---- the generated level ----
export interface TutorialLevel {
  size: number;
  block: number;
  level: number;
  solution: number[][];
  definedCells: Rule[];
  clues: Rule[];
  free: boolean;
  ruleName: string;
  tapOk: boolean;
  holdOk: boolean;
}

function randomSolution(): number[][] {
  const grid: number[][] = [];
  for (let y = 0; y < TUT_SIZE; y++) {
    const vals: number[] = [];
    for (let i = 0; i < TUT_SIZE; i++) vals.push((y + 1) * 10 + i + 1);
    grid.push(shuffle(vals));
  }
  return grid;
}

function defineRules(solution: number[][], cells: Array<[number, number]>): Rule[] {
  return cells.map(([y, x]) => [solution[y][x], 'define', x]);
}

function markerOf(clue: Rule): string {
  return typeof clue[1] === 'string' ? (clue[1] as string) : 'tri';
}

// triDir forces a three-in-a-row clue to read left-to-right ('lr') or
// right-to-left ('rl'); undefined = random. Used so the "Three in a row" block
// shows both reading directions at least once across its levels.
type TriDir = 'lr' | 'rl' | undefined;

function trueClue(solution: number[][], marker: string, triDir?: TriDir): Rule {
  if (marker === '^') {
    const x = randrange(TUT_SIZE);
    const [y1, y2] = sample(TUT_SIZE, 2);
    return [solution[y1][x], '^', solution[y2][x]];
  }
  if (marker === '<->') {
    const x1 = randrange(TUT_SIZE);
    const opts = [x1 - 1, x1 + 1].filter((x) => x >= 0 && x < TUT_SIZE);
    const x2 = choice(opts);
    const y1 = randrange(TUT_SIZE);
    const y2 = randrange(TUT_SIZE);
    return [solution[y1][x1], '<->', solution[y2][x2]];
  }
  if (marker === '...') {
    const [x1, x2] = sample(TUT_SIZE, 2).sort((a, b) => a - b);
    const y1 = randrange(TUT_SIZE);
    const y2 = randrange(TUT_SIZE);
    return [solution[y1][x1], '...', solution[y2][x2]];
  }
  // 'tri' — three consecutive columns, presented in the chosen reading order
  const ys = [randrange(TUT_SIZE), randrange(TUT_SIZE), randrange(TUT_SIZE)];
  const dir: TriDir = triDir ?? (Math.random() < 0.5 ? 'lr' : 'rl');
  return dir === 'lr'
    ? [solution[ys[0]][0], solution[ys[1]][1], solution[ys[2]][2]]
    : [solution[ys[0]][2], solution[ys[1]][1], solution[ys[2]][0]];
}

function solverWins(rules: Rule[]): boolean {
  const walk = new SelfWalkthrough(rules.map((r) => [...r]), TUT_SIZE);
  walk.tryToWin();
  return walk.isWon;
}

function clueCells(solution: number[][], clue: Rule): Array<[number, number]> {
  const cells: Array<[number, number]> = [];
  for (const value of clue) {
    if (typeof value === 'number') {
      const y = Math.floor(value / 10) - 1;
      cells.push([y, solution[y].indexOf(value)]);
    }
  }
  return cells;
}

function inOpen(open: Set<string>, y: number, x: number): boolean {
  return open.has(`${y},${x}`);
}

function clueIsUseful(solution: number[][], clue: Rule, open: Set<string>): boolean {
  return clueCells(solution, clue).some(([y, x]) => inOpen(open, y, x));
}

const CLUE_COUNT: Record<number, number> = { 0: 1, 1: 2, 2: 3 };

/** Pick nRows distinct rows, open exactly two cells in each — each such row
 *  costs exactly one click, so the board costs exactly nRows clicks. */
function openCellsInRows(nRows: number): Set<string> {
  const cells = new Set<string>();
  for (const ry of sample(TUT_SIZE, nRows)) {
    for (const cx of sample(TUT_SIZE, 2)) cells.add(`${ry},${cx}`);
  }
  return cells;
}

/** Exactly nCells distinct cells from the 3x3 board (block 0 gesture practice). */
function openCellsCount(nCells: number): Set<string> {
  const all: Array<[number, number]> = [];
  for (let y = 0; y < TUT_SIZE; y++) for (let x = 0; x < TUT_SIZE; x++) all.push([y, x]);
  shuffle(all);
  const out = new Set<string>();
  for (const [y, x] of all.slice(0, nCells)) out.add(`${y},${x}`);
  return out;
}

const BLOCK0_CELLS = [6, 7, 8, 6, 7, 8];

function givenFromOpen(open: Set<string>): Array<[number, number]> {
  const given: Array<[number, number]> = [];
  for (let y = 0; y < TUT_SIZE; y++) for (let x = 0; x < TUT_SIZE; x++) {
    if (!inOpen(open, y, x)) given.push([y, x]);
  }
  return given;
}

function makeLevel(
  block: number, level: number, solution: number[][],
  definedCells: Rule[], clues: Rule[], tapOk = true, holdOk = true,
): TutorialLevel {
  return {
    size: TUT_SIZE, block, level, solution, definedCells, clues,
    free: block === 0, ruleName: BLOCK_NAMES[block], tapOk, holdOk,
  };
}

function generateEntry(level: number): TutorialLevel {
  const cellCount = BLOCK0_CELLS[level];
  const solution = randomSolution();
  let open: Set<string>;
  let tapOk: boolean;
  let holdOk: boolean;
  if (level < 3) {
    // the cascade-friendly "2 per row" layout while it fits (6 cells = 3 rows);
    // 7/8 cells spill into a free count layout
    if (cellCount === 6) open = openCellsInRows(3);
    else open = openCellsCount(cellCount);
    tapOk = true; holdOk = false;
  } else {
    open = openCellsCount(cellCount);
    tapOk = false; holdOk = true;
  }
  return makeLevel(0, level, solution, defineRules(solution, givenFromOpen(open)), [], tapOk, holdOk);
}

function markersFor(block: number, count: number): string[] {
  if (block in BLOCK_MARKER) return new Array(count).fill(BLOCK_MARKER[block]);
  let picks: string[] = [];
  for (let i = 0; i < 40; i++) {
    picks = [];
    for (let j = 0; j < count; j++) picks.push(choice(ALL_MARKERS));
    if (count < 2 || new Set(picks).size >= 2) return picks;
  }
  return picks;
}

function ruleEq(a: Rule, b: Rule): boolean {
  return a.length === b.length && a.every((v, i) => v === b[i]);
}

function makeClues(solution: number[][], block: number, count: number, open: Set<string>, triDir?: TriDir): Rule[] | null {
  const markers = markersFor(block, count);
  const clues: Rule[] = [];
  for (const marker of markers) {
    let found = false;
    for (let i = 0; i < 60; i++) {
      const clue = trueClue(solution, marker, triDir);
      if (clues.some((c) => ruleEq(c, clue))) continue;
      if (!clueIsUseful(solution, clue, open)) continue;
      clues.push(clue);
      found = true;
      break;
    }
    if (!found) return null;
  }
  if (clues.length !== count) return null;
  if (block === 5 && count > 1 && new Set(clues.map(markerOf)).size < 2) return null;
  return clues;
}

function cluesAllNeeded(defined: Rule[], clues: Rule[]): boolean {
  for (let i = 0; i < clues.length; i++) {
    if (solverWins([...defined, ...clues.slice(0, i), ...clues.slice(i + 1)])) return false;
  }
  return true;
}

function generateLogic(block: number, level: number): TutorialLevel {
  const wantClues = CLUE_COUNT[level];
  const wantRows = level + 1;
  // Three-in-a-row block: force level 0 to read left-to-right and level 1
  // right-to-left, so both directions are taught; level 2 is free.
  const triDir: TriDir = block === 4 ? (level === 0 ? 'lr' : level === 1 ? 'rl' : undefined) : undefined;
  let fallback: { solution: number[][]; defined: Rule[]; clues: Rule[] } | null = null;
  const strict = 800;
  for (let attempt = 0; attempt < 3200; attempt++) {
    if (attempt >= strict && fallback) break;
    const solution = randomSolution();
    const open = openCellsInRows(wantRows);
    const defined = defineRules(solution, givenFromOpen(open));
    if (solverWins(defined)) continue; // must not solve itself before a clue
    const clues = makeClues(solution, block, wantClues, open, triDir);
    if (clues === null) continue;
    if (!solverWins([...defined, ...clues])) continue;
    if (cluesAllNeeded(defined, clues)) return makeLevel(block, level, solution, defined, clues);
    if (!fallback) fallback = { solution, defined, clues };
  }
  if (fallback) return makeLevel(block, level, fallback.solution, fallback.defined, fallback.clues);
  return generateLogic(block, level); // vanishingly rare
}

export function generateLevel(block: number, level: number): TutorialLevel {
  return block === 0 ? generateEntry(level) : generateLogic(block, level);
}

// ---- tracker row ----
export interface TrackerRow {
  name: string;
  cleared: number;
  total: number;
  done: boolean;
  current: boolean;
}

export type Outcome = 'level' | 'reset' | 'block' | 'replay' | 'tutorial';
export interface CompleteResult {
  outcome: Outcome;
  goalHint: boolean;
  praise: string | null;
  reminder: string | null;
  final: string | null;
}

// ---- progress state machine ----
export class TutorialDirector {
  blocksDone: number;
  replay = false;
  block: number;
  level = 0;
  mistakes = 0;
  levelHadMistake = false;
  private reminder = 0;
  private introShown = new Set<number>();
  private gestureShown = false;

  constructor(blocksDone = 0) {
    this.blocksDone = Math.max(0, Math.min(BLOCK_COUNT, Math.floor(blocksDone)));
    this.block = this.blocksDone < BLOCK_COUNT ? this.blocksDone : 0;
  }

  get allDone(): boolean {
    return this.blocksDone >= BLOCK_COUNT;
  }

  hasLogic(): boolean {
    return this.block > 0;
  }

  blockName(): string {
    return BLOCK_NAMES[this.block];
  }

  currentLevel(): TutorialLevel {
    return generateLevel(this.block, this.level);
  }

  /** Block-intro popup text — once, on the first visit to a block's level 0. */
  introText(): string | null {
    if (this.level !== 0 || this.introShown.has(this.block)) return null;
    this.introShown.add(this.block);
    return BLOCK_INTRO[this.block] ?? null;
  }

  /** The "switch to hold" popup, once, entering level 3 of block 0. */
  gestureIntro(): string | null {
    if (this.block !== 0 || this.level !== 3 || this.gestureShown) return null;
    this.gestureShown = true;
    return GESTURE_HOLD_TEXT;
  }

  startReplay(block: number): void {
    this.replay = true;
    this.block = Math.max(0, Math.min(BLOCK_COUNT - 1, Math.floor(block)));
    this.level = 0;
    this.levelHadMistake = false;
    this.introShown.delete(this.block);
    if (this.block === 0) this.gestureShown = false;
  }

  restartAll(): void {
    this.blocksDone = 0;
    this.block = 0;
    this.level = 0;
    this.mistakes = 0;
    this.levelHadMistake = false;
    this.replay = false;
    this.introShown.clear();
    this.gestureShown = false;
  }

  skipAll(): void {
    this.blocksDone = BLOCK_COUNT;
    this.replay = false;
  }

  /** Register a wrong click. Returns a teaching text for the first three. */
  recordMistake(): string | null {
    this.levelHadMistake = true;
    this.mistakes += 1;
    return this.mistakes <= MISTAKE_TEXTS.length ? MISTAKE_TEXTS[this.mistakes - 1] : null;
  }

  private nextReminder(): string {
    const text = MISTAKE_TEXTS[this.reminder % MISTAKE_TEXTS.length];
    this.reminder += 1;
    return text;
  }

  completeLevel(): CompleteResult {
    const wasBlock = this.block;
    const wasLevel = this.level;
    const mistaken = this.hasLogic() && this.levelHadMistake;
    this.levelHadMistake = false;
    const result: CompleteResult = { outcome: 'level', goalHint: false, praise: null, reminder: null, final: null };

    if (mistaken) {
      result.outcome = 'reset';
      result.reminder = this.nextReminder();
      this.level = 0;
      return result;
    }

    if (wasBlock === 0 && wasLevel === 0) result.goalHint = true;

    this.level += 1;
    if (this.level < levelsInBlock(wasBlock)) return result;

    this.level = 0;
    if (this.replay) {
      result.outcome = 'replay';
      result.praise = replayPraise(wasBlock);
      this.replay = false;
      return result;
    }

    if (wasBlock === this.blocksDone) this.blocksDone += 1;

    if (this.blocksDone >= BLOCK_COUNT) {
      result.outcome = 'tutorial';
      result.final = FINAL_TEXT;
      return result;
    }

    result.outcome = 'block';
    result.praise = blockPraise(wasBlock);
    this.block = wasBlock + 1;
    return result;
  }

  tracker(): TrackerRow[] {
    const playing = !(this.allDone && !this.replay);
    const rows: TrackerRow[] = [];
    for (let i = 0; i < BLOCK_COUNT; i++) {
      const total = levelsInBlock(i);
      const isCurrent = i === this.block && playing;
      const clearedBlock = i < this.blocksDone || i < this.block;
      let cleared: number;
      let done: boolean;
      if (isCurrent) {
        cleared = Math.min(total, this.level);
        done = false;
      } else if (clearedBlock) {
        cleared = total;
        done = true;
      } else {
        cleared = 0;
        done = false;
      }
      rows.push({ name: BLOCK_NAMES[i], cleared, total, done, current: isCurrent });
    }
    return rows;
  }
}
