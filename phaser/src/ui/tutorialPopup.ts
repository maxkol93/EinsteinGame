import Phaser from 'phaser';
import { COLORS, FONT, GAME, palette, rowColor, brighten } from '../config';
import { symbolFor } from '../model/decoder';
import { roundedTex, strokedRoundedTex } from './textures';
import { makeButton, BtnHandle } from './button';

export type TutorialAnim = 'pop_to_solve' | 'hold_to_define';

export interface PopupOpts {
  text: string;
  buttonLabel?: string;
  tag?: string;
  spotlight?: { x: number; y: number; w: number; h: number };
  animation?: TutorialAnim;
  onDone?: () => void;
}

const PANEL_W = 600;
const ANIM_H = 150;
const DEMO_VALUES = [31, 32, 33]; // row 3 → A, B, C
const SURVIVOR = 2;
const ANIM_PERIOD = 3.6; // seconds

/**
 * The tutorial message panel — welcome / block intro / teaching tip — over a
 * dimmed board, with an optional pulsing spotlight ring and an optional looped
 * gesture animation (tap-to-solve / hold-to-define) drawn live so the new
 * gesture is shown rather than only described. Port of view/ui.py TutorialPopup.
 */
export class TutorialPopup {
  private scene: Phaser.Scene;
  private root: Phaser.GameObjects.Container;
  private clock = 0;
  private opts: PopupOpts;
  private demoG?: Phaser.GameObjects.Graphics;
  private demoTexts: Phaser.GameObjects.Text[] = [];
  private spotG?: Phaser.GameObjects.Graphics;
  private btn!: BtnHandle;
  private demoCx = 0;
  private demoCy = 0;
  private updateRef = (_t: number, dt: number) => this.onUpdate(dt);

  constructor(scene: Phaser.Scene, opts: PopupOpts) {
    this.scene = scene;
    this.opts = opts;

    const lines = this.wrap(opts.text, PANEL_W - 80);
    const animH = opts.animation ? ANIM_H : 0;
    const panelH = 64 + lines.length * 26 + animH + 28 + 56 + 30;
    const cx = GAME.width / 2;
    const cy = GAME.height / 2;

    // dim
    const dim = scene.add.rectangle(cx, cy, GAME.width, GAME.height, 0x000000, 0.62).setDepth(200);
    dim.setInteractive(); // swallow clicks behind the popup

    if (opts.spotlight) {
      this.spotG = scene.add.graphics().setDepth(201);
    }

    const top = cy - panelH / 2;
    const left = cx - PANEL_W / 2;
    const panel = scene.add.image(cx, cy, roundedTex(scene, PANEL_W, panelH, 22)).setTint(brighten(COLORS.panel, 6)).setDepth(202);
    const border = scene.add.image(cx, cy, strokedRoundedTex(scene, PANEL_W, panelH, 22, 3)).setTint(brighten(COLORS.panel, 40)).setDepth(202);

    const objs: Phaser.GameObjects.GameObject[] = [dim, this.spotG as Phaser.GameObjects.GameObject, panel, border].filter(Boolean);

    objs.push(
      scene.add.text(cx, top + 32, (opts.tag ?? 'TUTORIAL'), { fontFamily: FONT, fontStyle: 'bold', fontSize: '14px', color: palette.accent })
        .setOrigin(0.5).setLetterSpacing(3).setDepth(203),
    );

    let ty = top + 64;
    for (const ln of lines) {
      objs.push(scene.add.text(cx, ty, ln, { fontFamily: FONT, fontSize: '18px', color: palette.text }).setOrigin(0.5).setDepth(203));
      ty += 26;
    }

    if (opts.animation) {
      this.demoCx = cx;
      this.demoCy = ty + ANIM_H / 2 - 6;
      this.demoG = scene.add.graphics().setDepth(203);
      objs.push(this.demoG);
      ty += animH;
    }

    const btnY = top + panelH - 30 - 28;
    this.btn = makeButton(scene, cx, btnY, 200, 50, opts.buttonLabel ?? 'Got it', () => this.finish(), {
      fontSize: 19, fill: COLORS.accent, textColor: '#1c1a1e',
    });
    this.btn.root.setDepth(204);

    this.root = scene.add.container(0, 0, objs);
    this.root.setDepth(200);

    scene.events.on('update', this.updateRef);
  }

  private finish(): void {
    this.opts.onDone?.();
    this.destroy();
  }

  destroy(): void {
    this.scene.events.off('update', this.updateRef);
    for (const t of this.demoTexts) t.destroy();
    this.demoTexts = [];
    this.btn.root.destroy();
    this.root.destroy(); // destroys all children
  }

  private onUpdate(dtMs: number): void {
    this.clock += dtMs / 1000;
    if (this.spotG && this.opts.spotlight) this.drawSpotlight();
    if (this.demoG) this.drawDemo();
  }

  private drawSpotlight(): void {
    const s = this.opts.spotlight!;
    const g = this.spotG!;
    const p = 0.5 + 0.5 * Math.sin(this.clock * 5);
    const grow = 14 + 8 * p;
    g.clear();
    g.lineStyle(4, COLORS.accent, 0.9);
    g.strokeRoundedRect(s.x - grow / 2, s.y - grow / 2, s.w + grow, s.h + grow, 18);
  }

  // ---- looped gesture demo ----
  private animProgress(): number {
    return (this.clock % ANIM_PERIOD) / ANIM_PERIOD;
  }

  private demoSlots(rectSize: number): Array<{ x: number; y: number; s: number }> {
    const rx = this.demoCx - rectSize / 2;
    const ry = this.demoCy - rectSize / 2;
    const cols = 2;
    const rows = 2;
    const inset = Math.max(3, Math.floor(rectSize / 22));
    const avail = rectSize - 2 * inset;
    const sub = Math.floor(Math.min(avail / cols, avail / rows));
    const gx = rx + Math.floor((rectSize - sub * cols) / 2);
    const gy = ry + Math.floor((rectSize - sub * rows) / 2);
    const out: Array<{ x: number; y: number; s: number }> = [];
    for (let i = 0; i < 3; i++) {
      const dy = Math.floor(i / cols);
      const dx = i % cols;
      const inRow = Math.min(cols, 3 - dy * cols);
      const rowOff = Math.floor(((cols - inRow) * sub) / 2);
      out.push({ x: gx + rowOff + dx * sub + sub / 2, y: gy + dy * sub + sub / 2, s: sub });
    }
    return out;
  }

  /** Reuse a pool of Text objects for the demo glyphs (one per slot + the big). */
  private demoText(i: number, str: string, x: number, y: number, size: number, scale: number, alpha: number): void {
    let t = this.demoTexts[i];
    if (!t) {
      t = this.scene.add.text(0, 0, '', { fontFamily: FONT, fontStyle: 'bold', color: '#ffffff' }).setOrigin(0.5).setDepth(204);
      this.demoTexts[i] = t;
    }
    t.setText(str).setFontSize(size).setPosition(x, y).setScale(scale).setAlpha(alpha).setVisible(true);
  }

  private hideDemoTextsFrom(i: number): void {
    for (let k = i; k < this.demoTexts.length; k++) this.demoTexts[k]?.setVisible(false);
  }

  private drawDemo(): void {
    const g = this.demoG!;
    g.clear();
    const rectSize = 100;
    const slots = this.demoSlots(rectSize);
    // board backdrop + empty-cell ghost
    g.fillStyle(COLORS.bg, 1);
    g.fillRoundedRect(this.demoCx - rectSize / 2 - 12, this.demoCy - rectSize / 2 - 12, rectSize + 24, rectSize + 24, 16);
    g.fillStyle(brighten(COLORS.bg, 14), 1);
    g.fillRoundedRect(this.demoCx - rectSize / 2, this.demoCy - rectSize / 2, rectSize, rectSize, 14);

    const t = this.animProgress();
    let textIdx = 0;
    if (this.opts.animation === 'pop_to_solve') textIdx = this.drawPop(g, slots, t);
    else textIdx = this.drawHold(g, slots, t);
    this.hideDemoTextsFrom(textIdx);
  }

  private chip(g: Phaser.GameObjects.Graphics, cx: number, cy: number, s: number, value: number, scale: number, alpha: number, ti: number): number {
    const w = s * scale;
    if (w < 2) return ti;
    g.fillStyle(rowColor(value), alpha);
    g.fillRoundedRect(cx - w / 2, cy - w / 2, w, w, Math.max(2, w / 5));
    if (w > 14) this.demoText(ti, symbolFor(value), cx, cy, Math.round(s * 0.5), scale, alpha);
    return ti + 1;
  }

  private chipPop(g: Phaser.GameObjects.Graphics, cx: number, cy: number, s: number, value: number, p: number, ti: number): number {
    let scale: number;
    if (p < 0.3) scale = 1 + 0.3 * (p / 0.3);
    else scale = 1.3 * (1 - this.easeOutQuad((p - 0.3) / 0.7));
    const alpha = (1 - p) ** 0.7;
    if (alpha <= 0 || scale < 0.05) return ti;
    return this.chip(g, cx, cy, s, value, Math.max(0.05, scale), alpha, ti);
  }

  private solved(g: Phaser.GameObjects.Graphics, value: number, scale: number, ti: number): number {
    const w = 100 * scale;
    g.fillStyle(rowColor(value), 1);
    g.fillRoundedRect(this.demoCx - w / 2, this.demoCy - w / 2, w, w, Math.max(4, w / 8));
    g.fillStyle(0xffffff, 0.14 * scale);
    g.fillRoundedRect(this.demoCx - w / 2, this.demoCy - w / 2, w, w * 0.4, Math.max(4, w / 8));
    this.demoText(ti, symbolFor(value), this.demoCx, this.demoCy, Math.round(100 * 0.44), scale, 1);
    return ti + 1;
  }

  private cursor(g: Phaser.GameObjects.Graphics, x: number, y: number, pressed: boolean, fill: number): void {
    if (fill > 0) {
      const radius = 16;
      g.lineStyle(3, COLORS.accent, 0.3);
      g.strokeCircle(x, y, radius);
      g.lineStyle(3, COLORS.accent, 0.95);
      g.beginPath();
      g.arc(x, y, radius, -Math.PI / 2, -Math.PI / 2 + fill * Math.PI * 2, false);
      g.strokePath();
    }
    // arrow
    g.fillStyle(0xfafafc, 1);
    g.beginPath();
    g.moveTo(x, y);
    g.lineTo(x + 14, y + 11);
    g.lineTo(x + 6, y + 12);
    g.lineTo(x + 4, y + 19);
    g.closePath();
    g.fillPath();
    g.lineStyle(2, 0x1c1a1e, 1);
    g.strokePath();
    if (pressed) {
      g.fillStyle(COLORS.accent, 0.7);
      g.fillCircle(x + 2, y + 2, 9);
    }
  }

  private drawPop(g: Phaser.GameObjects.Graphics, slots: Array<{ x: number; y: number; s: number }>, t: number): number {
    const keep = SURVIVOR;
    const popDur = 0.16;
    const popStart = [0.22, 0.52];
    const solveStart = 0.74;
    let ti = 0;
    if (t >= solveStart) {
      const sp = this.clamp01((t - solveStart) / 0.18);
      const scale = 0.4 + 0.6 * this.easeOutBack(sp, 2);
      ti = this.solved(g, DEMO_VALUES[keep], scale, ti);
      const c = slots[keep];
      this.cursor(g, c.x - 6, c.y - 6, false, 0);
      return ti;
    }
    for (let i = 0; i < 3; i++) {
      const slot = slots[i];
      if (i === keep) { ti = this.chip(g, slot.x, slot.y, slot.s, DEMO_VALUES[i], 1, 1, ti); continue; }
      const start = popStart[i];
      if (t < start) ti = this.chip(g, slot.x, slot.y, slot.s, DEMO_VALUES[i], 1, 1, ti);
      else if (t < start + popDur) ti = this.chipPop(g, slot.x, slot.y, slot.s, DEMO_VALUES[i], (t - start) / popDur, ti);
    }
    let tgt: { x: number; y: number };
    let near: number;
    if (t < popStart[1] - 0.06) { tgt = slots[0]; near = popStart[0]; }
    else { tgt = slots[1]; near = popStart[1]; }
    const press = near - 0.05 < t && t < near + 0.02;
    this.cursor(g, tgt.x - 6, tgt.y - 6, press, 0);
    return ti;
  }

  private drawHold(g: Phaser.GameObjects.Graphics, slots: Array<{ x: number; y: number; s: number }>, t: number): number {
    const chosen = SURVIVOR;
    const fillStart = 0.22;
    const fillEnd = 0.74;
    const popDur = 0.14;
    let ti = 0;
    if (t >= fillEnd) {
      const p = this.clamp01((t - fillEnd) / popDur);
      for (let i = 0; i < 3; i++) if (i !== chosen && p < 1) ti = this.chipPop(g, slots[i].x, slots[i].y, slots[i].s, DEMO_VALUES[i], p, ti);
      const sp = this.clamp01((t - fillEnd) / 0.18);
      const scale = 0.4 + 0.6 * this.easeOutBack(sp, 2);
      ti = this.solved(g, DEMO_VALUES[chosen], scale, ti);
      const c = slots[chosen];
      this.cursor(g, c.x - 6, c.y - 6, false, 0);
      return ti;
    }
    const holding = t >= fillStart;
    for (let i = 0; i < 3; i++) {
      const dim = holding && i !== chosen;
      ti = this.chip(g, slots[i].x, slots[i].y, slots[i].s, DEMO_VALUES[i], 1, dim ? 0.47 : 1, ti);
    }
    const fill = holding ? this.clamp01((t - fillStart) / (fillEnd - fillStart)) : 0;
    const c = slots[chosen];
    this.cursor(g, c.x - 6, c.y - 6, holding, fill);
    return ti;
  }

  // ---- easing + text wrap ----
  private clamp01(v: number): number { return Math.max(0, Math.min(1, v)); }
  private easeOutQuad(t: number): number { return 1 - (1 - t) * (1 - t); }
  private easeOutBack(t: number, overshoot: number): number {
    const c1 = overshoot;
    const c3 = c1 + 1;
    return 1 + c3 * (t - 1) ** 3 + c1 * (t - 1) ** 2;
  }

  private wrap(text: string, maxW: number): string[] {
    const probe = this.scene.add.text(0, 0, '', { fontFamily: FONT, fontSize: '18px' }).setVisible(false);
    const words = text.split(' ');
    const lines: string[] = [];
    let cur = '';
    for (const w of words) {
      const test = cur ? `${cur} ${w}` : w;
      probe.setText(test);
      if (probe.width > maxW && cur) { lines.push(cur); cur = w; } else cur = test;
    }
    if (cur) lines.push(cur);
    probe.destroy();
    return lines;
  }
}
