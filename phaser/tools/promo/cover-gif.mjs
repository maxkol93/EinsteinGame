// Animated itch.io cover GIF: 630×500, <3 MB
// Three phases:
//   1. Static zoom — title + tilted 4×4 board; board edges off-canvas
//   2. Pull-back   — title fades, board eases to full-height normal view
//   3. Cascade     — remaining cells pop with particles + screen shake
// Fonts embedded as base64 data URLs — no server needed.

import { chromium } from 'playwright';
import gifenc from 'gifenc';
const { GIFEncoder, quantize, applyPalette } = gifenc;
import { PNG } from 'pngjs';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HERE  = dirname(fileURLToPath(import.meta.url));
const ROOT  = join(HERE, '..', '..', '..');
const FONTS = join(ROOT, 'phaser/public/fonts');
const OUT   = join(ROOT, 'itch-assets');
mkdirSync(OUT, { recursive: true });

// ── Output ─────────────────────────────────────────────────────────────────
const W = 630, H = 500;

// ── Board — sized to fill the full cover height (with tiny margins) ────────
const CELL = 115, GAP = 4, STEP = CELL + GAP;  // 115, 4, 119
const BOARD_W = STEP * 4 - GAP;                 // 472 px
const BOARD_CX = W / 2;                         // 315
const BOARD_CY = H / 2;                         // 250
const BOARD_OX = BOARD_CX - BOARD_W / 2;        // 79
const BOARD_OY = BOARD_CY - BOARD_W / 2;        // 14

// ── Content ────────────────────────────────────────────────────────────────
const SOL = [
  ['1',  '2',  '3',  '4' ],
  ['Ⅱ', 'Ⅳ', 'Ⅰ', 'Ⅲ'],
  ['C',  'A',  'D',  'B' ],
  ['€',  '₽',  '฿',  '$' ],
];
const ROW_COLORS = ['#a87377', '#a5674c', '#a58949', '#788966'];

// Checker-board pre-solved pattern — exactly half the board solved from frame 0.
// Solved on (0,0)(0,2)(1,1)(1,3)(2,0)(2,2)(3,1)(3,3); unsolved the alternating set.
const PRE_SOLVED = new Set(['0,0','0,2','1,1','1,3','2,0','2,2','3,1','3,3']);

// Each unsolved cell has 2 plausible candidates (solved peers eliminate the others)
const CANDS = {
  '0,1': ['2','4'], '0,3': ['2','4'],
  '1,0': ['Ⅰ','Ⅱ'], '1,2': ['Ⅰ','Ⅱ'],
  '2,1': ['A','B'],  '2,3': ['A','B'],
  '3,0': ['€','฿'],  '3,2': ['€','฿'],
};

// Cascade order — pop left column first, then right column (looks like a wave)
const CASCADE = [
  [0,1],[1,0],[2,1],[3,0],
  [1,2],[0,3],[3,2],[2,3],
];

// ── Frame plan ─────────────────────────────────────────────────────────────
const ZOOM_N  = 10;   // static zoom,   110 ms/frame
const PULL_N  = 20;   // pull-back,      72 ms/frame
const POP_N   = 3;    // frames per pop, 80 ms/frame
const HOLD_N  = 4;    // hold solved,   130 ms/frame
const CASC_N  = CASCADE.length * POP_N;              // 24
const TOTAL   = ZOOM_N + PULL_N + CASC_N + HOLD_N;  // 58

// ── Camera keyframes ───────────────────────────────────────────────────────
// Zoom: scale 2.5 — even the four canvas corners map into board interior at -8° tilt.
// Focus at (308, 244) keeps the view slightly off-centre for visual dynamism while
// guaranteeing all board edges stay off-canvas (verified: ≥85 px margin after rotation).
const ZC = { scale: 2.5, rotDeg: -8, focusX: 308, focusY: 244, lensX: 315, lensY: 250 };
const NC = { scale: 1.0, rotDeg:  0, focusX: BOARD_CX, focusY: BOARD_CY, lensX: BOARD_CX, lensY: BOARD_CY };

const eio  = t => t < 0.5 ? 4*t*t*t : 1-(-2*t+2)**3/2;
const lerp = (a, b, t) => a + (b-a)*t;

// ── Seeded LCG RNG ─────────────────────────────────────────────────────────
let rseed = 0xdeadbeef;
const rnd  = () => { rseed = (rseed * 1664525 + 1013904223) >>> 0; return rseed / 0x100000000; };
const rndr = (lo, hi) => lo + rnd() * (hi - lo);

// ── Pre-compute particles + shake (Node side) ──────────────────────────────
// Particles live in screen space (cascade phase has identity camera).
const NUM_P = 14, LIFE = 5;

const allParts = [];
CASCADE.forEach(([y,x], i) => {
  const sf = ZOOM_N + PULL_N + i * POP_N;  // spawn frame
  const pcx = BOARD_OX + x*STEP + CELL/2;
  const pcy = BOARD_OY + y*STEP + CELL/2;
  for (let k = 0; k < NUM_P; k++) {
    const ang = rnd() * Math.PI * 2;
    const spd = rndr(28, 88);
    allParts.push({
      sf, col: ROW_COLORS[y],
      cx: pcx, cy: pcy,
      vx: Math.cos(ang)*spd, vy: Math.sin(ang)*spd,
      r: rndr(4, 9),
    });
  }
});

const shakeAt = {};
CASCADE.forEach(([,], i) => {
  const f = ZOOM_N + PULL_N + i * POP_N;
  const sx = rndr(-9, 9), sy = rndr(-5, 5);
  shakeAt[f]   = { x: sx,   y: sy   };
  shakeAt[f+1] = { x: sx/2, y: sy/2 };
});

// ── Build per-frame data ───────────────────────────────────────────────────
const frameData = [];
for (let f = 0; f < TOTAL; f++) {
  let cam, delay, titleAlpha;
  const solved = new Set(PRE_SOLVED);
  let transCell = null, transFrac = 0;

  if (f < ZOOM_N) {
    cam = { ...ZC }; delay = 110; titleAlpha = 1;
  } else if (f < ZOOM_N + PULL_N) {
    const t = eio((f - ZOOM_N) / (PULL_N - 1));
    cam = {
      scale:  lerp(ZC.scale,  NC.scale,  t),
      rotDeg: lerp(ZC.rotDeg, NC.rotDeg, t),
      focusX: lerp(ZC.focusX, NC.focusX, t),
      focusY: lerp(ZC.focusY, NC.focusY, t),
      lensX:  lerp(ZC.lensX,  NC.lensX,  t),
      lensY:  lerp(ZC.lensY,  NC.lensY,  t),
    };
    delay = 72;
    titleAlpha = Math.max(0, 1 - t * 2.2); // fades in first 45% of pull-back
  } else if (f < ZOOM_N + PULL_N + CASC_N) {
    cam = { ...NC }; delay = 80; titleAlpha = 0;
    const cf = f - ZOOM_N - PULL_N;
    const ci = Math.floor(cf / POP_N);
    transFrac = (cf % POP_N) / POP_N;
    // mark all completed cells solved
    for (let i = 0; i < ci; i++) { const [cy,cx]=CASCADE[i]; solved.add(`${cy},${cx}`); }
    // currently popping cell is always marked solved (bloom animation handles appearance)
    if (ci < CASCADE.length) {
      const [cy,cx] = CASCADE[ci];
      transCell = `${cy},${cx}`;
      solved.add(transCell);
    }
  } else {
    cam = { ...NC }; delay = 130; titleAlpha = 0;
    for (const [cy,cx] of CASCADE) solved.add(`${cy},${cx}`);
  }

  // particles active this frame
  const particles = allParts
    .filter(p => f >= p.sf && f < p.sf + LIFE)
    .map(p => {
      const age = f - p.sf, pct = age / LIFE;
      return { x: p.cx+p.vx*age, y: p.cy+p.vy*age, r: p.r*(1-pct*.5), col: p.col, a: 1-pct };
    });

  const shake = shakeAt[f] || { x: 0, y: 0 };

  frameData.push({ cam, delay, titleAlpha, solved:[...solved], transCell, transFrac, particles, shake });
}

// ── Load fonts as base64 data URLs (no network request needed) ─────────────
const fontReg  = readFileSync(join(FONTS, 'DejaVuSans.ttf')).toString('base64');
const fontBold = readFileSync(join(FONTS, 'DejaVuSans-Bold.ttf')).toString('base64');

// ── Playwright ─────────────────────────────────────────────────────────────
const browser = await chromium.launch({ headless: true });
const page    = await browser.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: 1 });

await page.goto('about:blank');
await page.evaluate(async ([r, b]) => {
  const f1 = new FontFace('DejaVuSans', `url(data:font/truetype;base64,${r})`, { weight: '400' });
  const f2 = new FontFace('DejaVuSans', `url(data:font/truetype;base64,${b})`, { weight: '700' });
  document.fonts.add(await f1.load());
  document.fonts.add(await f2.load());
  await document.fonts.ready;
}, [fontReg, fontBold]);

console.log(`Rendering ${TOTAL} frames (${W}×${H})…`);

const rawPNGs = await page.evaluate(async (data) => {
  const { W, H, CELL, STEP, BOX, BOY, SOL, RC, CANDS, frames } = data;

  const cv = document.createElement('canvas');
  cv.width = W; cv.height = H;
  const ctx = cv.getContext('2d');

  // ── helpers ───────────────────────────────────────────────────────────
  const rr = (x,y,w,h,r) => {
    ctx.beginPath();
    ctx.moveTo(x+r,y); ctx.arcTo(x+w,y,x+w,y+h,r);
    ctx.arcTo(x+w,y+h,x,y+h,r); ctx.arcTo(x,y+h,x,y,r);
    ctx.arcTo(x,y,x+w,y,r); ctx.closePath();
  };
  const p2 = h => [parseInt(h.slice(1,3),16),parseInt(h.slice(3,5),16),parseInt(h.slice(5,7),16)];
  const mix = (a, b, t) => {
    const ca=p2(a), cb=p2(b);
    return `rgb(${~~(ca[0]+(cb[0]-ca[0])*t)},${~~(ca[1]+(cb[1]-ca[1])*t)},${~~(ca[2]+(cb[2]-ca[2])*t)})`;
  };
  let bgs = 7331;
  const bgr = () => { bgs=(bgs*1103515245+12345)&0x7fffffff; return bgs/0x7fffffff; };

  // ── background ────────────────────────────────────────────────────────
  function drawBg() {
    const g=ctx.createRadialGradient(W*.46,H*.38,0,W/2,H/2,Math.max(W,H)*.82);
    g.addColorStop(0,'#25201f'); g.addColorStop(1,'#1c1819');
    ctx.fillStyle=g; ctx.fillRect(0,0,W,H);
    bgs=7331;
    ctx.save(); ctx.globalAlpha=0.038;
    for(let i=0;i<22;i++){
      const x=bgr()*W, y=bgr()*H, s=50*(0.5+bgr()*.9), c=RC[(bgr()*4)|0], a=(bgr()-.5)*.7;
      ctx.save(); ctx.translate(x,y); ctx.rotate(a);
      rr(-s/2,-s/2,s,s,s*.2); ctx.fillStyle=c; ctx.fill();
      ctx.restore();
    }
    ctx.restore();
  }

  // ── title ─────────────────────────────────────────────────────────────
  function drawTitle(alpha) {
    if(alpha<=0) return;
    ctx.save(); ctx.globalAlpha=alpha;
    const band=ctx.createLinearGradient(0,0,0,160);
    band.addColorStop(0,'rgba(0,0,0,.82)'); band.addColorStop(1,'rgba(0,0,0,0)');
    ctx.fillStyle=band; ctx.fillRect(0,0,W,160);
    ctx.textAlign='center'; ctx.textBaseline='middle';
    ctx.shadowColor='rgba(0,0,0,.92)'; ctx.shadowBlur=24; ctx.shadowOffsetY=3;
    ctx.font='bold 64px DejaVuSans'; ctx.letterSpacing='12px';
    ctx.fillStyle='#f5f0ec';
    ctx.fillText('EINSTEIN', W/2+6, 62);
    ctx.shadowBlur=0; ctx.letterSpacing='0px';
    ctx.font='400 17px DejaVuSans'; ctx.letterSpacing='3px';
    ctx.fillStyle='#cdc3be';
    ctx.fillText('a logic-grid deduction puzzle', W/2+1.5, 100);
    ctx.letterSpacing='0px';
    const dx=W/2-(RC.length-1)*20;
    RC.forEach((c,i) => {
      ctx.beginPath(); ctx.arc(dx+i*40,124,5.5,0,7);
      ctx.fillStyle=c; ctx.shadowColor=c; ctx.shadowBlur=8; ctx.fill();
    });
    ctx.restore();
  }

  // ── big tile (solved cell) ─────────────────────────────────────────────
  function drawBigTile(cx2, cy2, s, glyph, col, glow) {
    const ox=cx2+(CELL-s)/2, oy=cy2+(CELL-s)/2;
    ctx.save();
    ctx.shadowColor = glow>0 ? mix(col,'#ffffff',0.55) : 'rgba(0,0,0,.55)';
    ctx.shadowBlur  = glow>0 ? 40*glow : 8;
    ctx.shadowOffsetY=3;
    const g=ctx.createLinearGradient(0,oy,0,oy+s);
    g.addColorStop(0,mix(col,'#ffffff',0.22));
    g.addColorStop(.5,col);
    g.addColorStop(1,mix(col,'#000000',0.26));
    rr(ox,oy,s,s,s*.14); ctx.fillStyle=g; ctx.fill();
    ctx.shadowColor='transparent'; ctx.shadowBlur=0; ctx.shadowOffsetY=0;
    const sh=ctx.createLinearGradient(0,oy,0,oy+s*.48);
    sh.addColorStop(0,'rgba(255,255,255,.26)'); sh.addColorStop(1,'rgba(255,255,255,0)');
    rr(ox+s*.06,oy+s*.06,s*.88,s*.42,s*.1); ctx.fillStyle=sh; ctx.fill();
    ctx.fillStyle='rgba(255,255,255,.95)';
    ctx.font=`bold ${~~(s*.46)}px DejaVuSans`;
    ctx.textAlign='center'; ctx.textBaseline='middle';
    ctx.fillText(glyph, ox+s/2, oy+s/2+~~(s*.025));
    ctx.restore();
  }

  // ── candidate sub-grid ────────────────────────────────────────────────
  function drawCands(cx2, cy2, cands, col, alpha) {
    ctx.save(); ctx.globalAlpha=alpha;
    rr(cx2,cy2,CELL,CELL,CELL*.14);
    ctx.fillStyle='rgba(0,0,0,.24)'; ctx.fill();
    const m=CELL*.12, sub=(CELL-m*3)/2;
    const n=Math.min(cands.length,4);
    for(let i=0;i<n;i++){
      const dc=i%2, dr=~~(i/2);
      const rn=(dr===~~((n-1)/2)&&n%2===1)?1:2;
      const ro=(2-rn)*(sub+m)/2;
      const tx2=cx2+m+ro+dc*(sub+m), ty2=cy2+m+dr*(sub+m);
      rr(tx2,ty2,sub,sub,sub*.22);
      ctx.fillStyle=col; ctx.fill();
      ctx.fillStyle='rgba(255,255,255,.92)';
      ctx.font=`bold ${~~(sub*.52)}px DejaVuSans`;
      ctx.textAlign='center'; ctx.textBaseline='middle';
      ctx.fillText(cands[i], tx2+sub/2, ty2+sub/2+1);
    }
    ctx.restore();
  }

  // ── one cell ──────────────────────────────────────────────────────────
  function drawCell(y, x, ss, transCell, transFrac) {
    const key=`${y},${x}`;
    const cx2=BOX+x*STEP, cy2=BOY+y*STEP;
    const col=RC[y], glyph=SOL[y][x], cands=CANDS[key]||[glyph];

    // ghost plate
    rr(cx2,cy2,CELL,CELL,CELL*.14);
    ctx.fillStyle='rgba(0,0,0,.26)'; ctx.fill();

    if(ss.has(key)){
      if(transCell===key){
        // bloom: scale 0.28 → 1.0, glow 1 → 0 using eased t
        const sc2=0.28+0.72*Math.min(1,(transFrac/0.67)**0.7);
        const glow=Math.max(0,1-transFrac*1.5);
        drawBigTile(cx2,cy2,CELL*sc2,glyph,col,glow);
      } else {
        drawBigTile(cx2,cy2,CELL,glyph,col,0);
      }
    } else {
      drawCands(cx2,cy2,cands,col,1);
    }
  }

  // ── board ──────────────────────────────────────────────────────────────
  function drawBoard(ss, transCell, transFrac) {
    for(let y=0;y<4;y++) for(let x=0;x<4;x++) drawCell(y,x,ss,transCell,transFrac);
  }

  // ── particles ──────────────────────────────────────────────────────────
  function drawParticles(parts) {
    for(const p of parts){
      ctx.save();
      ctx.globalAlpha=p.a;
      ctx.beginPath(); ctx.arc(p.x,p.y,p.r,0,Math.PI*2);
      ctx.fillStyle=p.col; ctx.shadowColor=p.col; ctx.shadowBlur=p.r*2.5;
      ctx.fill();
      ctx.restore();
    }
  }

  // ── vignette ───────────────────────────────────────────────────────────
  function drawVignette() {
    const g=ctx.createRadialGradient(W/2,H/2,Math.min(W,H)*.22,W/2,H/2,Math.max(W,H)*.74);
    g.addColorStop(0,'rgba(0,0,0,0)'); g.addColorStop(1,'rgba(0,0,0,.56)');
    ctx.fillStyle=g; ctx.fillRect(0,0,W,H);
  }

  // ── render ─────────────────────────────────────────────────────────────
  const results=[];
  for(const fp of frames){
    ctx.clearRect(0,0,W,H);
    drawBg();

    const {cam,titleAlpha,solved,transCell,transFrac,particles,shake}=fp;
    const ss=new Set(solved), rot=cam.rotDeg*Math.PI/180;

    ctx.save();
    ctx.translate(shake.x,shake.y);
    ctx.translate(cam.lensX,cam.lensY);
    ctx.rotate(rot);
    ctx.scale(cam.scale,cam.scale);
    ctx.translate(-cam.focusX,-cam.focusY);
    drawBoard(ss,transCell,transFrac);
    ctx.restore();

    if(particles.length) drawParticles(particles);
    drawTitle(titleAlpha);
    drawVignette();

    results.push(cv.toDataURL('image/png').split(',')[1]);
  }
  return results;
}, {
  W, H, CELL, STEP,
  BOX: BOARD_OX, BOY: BOARD_OY,
  SOL, RC: ROW_COLORS, CANDS,
  frames: frameData,
});

await browser.close();

// ── Encode GIF ─────────────────────────────────────────────────────────────
console.log(`Encoding ${rawPNGs.length} frames…`);
const gif = GIFEncoder();
for(let i=0;i<rawPNGs.length;i++){
  const buf=Buffer.from(rawPNGs[i],'base64');
  const png=PNG.sync.read(buf);
  const rgba=new Uint8ClampedArray(png.data.buffer,png.data.byteOffset,png.data.length);
  const pal=quantize(rgba,256);
  const idx=applyPalette(rgba,pal);
  gif.writeFrame(idx,W,H,{palette:pal,delay:frameData[i].delay});
  if(i%10===0) process.stdout.write(`  ${i}/${rawPNGs.length}\n`);
}
gif.finish();

const out=join(OUT,'cover-animated.gif');
writeFileSync(out,Buffer.from(gif.bytes()));
const mb=(gif.bytes().length/1024/1024).toFixed(2);
console.log(`\n→ ${out}  (${mb} MB, ${rawPNGs.length} frames)`);
if(+mb>3) console.warn('⚠ over 3 MB — reduce ZOOM_N/CASC_N or scale down');
