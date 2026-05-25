// Smoke test for the ported puzzle model. Run: npm run smoke
// Verifies, across every size/difficulty:
//  1) generation succeeds (the generator's solver certified no-guess solvable),
//  2) the trimmed clue set is STILL fully solvable by deduction (a fresh
//     SelfWalkthrough on the same rules wins),
//  3) perfect elimination play drives the board to a correct, won state,
//  4) a fixed seed reproduces the identical board (Retry / seeded puzzles).
import { generatePuzzle, FieldAndRules } from '../src/model/fieldAndRules';
import { SelfWalkthrough } from '../src/model/selfWalkthrough';
import { PuzzleBoard } from '../src/model/board';
import { Rule } from '../src/model/types';

function solvableByLogic(model: FieldAndRules): boolean {
  const copy: Rule[] = model.rules.map((r) => [...r]);
  const s = new SelfWalkthrough(copy, model.size);
  s.tryToWin();
  return s.isWon;
}

let total = 0;
let fails = 0;
let clueSum = 0;
const t0 = Date.now();

for (const size of [4, 5, 6]) {
  for (const diff of [0, 1, 2]) {
    for (let k = 0; k < 30; k++) {
      total += 1;
      const { model, seed } = generatePuzzle(size, diff);
      clueSum += model.displayableRules.length;

      if (!solvableByLogic(model)) {
        fails += 1;
        console.error(`NOT LOGICALLY SOLVABLE size=${size} diff=${diff} seed=${seed}`);
        continue;
      }

      const board = new PuzzleBoard(size, model.solution, model.definedStartCells);
      for (let y = 0; y < size; y++) {
        for (let x = 0; x < size; x++) {
          const cell = board.cells[y][x];
          if (cell.value !== null) continue;
          for (const cand of [...cell.candidates]) {
            if (cand !== model.solution[y][x]) board.pop(y, x, cand);
          }
        }
      }
      if (!board.isWon) {
        fails += 1;
        console.error(`BOARD NOT WON size=${size} diff=${diff} seed=${seed} count=${board.definedCount}/${size * size}`);
        continue;
      }
      for (let y = 0; y < size; y++) {
        for (let x = 0; x < size; x++) {
          if (board.cells[y][x].value !== model.solution[y][x]) {
            fails += 1;
            console.error(`WRONG CELL size=${size} diff=${diff} seed=${seed} at ${y},${x}`);
          }
        }
      }

      // determinism: same seed → identical field + rules
      const a = generatePuzzle(size, diff, seed).model;
      const b = generatePuzzle(size, diff, seed).model;
      if (JSON.stringify(a.field) !== JSON.stringify(b.field) ||
          JSON.stringify(a.rules) !== JSON.stringify(b.rules)) {
        fails += 1;
        console.error(`NON-DETERMINISTIC seed=${seed} size=${size} diff=${diff}`);
      }
    }
  }
}

console.log(
  `generated ${total} boards in ${Date.now() - t0}ms — failures=${fails}, ` +
    `avg clues/board=${(clueSum / total).toFixed(1)}`,
);
process.exit(fails === 0 ? 0 : 1);
