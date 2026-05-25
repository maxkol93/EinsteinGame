import Phaser from 'phaser';
import { brighten, FONT, GAME } from '../config';
import { dotTex, chunkTex, roundedTex } from '../ui/textures';

/**
 * The "juice" layer — a Phaser port of view/effects.py. Particle bursts,
 * shockwave rings, white flashes, camera shake, confetti and the floating
 * "+N chain!" combo readout. Kept cheap (short lifetimes, emitters auto-freed).
 */
export class Fx {
  private scene: Phaser.Scene;
  private dot: string;
  private chunk: string;

  constructor(scene: Phaser.Scene) {
    this.scene = scene;
    this.dot = dotTex(scene);
    this.chunk = chunkTex(scene);
  }

  /** Outward particle spray of chunks + sparks. */
  burst(
    x: number, y: number, color: number,
    opts: { count?: number; speed?: number; size?: number; life?: [number, number]; gravity?: number; up?: number } = {},
  ): void {
    const count = opts.count ?? 14;
    const speed = opts.speed ?? 320;
    const size = opts.size ?? 5;
    const life = opts.life ?? [450, 850];
    const tex = Math.random() < 0.5 ? this.dot : this.chunk;
    const base = tex === this.dot ? 16 : 12;
    const e = this.scene.add.particles(x, y, tex, {
      lifespan: { min: life[0], max: life[1] },
      speed: { min: speed * 0.35, max: speed },
      angle: { min: 0, max: 360 },
      gravityY: opts.gravity ?? 520,
      scale: { start: (size * 1.6) / base, end: 0 },
      alpha: { start: 1, end: 0 },
      tint: [brighten(color, 60), brighten(color, 90), 0xffffff],
      blendMode: Phaser.BlendModes.ADD,
      emitting: false,
    });
    e.setDepth(60);
    e.explode(count);
    this.scene.time.delayedCall(life[1] + 120, () => e.destroy());
  }

  /** Expanding stroked shockwave ring. */
  ring(
    x: number, y: number, color: number, maxR: number,
    life = 400, width = 4, startR = 2,
  ): void {
    const g = this.scene.add.graphics();
    g.setDepth(58);
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

  /** Rounded flash over a rect — additive (bloom) or normal (red wrong). */
  flash(x: number, y: number, w: number, h: number, color: number, add: boolean, life = 220): void {
    const key = roundedTex(this.scene, 80, 80, 16);
    const img = this.scene.add.image(x, y, key).setDisplaySize(w, h).setTint(color).setDepth(59);
    if (add) img.setBlendMode(Phaser.BlendModes.ADD);
    img.setAlpha(add ? 0.66 : 0.82);
    this.scene.tweens.add({ targets: img, alpha: 0, duration: life, ease: 'Quad.easeIn', onComplete: () => img.destroy() });
  }

  /** Candidate tile burst — small + snappy. */
  smallBurst(x: number, y: number, color: number): void {
    this.burst(x, y, color, { count: 7, speed: 210, size: 3, life: [220, 420] });
    this.ring(x, y, color, 26, 280, 3);
  }

  /** Resolved big cell — the headline pop: spray, rings, white wave, flash, shake. */
  bigBurst(x: number, y: number, w: number, h: number, color: number): void {
    this.burst(x, y, color, { count: 20, speed: 430, size: 6, life: [550, 1000] });
    this.ring(x, y, color, 92, 460, 6);
    this.ring(x, y, 0xffffff, 58, 320, 3);
    this.ring(x, y, color, 150, 600, 2, 24); // wide slow cascade "wave"
    this.flash(x, y, w, h, 0xffffff, true, 220);
    this.shake(7, 240);
  }

  wrong(x: number, y: number, w: number, h: number): void {
    this.flash(x, y, w, h, 0xe05a68, false, 360);
    this.burst(x, y, 0xe85454, { count: 12, speed: 250, size: 4, life: [350, 600], up: 0 });
    this.ring(x, y, 0xe85454, 70, 340, 4);
    this.shake(9, 320);
  }

  heartBreak(x: number, y: number): void {
    this.burst(x, y, 0xe44e5c, { count: 10, speed: 220, size: 4, life: [400, 700], gravity: 640 });
    this.ring(x, y, 0xe44e5c, 34, 320, 3);
  }

  comboText(x: number, y: number, text: string): void {
    const t = this.scene.add
      .text(x, y, text, { fontFamily: FONT, fontStyle: 'bold', fontSize: '34px', color: '#ffe27a' })
      .setOrigin(0.5).setDepth(70).setScale(0.5);
    this.scene.tweens.add({ targets: t, scale: 1.1, duration: 230, ease: 'Back.easeOut' });
    this.scene.tweens.add({ targets: t, y: y - 52, duration: 1050, ease: 'Cubic.easeOut' });
    this.scene.tweens.add({ targets: t, alpha: 0, delay: 650, duration: 400, onComplete: () => t.destroy() });
  }

  confetti(count = 40): void {
    const colors = [0xa87377, 0xa5674c, 0xa58949, 0x788966, 0x5c7476, 0x6c5161, 0xffe282, 0xffffff];
    const e = this.scene.add.particles(0, 0, this.chunk, {
      x: { min: 0, max: GAME.width },
      y: { min: -40, max: -8 },
      lifespan: 2600,
      speedY: { min: 80, max: 200 },
      speedX: { min: -70, max: 70 },
      gravityY: 70,
      scale: { min: 0.6, max: 1.4 },
      rotate: { min: 0, max: 360 },
      tint: colors,
      quantity: count,
      emitting: false,
    });
    e.setDepth(120);
    e.explode(count);
    this.scene.time.delayedCall(3200, () => e.destroy());
  }

  celebrate(): void {
    const cx = GAME.width / 2;
    const cy = GAME.height / 2;
    this.ring(cx, cy, 0xffd678, 420, 800, 8);
    this.ring(cx, cy, 0xffffff, 300, 600, 4);
    this.confetti(48);
  }

  shake(amp: number, durMs: number): void {
    this.scene.cameras.main.shake(durMs, amp * 0.0009);
  }
}
