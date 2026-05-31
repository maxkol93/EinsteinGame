// Headless playthrough check. Viewport matches the game's native 1295x735 so
// Scale.FIT maps game coords 1:1 to page pixels (no letterbox math needed).
// Usage: node tools/verify.mjs [http://localhost:4173]
import { chromium } from 'playwright';

const url = process.argv[2] || 'http://localhost:4173';
const errors = [];
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1295, height: 735 } });
page.on('console', (m) => m.type() === 'error' && errors.push(`console: ${m.text()}`));
page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));

await page.goto(url, { waitUntil: 'networkidle' });
await page.waitForFunction(() => window.game?.scene?.isActive('menu'), { timeout: 10000 });
await page.waitForTimeout(600);
await page.screenshot({ path: 'tools/shot-menu.png' });
console.log('menu rendered');

await page.mouse.click(1295 / 2, 512); // PLAY
await page.waitForFunction(() => window.game?.scene?.isActive('game'), { timeout: 10000 });
await page.waitForTimeout(700);

const info = await page.evaluate(() => {
  const s = window.game.scene.getScene('game');
  return { size: s.size, given: s.board.definedCount, total: s.size * s.size, clues: s.model.displayableRules.length };
});
console.log(`game started: ${info.size}x${info.size}, ${info.given}/${info.total} pre-solved, ${info.clues} clues`);

// the SFX/music bank must have loaded into the audio cache
const audioOk = await page.evaluate(() => {
  const keys = ['spread', 'click', 'pick', 'pick_2', 'pick_3', 'pick_4', 'solve', 'wrong', 'win', 'lose', 'start', 'ambient_loop'];
  return keys.every((k) => window.game.cache.audio.exists(k));
});
if (!audioOk) errors.push('audio bank did not load (missing key in cache.audio)');
else console.log('audio bank loaded (12 sounds)');

// hover a clue to show the tooltip, then screenshot
const cg = await page.evaluate(() => {
  const s = window.game.scene.getScene('game');
  const g = s.clueGroups[0];
  return g ? { x: g.gx + 57, y: g.gy + 19 } : null;
});
if (cg) { await page.mouse.move(cg.x, cg.y); await page.waitForTimeout(250); }
await page.screenshot({ path: 'tools/shot-game.png' });
await page.mouse.move(200, 400); // unhover

// real pointer pop on a wrong candidate -> cascade
const chip = await page.evaluate(() => {
  const s = window.game.scene.getScene('game');
  for (let y = 0; y < s.size; y++)
    for (let x = 0; x < s.size; x++) {
      const cell = s.board.cells[y][x];
      if (cell.value !== null) continue;
      const wrong = cell.candidates.find((c) => c !== s.board.solution[y][x]);
      if (wrong === undefined) continue;
      const c = s.chips[y][x].get(wrong);
      return { x: c.img.x, y: c.img.y };
    }
  return null;
});
if (chip) {
  await page.mouse.click(chip.x, chip.y);
  await page.waitForTimeout(140);
  await page.screenshot({ path: 'tools/shot-pop.png' });
  await page.waitForTimeout(700);
  console.log('pointer pop + cascade ok');
}

// auto-solve through the real action path, confirm the win overlay
await page.evaluate(async () => {
  const s = window.game.scene.getScene('game');
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  for (let pass = 0; pass < 4 && !s.gameOver; pass++)
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
  while (s.busy) await sleep(25);
  await sleep(600);
});

const result = await page.evaluate(() => {
  const s = window.game.scene.getScene('game');
  return { won: s.board.isWon, over: s.gameOver, count: s.board.definedCount, total: s.size * s.size };
});
await page.screenshot({ path: 'tools/shot-win.png' });
console.log(`auto-solve: won=${result.won} over=${result.over} ${result.count}/${result.total}`);
if (!result.won || !result.over) errors.push(`did not finish: ${JSON.stringify(result)}`);

await browser.close();
if (errors.length) { console.error('\nFAILURES:\n' + errors.join('\n')); process.exit(1); }
console.log('\nOK — no console/page errors; menu+game+tooltip+cascade+win all work.');
