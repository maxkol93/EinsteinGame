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
