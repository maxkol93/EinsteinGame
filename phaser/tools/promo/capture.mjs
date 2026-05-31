import { chromium } from 'playwright';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { mkdirSync } from 'node:fs';

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = join(HERE, '..', '..', '..', 'itch-assets', 'raw');
mkdirSync(OUT, { recursive: true });
const url = process.argv[2] || 'http://localhost:4173';

const SETTINGS = { tutorial_blocks: 6, unlock_all: true };
const STATS = {
  modes: { easy_4: { levels: 24, best: 37 }, easy_5: { levels: 9, best: 71 }, normal_5: { levels: 12, best: 95 }, normal_6: { levels: 4, best: 150 }, hard_6: { levels: 2, best: 188 } },
  streak: 4, best_streak: 9,
  daily: { last: 1, streak: 6, count: 11, best_time: 52 }, weekly: { count: 3, best_time: 121 }, monthly: { count: 1, best_time: 240 },
  achievements: ['first_win', 'flawless', 'speed', 'streak5', 'veteran', 'hard6', 'tutorial'],
};

const browser = await chromium.launch({ args: ['--disable-background-timer-throttling', '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows', '--disable-features=CalculateNativeWinOcclusion'] });
const frames = (page, n) => page.evaluate((k) => new Promise((r) => { let i = 0; const t = () => { if (++i > k) return r(); requestAnimationFrame(t); }; requestAnimationFrame(t); }), n);

async function newPage(w = 1295, h = 735, settings = SETTINGS) {
  const page = await browser.newPage({ viewport: { width: w, height: h }, deviceScaleFactor: 2 });
  await page.addInitScript((s) => { try { localStorage.setItem('einsteingame_settings', JSON.stringify(s.set)); localStorage.setItem('einsteingame_stats', JSON.stringify(s.st)); localStorage.setItem('einstein.audio', JSON.stringify({ volume: 0.7, musicVolume: 0, sfxOn: false, musicOn: false })); } catch {} }, { set: settings, st: STATS });
  await page.goto(url, { waitUntil: 'networkidle' });
  await page.waitForFunction(() => window.game?.scene?.isActive('menu'), { timeout: 12000 });
  await frames(page, 30);
  return page;
}
async function startGame(page, size, difficulty) {
  await page.evaluate((d) => window.game.scene.getScene('menu').scene.start('game', d), { size, difficulty });
  await page.waitForFunction(() => window.game?.scene?.isActive('game'), { timeout: 8000 });
  for (let i = 0; i < 8; i++) await frames(page, 6);
}
async function solve(page, threshold = -1) {
  for (let i = 0; i < 400; i++) {
    const r = await page.evaluate((th) => {
      const s = window.game.scene.getScene('game');
      if (s.busy) return 'busy';
      for (let y = 0; y < s.size; y++) for (let x = 0; x < s.size; x++) {
        if (th >= 0 && x + y > th) continue;
        const c = s.board.cells[y][x]; if (c.value !== null) continue;
        const w = c.candidates.find((v) => v !== s.board.solution[y][x]);
        if (w === undefined) continue;
        s.doAction(y, x, w, false); return 'acted';
      }
      return 'done';
    }, threshold);
    if (r === 'done') break;
    await frames(page, r === 'busy' ? 4 : 6);
  }
  for (let i = 0; i < 8; i++) await frames(page, 6);
}
async function shot(page, name, clip) {
  await page.screenshot({ path: join(OUT, name), ...(clip ? { clip } : {}) });
  console.log('  ', name);
}
const BOARD_CLIP = { x: 340, y: 60, width: 615, height: 615 };

{ const p = await newPage(); await shot(p, 'menu.png'); await p.close(); }
{ const p = await newPage(); await startGame(p, 6, 1); await solve(p, 5); await shot(p, 'game-6x6.png'); await shot(p, 'board-6x6.png', BOARD_CLIP); await p.close(); }
{ const p = await newPage(); await startGame(p, 5, 1); await solve(p, 3); await shot(p, 'board-5x5.png', BOARD_CLIP); await p.close(); }
{ const p = await newPage(); await startGame(p, 6, 2); await shot(p, 'board-fresh.png', BOARD_CLIP); await p.close(); }
{ const p = await newPage(); await p.mouse.click(1023, 530); for (let i = 0; i < 4; i++) await frames(p, 6); await shot(p, 'progress.png'); await p.close(); }
{ const p = await newPage(); await startGame(p, 4, 0); await solve(p, -1); for (let i = 0; i < 8; i++) await frames(p, 6); await shot(p, 'win.png'); await p.close(); }
{
  const p = await newPage(1295, 735, { tutorial_blocks: 1, unlock_all: true });
  await p.evaluate(() => window.game.scene.getScene('menu').scene.start('tutorial'));
  await p.waitForFunction(() => window.game?.scene?.isActive('tutorial'), { timeout: 8000 });
  for (let i = 0; i < 10; i++) await frames(p, 6);
  await shot(p, 'tutorial.png');
  await p.close();
}
console.log('done → itch-assets/raw/');
await browser.close();
