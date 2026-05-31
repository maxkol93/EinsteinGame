import { Rule } from './types';

export interface CellState {
  candidates: number[];
  value: number | null; // non-null once solved
}

export interface Struck {
  y: number;
  x: number;
  n: number;
  step: number; // animation order; multiply by a per-step delay in the view
}

export interface Resolved {
  y: number;
  x: number;
  n: number;
  step: number;
}

export interface ChangeSet {
  struck: Struck[];
  resolved: Resolved[];
}

/**
 * The player-facing board: each cell holds candidate values until it's solved.
 * Popping/defining drives the same row-cascade as the pygame view
 * (view/window.py): solving a cell strikes its value from the rest of its row,
 * auto-solves any cell that forces, and re-checks values that become unique in
 * the row. The answer grid keeps a cascade from ever resolving a cell to the
 * wrong value (which used to blank cells in the original).
 *
 * This model does NOT judge right/wrong — the caller compares against the
 * solution (popping the answer, or defining a non-answer, is the mistake).
 */
export class PuzzleBoard {
  readonly size: number;
  readonly cells: CellState[][];
  readonly solution: number[][];
  definedCount = 0;
  rowCascade = true;
  // Free mode (the tutorial's gesture block): a cell resolves to whatever
  // candidate is left, NOT corrected to the solution — any pop/define is valid.
  readonly free: boolean;

  private placed = new Set<number>();
  private cs: ChangeSet = { struck: [], resolved: [] };
  private step = 0;

  constructor(size: number, solution: number[][], startCells: Rule[] = [], free = false) {
    this.size = size;
    this.solution = solution;
    this.free = free;
    this.cells = [];
    for (let y = 0; y < size; y++) {
      const row: CellState[] = [];
      for (let x = 0; x < size; x++) {
        const candidates: number[] = [];
        for (let i = 0; i < size; i++) candidates.push((y + 1) * 10 + i + 1);
        row.push({ candidates, value: null });
      }
      this.cells.push(row);
    }
    for (const rule of startCells) {
      const value = rule[0] as number;
      const y = Math.floor(value / 10) - 1;
      const x = rule[2] as number;
      const cell = this.cells[y]?.[x];
      if (cell && cell.value === null && cell.candidates.includes(value)) {
        this.define(y, x, value); // changeset discarded — this is initial state
      }
    }
  }

  get isWon(): boolean {
    return this.definedCount === this.size * this.size;
  }

  /** Is value `n` the correct answer for cell (y,x)? */
  isAnswer(y: number, x: number, n: number): boolean {
    return this.solution[y]?.[x] === n;
  }

  /** Remove one candidate. Returns everything that cascaded for the view. */
  pop(y: number, x: number, n: number): ChangeSet {
    this.cs = { struck: [], resolved: [] };
    this.step = 0;
    const cell = this.cells[y]?.[x];
    if (!cell || cell.value !== null) return this.cs;
    const idx = cell.candidates.indexOf(n);
    if (idx < 0) return this.cs;
    cell.candidates.splice(idx, 1);
    this.cs.struck.push({ y, x, n, step: 0 });
    if (cell.candidates.length === 1) {
      this.cascadeResolve(y, x, cell.candidates[0]);
    }
    this.checkLastInRow(y, n);
    return this.cs;
  }

  /** Assert `n` is the cell's answer: clear the rest, then cascade. */
  define(y: number, x: number, n: number): ChangeSet {
    this.cs = { struck: [], resolved: [] };
    this.step = 0;
    const cell = this.cells[y]?.[x];
    if (!cell || cell.value !== null || !cell.candidates.includes(n)) return this.cs;
    this.cascadeResolve(y, x, n);
    return this.cs;
  }

  private cascadeResolve(row: number, x: number, n: number): void {
    // resolve to the cell's correct value when known, so a stale cascade beat
    // can't place a value already solved elsewhere in the row (skipped in free
    // mode, where the cell keeps whatever candidate the player left)
    if (!this.free) {
      const sv = this.solution[row]?.[x];
      if (sv !== undefined) n = sv;
    }

    const cell = this.cells[row][x];
    if (cell.value !== null) return;
    if (this.rowCascade && this.placed.has(n)) return; // value already placed

    const step = this.step++;
    const buttons = cell.candidates.slice();
    for (const b of buttons) this.cs.struck.push({ y: row, x, n: b, step });
    cell.candidates = [];
    cell.value = n;
    this.definedCount += 1;
    this.placed.add(n);
    this.cs.resolved.push({ y: row, x, n, step });

    this.removeAllInRow(row, n, step);
    for (const b of buttons) if (b !== n) this.checkLastInRow(row, b);
  }

  private removeAllInRow(row: number, n: number, baseStep: number): void {
    if (!this.rowCascade) return;
    let step = 0;
    for (let x = 0; x < this.size; x++) {
      const cell = this.cells[row][x];
      if (cell.value !== null) continue;
      const idx = cell.candidates.indexOf(n);
      if (idx < 0) continue;
      if (cell.candidates.length === 2) {
        // losing `n` solves this cell — flip it as its own cascade step
        const survivor = cell.candidates.find((v) => v !== n)!;
        this.cascadeResolve(row, x, survivor);
      } else {
        cell.candidates.splice(idx, 1);
        this.cs.struck.push({ y: row, x, n, step: baseStep + 0.4 + step * 0.12 });
        step += 1;
      }
    }
  }

  private checkLastInRow(row: number, n: number): void {
    if (!this.rowCascade) return;
    let count = 0;
    let column = -1;
    for (let x = 0; x < this.size; x++) {
      const cell = this.cells[row][x];
      if (cell.value !== null) continue;
      if (cell.candidates.includes(n)) {
        count += 1;
        column = x;
      }
    }
    if (count === 1) this.cascadeResolve(row, column, n);
  }
}
