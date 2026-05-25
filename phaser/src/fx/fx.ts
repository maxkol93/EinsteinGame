import Phaser from 'phaser';
import { brighten, FONT, GAME } from '../config';
import { dotTex, chunkTex, roundedTex } from '../ui/textures';

interface BurstOpts {
  count?: number;
  speed?: number;
  size?: number;
  life?: [number, number];
  gravity?: number;
  angleMin?: number;
  angleMax?: number;
}

/**
 * The "juice" layer — a Phaser port of view/effects.py. Particle bursts,
 * shockwave rings, white bloom flashes, an edge vignette, camera shake,
 * confetti and the floating "+N chain!" combo readout.
 */
export class Fx {
  private scene: Phaser.Scene;
  private dot: string;
  private chunk: string;
  private vignette: Phaser.GameObjects.Image;
  private vigHold = 0;

  constructor(scene: Phaser.Scene) {
    this.scene = scene;
    this.dot = dotTex(scene);
    this.chunk = chunkTex(scene);
    this.vignette = scene.add
      .image(GAME.width / 2, GAME.height / 2, this.vignetteTex())
      .setDisplaySize(GAME.width * 1.08, GAME.height * 1.12)
      .setAlpha(0)
      .setDepth(140);
  }

  private vignetteTex(): string {
    const key = 'fx_vignette';
    if (this.scene.textures.exists(key)) return key;
    const s = 256;
    const c = document.createElement('canvas');
    c.width = s;
    c.height = s;
    const ctx = c.getContext('2d')!;
    // transparent centre → opaque edges (white, so it can be tinted any colour)
    const g = ctx.createRadialGradient(s / 2, s / 2, s * 0.2, s / 2, s / 2, s * 0.62);
    g.addColorStop(0, 'rgba(255,255,255,0)');
    g.addColorStop(0.62, 'rgba(255,255,255,0.18)');
    g.addColorStop(1, 'rgba(255,255,255,1)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, s, s);
    this.scene.textures.addCanvas(key, c);
    return key;
  }

  burst(x: number, y: number, color: number, opts: BurstOpts = {}): void {
    const count = opts.count ?? 14;
    const speed = opts.speed ?? 320;
    const size = opts.size ?? 5;
    const life = opts.life ?? [450, 850];
    const tex = Math.random() < 0.5 ? this.dot : this.chunk;
    const base = tex === this.dot ? 16 : 12;
    const e = this.scene.add.particles(x, y, tex, {
      lifespan: { min: life[0], max: life[1] },
      speed: { min: speed * 0.35, max: speed },
      angle: { min: opts.angleMin ?? 0, max: opts.angleMax ?? 360 },
      gravityY: opts.gravity ?? 520,
      scale: { start: (size * 1.6) / base, end: 0 },
      alpha: { start: 1, end: 0 },
      rotate: { min: 0, max: 360 },
      tint: [brighten(color, 60), brighten(color, 90), 0xffffff],
      blendMode: Phaser.BlendModes.ADD,
      emitting: false,
    });
    e.setDepth(60);
    e.explode(count);
    this.scene.time.delayedCall(life[1] + 150, () => e.destroy());
  }

  ring(x: number, y: number, color: number, maxR: number, life = 400, width = 4, startR = 2): void {
    const g = this.scene.add.graphics().setDepth(58);
    const c = brighten(color, 70);
    this.scene.tweens.addCounter({
      from: 0, to: 1, duration: life, ease: 'Cubic.easeOut',
      onUpdate: (tw) => {
        const t = tw.getValue() ?? 0;
        const r = startR + (maxR - startR) * t;
        g.clear();
        g.lineStyle(Math.max(1, width * (1 - t * 0.7)), c, 0.85 * (1 - t) ** 1.5);
        g.strokeCircle(x, y, r);
      },
      onComplete: () => g.destroy(),
    });
  }

  flash(x: number, y: number, w: number, h: number, color: number, add: boolean, life = 220): void {
    const img = this.scene.add.image(x, y, roundedTex(this.scene, 80, 80, 16)).setDisplaySize(w, h).setTint(color).setDepth(59);
    if (add) img.setBlendMode(Phaser.BlendModes.ADD);
    img.setAlpha(add ? 0.66 : 0.8);
    this.scene.tweens.add({ targets: img, alpha: 0, duration: life, ease: 'Quad.easeIn', onComplete: () => img.destroy() });
  }

  /** Candidate tile pop — small + snappy spark spray + ring. */
  smallBurst(x: number, y: number, color: number): void {
    this.burst(x, y, color, { count: 8, speed: 230, size: 3.4, life: [220, 440] });
    this.ring(x, y, color, 28, 300, 3);
  }

  /** Resolved big cell — the headline pop: spray, rings, white wave, bloom flash, shake. */
  bigBurst(x: number, y: number, w: number, h: number, color: number): void {
    this.burst(x, y, color, { count: 22, speed: 450, size: 6.5, life: [560, 1020] });
    this.ring(x, y, color, 94, 470, 6);
    this.ring(x, y, 0xffffff, 60, 320, 3);
    this.ring(x, y, color, 152, 620, 2, 24); // wide slow cascade "wave"
    this.flash(x, y, w, h, 0xffffff, true, 230);
    this.shake(7, 240);
  }

  /** Wrong move: red flash over the whole cell, downward red spray, ring,
   *  edge vignette pulse, shake — matches pygame Effects.wrong_click. */
  wrong(cx: number, cy: number, cell: number): void {
    this.flash(cx, cy, cell, cell, 0xe04040, false, 380);
    this.burst(cx, cy, 0xe85454, { count: 13, speed: 280, size: 4, life: [350, 600], angleMin: 22, angleMax: 158 });
    this.ring(cx, cy, 0xe85454, 72, 340, 4);
    this.vignettePulse(0xdc3838, 0.6);
    this.shake(9, 320);
  }

  heartBreak(x: number, y: number): void {
    this.burst(x, y, 0xe44e5c, { count: 11, speed: 230, size: 4, life: [400, 720], gravity: 640 });
    this.ring(x, y, 0xe44e5c, 34, 320, 3);
  }

  comboText(x: number, y: number, text: string): void {
    const t = this.scene.add
      .text(x, y, text, { fontFamily: FONT, fontStyle: 'bold', fontSize: '34px', color: '#ffe27a' })
      .setOrigin(0.5).setDepth(70).setScale(0.5);
    t.setStroke('#1c1819', 5);
    this.scene.tweens.add({ targets: t, scale: 1.1, duration: 230, ease: 'Back.easeOut' });
    this.scene.tweens.add({ targets: t, y: y - 54, duration: 1050, ease: 'Cubic.easeOut' });
    this.scene.tweens.add({ targets: t, alpha: 0, delay: 650, duration: 400, onComplete: () => t.destroy() });
  }

  confetti(count = 46): void {
    const colors = [0xa87377, 0xa5674c, 0xa58949, 0x788966, 0x5c7476, 0x6c5161, 0xffe282, 0xffffff];
    const e = this.scene.add.particles(0, 0, this.chunk, {
      x: { min: 0, max: GAME.width },
      y: { min: -40, max: -8 },
      lifespan: 2800,
      speedY: { min: 80, max: 200 },
      speedX: { min: -70, max: 70 },
      gravityY: 70,
      scale: { min: 0.7, max: 1.5 },
      rotate: { min: 0, max: 360 },
      tint: colors,
      emitting: false,
    });
    e.setDepth(150);
    e.explode(count);
    this.scene.time.delayedCall(3400, () => e.destroy());
  }

  celebrate(): void {
    const cx = GAME.width / 2;
    const cy = GAME.height / 2;
    this.ring(cx, cy, 0xffd678, 440, 820, 8);
    this.ring(cx, cy, 0xffffff, 320, 620, 4);
    this.confetti(52);
  }

  // ---- edge vignette (replaces the old full-screen red rectangle) ----

  vignettePulse(color: number, peak: number): void {
    this.vignette.setTint(color);
    this.scene.tweens.killTweensOf(this.vignette);
    this.scene.tweens.chain({
      targets: this.vignette,
      tweens: [
        { alpha: peak, duration: 110, ease: 'Quad.easeOut' },
        { alpha: this.vigHold, duration: 420, ease: 'Quad.easeIn' },
      ],
    });
  }

  vignetteHold(color: number, level: number): void {
    this.vignette.setTint(color);
    this.vigHold = level;
    this.scene.tweens.killTweensOf(this.vignette);
    this.scene.tweens.add({ targets: this.vignette, alpha: level, duration: 480, ease: 'Quad.easeOut' });
  }

  shake(amp: number, durMs: number): void {
    this.scene.cameras.main.shake(durMs, amp * 0.0009);
  }
}
