import Phaser from 'phaser';

// White textures generated once and reused, tinted per call. Tinting a white
// rounded-rect gives a coloured rounded button; scaling DOWN stays crisp, so
// candidate tiles + big cells share one high-res base each.

export function roundedTex(scene: Phaser.Scene, w: number, h: number, radius: number): string {
  const key = `rr_${w}x${h}_${radius}`;
  if (scene.textures.exists(key)) return key;
  const g = scene.make.graphics({ x: 0, y: 0 }, false);
  g.fillStyle(0xffffff, 1);
  g.fillRoundedRect(0, 0, w, h, radius);
  g.generateTexture(key, w, h);
  g.destroy();
  return key;
}

export function strokedRoundedTex(
  scene: Phaser.Scene, w: number, h: number, radius: number, lw: number,
): string {
  const key = `sr_${w}x${h}_${radius}_${lw}`;
  if (scene.textures.exists(key)) return key;
  const g = scene.make.graphics({ x: 0, y: 0 }, false);
  g.lineStyle(lw, 0xffffff, 1);
  g.strokeRoundedRect(lw / 2, lw / 2, w - lw, h - lw, radius);
  g.generateTexture(key, w, h);
  g.destroy();
  return key;
}

// Big, crisp round particle (sparks). Larger than the old 16px so a scaled-down
// burst still reads as fat, visible circles rather than specks.
export function dotTex(scene: Phaser.Scene): string {
  const key = 'fx_dot';
  if (scene.textures.exists(key)) return key;
  const g = scene.make.graphics({ x: 0, y: 0 }, false);
  g.fillStyle(0xffffff, 1);
  g.fillCircle(16, 16, 16);
  g.generateTexture(key, 32, 32);
  g.destroy();
  return key;
}

// Soft round particle — a radial-gradient dot (solid core → feathered edge).
// One tinted texture used for every burst so pops read as a clean monochrome
// spray rather than a multi-tone confetti of squares.
export function softDotTex(scene: Phaser.Scene): string {
  const key = 'fx_softdot';
  if (scene.textures.exists(key)) return key;
  const s = 48;
  const c = document.createElement('canvas');
  c.width = s; c.height = s;
  const ctx = c.getContext('2d')!;
  const g = ctx.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.55, 'rgba(255,255,255,0.92)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(s / 2, s / 2, s / 2, 0, Math.PI * 2);
  ctx.fill();
  scene.textures.addCanvas(key, c);
  return key;
}

// Chunk particle — a fat rounded square that tumbles as it flies.
export function chunkTex(scene: Phaser.Scene): string {
  const key = 'fx_chunk';
  if (scene.textures.exists(key)) return key;
  const g = scene.make.graphics({ x: 0, y: 0 }, false);
  g.fillStyle(0xffffff, 1);
  g.fillRoundedRect(0, 0, 18, 18, 5);
  g.generateTexture(key, 18, 18);
  g.destroy();
  return key;
}

const ch = (v: number, f: number): number => Math.max(0, Math.min(255, Math.round(v * f)));
const rgb = (color: number): [number, number, number] => [(color >> 16) & 0xff, (color >> 8) & 0xff, color & 0xff];

function roundRectPath(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

/**
 * A resolved big cell baked in its own colour: a vertical gradient (lighter
 * top → darker bottom, the top-light look pygame's _make_gradient_surface
 * gives) plus a THIN soft highlight band slightly above centre — not a bright
 * white top sheen. Drawn with the colour baked in, so the image takes no tint.
 */
export function bigCellTex(scene: Phaser.Scene, color: number, w = 160, h = 160, radius = 18): string {
  const key = `bigcell_${(color & 0xffffff).toString(16)}_${w}x${h}_${radius}`;
  if (scene.textures.exists(key)) return key;
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const ctx = c.getContext('2d')!;
  roundRectPath(ctx, 0, 0, w, h, radius);
  ctx.clip();
  const [r, g, b] = rgb(color);
  const grad = ctx.createLinearGradient(0, 0, 0, h);
  grad.addColorStop(0, `rgb(${ch(r, 1.24)},${ch(g, 1.24)},${ch(b, 1.24)})`);
  grad.addColorStop(0.5, `rgb(${ch(r, 1.0)},${ch(g, 1.0)},${ch(b, 1.0)})`);
  grad.addColorStop(1, `rgb(${ch(r, 0.62)},${ch(g, 0.62)},${ch(b, 0.62)})`);
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, w, h);
  // thin highlight band just above the middle
  const bandY = h * 0.40;
  const bandH = h * 0.09;
  const band = ctx.createLinearGradient(0, bandY - bandH, 0, bandY + bandH);
  band.addColorStop(0, 'rgba(255,255,255,0)');
  band.addColorStop(0.5, 'rgba(255,255,255,0.17)');
  band.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = band;
  ctx.fillRect(0, bandY - bandH, w, bandH * 2);
  scene.textures.addCanvas(key, c);
  return key;
}

// A light diagonal hatch clipped to a rounded rect — thin white stripes on a
// transparent ground. Overlaid (low alpha) on the CENTRE cell of a
// three-in-a-row clue in focus mode so it reads apart from the two edge cells,
// while the symbol on top stays legible.
export function hatchTex(scene: Phaser.Scene, size = 128, radius = 26, spacing = 18, lw = 5): string {
  const key = `hatch_${size}_${radius}_${spacing}_${lw}`;
  if (scene.textures.exists(key)) return key;
  const c = document.createElement('canvas');
  c.width = size; c.height = size;
  const ctx = c.getContext('2d')!;
  roundRectPath(ctx, 0, 0, size, size, radius);
  ctx.clip();
  ctx.strokeStyle = 'rgba(255,255,255,1)';
  ctx.lineWidth = lw;
  for (let d = -size; d < size * 2; d += spacing) {
    ctx.beginPath();
    ctx.moveTo(d, 0);
    ctx.lineTo(d + size, size);
    ctx.stroke();
  }
  scene.textures.addCanvas(key, c);
  return key;
}

// A radial vignette: transparent at the centre, darkening towards the edges.
// Used in clue-focus mode to draw the eye to the lit clue + matched cells.
export function vignetteTex(scene: Phaser.Scene, w: number, h: number): string {
  const key = `vignette_${w}x${h}`;
  if (scene.textures.exists(key)) return key;
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const ctx = c.getContext('2d')!;
  const cx = w / 2, cy = h / 2;
  const inner = Math.min(w, h) * 0.34;
  const outer = Math.hypot(w, h) * 0.62;
  const g = ctx.createRadialGradient(cx, cy, inner, cx, cy, outer);
  g.addColorStop(0, 'rgba(0,0,0,0)');
  g.addColorStop(0.7, 'rgba(0,0,0,0.30)');
  g.addColorStop(1, 'rgba(0,0,0,0.78)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);
  scene.textures.addCanvas(key, c);
  return key;
}

// A 16px soft shadow strip a side panel casts onto the board (window.py
// _make_shadow_strip). Alpha fades from the panel edge to nothing.
export function shadowStripTex(
  scene: Phaser.Scene, darkOnRight: boolean, h: number, w = 16,
): string {
  const key = `shadowstrip_${darkOnRight ? 'r' : 'l'}_${w}x${h}`;
  if (scene.textures.exists(key)) return key;
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const ctx = c.getContext('2d')!;
  const g = ctx.createLinearGradient(0, 0, w, 0);
  if (darkOnRight) {
    g.addColorStop(0, 'rgba(0,0,0,0)');
    g.addColorStop(1, 'rgba(0,0,0,0.30)');
  } else {
    g.addColorStop(0, 'rgba(0,0,0,0.30)');
    g.addColorStop(1, 'rgba(0,0,0,0)');
  }
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);
  scene.textures.addCanvas(key, c);
  return key;
}

// A crisp, dark, button-SHAPED drop shadow for a lifted tile/button. The
// rounded rect nearly fills the texture (small margin for a tight blur), so the
// caller's displaySize maps 1:1 to the shadow size — and the rounded-rect shape
// matches the element instead of reading as a fuzzy oval. Positioned slightly
// down+aside by the caller so a small offset says "lifted just a little".
export function shadowTex(scene: Phaser.Scene, w = 128, h = 128, radius = 22): string {
  const key = `fx_shadow_${w}x${h}_${radius}`;
  if (scene.textures.exists(key)) return key;
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const ctx = c.getContext('2d')!;
  ctx.filter = 'blur(2.5px)'; // tight, defined edge — not a cloud
  ctx.fillStyle = 'rgba(0,0,0,1)';
  roundRectPath(ctx, 6, 6, w - 12, h - 12, radius);
  ctx.fill();
  scene.textures.addCanvas(key, c);
  return key;
}
