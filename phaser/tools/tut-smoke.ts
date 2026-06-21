import { TutorialDirector, generateLevel, levelsInBlock, BLOCK_COUNT } from '../src/model/tutorial';
import { SelfWalkthrough } from '../src/model/selfWalkthrough';

let fails = 0, n = 0;
const t0 = Date.now();
for (let rep = 0; rep < 20; rep++) {
  for (let block = 0; block < BLOCK_COUNT; block++) {
    for (let level = 0; level < levelsInBlock(block); level++) {
      const lv = generateLevel(block, level);
      n++;
      if (block === 0) {
        // entry: free, no clues, correct gesture flags
        if (lv.clues.length !== 0) { fails++; console.log(`b0 has clues`); }
        const tapHalf = level < 2;
        if (lv.tapOk !== tapHalf || lv.holdOk !== !tapHalf) { fails++; console.log(`b0 gesture flags wrong l${level}`); }
      } else {
        // logic: must be solvable by defined+clues, clues = level+1
        if (lv.clues.length !== level + 1) { fails++; console.log(`b${block} l${level} clue count ${lv.clues.length}`); }
        const walk = new SelfWalkthrough([...lv.definedCells, ...lv.clues].map(r => [...r]), 3);
        walk.tryToWin();
        if (!walk.isWon) { fails++; console.log(`b${block} l${level} NOT solvable`); }
      }
    }
  }
}
// director flow: a clean run should reach 'tutorial'
const d = new TutorialDirector(0);
let guard = 0, outcome = '';
while (guard++ < 60) {
  // simulate clearing each level with no mistake
  const r = d.completeLevel();
  outcome = r.outcome;
  if (outcome === 'tutorial') break;
}
console.log(`generated ${n} tutorial levels in ${Date.now()-t0}ms — failures=${fails}; director reaches '${outcome}' (blocksDone=${d.blocksDone})`);
process.exit(fails || outcome !== 'tutorial' ? 1 : 0);
