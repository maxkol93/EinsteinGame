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
  sparkRatio?: number;
}

/**
 * The "juice" layer — a faithful Phaser port of view/effects.py. Every action
 * answers back with motion, light and a little overshoot:
 *   - particle bursts: colour chunks (gravity + spin) + bright additive sparks
 *   - expanding shockwave rings
 *   - rounded flashes (additive white bloom, or flat red on a wrong move)
 *   - a red screen-EDGE vignette (NOT a centre blob)
 *   - camera shake, confetti and the floating "+N chain!" combo readout
 * Kept cheap: short lifetimes, emitters auto-freed.
 */
export class Fx {
  private scene: Phaser.Scene;
  private dot: string;
  private chunk: string;
  private vignette: Phaser.GameObjects.Image;
  private vigHold = 0;
  private vigTween?: Phaser.Tweens.Tween | Phaser.Tweens.TweenChain;

  constructor(scene: Phaser.Scene) {
    this.scene = scene;
    this.dot = dotTex(scene);
    this.chunk = chunkTex(scene);
    this.vignette = scene.add
      .image(GAME.width / 2, GAME.height / 2, this.vignetteTex())
      .setDisplaySize(GAME.width * 1.1, GAME.height * 1.16)
      .setAlpha(0)
      .setDepth(90);
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
    const g = ctx.createRadialGradient(s / 2, s / 2, s * 0.18, s / 2, s / 2, s * 0.62);
    g.addColorStop(0, 'rgba(255,255,255,0)');
    g.addColorStop(0.55, 'rgba(255,255,255,0.16)');
    g.addColorStop(1, 'rgba(255,255,255,1)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, s, s);
    this.scene.textures.addCanvas(key, c);
    return key;
  }

  /** Outward spray — colour chunks (gravity, spin) + bright additive sparks. */
  burst(x: number, y: number, color: number, opts: BurstOpts = {}): void {
    const count = opts.count ?? 14;
    const speed = opts.speed ?? 320;
    const size = opts.size ?? 5;
    const life = opts.life ?? [450, 850];
    const grav = opts.gravity ?? 520;
    const aMin = opts.angleMin ?? 0;
    const aMax = opts.angleMax ?? 360;
    const sparks = Math.round(count * (opts.sparkRatio ?? 0.45));
    const chunks = Math.max(0, count - sparks);

    if (chunks > 0) {
      const ce = this.scene.add
        .particles(x, y, this.chunk, {
          lifespan: { min: life[0], max: life[1] },
          speed: { min: speed * 0.35, max: speed },
          angle: { min: aMin, max: aMax },
          gravityY: grav,
          scale: { start: (size * 1.5) / 12, end: 0 },
          alpha: { start: 1, end: 0 },
          rotate: { min: 0, max: 360 },
          tint: [color, brighten(color, 35)],
          emitting: false,
        })
        .setDepth(60);
      ce.explode(chunks);
      this.scene.time.delayedCall(life[1] + 220, () => ce.destroy());
    }
    if (sparks > 0) {
      const se = this.scene.add
        .particles(x, y, this.dot, {
          lifespan: { min: life[0] * 0.55, max: life[1] * 0.8 },
          speed: { min: speed * 0.4, max: speed * 1.15 },
          angle: { min: aMin, max: aMax },
          gravityY: grav * 0.45, // sparks hang/rise a touch — the fountain look
          scale: { start: (size * 1.1) / 16, end: 0 },
          alpha: { start: 1, end: 0 },
          tint: [brighten(color, 80), 0xffffff],
          blendMode: Phaser.BlendModes.ADD,
          emitting: false,
        })
        .setDepth(61);
      se.explode(sparks);
      this.scene.time.delayedCall(life[1] + 220, () => se.destroy());
    }
  }

  /** Expanding stroked shockwave ring. */
  ring(x: number, y: number, color: number, maxR: number, life = 400, width = 4, startR = 2): void {
    const g = this.scene.add.graphics().setDepth(58);
    const c = brighten(color, 70);
    this.scene.tweens.addCounter({
      from: 0, to: 1, duration: life, ease: 'Cubic.easeOut',
      onUpdate: (tw) => {
        const t = tw.getValue() ?? 0;
        const r = startR + (maxR - startR) * t;
        g.clear();
        g.lineStyle(Math.max(1, width * (1 - t * 0.7)), c, 0.9 * (1 - t) ** 1.5);
        g.strokeCircle(x, y, r);
      },
      onComplete: () => g.destroy(),
    });
  }

  /** Rounded flash over a rect — additive white bloom, or flat red (wrong). */
  flash(x: number, y: number, w: number, h: number, color: number, add: boolean, life = 220): void {
    const img = this.scene.add
      .image(x, y, roundedTex(this.scene, 80, 80, 16))
      .setDisplaySize(w, h)
      .setTint(color)
      .setDepth(59);
    if (add) img.setBlendMode(Phaser.BlendModes.ADD);
    img.setAlpha(add ? 0.66 : 0.82);
    this.scene.tweens.add({ targets: img, alpha: 0, duration: life, ease: 'Quad.easeIn', onComplete: () => img.destroy() });
  }

  /** Candidate tile pop — small + snappy spark spray + ring. */
  smallBurst(x: number, y: number, color: number): void {
    this.burst(x, y, color, { count: 9, speed: 235, size: 3.6, life: [220, 440], sparkRatio: 0.55 });
    this.ring(x, y, color, 30, 300, 3);
  }

  /** Resolved big cell — the headline pop: spray, rings, white wave, bloom, shake. */
  bigBurst(x: number, y: number, w: number, h: number, color: number): void {
    this.burst(x, y, color, { count: 24, speed: 460, size: 6.5, life: [560, 1040] });
    this.ring(x, y, color, 96, 470, 6);
    this.ring(x, y, 0xffffff, 60, 320, 3);
    this.ring(x, y, color, 154, 620, 2, 24); // wide slow cascade "wave"
    this.flash(x, y, w, h, 0xffffff, true, 240);
    this.shake(7, 240);
  }

  /** Wrong move: red flash over the WHOLE cell, downward red spray, ring,
   *  red edge-vignette pulse, shake — matches pygame Effects.wrong_click. */
  wrong(cx: number, cy: number, cell: number): void {
    this.flash(cx, cy, cell, cell, 0xe04040, false, 380);
    this.burst(cx, cy, 0xe85454, {
      count: 14, speed: 285, size: 4.2, life: [350, 620],
      angleMin: 22, angleMax: 158, gravity: 560, sparkRatio: 0.4,
    });
    this.ring(cx, cy, 0xe85454, 74, 340, 4);
    this.vignettePulse(0xdc3737, 0.62);
    this.shake(9, 320);
  }

  heartBreak(x: number, y: number): void {
    this.burst(x, y, 0xe44e5c, { count: 11, speed: 235, size: 4, life: [400, 720], gravity: 640 });
    this.ring(x, y, 0xe44e5c, 34, 320, 3);
  }

  comboText(x: number, y: number, text: string): void {
    const t = this.scene.add
      .text(x, y, text, { fontFamily: FONT, fontStyle: 'bold', fontSize: '34px', color: '#ffe27a' })
      .setOrigin(0.5).setDepth(70).setScale(0.5);
    t.setStroke('#1c1410', 6);
    this.scene.tweens.add({ targets: t, scale: 1.12, duration: 240, ease: 'Back.easeOut' });
    this.scene.tweens.add({ targets: t, y: y - 54, duration: 1050, ease: 'Cubic.easeOut' });
    this.scene.tweens.add({ targets: t, alpha: 0, delay: 650, duration: 400, onComplete: () => t.destroy() });
  }

  confetti(count = 48): void {
    const colors = [0xa87377, 0xa5674c, 0xa58949, 0x788966, 0x5c7476, 0x6c5161, 0xffe282, 0xffffff];
    const e = this.scene.add
      .particles(0, 0, this.chunk, {
        x: { min: 0, max: GAME.width },
        y: { min: -40, max: -8 },
        lifespan: 2800,
        speedY: { min: 80, max: 200 },
        speedX: { min: -70, max: 70 },
        gravityY: 70,
        scale: { min: 0.7, max: 1.6 },
        rotate: { min: 0, max: 360 },
        tint: colors,
        emitting: false,
      })
      .setDepth(95);
    e.explode(count);
    this.scene.time.delayedCall(3400, () => e.destroy());
  }

  celebrate(): void {
    const cx = GAME.width / 2;
    const cy = GAME.height / 2;
    this.ring(cx, cy, 0xffd678, 440, 820, 8);
    this.ring(cx, cy, 0xffffff, 320, 620, 4);
    this.burst(cx, cy, 0xffe6a0, { count: 18, speed: 520, size: 6, life: [700, 1300], gravity: 420, sparkRatio: 0.7 });
    this.confetti(52);
  }

  // ---- red screen-edge vignette (replaces the old centre red rectangle) ----

  vignettePulse(color: number, peak: number): void {
    this.vignette.setTint(color);
    this.vigTween?.stop();
    this.vigTween = this.scene.tweens.chain({
      targets: this.vignette,
      tweens: [
        { alpha: peak, duration: 110, ease: 'Quad.easeOut' },
        { alpha: this.vigHold, duration: 430, ease: 'Quad.easeIn' },
      ],
    });
  }

  vignetteHold(color: number, level: number): void {
    this.vignette.setTint(color);
    this.vigHold = level;
    this.vigTween?.stop();
    this.vigTween = this.scene.tweens.add({ targets: this.vignette, alpha: level, duration: 480, ease: 'Quad.easeOut' });
  }

  /** Lose flourish — heavy shake + dark-red vignette settles in. */
  defeat(): void {
    this.shake(13, 480);
    this.vignetteHold(0x962226, 0.5);
    this.vignettePulse(0xb83034, 0.78);
  }

  shake(amp: number, durMs: number): void {
    this.scene.cameras.main.shake(durMs, amp * 0.0012);
  }
}
