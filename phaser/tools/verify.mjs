// Headless playthrough check. Loads the running dev/preview server, drives the
// real menu + game scenes, and fails on any console/page error.
// Usage: node tools/verify.mjs http://localhost:4173
import { chromium } from 'playwright';

const url = process.argv[2] || 'http://localhost:4173';
const errors = [];

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
page.on('console', (m) => m.type() === 'error' && errors.push(`console: ${m.text()}`));
page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));

await page.goto(url, { waitUntil: 'networkidle' });
await page.waitForFunction(() => window.game?.scene?.isActive('menu'), { timeout: 10000 });
await page.waitForTimeout(400);
await page.screenshot({ path: 'tools/shot-menu.png' });
console.log('menu rendered');

// PLAY button is at game coords (640, 506) — viewport matches 1280x720 1:1
await page.mouse.click(640, 506);
await page.waitForFunction(() => window.game?.scene?.isActive('game'), { timeout: 10000 });
await page.waitForTimeout(500);
await page.screenshot({ path: 'tools/shot-game.png' });

const info = await page.evaluate(() => {
  const s = window.game.scene.getScene('game');
  return { size: s.size, given: s.board.definedCount, total: s.size * s.size, clues: s.model.displayableRules.length };
});
console.log(`game started: ${info.size}x${info.size}, ${info.given}/${info.total} pre-solved, ${info.clues} clues shown`);

// real pointer pop: click a wrong candidate's chip in the first unsolved cell
const popped = await page.evaluate(() => {
  const s = window.game.scene.getScene('game');
  for (let y = 0; y < s.size; y++)
    for (let x = 0; x < s.size; x++) {
      const cell = s.board.cells[y][x];
      if (cell.value !== null) continue;
      const wrong = cell.candidates.find((c) => c !== s.board.solution[y][x]);
      if (wrong === undefined) continue;
      const chip = s.chips[y][x].get(wrong);
      return { x: chip.x, y: chip.y };
    }
  return null;
});
if (popped) {
  await page.mouse.click(popped.x, popped.y);
  await page.waitForTimeout(700);
  await page.screenshot({ path: 'tools/shot-pop.png' });
  console.log('pointer pop + cascade ok');
}

// auto-solve through the real action path, then confirm the win overlay
await page.evaluate(async () => {
  const s = window.game.scene.getScene('game');
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  for (let pass = 0; pass < 4 && !s.gameOver; pass++) {
    for (let y = 0; y < s.size; y++)
      for (let x = 0; x < s.size; x++) {
        let guard = 0;
        while (s.board.cells[y][x].value === null && guard++ < 40) {
          const cands = [...s.board.cells[y][x].candidates];
          const wrong = cands.find((c) => c !== s.board.solution[y][x]);
          if (wrong === undefined) break;
          while (s.busy) await sleep(25);
          s.doAction(y, x, wrong, false);
          await sleep(25);
        }
      }
  }
  while (s.busy) await sleep(25);
  await sleep(400);
});

const result = await page.evaluate(() => {
  const s = window.game.scene.getScene('game');
  return { won: s.board.isWon, gameOver: s.gameOver, count: s.board.definedCount, total: s.size * s.size };
});
await page.screenshot({ path: 'tools/shot-win.png' });
console.log(`auto-solve: won=${result.won} gameOver=${result.gameOver} ${result.count}/${result.total}`);

if (!result.won || !result.gameOver) errors.push(`did not reach a won/finished state: ${JSON.stringify(result)}`);

await browser.close();

if (errors.length) {
  console.error('\nFAILURES:\n' + errors.join('\n'));
  process.exit(1);
}
console.log('\nOK — no console/page errors, menu+game+cascade+win all work.');
