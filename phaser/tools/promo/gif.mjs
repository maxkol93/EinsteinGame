// Record real-game GIFs for the itch page + socials. Headless rAF is throttled
// on this box (tweens jump), so we drive a HEADED browser for true real-time
// animation, screenshot at ~15fps, and encode with gifenc (pure JS).
// Output → ../../../itch-assets/
import { chromium } from 'playwright';
import gifenc from 'gifenc';
const { GIFEncoder, quantize, applyPalette } = gifenc;
import { PNG } from 'pngjs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { mkdirSync, writeFileSync } from 'node:fs';

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = join(HERE, '..', '..', '..', 'itch-assets');
mkdirSync(OUT, { recursive: true });
const url = process.argv[2] || 'http://localhost:4173';
const only = process.argv[3]; // optional: run a single scenario by name

const SETTINGS = { tutorial_blocks: 6, unlock_all: true };
const STATS = { modes: { easy_4: { levels: 24, best: 37 }, normal_6: { levels: 4, best: 150 } }, streak: 4, best_streak: 9, daily: { last: 1, streak: 6, count: 11, best_time: 52 }, achievements: ['first_win', 'flawless'] };

const browser = await chromium.launch({ headless: false, args: ['--disable-features=CalculateNativeWinOcclusion'] });

async function newPage(w, h, settings = SETTINGS) {
  const page = await browser.newPage({ viewport: { width: w, height: h }, deviceScaleFactor: 1 });
  await page.addInitScript((s) => { try { localStorage.setItem('einsteingame_settings', JSON.stringify(s.set)); localStorage.setItem('einsteingame_stats', JSON.stringify(s.st)); localStorage.setItem('einstein.audio', JSON.stringify({ volume: 0, musicVolume: 0, sfxOn: false, musicOn: false })); } catch {} }, { set: settings, st: STATS });
  await page.goto(url, { waitUntil: 'networkidle' });
  await page.waitForFunction(() => window.game?.scene?.isActive('menu'), { timeout: 12000 });
  await page.waitForTimeout(500);
  return page;
}
async function startGame(page, size, difficulty) {
  await page.evaluate((d) => window.game.scene.getScene('menu').scene.start('game', d), { size, difficulty });
  await page.waitForFunction(() => window.game?.scene?.isActive('game'), { timeout: 8000 });
  await page.waitForTimeout(900); // entrance cascade settles
}
// pop one wrong candidate inside an optional triangle (th<0 = anywhere); returns false when none left
const popNext = (page, th) => page.evaluate((th) => {
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
}, th);

function downscale(rgba, W, H, tw, th) {
  const out = new Uint8ClampedArray(tw * th * 4);
  for (let y = 0; y < th; y++) { const sy = Math.min(H - 1, (y * H / th) | 0); for (let x = 0; x < tw; x++) { const sx = Math.min(W - 1, (x * W / tw) | 0); const si = (sy * W + sx) * 4, di = (y * tw + x) * 4; out[di] = rgba[si]; out[di + 1] = rgba[si + 1]; out[di + 2] = rgba[si + 2]; out[di + 3] = 255; } }
  return out;
}
async function grab(page, clip, tw, th) {
  const buf = await page.screenshot({ clip });
  const png = PNG.sync.read(buf);
  return downscale(new Uint8ClampedArray(png.data.buffer, png.data.byteOffset, png.data.length), png.width, png.height, tw, th);
}
function encode(frames, tw, th, delay, name) {
  const gif = GIFEncoder();
  for (const f of frames) { const pal = quantize(f, 256); const idx = applyPalette(f, pal); gif.writeFrame(idx, tw, th, { palette: pal, delay }); }
  gif.finish();
  writeFileSync(join(OUT, name), Buffer.from(gif.bytes()));
  console.log('  ', name, `${tw}x${th} ${frames.length}f`);
}

// ---- scenarios ----
const scenarios = {
  // hero cascade: a 6x6 fills in pop-by-pop with juice
  async cascade() {
    const page = await newPage(1295, 735);
    await startGame(page, 6, 1);
    const clip = { x: 300, y: 35, width: 690, height: 668 }, tw = 470, th = 455;
    const frames = [];
    for (let i = 0; i < 56; i++) {
      if (i % 2 === 0) await popNext(page, -1);
      frames.push(await grab(page, clip, tw, th));
      await page.waitForTimeout(70);
    }
    for (let i = 0; i < 8; i++) { frames.push(await grab(page, clip, tw, th)); await page.waitForTimeout(70); } // hold the solved board
    encode(frames, tw, th, 7, 'gif-cascade.gif');
    await page.close();
  },
  // win plaque + confetti rain
  async win() {
    const page = await newPage(1295, 735);
    await startGame(page, 4, 0);
    let r; do { r = await popNext(page, -1); await page.waitForTimeout(20); } while (r !== 'done'); // solve almost instantly
    const clip = { x: 250, y: 20, width: 800, height: 700 }, tw = 480, th = 420;
    const frames = [];
    for (let i = 0; i < 60; i++) { frames.push(await grab(page, clip, tw, th)); await page.waitForTimeout(70); }
    encode(frames, tw, th, 7, 'gif-win.gif');
    await page.close();
  },
  // hover a clue → cross-highlight sweeps the row/column
  async hover() {
    const page = await newPage(1295, 735);
    await startGame(page, 6, 1);
    await popNext(page, 4); await page.waitForTimeout(400); // some context solved
    const clip = { x: 300, y: 35, width: 690, height: 668 }, tw = 470, th = 455;
    const frames = [];
    const spots = [[1010, 120], [1010, 200], [1010, 290], [560, 110], [560, 230], [560, 360], [1010, 380]];
    let si = 0;
    for (let i = 0; i < 48; i++) {
      if (i % 6 === 0) { const [mx, my] = spots[si % spots.length]; si++; await page.mouse.move(mx, my, { steps: 3 }); }
      frames.push(await grab(page, clip, tw, th));
      await page.waitForTimeout(80);
    }
    encode(frames, tw, th, 8, 'gif-hover.gif');
    await page.close();
  },
  // vertical social short: portrait cascade
  async short() {
    const page = await newPage(560, 1100);
    await startGame(page, 6, 1);
    const clip = { x: 0, y: 0, width: 560, height: 1100 }, tw = 360, th = 707;
    const frames = [];
    for (let i = 0; i < 52; i++) {
      if (i % 2 === 0) await popNext(page, -1);
      frames.push(await grab(page, clip, tw, th));
      await page.waitForTimeout(75);
    }
    for (let i = 0; i < 8; i++) { frames.push(await grab(page, clip, tw, th)); await page.waitForTimeout(75); }
    encode(frames, tw, th, 8, 'short-cascade.gif');
    await page.close();
  },
};

const names = only ? [only] : Object.keys(scenarios);
for (const n of names) { console.log('scenario:', n); await scenarios[n](); }
console.log('done → itch-assets/');
await browser.close();
