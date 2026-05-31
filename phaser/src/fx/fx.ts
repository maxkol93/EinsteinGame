import Phaser from 'phaser';
import { brighten, FONT, GAME } from '../config';
import { chunkTex, softDotTex, roundedTex } from '../ui/textures';

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
  private chunk: string;
  private soft: string;
  private vignette: Phaser.GameObjects.Image;
  private vigHold = 0;
  private vigTween?: Phaser.Tweens.Tween | Phaser.Tweens.TweenChain;
  private celebrateRain?: Phaser.GameObjects.Particles.ParticleEmitter;
  private celebrateTimer?: Phaser.Time.TimerEvent;
  // accessibility: when set, screenshake / particle bursts / confetti / the
  // vignette pulse are suppressed; localized rings + flashes still play
  private reduced = false;

  constructor(scene: Phaser.Scene) {
    this.scene = scene;
    this.chunk = chunkTex(scene);
    this.soft = softDotTex(scene);
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

  setReduced(on: boolean): void {
    this.reduced = on;
  }

  /** Outward spray — soft round MONOCHROME dots. One feathered circle texture,
   *  one tint, a gentle gravity and a long ease-out fade: a clean, tactile puff
   *  that lingers, instead of a multi-tone confetti of squares and white sparks.
   *  Particle best-practice: ease size→0 and alpha→0 over a long lifespan, low
   *  gravity so they drift and settle, no rotation noise. */
  burst(x: number, y: number, color: number, opts: BurstOpts = {}): void {
    if (this.reduced) return;
    const count = opts.count ?? 14;
    const speed = opts.speed ?? 300;
    const size = opts.size ?? 5;
    const life = opts.life ?? [600, 1100];
    const grav = opts.gravity ?? 240; // softer than before so they float & settle
    const aMin = opts.angleMin ?? 0;
    const aMax = opts.angleMax ?? 360;

    const e = this.scene.add
      .particles(x, y, this.soft, {
        lifespan: { min: life[0], max: life[1] },
        speed: { min: speed * 0.22, max: speed },
        angle: { min: aMin, max: aMax },
        gravityY: grav,
        scale: { start: (size * 2.4) / 48, end: 0, ease: 'Quad.easeOut' }, // soft tex is 48px
        alpha: { start: 0.95, end: 0, ease: 'Quad.easeIn' },
        tint: color, // single tone — no per-particle colour variation
        emitting: false,
      })
      .setDepth(60);
    e.explode(count);
    this.scene.time.delayedCall(life[1] + 300, () => e.destroy());
  }

  /** Expanding stroked shockwave ring — ADDITIVE (like pygame's BLEND_RGBA_ADD
   *  Ring), so it reads as bright light radiating outward on the dark board,
   *  not a faint hairline that gets lost under the particle burst. */
  ring(x: number, y: number, color: number, maxR: number, life = 400, width = 4, startR = 2): void {
    const g = this.scene.add.graphics().setDepth(62);
    g.setBlendMode(Phaser.BlendModes.ADD);
    const c = brighten(color, 70);
    this.scene.tweens.addCounter({
      from: 0, to: 1, duration: life, ease: 'Cubic.easeOut',
      onUpdate: (tw) => {
        const t = tw.getValue() ?? 0;
        const r = startR + (maxR - startR) * t;
        g.clear();
        // extra width + a faint inner echo so the wave is unmistakable
        g.lineStyle(Math.max(1.5, (width + 1) * (1 - t * 0.6)), c, 0.95 * (1 - t) ** 1.3);
        g.strokeCircle(x, y, r);
        if (r > 6) {
          g.lineStyle(Math.max(1, width * 0.5 * (1 - t)), 0xffffff, 0.5 * (1 - t) ** 1.5);
          g.strokeCircle(x, y, r * 0.82);
        }
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

  /** Candidate tile pop — small + snappy spark spray + ring. Held a touch
   *  longer so the pop is actually readable. */
  smallBurst(x: number, y: number, color: number): void {
    this.burst(x, y, color, { count: 12, speed: 250, size: 6, life: [520, 980] });
    this.ring(x, y, color, 44, 560, 5);
    this.ring(x, y, 0xffffff, 28, 380, 3);
  }

  /** Resolved big cell — the headline pop: spray, rings, white wave, bloom,
   *  shake. Rings/flash linger longer (so the "solve" reads), shake softened. */
  bigBurst(x: number, y: number, w: number, h: number, color: number): void {
    this.burst(x, y, color, { count: 26, speed: 430, size: 9, life: [820, 1500] });
    this.ring(x, y, color, 112, 760, 8);
    this.ring(x, y, 0xffffff, 74, 540, 5);
    this.ring(x, y, color, 184, 980, 4, 26); // wide slow cascade "wave"
    this.flash(x, y, w, h, 0xffffff, true, 420);
    this.shake(1.6, 130); // a gentle tap, not a jolt
  }

  /** Wrong move: red flash over the WHOLE cell, downward red spray, ring,
   *  red edge-vignette pulse, shake — matches pygame Effects.wrong_click. */
  wrong(cx: number, cy: number, cell: number): void {
    this.flash(cx, cy, cell, cell, 0xe04040, false, 380);
    this.burst(cx, cy, 0xe85454, {
      count: 15, speed: 300, size: 5.5, life: [360, 640],
      angleMin: 22, angleMax: 158, gravity: 560, sparkRatio: 0.4,
    });
    this.ring(cx, cy, 0xe85454, 78, 360, 5);
    this.vignettePulse(0xdc3737, 0.55);
    this.shake(2.4, 170); // much calmer than before — a wrong tap shouldn't jolt
  }

  heartBreak(x: number, y: number): void {
    this.burst(x, y, 0xe44e5c, { count: 12, speed: 245, size: 5, life: [420, 740], gravity: 640 });
    this.ring(x, y, 0xe44e5c, 36, 330, 4);
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
    if (this.reduced) return;
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
    // the one-shot burst — fires once, all at once
    this.ring(cx, cy, 0xffd678, 440, 820, 8);
    this.ring(cx, cy, 0xffffff, 320, 620, 4);
    this.burst(cx, cy, 0xffe6a0, { count: 18, speed: 520, size: 6, life: [700, 1300], gravity: 420 });
    this.confetti(60); // initial fall

    // continuous confetti rain — keeps falling for as long as the win screen
    // is up (auto-cleared on scene shutdown, or via stopCelebrate()).
    const colors = [0xa87377, 0xa5674c, 0xa58949, 0x788966, 0x5c7476, 0x6c5161, 0xffe282, 0xffffff];
    this.celebrateRain = this.scene.add
      .particles(0, 0, this.chunk, {
        x: { min: 0, max: GAME.width },
        y: { min: -40, max: -8 },
        lifespan: 3200,
        speedY: { min: 90, max: 220 },
        speedX: { min: -60, max: 60 },
        gravityY: 60,
        scale: { min: 0.6, max: 1.5 },
        rotate: { min: 0, max: 360 },
        tint: colors,
        frequency: 90, // emit a couple every 90ms → a steady fall
        quantity: 2,
      })
      .setDepth(95);
    // every so often a fresh gold pop bursts at a random spot near the top
    this.celebrateTimer = this.scene.time.addEvent({
      delay: 850, loop: true,
      callback: () => {
        const px = GAME.width * (0.2 + 0.6 * ((this.scene.time.now / 850) % 1));
        this.burst(px, GAME.height * 0.32, 0xffe6a0, { count: 10, speed: 360, size: 5, life: [700, 1200], gravity: 360 });
      },
    });
  }

  /** Stop the looping win celebration (rain + periodic pops). Safe to call when
   *  none is running. */
  stopCelebrate(): void {
    this.celebrateRain?.destroy();
    this.celebrateRain = undefined;
    this.celebrateTimer?.remove();
    this.celebrateTimer = undefined;
  }

  // ---- red screen-edge vignette (replaces the old centre red rectangle) ----

  vignettePulse(color: number, peak: number): void {
    if (this.reduced) return;
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
    if (this.reduced) return;
    this.scene.cameras.main.shake(durMs, amp * 0.0012);
  }
}
