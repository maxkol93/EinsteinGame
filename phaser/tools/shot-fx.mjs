// Captures the interaction states the scripted verify doesn't: a hovered
// candidate (outline + lift) and a wrong move (cell flood red + edge vignette).
// Usage: node tools/shot-fx.mjs [http://localhost:4173]
import { chromium } from 'playwright';

const url = process.argv[2] || 'http://localhost:4173';
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1295, height: 735 } });
const errors = [];
page.on('console', (m) => m.type() === 'error' && errors.push(`console: ${m.text()}`));
page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));

await page.goto(url, { waitUntil: 'networkidle' });
await page.waitForFunction(() => window.game?.scene?.isActive('menu'), { timeout: 10000 });
await page.mouse.click(1295 / 2, 512); // PLAY
await page.waitForFunction(() => window.game?.scene?.isActive('game'), { timeout: 10000 });
await page.waitForTimeout(700);

// --- hover a candidate chip ---
const hoverPt = await page.evaluate(() => {
  const s = window.game.scene.getScene('game');
  for (let y = 0; y < s.size; y++)
    for (let x = 0; x < s.size; x++) {
      const cell = s.board.cells[y][x];
      if (cell.value !== null) continue;
      const c = s.chips[y][x].values().next().value;
      if (c) return { x: c.img.x, y: c.img.y };
    }
  return null;
});
if (hoverPt) {
  await page.mouse.move(hoverPt.x, hoverPt.y);
  await page.waitForTimeout(330); // > HOVER_SPREAD_MS so twins + clues light up
  await page.screenshot({ path: 'tools/shot-hover.png' });
  console.log('hover captured');
  await page.mouse.move(60, 60); // unhover
  await page.waitForTimeout(200);
}

// --- a WRONG move: pop the answer candidate (a mistake) ---
const wrongPt = await page.evaluate(() => {
  const s = window.game.scene.getScene('game');
  for (let y = 0; y < s.size; y++)
    for (let x = 0; x < s.size; x++) {
      const cell = s.board.cells[y][x];
      if (cell.value !== null) continue;
      const ans = s.board.solution[y][x];
      if (!cell.candidates.includes(ans)) continue;
      const c = s.chips[y][x].get(ans);
      if (c) return { x: c.img.x, y: c.img.y };
    }
  return null;
});
if (wrongPt) {
  await page.mouse.click(wrongPt.x, wrongPt.y);
  await page.waitForTimeout(120); // catch peak red flash + vignette pulse
  await page.screenshot({ path: 'tools/shot-wrong.png' });
  console.log('wrong-move captured');
}

await browser.close();
if (errors.length) { console.error('\nFAILURES:\n' + errors.join('\n')); process.exit(1); }
console.log('OK — hover + wrong-move states captured, no console errors.');
