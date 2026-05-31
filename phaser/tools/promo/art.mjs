// Compose the itch.io page art from the captured board crops + designed canvas
// layers. Pure-canvas inside Playwright (no ImageMagick). Single-sourced colors
// from shared/palette.json; DejaVu font served by the preview server.
// Output → ../../../itch-assets/
import { chromium } from 'playwright';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..', '..', '..');
const RAW = join(ROOT, 'itch-assets', 'raw');
const OUT = join(ROOT, 'itch-assets');
mkdirSync(OUT, { recursive: true });
const url = process.argv[2] || 'http://localhost:4173';

const palRaw = JSON.parse(readFileSync(join(ROOT, 'shared', 'palette.json'), 'utf8'));
const pal = { ...palRaw, rows: Object.values(palRaw.rows) }; // rows is a {1..6} map → array
const b64 = (f) => 'data:image/png;base64,' + readFileSync(join(RAW, f)).toString('base64');
const IMGS = {
  board6: b64('board-6x6.png'),
  board5: b64('board-5x5.png'),
  fresh: b64('board-fresh.png'),
  game: b64('game-6x6.png'),
};

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 });
await page.goto(url, { waitUntil: 'domcontentloaded' });

// Load the bundled font that the game uses (served from /fonts).
await page.evaluate(async () => {
  const reg = async (name, file, weight) => {
    const f = new FontFace(name, `url(/fonts/${file})`, { weight });
    await f.load(); document.fonts.add(f);
  };
  try {
    await reg('DejaVu', 'DejaVuSans.ttf', '400');
    await reg('DejaVu', 'DejaVuSans-Bold.ttf', '700');
  } catch {}
  await document.fonts.ready;
});

// Everything below runs in-page: it has the canvas 2D API + loaded fonts.
async function render(name, w, h, fn) {
  const dataUrl = await page.evaluate(async ({ w, h, fnStr, pal, IMGS }) => {
    const load = (src) => new Promise((res) => { const i = new Image(); i.onload = () => res(i); i.src = src; });
    const imgs = {};
    for (const k of Object.keys(IMGS)) imgs[k] = await load(IMGS[k]);
    const cv = document.createElement('canvas'); cv.width = w; cv.height = h;
    const ctx = cv.getContext('2d');

    // ---- shared helpers (in-page) ----
    const C = pal;
    const rows = C.rows;
    function rr(x, y, w, h, r) { ctx.beginPath(); ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r); ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath(); }
    function mix(a, b, t) { const pa = [parseInt(a.slice(1, 3), 16), parseInt(a.slice(3, 5), 16), parseInt(a.slice(5, 7), 16)]; const pb = [parseInt(b.slice(1, 3), 16), parseInt(b.slice(3, 5), 16), parseInt(b.slice(5, 7), 16)]; const m = pa.map((v, i) => Math.round(v + (pb[i] - v) * t)); return `rgb(${m[0]},${m[1]},${m[2]})`; }
    // seeded prng for reproducible scatter
    let seed = 1337; const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
    function bg(grad = true) {
      if (grad) { const g = ctx.createRadialGradient(w * 0.5, h * 0.42, 0, w * 0.5, h * 0.5, Math.max(w, h) * 0.75); g.addColorStop(0, mix(C.bg, '#000000', -0.0)); g.addColorStop(0, '#241f20'); g.addColorStop(1, C.bg); ctx.fillStyle = g; } else ctx.fillStyle = C.bg;
      ctx.fillRect(0, 0, w, h);
    }
    function scatter(alpha, count, sz, wrap) {
      ctx.save(); ctx.globalAlpha = alpha;
      for (let i = 0; i < count; i++) {
        const x = rnd() * w, y = rnd() * h, s = sz * (0.6 + rnd() * 0.9), col = rows[(rnd() * rows.length) | 0], a = (rnd() - 0.5) * 0.6;
        const draw = (dx, dy) => { ctx.save(); ctx.translate(x + dx, y + dy); ctx.rotate(a); rr(-s / 2, -s / 2, s, s, s * 0.22); ctx.fillStyle = col; ctx.fill(); ctx.restore(); };
        draw(0, 0);
        if (wrap) { draw(-w, 0); draw(w, 0); draw(0, -h); draw(0, h); draw(-w, -h); draw(w, h); draw(-w, h); draw(w, -h); }
      }
      ctx.restore();
    }
    function vignette(strength = 0.55) { const g = ctx.createRadialGradient(w / 2, h / 2, Math.min(w, h) * 0.25, w / 2, h / 2, Math.max(w, h) * 0.7); g.addColorStop(0, 'rgba(0,0,0,0)'); g.addColorStop(1, `rgba(0,0,0,${strength})`); ctx.fillStyle = g; ctx.fillRect(0, 0, w, h); }
    function dots(cx, cy, r, gap) { for (let i = 0; i < rows.length; i++) { ctx.beginPath(); ctx.arc(cx + i * gap, cy, r, 0, 7); ctx.fillStyle = rows[i]; ctx.fill(); } }
    // game-style tile with vertical gradient + sheen
    function tile(x, y, s, col, glyph, fontPx) {
      ctx.save();
      ctx.shadowColor = 'rgba(0,0,0,0.45)'; ctx.shadowBlur = s * 0.08; ctx.shadowOffsetY = s * 0.04;
      const g = ctx.createLinearGradient(0, y, 0, y + s); g.addColorStop(0, mix(col, '#ffffff', 0.16)); g.addColorStop(0.5, col); g.addColorStop(1, mix(col, '#000000', 0.22));
      rr(x, y, s, s, s * 0.14); ctx.fillStyle = g; ctx.fill();
      ctx.shadowColor = 'transparent';
      // sheen
      const sh = ctx.createLinearGradient(0, y, 0, y + s * 0.5); sh.addColorStop(0, 'rgba(255,255,255,0.22)'); sh.addColorStop(1, 'rgba(255,255,255,0)');
      rr(x + s * 0.06, y + s * 0.06, s - s * 0.12, s * 0.42, s * 0.1); ctx.fillStyle = sh; ctx.fill();
      if (glyph) { ctx.fillStyle = 'rgba(255,255,255,0.96)'; ctx.font = `700 ${fontPx || s * 0.5}px DejaVu`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(glyph, x + s / 2, y + s / 2 + s * 0.02); }
      ctx.restore();
    }
    function candidate(x, y, s, col, glyphs) {
      rr(x, y, s, s, s * 0.1); ctx.fillStyle = mix(C.bg, '#000', 0.15); ctx.fill();
      const m = s * 0.18, cs = (s - m * 3) / 2;
      glyphs.forEach((gl, i) => { const gx = x + m + (i % 2) * (cs + m), gy = y + m + ((i / 2) | 0) * (cs + m); rr(gx, gy, cs, cs, cs * 0.18); ctx.fillStyle = col; ctx.fill(); ctx.fillStyle = 'rgba(255,255,255,0.92)'; ctx.font = `700 ${cs * 0.55}px DejaVu`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(gl, gx + cs / 2, gy + cs / 2); });
    }
    function title(cx, y, text, px, spacing) { ctx.save(); ctx.font = `700 ${px}px DejaVu`; ctx.letterSpacing = spacing + 'px'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillStyle = C.text; ctx.shadowColor = 'rgba(0,0,0,0.5)'; ctx.shadowBlur = px * 0.25; ctx.shadowOffsetY = px * 0.05; ctx.fillText(text, cx + spacing / 2, y); ctx.restore(); }
    function imgAngled(im, cx, cy, dw, deg, shadow = true) { ctx.save(); ctx.translate(cx, cy); ctx.rotate(deg * Math.PI / 180); const dh = dw * im.height / im.width; if (shadow) { ctx.shadowColor = 'rgba(0,0,0,0.5)'; ctx.shadowBlur = dw * 0.06; ctx.shadowOffsetY = dw * 0.03; } rr(-dw / 2, -dh / 2, dw, dh, dw * 0.04); ctx.clip(); ctx.drawImage(im, -dw / 2, -dh / 2, dw, dh); ctx.restore(); ctx.save(); ctx.translate(cx, cy); ctx.rotate(deg * Math.PI / 180); rr(-dw / 2, -dh / 2, dw, dh, dw * 0.04); ctx.lineWidth = 2; ctx.strokeStyle = 'rgba(255,255,255,0.08)'; ctx.stroke(); ctx.restore(); }

    const api = { ctx, cv, w, h, C, rows, rr, mix, rnd, bg, scatter, vignette, dots, tile, candidate, title, imgAngled, imgs };
    const fn = new Function('a', `with(a){ return (${fnStr})(a); }`);
    await fn(api);
    return cv.toDataURL('image/png');
  }, { w, h, fnStr: fn.toString(), pal, IMGS });
  const buf = Buffer.from(dataUrl.split(',')[1], 'base64');
  writeFileSync(join(OUT, name), buf);
  console.log('  ', name, `${w}x${h}`);
}

// ============ COVER 1260x1000 (itch 630x500 @2x) ============
await render('cover.png', 1260, 1000, (a) => {
  const { bg, scatter, vignette, title, dots, imgAngled, imgs, w, ctx, C } = a;
  bg(); scatter(0.06, 26, 70, false);
  imgAngled(imgs.board6, w * 0.6, 680, 720, -7);
  title(w / 2, 168, 'EINSTEIN', 112, 16);
  ctx.font = '400 36px DejaVu'; ctx.letterSpacing = '5px'; ctx.textAlign = 'center'; ctx.fillStyle = C.accent; ctx.fillText('a logic-grid deduction puzzle', w / 2 + 2.5, 238);
  ctx.letterSpacing = '0px';
  dots(w / 2 - 5 * 24, 292, 9, 48);
  vignette(0.6);
});

// ============ BANNER 1920x640 (3:1, social header) ============
await render('banner.png', 1920, 640, (a) => {
  const { bg, scatter, vignette, title, dots, imgAngled, imgs, ctx, C } = a;
  bg(); scatter(0.06, 30, 64, false);
  imgAngled(imgs.board6, 1560, 320, 620, -6);
  imgAngled(imgs.board5, 1180, 360, 360, 8);
  ctx.textAlign = 'left';
  ctx.font = '700 116px DejaVu'; ctx.letterSpacing = '20px'; ctx.fillStyle = C.text; ctx.shadowColor = 'rgba(0,0,0,0.5)'; ctx.shadowBlur = 24; ctx.fillText('EINSTEIN', 120, 250); ctx.shadowColor = 'transparent';
  ctx.font = '400 34px DejaVu'; ctx.letterSpacing = '2px'; ctx.fillStyle = C.accent;
  ctx.fillText("Einstein's riddle — the satisfying kind.", 124, 330);
  ctx.fillText('One clue, and the whole board cascades into place.', 124, 380);
  ctx.letterSpacing = '0px'; dots(128, 450, 9, 46);
  vignette(0.5);
});

// ============ PATTERN tile 640x640 (seamless page background) ============
await render('pattern.png', 640, 640, (a) => {
  const { ctx, w, h, C, mix } = a;
  ctx.fillStyle = mix(C.bg, '#ffffff', 0.02); ctx.fillRect(0, 0, w, h);
  a.scatter(0.20, 34, 58, true);
});

// ============ EMBED-BG 1920x1080 (behind the game iframe) ============
await render('embed-bg.png', 1920, 1080, (a) => {
  const { bg, scatter, vignette, imgAngled, imgs, ctx } = a;
  bg(); scatter(0.05, 40, 70, false);
  ctx.save(); ctx.globalAlpha = 0.07; imgAngled(imgs.board6, 960, 540, 900, -7, false); ctx.restore();
  vignette(0.74);
});

// ============ HOW-TO-PLAY infographic 1200x1500 ============
await render('how-to-play.png', 1200, 1500, (a) => {
  const { bg, scatter, vignette, dots, tile, candidate, rr, mix, ctx, C, rows, w } = a;
  bg(); scatter(0.05, 22, 64, false);
  // header
  ctx.textAlign = 'center'; ctx.textBaseline = 'alphabetic';
  ctx.font = '700 70px DejaVu'; ctx.letterSpacing = '10px'; ctx.fillStyle = C.text; ctx.shadowColor = 'rgba(0,0,0,0.5)'; ctx.shadowBlur = 18; ctx.fillText('HOW TO PLAY', w / 2 + 5, 130); ctx.shadowColor = 'transparent';
  ctx.font = '400 30px DejaVu'; ctx.letterSpacing = '2px'; ctx.fillStyle = C.accent; ctx.fillText("One clue, and the whole board cascades into place.", w / 2 + 1, 182);
  ctx.letterSpacing = '0px'; dots(w / 2 - 5 * 22, 222, 8, 44);

  const steps = [
    { t: 'Pop the wrong ones', c: ['Every cell hides every symbol.', 'Tap a cell to pop a value that the', 'clues rule out — it vanishes.'] },
    { t: 'Read the clues', c: ['Clues sit beside the board:', '↕ same column   ↔ neighbours', '… left-of   · · · somewhere right'] },
    { t: 'Watch it cascade', c: ['The last symbol standing solves', 'the cell — and that deduction', 'chains across the whole board.'] },
  ];
  const cardX = 90, cardW = w - 180, cardH = 330, gap = 40, top = 290;
  for (let i = 0; i < 3; i++) {
    const y = top + i * (cardH + gap);
    // card
    rr(cardX, y, cardW, cardH, 28); ctx.fillStyle = mix(C.panel, '#ffffff', 0.03); ctx.fill();
    rr(cardX, y, cardW, cardH, 28); ctx.lineWidth = 2; ctx.strokeStyle = 'rgba(255,255,255,0.06)'; ctx.stroke();
    // number badge
    const bx = cardX + 90, by = y + 90;
    ctx.beginPath(); ctx.arc(bx, by, 44, 0, 7); ctx.fillStyle = rows[i * 2]; ctx.fill();
    ctx.fillStyle = '#fff'; ctx.font = '700 50px DejaVu'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(String(i + 1), bx, by + 3);
    // title + caption
    ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
    ctx.font = '700 42px DejaVu'; ctx.fillStyle = C.text; ctx.fillText(steps[i].t, cardX + 160, y + 86);
    ctx.font = '400 30px DejaVu'; ctx.fillStyle = C.accent;
    steps[i].c.forEach((ln, k) => ctx.fillText(ln, cardX + 160, y + 146 + k * 44));
    // illustration on right
    const ix = cardX + cardW - 260, iy = y + 55, s = 110;
    if (i === 0) { // candidate with a popping value
      candidate(ix + 30, iy, s, rows[3], ['A', 'B', 'C', 'D']);
      // ghost "popped" tile to the right with X
      ctx.save(); ctx.globalAlpha = 0.5; tile(ix + 30 + s + 28, iy, s, rows[3], '', s * 0.5); ctx.restore();
      ctx.strokeStyle = 'rgba(245,240,236,0.85)'; ctx.lineWidth = 7; ctx.lineCap = 'round';
      const cx = ix + 30 + s + 28 + s / 2, cy = iy + s / 2, r = s * 0.22;
      ctx.beginPath(); ctx.moveTo(cx - r, cy - r); ctx.lineTo(cx + r, cy + r); ctx.moveTo(cx + r, cy - r); ctx.lineTo(cx - r, cy + r); ctx.stroke();
    } else if (i === 1) { // two clue chips with a relation glyph
      tile(ix, iy, s, rows[0], 'A', s * 0.5);
      ctx.fillStyle = C.text; ctx.font = '700 64px DejaVu'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText('↔', ix + s + 50, iy + s / 2);
      tile(ix + s + 100, iy, s, rows[4], '3', s * 0.5);
      ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
    } else { // solved tile chaining
      tile(ix, iy, s, rows[2], '€', s * 0.5);
      ctx.fillStyle = C.text; ctx.font = '700 60px DejaVu'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText('→', ix + s + 50, iy + s / 2);
      tile(ix + s + 100, iy, s, rows[5], 'φ', s * 0.5);
      ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
    }
  }
  vignette(0.5);
});

console.log('done → itch-assets/');
await browser.close();
