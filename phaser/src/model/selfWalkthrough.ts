import { Rule } from './types';

/**
 * Faithful port of model/self_walkthrough.py.
 *
 * Decides whether the puzzle is solvable by pure deduction (no guessing) under
 * the current rule set, and trims redundant rules. A cell is either a definite
 * value (number) or a list of remaining candidates (number[]). The generator
 * keeps adding rules until this solver reports `isWon`, so any board it accepts
 * is solvable by exactly this chain of deductions — i.e. by a human following
 * the same logic.
 */
export class SelfWalkthrough {
  private rules: Rule[];
  private readonly size: number;
  private field: Array<Array<number | number[]>> = [];
  private won = false;
  private readonly iterLimit = 10;
  private undefinedCount = 0;
  private countIter = 0;

  constructor(rules: Rule[], size: number) {
    this.rules = rules;
    this.size = size;
    this.generateField();
  }

  get isWon(): boolean {
    return this.won;
  }

  private generateField(): void {
    this.field = [];
    for (let y = 0; y < this.size; y++) {
      const row: Array<number | number[]> = [];
      for (let x = 0; x < this.size; x++) {
        const cell: number[] = [];
        for (let i = 0; i < this.size; i++) cell.push((y + 1) * 10 + i + 1);
        row.push(cell);
      }
      this.field.push(row);
    }
  }

  tryToWin(): void {
    this.won = false;
    this.generateField();
    this.undefinedCount = this.size ** 2;
    this.countIter = 0;
    while (!this.won && this.countIter < this.iterLimit) {
      this.simpleIter();
      this.countIter += 1;
      if (this.undefinedCount === 0) this.won = true;
    }
  }

  updateRules(rules: Rule[]): void {
    this.rules = rules;
    this.tryToWin();
  }

  /** Drop rules (from `startIndex` on) that the puzzle stays solvable without.
   *  Mutates the shared rules array in place, like the Python version. */
  tryToRemoveRules(startIndex: number): void {
    let curInd = startIndex;
    while (curInd < this.rules.length - 1) {
      const removed = this.rules.splice(curInd, 1)[0];
      this.tryToWin();
      if (!this.won) {
        this.rules.splice(curInd, 0, removed);
        curInd += 1;
      }
    }
  }

  // ---------------- iterate over the rules ----------------

  private simpleIter(): void {
    for (const rule of this.rules) {
      const y0 = Math.floor((rule[0] as number) / 10) - 1;
      const y2 = Math.floor((rule[2] as number) / 10) - 1;
      if (rule[1] === '^') {
        this.ruleSameColumnsCheckAll(y0, y2, rule[0] as number, rule[2] as number);
      }
      if (rule[1] === '...') {
        this.ruleLeftToRight(y0, y2, rule);
      }
      if (rule[1] === '<->') {
        for (let x = 0; x < this.size; x++) {
          this.ruleNeighborCheck(y0, y2, x, rule[0] as number, rule[2] as number);
          this.ruleNeighborCheck(y2, y0, x, rule[2] as number, rule[0] as number);
        }
      }
      if (typeof rule[1] === 'number') {
        this.ruleThreeInRowCheck(y0, y2, rule);
      }
      if (rule[1] === 'define') {
        this.defineThisCell(
          Math.floor((rule[0] as number) / 10) - 1,
          rule[2] as number,
          rule[0] as number,
        );
      }
    }
  }

  private ruleSameColumnsCheckAll(y1: number, y2: number, n1: number, n2: number): void {
    for (let x = 0; x < this.size; x++) {
      this.sameColumnCheck(y1, y2, x, n1, n2);
      this.sameColumnCheck(y2, y1, x, n2, n1);
    }
  }

  private ruleLeftToRight(y0: number, y2: number, rule: Rule): void {
    const a = rule[0] as number;
    const c = rule[2] as number;
    for (let x = 0; x < this.size; x++) {
      this.removeNumberInCell(y2, x, c);
      if (this.numInCell(y0, x, a)) break;
    }
    let ind = this.size - 1;
    while (ind >= 0) {
      this.removeNumberInCell(y0, ind, a);
      if (this.numInCell(y2, ind, c)) break;
      ind -= 1;
    }
  }

  private ruleThreeInRowCheck(y0: number, y2: number, rule: Rule): void {
    const r = rule as number[];
    const y1 = Math.floor(r[1] / 10) - 1;
    this.removeNumberInCell(y1, 0, r[1]); // middle value can't sit on the edges
    this.removeNumberInCell(y1, this.size - 1, r[1]);

    // which of the three values are already placed, and in which column
    const defined = new Map<number, number>();
    const rows = [y0, y1, y2];
    for (let i = 0; i < 3; i++) {
      const y = rows[i];
      for (let x = 0; x < this.size; x++) {
        if (this.field[y][x] === r[i]) {
          defined.set(i, x);
          break;
        }
      }
    }

    if (defined.size === 2) this.defineOther(defined, r);
    if (defined.size === 1 && (defined.has(0) || defined.has(2))) {
      const v0 = [...defined.values()][0];
      if (v0 <= 1 || v0 >= this.size - 2) this.defineOther(defined, r);
    } else {
      this.checkOther(defined, r);
    }

    for (let i = 0; i < 2; i++) {
      const sy1 = Math.floor(r[i] / 10) - 1;
      const sy2 = Math.floor(r[i + 1] / 10) - 1;
      for (let x = 0; x < this.size; x++) {
        this.ruleNeighborCheck(sy1, sy2, x, r[i], r[i + 1]);
        this.ruleNeighborCheck(sy2, sy1, x, r[i + 1], r[i]);
      }
    }

    for (let x = 0; x < this.size; x++) {
      this.checkThroughOne(y0, y2, x, r[0], r[2]);
      this.checkThroughOne(y2, y0, x, r[2], r[0]);
    }

    for (let x = 0; x < this.size; x++) {
      if (!this.numInCell(y0, x, r[0]) && !this.numInCell(y2, x, r[2])) {
        if (x > 0) this.removeNumberInCell(y1, x - 1, r[1]);
        if (x < this.size - 1) this.removeNumberInCell(y1, x + 1, r[1]);
      }
    }
  }

  // ---------------- per-rule checks ----------------

  private inBounds(y: number, x: number): boolean {
    return y >= 0 && y < this.size && x >= 0 && x < this.size;
  }

  private numInCell(y: number, x: number, n: number): boolean {
    if (!this.inBounds(y, x)) return false;
    const cell = this.field[y][x];
    if (typeof cell === 'number') return cell === n;
    return cell.includes(n);
  }

  private sameColumnCheck(y1: number, y2: number, x: number, n1: number, n2: number): void {
    const cell = this.field[y1][x];
    if (typeof cell === 'number') {
      if (cell === n1) this.defineThisCell(y2, x, n2);
      else this.removeNumberInCell(y2, x, n2);
    } else if (!cell.includes(n1)) {
      this.removeNumberInCell(y2, x, n2);
    }
  }

  private checkNeighborColumn(
    y1: number, y2: number, x: number, n1: number, n2: number, dx: number,
  ): void {
    if (!this.numInCell(y2, x + dx, n2)) this.removeNumberInCell(y1, x, n1);
  }

  private ruleNeighborCheck(y1: number, y2: number, x: number, n1: number, n2: number): void {
    if (x === 0) {
      this.checkNeighborColumn(y1, y2, x, n1, n2, 1);
    } else if (x === this.size - 1) {
      this.checkNeighborColumn(y1, y2, x, n1, n2, -1);
    } else {
      if (!this.numInCell(y2, x - 1, n2) && !this.numInCell(y2, x + 1, n2)) {
        this.removeNumberInCell(y1, x, n1);
      }
      if (
        (x === 1 && this.field[y2][0] === n2) ||
        (x === this.size - 2 && this.field[y2][this.size - 1] === n2)
      ) {
        this.defineThisCell(y1, x, n1);
      }
      if (this.field[y2][x] === n2) {
        const inds: number[] = [];
        for (let i = 0; i < this.size; i++) inds.push(i);
        this.safeRemove(inds, x - 1);
        this.safeRemove(inds, x + 1);
        for (const i of inds) this.removeNumberInCell(y1, i, n1);
      }
    }
  }

  private checkThroughOne(y1: number, y2: number, x: number, n1: number, n2: number): void {
    if (x <= 1) {
      this.checkNeighborColumn(y1, y2, x, n1, n2, 2);
    } else if (x >= this.size - 2) {
      this.checkNeighborColumn(y1, y2, x, n1, n2, -2);
    } else if (!this.numInCell(y2, x - 2, n2) && !this.numInCell(y2, x + 2, n2)) {
      this.removeNumberInCell(y1, x, n1);
    }
  }

  private defineOther(defined: Map<number, number>, rule: number[]): void {
    if (defined.size === 1) {
      const x = [...defined.values()][0];
      const ys = rule.map((i) => Math.floor(i / 10) - 1);
      const ind1 = 1;
      const ind2 = defined.has(0) ? 2 : 0;
      const dx = x <= 1 ? 1 : -1;
      this.defineThisCell(ys[ind1], x + dx, rule[ind1]);
      this.defineThisCell(ys[ind2], x + dx * 2, rule[ind2]);
    } else if (defined.size === 2) {
      const vals = [...defined.values()];
      let curX: number;
      let curInd: number;
      if (Math.abs(vals[0] - vals[1]) === 2) {
        curX = Math.floor((vals[0] + vals[1]) / 2);
        curInd = 1;
      } else if (!defined.has(0)) {
        curX = defined.get(1)! + (defined.get(1)! - defined.get(2)!);
        curInd = 0;
      } else if (!defined.has(2)) {
        curX = defined.get(1)! + (defined.get(1)! - defined.get(0)!);
        curInd = 2;
      } else {
        // keys {0,2} with the columns not 2 apart — an inconsistent mid-
        // deduction state. Python leaves cur_x/cur_ind unbound (it would
        // raise); rather than define a NaN column, do nothing. (Matches
        // self_walkthrough.py: only the `0 not in` / `2 not in` branches act.)
        return;
      }
      this.defineThisCell(Math.floor(rule[curInd] / 10) - 1, curX, rule[curInd]);
    }
  }

  private checkOther(defined: Map<number, number>, rule: number[]): void {
    const y0 = Math.floor(rule[0] / 10) - 1;
    const y1 = Math.floor(rule[1] / 10) - 1;
    const y2 = Math.floor(rule[2] / 10) - 1;
    const range = (): number[] => {
      const a: number[] = [];
      for (let i = 0; i < this.size; i++) a.push(i);
      return a;
    };
    if (defined.has(1)) {
      const inds = range();
      this.safeRemove(inds, defined.get(1)! - 1);
      this.safeRemove(inds, defined.get(1)! + 1);
      for (const x of inds) {
        this.removeNumberInCell(y0, x, rule[0]);
        this.removeNumberInCell(y2, x, rule[2]);
      }
    } else if (defined.has(0)) {
      const xs1 = range();
      this.safeRemove(xs1, defined.get(0)! - 1);
      this.safeRemove(xs1, defined.get(0)! + 1);
      const xs2 = range();
      this.safeRemove(xs2, defined.get(0)! - 2);
      this.safeRemove(xs2, defined.get(0)! + 2);
      for (const x of xs1) this.removeNumberInCell(y1, x, rule[1]);
      for (const x of xs2) this.removeNumberInCell(y2, x, rule[2]);
    } else if (defined.has(2)) {
      const xs1 = range();
      this.safeRemove(xs1, defined.get(2)! - 1);
      this.safeRemove(xs1, defined.get(2)! + 1);
      const xs0 = range();
      this.safeRemove(xs0, defined.get(2)! - 2);
      this.safeRemove(xs0, defined.get(2)! + 2);
      for (const x of xs1) this.removeNumberInCell(y1, x, rule[1]);
      for (const x of xs0) this.removeNumberInCell(y0, x, rule[0]);
    }
  }

  private safeRemove(lst: number[], value: number): void {
    const i = lst.indexOf(value);
    if (i >= 0) lst.splice(i, 1);
  }

  // ---------------- field mutation ----------------

  private removeAllBattonInRow(row: number, n: number): void {
    for (let x = 0; x < this.size; x++) {
      const cell = this.field[row][x];
      if (Array.isArray(cell)) {
        const idx = cell.indexOf(n);
        if (idx >= 0) {
          cell.splice(idx, 1);
          if (cell.length === 1) {
            const other = cell.pop()!;
            this.defineThisCell(row, x, other);
            this.removeAllBattonInRow(row, other);
          }
        }
      }
    }
  }

  private defineThisCell(y: number, x: number, n: number): void {
    if (!this.inBounds(y, x)) return;
    if (Array.isArray(this.field[y][x])) {
      this.undefinedCount -= 1;
      this.field[y][x] = n;
    }
    this.removeAllBattonInRow(y, n);
  }

  private checkRow(row: number, n: number): void {
    let count = 0;
    let column = -1;
    let checkCell: number[] | null = null;
    for (let x = 0; x < this.size; x++) {
      const cell = this.field[row][x];
      if (Array.isArray(cell) && cell.includes(n)) {
        count += 1;
        column = x;
        checkCell = cell;
      }
    }
    if (count === 1 && checkCell) {
      this.removeAllButtonInCell(checkCell, row, column, n);
    }
  }

  private removeAllButtonInCell(cell: number[], row: number, column: number, n: number): void {
    const forCheck = [...cell];
    this.defineThisCell(row, column, n);
    for (const btn of forCheck) this.checkRow(row, btn);
  }

  private removeNumberInCell(y: number, x: number, n: number): void {
    if (!this.inBounds(y, x)) return;
    const cell = this.field[y][x];
    if (Array.isArray(cell)) {
      const idx = cell.indexOf(n);
      if (idx >= 0) {
        cell.splice(idx, 1);
        if (cell.length === 1) this.defineThisCell(y, x, cell[0]);
        this.checkRow(y, n);
      }
    }
  }
}
