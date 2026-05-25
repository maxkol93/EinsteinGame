import { chromium } from 'playwright';
const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: 1000, height: 760 } });
await p.goto('http://localhost:4173', { waitUntil: 'networkidle' });
await p.waitForFunction(() => window.game?.scene?.isActive('menu'), { timeout: 10000 });
await p.waitForTimeout(400);

const map = await p.evaluate(() => {
  const g = window.game, cr = g.canvas.getBoundingClientRect(), sm = g.scale;
  return { left: cr.left, top: cr.top, w: cr.width, h: cr.height, gW: sm.gameSize.width, gH: sm.gameSize.height };
});
const sx = (gx) => map.left + gx * (map.w / map.gW);
const sy = (gy) => map.top + gy * (map.h / map.gH);

const vis = await p.evaluate(() => {
  const s = window.game.scene.getScene('menu');
  return s.sizeBtns.map((btn, i) => {
    const r = btn.root.getBounds();
    return { i, l: Math.round(r.x), r: Math.round(r.x + r.width), cy: r.y + r.height / 2 };
  });
});
console.log('visual button x-ranges:', vis.map((v) => `[${v.l}..${v.r}]`).join(' '));

const cy = vis[0].cy;
let line = '';
for (let gx = 380; gx <= 900; gx += 10) {
  await p.mouse.move(sx(gx), sy(cy));
  const idx = await p.evaluate(() => {
    const g = window.game, s = g.scene.getScene('menu');
    const objs = s.input.hitTestPointer(g.input.activePointer);
    for (const o of objs) {
      const k = s.sizeBtns.findIndex((btn) => btn.root.list.includes(o));
      if (k >= 0) return k;
    }
    return -1;
  });
  line += idx < 0 ? '.' : String(idx);
}
console.log('hit-test sweep (gx 380..900 step10):');
console.log(line);
for (const v of vis) console.log(`  button ${v.i}: visual cols ${Math.round((v.l - 380) / 10)}..${Math.round((v.r - 380) / 10)}`);
await b.close();
