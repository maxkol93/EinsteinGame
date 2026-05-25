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

export function dotTex(scene: Phaser.Scene): string {
  const key = 'fx_dot';
  if (scene.textures.exists(key)) return key;
  const g = scene.make.graphics({ x: 0, y: 0 }, false);
  g.fillStyle(0xffffff, 1);
  g.fillCircle(8, 8, 8);
  g.generateTexture(key, 16, 16);
  g.destroy();
  return key;
}

export function chunkTex(scene: Phaser.Scene): string {
  const key = 'fx_chunk';
  if (scene.textures.exists(key)) return key;
  const g = scene.make.graphics({ x: 0, y: 0 }, false);
  g.fillStyle(0xffffff, 1);
  g.fillRoundedRect(0, 0, 12, 12, 3);
  g.generateTexture(key, 12, 12);
  g.destroy();
  return key;
}

// A rounded-rect top sheen (white → transparent vertical gradient, clipped to
// the rounded shape). Overlaid on a resolved big cell it gives the glossy
// highlight pygame paints in ui._draw_demo_solved / window._render_cell.
export function sheenRoundedTex(
  scene: Phaser.Scene, w = 160, h = 160, radius = 18,
): string {
  const key = `sheen_${w}x${h}_${radius}`;
  if (scene.textures.exists(key)) return key;
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d')!;
  const r = radius;
  ctx.beginPath();
  ctx.moveTo(r, 0);
  ctx.arcTo(w, 0, w, h, r);
  ctx.arcTo(w, h, 0, h, r);
  ctx.arcTo(0, h, 0, 0, r);
  ctx.arcTo(0, 0, w, 0, r);
  ctx.closePath();
  ctx.clip();
  const g = ctx.createLinearGradient(0, 0, 0, h);
  g.addColorStop(0, 'rgba(255,255,255,0.55)');
  g.addColorStop(0.5, 'rgba(255,255,255,0.07)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);
  scene.textures.addCanvas(key, c);
  return key;
}
