import { Rule } from './types';
import { Rng } from './rng';
import { SelfWalkthrough } from './selfWalkthrough';

// Pre-revealed starter cells per (size, difficulty). Easy hands a big head
// start; Hard reveals nothing. Mirror of presenter/game.py _COMPLEXITY.
export const COMPLEXITY: Record<number, [number, number, number]> = {
  4: [9, 4, 0],
  5: [14, 7, 0],
  6: [20, 10, 0],
};

const MAX_RULE_ADDS = 600;
const MAX_RULE_ATTEMPTS = 400;

/**
 * Faithful port of model/field_and_rules.py.
 *
 * Generates the solved board (`field`), a set of clues (`rules`) and the
 * revealed starter cells (`definedStartCells`). The rule set is grown with
 * random clues until {@link SelfWalkthrough} can fully deduce the board, then
 * trimmed of redundant clues — so every generated puzzle is solvable without
 * guessing.
 */
export class FieldAndRules {
  readonly seed: number;
  readonly size: number;
  readonly field: number[][];
  readonly rules: Rule[] = [];
  readonly definedStartCells: Rule[] = [];
  readonly definedStartCellsCount: number;

  private readonly rng: Rng;
  private minNums: Array<[number, number]> = [];
  private solver!: SelfWalkthrough;

  constructor(complexity: number, size: number, seed: number) {
    this.seed = seed;
    this.size = size;
    this.rng = new Rng(seed);
    this.field = this.generateFinalField();
    this.definedStartCellsCount = complexity;
    this.generateStartRules();
    this.initSolver();
  }

  /** The solved board doubles as the answer grid for the player's cascade. */
  get solution(): number[][] {
    return this.field;
  }

  /** Clues shown to the player (the revealed starter cells are excluded — the
   *  board pre-solves those instead). */
  get displayableRules(): Rule[] {
    return this.rules.slice(this.definedStartCellsCount);
  }

  private generateFinalField(): number[][] {
    const data: number[][] = [];
    for (let y = 0; y < this.size; y++) {
      const row: number[] = [];
      let count = this.size;
      while (count) {
        const n = (y + 1) * 10 + this.rng.randint(1, this.size);
        if (!row.includes(n)) {
          row.push(n);
          count -= 1;
        }
      }
      data.push(row);
    }
    return data;
  }

  private generateStartRules(): void {
    // N*(N-1) cells, N-1 per row — the minimum pool the clues are built from.
    this.minNums = [];
    for (let row = 0; row < this.size; row++) {
      const inds: number[] = [];
      for (let i = 0; i < this.size; i++) inds.push(i);
      const drop = this.rng.randint(0, this.size - 1);
      inds.splice(inds.indexOf(drop), 1);
      for (const column of inds) this.minNums.push([row, column]);
    }

    // revealed starter cells
    for (let i = 0; i < this.definedStartCellsCount; i++) {
      const idx = this.rng.randint(0, this.minNums.length - 1);
      const num = this.minNums[idx];
      const rule: Rule = [this.field[num[0]][num[1]], 'define', num[1]];
      this.rules.push(rule);
      this.definedStartCells.push(rule);
      this.minNums.splice(idx, 1);
    }

    // pair the rest into minimal starting clues
    while (this.minNums.length) {
      if (this.minNums.length === 1) {
        const num = this.minNums.shift()!;
        this.createStartRule(num, [
          this.rng.randint(0, this.size - 1),
          this.rng.randint(0, this.size - 1),
        ]);
      } else {
        const num = this.minNums.shift()!;
        const ri = this.rng.randint(0, this.minNums.length - 1);
        const rand = this.minNums.splice(ri, 1)[0];
        this.createStartRule(num, rand);
      }
    }
  }

  private initSolver(): void {
    this.solver = new SelfWalkthrough(this.rules, this.size);
    this.solver.tryToWin();
    let adds = 0;
    while (!this.solver.isWon) {
      if (adds >= MAX_RULE_ADDS) {
        throw new Error(
          `FieldAndRules: gave up generating rules for seed ${this.seed} (size=${this.size})`,
        );
      }
      this.runUpdateRules();
      adds += 1;
    }
    this.solver.tryToRemoveRules(this.definedStartCellsCount);
  }

  private runUpdateRules(): void {
    for (let i = 0; i < MAX_RULE_ATTEMPTS; i++) {
      const r = this.createRule(this.rng.randint(1, 4));
      if (!this.ruleExists(r)) {
        this.rules.push(r);
        this.solver.updateRules(this.rules);
        return;
      }
    }
    throw new Error(
      `FieldAndRules: ${MAX_RULE_ATTEMPTS} rule-create attempts produced only duplicates (seed=${this.seed}, size=${this.size})`,
    );
  }

  private ruleExists(r: Rule): boolean {
    return this.rules.some(
      (e) => e.length === r.length && e.every((v, i) => v === r[i]),
    );
  }

  // num1/num2 are [row, column]
  private createStartRule(num1: [number, number], num2: [number, number]): void {
    const [y1, x1] = num1;
    const [y2, x2] = num2;
    let ruleType: number;
    if (x1 === x2) ruleType = 1;
    else if (Math.abs(x1 - x2) === 1) ruleType = this.rng.choice([2, 3, 3]);
    else if (Math.abs(x1 - x2) === 2) ruleType = this.rng.choice([2, 4, 4]);
    else ruleType = 2;

    if (ruleType === 1) {
      this.rules.push([this.field[y1][x1], '^', this.field[y2][x2]]);
    } else if (ruleType === 2) {
      if (x1 < x2) this.rules.push([this.field[y1][x1], '...', this.field[y2][x2]]);
      else if (x1 > x2) this.rules.push([this.field[y2][x2], '...', this.field[y1][x1]]);
    } else if (ruleType === 3) {
      this.rules.push([this.field[y1][x1], '<->', this.field[y2][x2]]);
    } else if (ruleType === 4) {
      const xMid = Math.floor((x1 + x2) / 2);
      const yMid = this.rng.randint(0, this.size - 1);
      const k = this.minNums.findIndex((p) => p[0] === yMid && p[1] === xMid);
      if (k >= 0) this.minNums.splice(k, 1);
      this.rules.push([this.field[y1][x1], this.field[yMid][xMid], this.field[y2][x2]]);
    }
  }

  private createRule(ruleType: number): Rule {
    const last = this.size - 1;
    const y = this.rng.randint(0, last);
    const x = this.rng.randint(0, last);
    if (ruleType === 1) {
      let y2 = y;
      while (y2 === y) y2 = this.rng.randint(0, last);
      return [this.field[y][x], '^', this.field[y2][x]];
    }
    if (ruleType === 2) {
      const x1 = this.rng.randint(0, last - 1);
      const x2 = this.rng.randint(x1 + 1, last);
      const y2 = this.rng.randint(0, last);
      return [this.field[y][x1], '...', this.field[y2][x2]];
    }
    if (ruleType === 3) {
      let x2: number;
      if (x === 0) x2 = 1;
      else if (x === last) x2 = last - 1;
      else x2 = x + this.rng.choice([-1, 1]);
      const y2 = this.rng.randint(0, last);
      return [this.field[y][x], '<->', this.field[y2][x2]];
    }
    // ruleType === 4 : three in a row
    let dx: number;
    if (x <= 1) dx = 1;
    else if (x >= this.size - 2) dx = -1;
    else dx = this.rng.choice([-1, 1]);
    const x2 = x + dx;
    const x3 = x2 + dx;
    const y2 = this.rng.randint(0, last);
    const y3 = this.rng.randint(0, last);
    return [this.field[y][x], this.field[y2][x2], this.field[y3][x3]];
  }
}

/** Build a puzzle, re-rolling the seed if the generator's safety caps trip. */
export function generatePuzzle(
  size: number,
  difficulty: number,
  seed?: number,
): { model: FieldAndRules; seed: number } {
  let s = seed ?? 1 + Math.floor(Math.random() * (2 ** 31 - 1));
  const complexity = COMPLEXITY[size][difficulty];
  let lastErr: unknown;
  for (let attempt = 0; attempt < 10; attempt++) {
    try {
      return { model: new FieldAndRules(complexity, size, s), seed: s };
    } catch (e) {
      lastErr = e;
      s = ((s * 1103515245 + 12345) & 0x7fffffff) || 1;
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error('puzzle generation failed');
}
