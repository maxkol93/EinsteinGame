import Phaser from 'phaser';
import { COLORS, GAME, FONT, palette, brighten, applyRenderScale, PORTRAIT } from '../config';
import { makeButton, BtnHandle } from '../ui/button';
import { makeSlider } from '../ui/slider';
import { makeToggle } from '../ui/toggle';
import { roundedTex, strokedRoundedTex } from '../ui/textures';
import { audio } from '../audio/sound';
import { stats } from '../model/stats';
import { settings } from '../model/settings';
import { sizeLocks, diffLocks, sizeUnlocked } from '../model/progression';
import { ACHIEVEMENTS, achievementInfo } from '../model/achievements';
import { TutorialDirector, BLOCK_NAMES } from '../model/tutorial';
import { seededConfig, SeededKind } from '../model/daily';
import { openStatsOverlay } from '../ui/statsOverlay';

const SIZES = [4, 5, 6, 7];
const DIFFS = ['Easy', 'Normal', 'Hard'];
const CX_L = 360; // left column centre
const PANEL_X = 700; // right options panel left edge
const PANEL_W = 445;
const CX_R = PANEL_X + PANEL_W / 2;

const SIZE_LOCK_MSG = 'Win 3 puzzles in the previous board size to unlock this.';
const DIFF_LOCK_MSG = 'Win 3 puzzles in every size of the previous difficulty to unlock this.';

export class MenuScene extends Phaser.Scene {
  private size = 4;
  private difficulty = 0;
  private sizeBtns: BtnHandle[] = [];
  private diffBtns: BtnHandle[] = [];
  private sizeLockMarks: Phaser.GameObjects.Text[] = [];
  private diffLockMarks: Phaser.GameObjects.Text[] = [];
  private notice?: Phaser.GameObjects.Container;
  private tooltip?: Phaser.GameObjects.Text;

  constructor() {
    super('menu');
  }

  init(data: { size?: number; difficulty?: number }): void {
    if (data?.size) this.size = data.size;
    if (data?.difficulty != null) this.difficulty = data.difficulty;
  }

  create(): void {
    applyRenderScale(this);
    this.cameras.main.setBackgroundColor(COLORS.bg);

    // Standalone menu plays the menu bed; but when this menu is the pause
    // overlay over a still-paused game or tutorial, keep that loop playing so
    // Continue resumes seamlessly (resume doesn't re-run the scene's create).
    if (!this.scene.isPaused('game') && !this.scene.isPaused('tutorial')) audio.playMusic('menu');

    // U toggles the debug unlock-all (mirrors pressing U in the pygame build).
    this.input.keyboard?.on('keydown-U', () => {
      settings.unlockAll = !settings.unlockAll;
      this.showNotice(settings.unlockAll ? 'Debug: everything unlocked' : 'Debug: progression locks on');
      this.refreshLocks();
    });

    this.buildTitle();
    if (PORTRAIT) {
      this.buildPortrait();
    } else {
      this.buildLeftColumn();
      this.buildOptionsPanel();
    }
    this.refreshLocks();
  }

  /** Single-column portrait/mobile menu (560-wide design → near 1:1 on a phone,
   *  so normal-ish sizes stay legible). Laid out by an exact-placement engine:
   *  each block declares its height + the clear gap above it, so a label can
   *  never overlap the row beneath it. Spare (or short) vertical space is spread
   *  across the gaps so the column fits any (dynamic) portrait height. */
  private buildPortrait(): void {
    const cx = GAME.width / 2;
    const bw = GAME.width - 48;
    const S = 1.3; // slider/toggle size scale
    const cw = (bw - 28) / 3; // three-across column width (difficulties)
    const xAt = (i: number): number => cx - bw / 2 + cw / 2 + i * (cw + 14);
    const cw4 = (bw - 42) / 4; // four-across column width (board sizes)
    const xAt4 = (i: number): number => cx - bw / 2 + cw4 / 2 + i * (cw4 + 14);
    const lbl = (t: string, cy: number): void => { this.add.text(cx, cy, t, { fontFamily: FONT, fontSize: '18px', color: palette.accent }).setOrigin(0.5).setLetterSpacing(1); };

    interface Block { h: number; gap: number; render: (cy: number) => void }
    const blocks: Block[] = [];
    const push = (h: number, gap: number, render: (cy: number) => void): void => { blocks.push({ h, gap, render }); };

    push(22, 22, (cy) => lbl('BOARD SIZE', cy));
    push(62, 12, (cy) => {
      this.sizeBtns = SIZES.map((s, i) => {
        const x = xAt4(i);
        const b = makeButton(this, x, cy, cw4, 62, `${s}×${s}`, () => this.selectSize(s), { selected: s === this.size, fontSize: 22 });
        const lock = this.add.text(x + cw4 / 2 - 20, cy, '🔒', { fontSize: '20px' }).setOrigin(0.5).setVisible(false);
        lock.setDepth(b.root.depth + 1);
        this.sizeLockMarks.push(lock);
        return b;
      });
    });
    push(22, 22, (cy) => lbl('DIFFICULTY', cy));
    push(62, 12, (cy) => {
      this.diffBtns = DIFFS.map((d, i) => {
        const x = xAt(i);
        const b = makeButton(this, x, cy, cw, 62, d, () => this.selectDiff(i), { selected: i === this.difficulty, fontSize: 21 });
        const lock = this.add.text(x + cw / 2 - 20, cy, '🔒', { fontSize: '20px' }).setOrigin(0.5).setVisible(false);
        lock.setDepth(b.root.depth + 1);
        this.diffLockMarks.push(lock);
        return b;
      });
    });

    if (this.scene.isPaused('game') || this.scene.isPaused('tutorial')) {
      push(66, 24, (cy) => makeButton(this, cx, cy, bw, 66, '▶  CONTINUE', () => this.continueGame(), { fontSize: 27, fill: COLORS.rows['4'], textColor: '#ffffff' }));
      if (this.scene.isPaused('game')) {
        push(50, 18, (cy) => makeButton(this, cx, cy, bw, 50, 'New game', () => this.play(), { fontSize: 20 }));
      }
    } else {
      push(80, 24, (cy) => makeButton(this, cx, cy, bw, 80, 'PLAY', () => this.play(), { fontSize: 34, fill: COLORS.rows['4'], textColor: '#ffffff' }));
    }

    push(22, 22, (cy) => lbl('SEEDED CHALLENGES', cy));
    push(56, 12, (cy) => {
      const kinds: SeededKind[] = ['daily', 'weekly', 'monthly'];
      kinds.forEach((kind, i) => makeButton(this, xAt(i), cy, cw, 56, this.seededLabel(kind), () => this.playSeeded(kind), { fontSize: 15, fill: brighten(COLORS.panel, 30) }));
    });

    push(42, 22, (cy) => makeSlider(this, cx - bw / 2, cy - 21, bw, 'SOUND', audio.sfxVolume, (v) => audio.setVolume(v), S));
    push(42, 14, (cy) => makeSlider(this, cx - bw / 2, cy - 21, bw, 'MUSIC', audio.musicVolume2, (v) => audio.setMusicVolume(v), S));
    push(40, 16, (cy) => makeToggle(this, cx - bw / 2, cy - 20, bw, 'Show tooltips', settings.tooltips, (on) => { settings.tooltips = on; }, S));
    push(40, 8, (cy) => makeToggle(this, cx - bw / 2, cy - 20, bw, 'Tap to select  (touch)', settings.touch, (on) => { settings.touch = on; }, S));
    push(40, 8, (cy) => makeToggle(this, cx - bw / 2, cy - 20, bw, 'Reduce motion', settings.reduceMotion, (on) => { settings.reduceMotion = on; this.applyReduceMotionLive(); }, S));
    push(40, 8, (cy) => makeToggle(this, cx - bw / 2, cy - 20, bw, 'Zen mode  (records not counted)', settings.zen, (on) => { settings.zen = on; }, S));

    push(58, 20, (cy) => {
      const half = (bw - 14) / 2;
      makeButton(this, cx - half / 2 - 7, cy, half, 58, settings.tutorialDone ? '↺  Tutorial' : '▶  Tutorial', () => this.openBlockSelect(), { fontSize: 18, fill: brighten(COLORS.panel, 40) });
      makeButton(this, cx + half / 2 + 7, cy, half, 58, '☆  Progress', () => openStatsOverlay(this), { fontSize: 18, fill: brighten(COLORS.panel, 40) });
    });

    const startY = 162;
    const natural = blocks.reduce((s, b) => s + b.h + b.gap, startY) + 18; // + bottom margin
    const per = (GAME.height - natural) / blocks.length; // <0 compress, >0 breathe
    let cursor = startY;
    for (const b of blocks) {
      cursor += Math.max(5, b.gap + per) + b.h / 2;
      b.render(cursor);
      cursor += b.h / 2;
    }
  }

  private buildTitle(): void {
    const cx = GAME.width / 2;
    const ty = PORTRAIT ? 80 : 54;
    this.add.text(cx, ty, 'EINSTEIN', { fontFamily: FONT, fontStyle: 'bold', fontSize: PORTRAIT ? '52px' : '60px', color: palette.text }).setOrigin(0.5).setLetterSpacing(PORTRAIT ? 8 : 14);
    this.add.text(cx, ty + 44, 'a logic-grid deduction puzzle', { fontFamily: FONT, fontSize: '18px', color: palette.accent }).setOrigin(0.5);
    Object.values(COLORS.rows).forEach((color, i, arr) => {
      this.add.circle(cx - ((arr.length - 1) * 24) / 2 + i * 24, ty + 72, 6, color);
    });
  }

  // ---------------------- left column ----------------------

  private buildLeftColumn(): void {
    const cx = CX_L;

    this.add.text(cx, 178, 'BOARD SIZE', { fontFamily: FONT, fontSize: '15px', color: palette.accent }).setOrigin(0.5);
    this.sizeBtns = SIZES.map((s, i) => {
      const w = 88;
      const gap = 10;
      const x = cx - (SIZES.length - 1) * (w + gap) * 0.5 + i * (w + gap);
      const b = makeButton(this, x, 212, w, 48, `${s}×${s}`, () => this.selectSize(s), { selected: s === this.size });
      const lock = this.add.text(x + w / 2 - 16, 212, '🔒', { fontSize: '16px' }).setOrigin(0.5).setVisible(false);
      lock.setDepth(b.root.depth + 1);
      this.sizeLockMarks.push(lock);
      return b;
    });

    this.add.text(cx, 272, 'DIFFICULTY', { fontFamily: FONT, fontSize: '15px', color: palette.accent }).setOrigin(0.5);
    this.diffBtns = DIFFS.map((d, i) => {
      const w = 118;
      const x = cx - (DIFFS.length - 1) * (w + 12) * 0.5 + i * (w + 12);
      const b = makeButton(this, x, 306, w, 48, d, () => this.selectDiff(i), { selected: i === this.difficulty });
      const lock = this.add.text(x + w / 2 - 16, 306, '🔒', { fontSize: '16px' }).setOrigin(0.5).setVisible(false);
      lock.setDepth(b.root.depth + 1);
      this.diffLockMarks.push(lock);
      return b;
    });

    // Continue (+ New game for a paused game) when a board/tutorial is paused, else Play.
    if (this.scene.isPaused('game') || this.scene.isPaused('tutorial')) {
      makeButton(this, cx, 376, 380, 52, '▶  CONTINUE', () => this.continueGame(), { fontSize: 22, fill: COLORS.rows['4'], textColor: '#ffffff' });
      if (this.scene.isPaused('game')) {
        makeButton(this, cx, 422, 380, 40, 'New game', () => this.play(), { fontSize: 17 });
      }
    } else {
      makeButton(this, cx, 392, 380, 60, 'PLAY', () => this.play(), { fontSize: 26, fill: COLORS.rows['4'], textColor: '#ffffff' });
    }

    // Daily / Weekly / Monthly
    this.add.text(cx, 466, 'SEEDED CHALLENGES', { fontFamily: FONT, fontSize: '14px', color: palette.accent }).setOrigin(0.5);
    const kinds: SeededKind[] = ['daily', 'weekly', 'monthly'];
    const sw = 124;
    kinds.forEach((kind, i) => {
      const x = cx - (kinds.length - 1) * (sw + 8) * 0.5 + i * (sw + 8);
      makeButton(this, x, 502, sw, 42, this.seededLabel(kind), () => this.playSeeded(kind), { fontSize: 14, fill: brighten(COLORS.panel, 26) });
    });

    this.add.text(cx, 560, 'Tap a tile to pop a wrong value · long-press / right-click to lock it in.', { fontFamily: FONT, fontSize: '13px', color: palette.accent, align: 'center', wordWrap: { width: 420 } }).setOrigin(0.5);
  }

  private seededLabel(kind: SeededKind): string {
    const cfg = seededConfig(kind);
    const block = stats.seeded(kind);
    const done = block.last === cfg.period;
    const name = kind[0].toUpperCase() + kind.slice(1);
    return `${name} #${cfg.number}${done ? '  ✓' : ''}`;
  }

  private playSeeded(kind: SeededKind): void {
    if (settings.zen) { this.showNotice('Seeded puzzles are unavailable in Zen mode — turn Zen off.'); return; }
    const cfg = seededConfig(kind);
    if (this.scene.isPaused('game') || this.scene.isSleeping('game')) this.scene.stop('game');
    this.scene.start('game', { size: cfg.size, difficulty: cfg.difficulty, seed: cfg.seed, seededKind: kind, seededPeriod: cfg.period, seededNumber: cfg.number });
  }

  // ---------------------- right options panel ----------------------

  private buildOptionsPanel(): void {
    const px = PANEL_X;
    const py = 168;
    const pw = PANEL_W;
    const ph = 398; // matches the left column's vertical extent (~178..576)
    this.add.image(px, py, roundedTex(this, pw, ph, 18)).setOrigin(0, 0).setTint(brighten(COLORS.bg, 11));
    this.add.image(px, py, strokedRoundedTex(this, pw, ph, 18, 2)).setOrigin(0, 0).setTint(brighten(COLORS.panel, 30));
    this.add.text(px + pw / 2, py + 26, 'O P T I O N S', { fontFamily: FONT, fontStyle: 'bold', fontSize: '15px', color: palette.accent }).setOrigin(0.5).setLetterSpacing(2);

    const ix = px + 28;
    const iw = pw - 56;
    // distribute SOUND, MUSIC, 4 toggles and the two buttons evenly over the
    // panel so nothing leaves dead space at the bottom
    let y = py + 60;
    makeSlider(this, ix, y, iw, 'SOUND', audio.sfxVolume, (v) => audio.setVolume(v));
    y += 58;
    makeSlider(this, ix, y, iw, 'MUSIC', audio.musicVolume2, (v) => audio.setMusicVolume(v));
    y += 60;
    makeToggle(this, ix, y, iw, 'Show tooltips', settings.tooltips, (on) => { settings.tooltips = on; });
    y += 40;
    makeToggle(this, ix, y, iw, 'Tap to select  (touch)', settings.touch, (on) => { settings.touch = on; });
    y += 40;
    makeToggle(this, ix, y, iw, 'Reduce motion', settings.reduceMotion, (on) => { settings.reduceMotion = on; this.applyReduceMotionLive(); });
    y += 40;
    makeToggle(this, ix, y, iw, 'Zen mode  (records not counted)', settings.zen, (on) => { settings.zen = on; });

    // buttons pinned near the panel bottom, with a clearly lighter fill so they
    // don't sink into the panel background
    const half = (iw - 12) / 2;
    const by = py + ph - 36;
    const btnFill = brighten(COLORS.panel, 40);
    makeButton(this, ix + half / 2, by, half, 48, settings.tutorialDone ? '↺  Tutorial' : '▶  Tutorial', () => this.openBlockSelect(), { fontSize: 16, fill: btnFill });
    makeButton(this, ix + half + 12 + half / 2, by, half, 48, '☆  Progress', () => openStatsOverlay(this), { fontSize: 16, fill: btnFill });
  }

  private showBadgeTip(x: number, text: string): void {
    this.hideBadgeTip();
    this.tooltip = this.add
      .text(Phaser.Math.Clamp(x, 160, GAME.width - 160), 702, text, {
        fontFamily: FONT, fontSize: '15px', color: palette.text,
        backgroundColor: '#1f1b21', padding: { x: 8, y: 4 },
      })
      .setOrigin(0.5)
      .setDepth(50);
  }

  private hideBadgeTip(): void {
    this.tooltip?.destroy();
    this.tooltip = undefined;
  }

  // ---------------------- locks ----------------------

  private refreshLocks(): void {
    const sl = sizeLocks(stats, this.difficulty, settings.unlockAll);
    const dl = diffLocks(stats, settings.unlockAll);
    this.sizeBtns.forEach((b, i) => {
      this.sizeLockMarks[i].setVisible(sl[i]);
      b.root.setAlpha(sl[i] ? 0.45 : 1);
      b.setLocked(sl[i]);
    });
    this.diffBtns.forEach((b, i) => {
      this.diffLockMarks[i].setVisible(dl[i]);
      b.root.setAlpha(dl[i] ? 0.45 : 1);
      b.setLocked(dl[i]);
    });
    // if the current selection just became invalid (e.g. locks turned back on),
    // fall back to the always-open 4×4 / Easy.
    if (sl[SIZES.indexOf(this.size)]) this.selectSize(4, true);
    if (dl[this.difficulty]) this.selectDiff(0, true);
  }

  // ---------------------- selection ----------------------

  private selectSize(s: number, force = false): void {
    if (!force && !sizeUnlocked(stats, this.difficulty, s, settings.unlockAll)) {
      this.showNotice(SIZE_LOCK_MSG);
      return;
    }
    this.size = s;
    this.sizeBtns.forEach((b, i) => b.setSelected(SIZES[i] === s));
  }

  private selectDiff(i: number, force = false): void {
    if (!force && diffLocks(stats, settings.unlockAll)[i]) {
      this.showNotice(DIFF_LOCK_MSG);
      return;
    }
    this.difficulty = i;
    this.diffBtns.forEach((b, j) => b.setSelected(j === i));
    // changing difficulty changes which sizes are open
    this.refreshLocks();
  }

  private play(): void {
    if (!sizeUnlocked(stats, this.difficulty, this.size, settings.unlockAll)) {
      this.showNotice(SIZE_LOCK_MSG);
      return;
    }
    // a fresh board replaces any paused one
    if (this.scene.isPaused('game') || this.scene.isSleeping('game')) this.scene.stop('game');
    this.scene.start('game', { size: this.size, difficulty: this.difficulty, zen: settings.zen });
  }

  /** Resume the paused in-progress board or tutorial. */
  private continueGame(): void {
    if (this.scene.isPaused('game')) {
      this.scene.resume('game');
    } else {
      this.scene.resume('tutorial');
    }
    this.scene.stop();
  }

  /** Push the reduce-motion setting to a live/paused game so it applies now. */
  private applyReduceMotionLive(): void {
    const g = this.scene.get('game') as Phaser.Scene & { applyReduceMotion?: () => void };
    g?.applyReduceMotion?.();
    const t = this.scene.get('tutorial') as Phaser.Scene & { applyReduceMotion?: () => void };
    t?.applyReduceMotion?.();
  }

  /** Pick a tutorial block to play/replay (port of pygame BlockSelectOverlay). */
  private openBlockSelect(): void {
    const cx = GAME.width / 2;
    const cy = GAME.height / 2;
    const f = PORTRAIT ? 1.5 : 1; // bigger on mobile
    const pw = Math.round((PORTRAIT ? GAME.width - 60 : 440));
    const rowH = Math.round(54 * f);
    const ph = Math.round(150 * f + BLOCK_NAMES.length * rowH + 70 * f);
    const top = cy - ph / 2;
    const depth = 60;
    const objs: Phaser.GameObjects.GameObject[] = [];

    const dim = this.add.rectangle(cx, cy, GAME.width, GAME.height, 0x000000, 0.6).setDepth(depth).setInteractive();
    const panel = this.add.image(cx, cy, roundedTex(this, pw, ph, 22)).setTint(COLORS.panel).setDepth(depth + 1);
    const border = this.add.image(cx, cy, strokedRoundedTex(this, pw, ph, 22, 2)).setTint(brighten(COLORS.panel, 34)).setDepth(depth + 1);
    objs.push(dim, panel, border);
    objs.push(this.add.text(cx, top + 40 * f, 'TUTORIAL', { fontFamily: FONT, fontStyle: 'bold', fontSize: `${Math.round(30 * f)}px`, color: palette.text }).setOrigin(0.5).setLetterSpacing(4).setDepth(depth + 2));
    objs.push(this.add.text(cx, top + 72 * f, 'play or replay any block', { fontFamily: FONT, fontSize: `${Math.round(14 * f)}px`, color: palette.accent }).setOrigin(0.5).setDepth(depth + 2));

    const handles: BtnHandle[] = [];
    BLOCK_NAMES.forEach((name, i) => {
      const b = makeButton(this, cx, top + 104 * f + i * rowH, pw - 60, rowH - 10, `${i + 1}.   ${name}`, () => {
        const d = new TutorialDirector(settings.tutorialBlocks);
        d.startReplay(i);
        this.registry.set('tutorialDirector', d);
        this.scene.start('tutorial');
      }, { fontSize: Math.round(19 * f), fill: brighten(COLORS.panel, 26) });
      b.root.setDepth(depth + 2);
      handles.push(b);
    });
    const back = makeButton(this, cx, top + ph - 40 * f, pw - 60, Math.round(46 * f), 'Back', () => {
      objs.forEach((o) => o.destroy());
      handles.forEach((h) => h.root.destroy());
    }, { fontSize: Math.round(18 * f), fill: COLORS.accent, textColor: '#1c1a1e' });
    back.root.setDepth(depth + 2);
    handles.push(back);
  }

  /** A fading toast at the bottom of the screen — a dark rounded background so
   *  it reads as a popup over the menu, not loose text across the buttons. */
  private showNotice(msg: string): void {
    this.notice?.destroy();
    const cx = GAME.width / 2;
    const y = GAME.height - (PORTRAIT ? 70 : 44);
    const txt = this.add.text(0, 0, msg, { fontFamily: FONT, fontSize: PORTRAIT ? '20px' : '15px', color: '#f0c890', align: 'center', wordWrap: { width: GAME.width - 100 } }).setOrigin(0.5);
    const pw = Math.ceil(txt.width + 36);
    const ph = Math.ceil(txt.height + 20);
    const bg = this.add.image(0, 0, roundedTex(this, pw, ph, 12)).setTint(brighten(COLORS.panel, 8)).setAlpha(0.96);
    const border = this.add.image(0, 0, strokedRoundedTex(this, pw, ph, 12, 2)).setTint(0xe0b070).setAlpha(0.7);
    this.notice = this.add.container(cx, y, [bg, border, txt]).setDepth(80);
    const n = this.notice;
    n.setScale(0.9);
    this.tweens.add({ targets: n, scale: 1, duration: 160, ease: 'Back.easeOut' });
    this.tweens.add({ targets: n, alpha: 0, delay: 2400, duration: 600, onComplete: () => n.destroy() });
  }
}
