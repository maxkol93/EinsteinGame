import Phaser from 'phaser';
import { COLORS, GAME, FONT, palette, rowColor, brighten, applyRenderScale } from '../config';
import { PuzzleBoard, ChangeSet } from '../model/board';
import { symbolFor, ruleSegments } from '../model/decoder';
import { Rule } from '../model/types';
import { makeButton } from '../ui/button';
import { roundedTex, strokedRoundedTex, bigCellTex } from '../ui/textures';
import { Fx } from '../fx/fx';
import { audio } from '../audio/sound';
import { settings } from '../model/settings';
import { stats } from '../model/stats';
import {
  TutorialDirector, TutorialLevel, CompleteResult, TrackerRow, levelsInBlock,
  GOAL_HINT, GESTURE_HOLD_TEXT,
} from '../model/tutorial';
import { TutorialPopup, TutorialAnim } from '../ui/tutorialPopup';

// Layout mirrors the landscape game (a left panel, the board, a right clue
// panel) but the board is a big 3x3 and the left panel is the block tracker.
const SPAN = 540;
const GAP = 4;
const MARGIN = 60;
const PANEL = 300;
const BX = PANEL + MARGIN;
const BY = 110;
const CLUE_X = BX + SPAN + MARGIN;
const RULE_CELL = 44;
const STEP_MS = 140;
const HOLD_MS = 350;
const HOVER_SPREAD_MS = 200;
const OP_SYMBOL: Record<string, string> = { '^': '↕', '<->': '↔', '...': '…' };

const TITLE: Record<string, string> = {
  level: 'LEVEL CLEAR', reset: 'LET\'S RETRY', block: 'BLOCK CLEAR',
  replay: 'BLOCK CLEAR', tutorial: 'TUTORIAL COMPLETE',
};

interface Chip {
  img: Phaser.GameObjects.Image; txt: Phaser.GameObjects.Text; outline: Phaser.GameObjects.Image;
  value: number; cx: number; cy: number; sub: number; base: number;
}
interface BigCell { img: Phaser.GameObjects.Image; txt: Phaser.GameObjects.Text; outline: Phaser.GameObjects.Image; value: number; cx: number; cy: number; base: number; }
interface ClueMini { img: Phaser.GameObjects.Image; txt: Phaser.GameObjects.Text; outline: Phaser.GameObjects.Image; value: number; scale: number; }
interface ClueGroup { objs: Phaser.GameObjects.GameObject[]; minis: ClueMini[]; rule: Rule; gx: number; gy: number; dim: boolean; }
interface Glowable {
  img: Phaser.GameObjects.Image; txt?: Phaser.GameObjects.Text; outline?: Phaser.GameObjects.Image;
  tintBase: number; tintHi: number; scale: number; homeY: number; canHop: boolean;
}

export class TutorialScene extends Phaser.Scene {
  private dir!: TutorialDirector;
  private level!: TutorialLevel;
  private board!: PuzzleBoard;
  private fx!: Fx;

  private size = 3;
  private cellSide = 0;
  private candCols = 2;
  private candRows = 2;
  private chips: Array<Array<Map<number, Chip>>> = [];
  private bigObjs: Array<Array<BigCell | null>> = [];
  private clueGroups: ClueGroup[] = [];

  private busy = false;
  private finished = false;
  private press: { y: number; x: number; n: number; fired: boolean } | null = null;
  private longPress?: Phaser.Time.TimerEvent;
  private holdRing?: Phaser.GameObjects.Graphics;
  private holdTween?: Phaser.Tweens.Tween;
  private popup?: TutorialPopup;

  // cross-highlight hover state
  private hoverChip: Chip | null = null;
  private litGlow: Glowable[] = [];
  private spreadTimer?: Phaser.Time.TimerEvent;
  private tooltip?: Phaser.GameObjects.Container;
  private hoverGroup: ClueGroup | null = null;
  private lastResult?: CompleteResult; // for the headless verify to drive Continue
  private misuseTaps = 0; // taps on a hold-only level → reminder after a few

  private tileTex = '';
  private miniTex = '';

  constructor() {
    super('tutorial');
  }

  create(): void {
    applyRenderScale(this);
    this.input.mouse?.disableContextMenu();
    this.cameras.main.setBackgroundColor(COLORS.bg);
    this.fx = new Fx(this);
    this.fx.setReduced(settings.reduceMotion);

    // the director persists across per-level scene restarts via the registry
    this.dir = this.registry.get('tutorialDirector') as TutorialDirector;
    if (!this.dir) {
      this.dir = new TutorialDirector(settings.tutorialBlocks);
      this.registry.set('tutorialDirector', this.dir);
    }

    this.busy = false;
    this.finished = false;
    this.press = null;
    this.misuseTaps = 0;
    this.clueGroups = [];

    this.tileTex = roundedTex(this, 80, 80, 16);
    this.miniTex = roundedTex(this, 64, 64, 12);

    this.level = this.dir.currentLevel();
    this.size = this.level.size;
    this.cellSide = Math.floor((SPAN - (this.size - 1) * GAP) / this.size);
    this.candCols = Math.ceil(Math.sqrt(this.size));
    this.candRows = Math.ceil(this.size / this.candCols);
    this.board = new PuzzleBoard(this.size, this.level.solution, this.level.definedCells, this.level.free);

    this.buildBackground();
    this.buildPanel();
    this.buildBoard();
    this.buildClues();
    this.bindInput();
    this.playEntrance();

    audio.playMusic('game');
    audio.play('start');

    this.showIntro();
  }

  // --------------------------- panels ---------------------------

  private buildBackground(): void {
    const panelColor = brighten(COLORS.bg, 13);
    const divider = brighten(panelColor, 30);
    const leftEdge = BX - 22;
    const rightEdge = BX + SPAN + 22;
    const g = this.add.graphics().setDepth(-10);
    g.fillStyle(panelColor, 1);
    g.fillRect(0, 0, leftEdge, GAME.height);
    g.fillRect(rightEdge, 0, GAME.width - rightEdge, GAME.height);
    g.lineStyle(1, divider, 1);
    g.lineBetween(leftEdge, 0, leftEdge, GAME.height);
    g.lineBetween(rightEdge, 0, rightEdge, GAME.height);
  }

  private buildPanel(): void {
    makeButton(this, PANEL / 2, 42, PANEL - 60, 46, '☰  MENU', () => this.toMenu(), { fontSize: 18 });
    this.add.text(PANEL / 2, 96, 'T U T O R I A L', { fontFamily: FONT, fontStyle: 'bold', fontSize: '16px', color: palette.accent }).setOrigin(0.5).setLetterSpacing(2);
    this.add.text(PANEL / 2, 124, this.level.ruleName, { fontFamily: FONT, fontStyle: 'bold', fontSize: '20px', color: palette.text }).setOrigin(0.5);
    this.drawTracker(this.dir.tracker(), 30, 162, PANEL - 60);
    makeButton(this, PANEL / 2, GAME.height - 52, PANEL - 60, 44, 'SKIP TUTORIAL', () => this.skip(), { fontSize: 16 });
  }

  /** The 6-block progress tracker (port of draw_tutorial_progress). */
  private drawTracker(tracker: TrackerRow[], x: number, y: number, width: number, depth = 1): void {
    const rowH = 38;
    const muted = brighten(COLORS.panel, 70);
    tracker.forEach((row, i) => {
      const ry = y + i * rowH;
      const rh = rowH - 6;
      const mcx = x + 15;
      const mcy = ry + rh / 2;
      if (row.current) {
        this.add.image(x + width / 2, mcy, roundedTex(this, Math.ceil(width), Math.ceil(rh), 8)).setTint(brighten(COLORS.panel, 30)).setDepth(depth);
      }
      const dot = this.add.graphics().setDepth(depth + 1);
      if (row.done) {
        dot.fillStyle(COLORS.accent, 1); dot.fillCircle(mcx, mcy, 9);
      } else if (row.current) {
        dot.lineStyle(2, COLORS.accent, 1); dot.strokeCircle(mcx, mcy, 9);
      } else {
        dot.lineStyle(2, muted, 1); dot.strokeCircle(mcx, mcy, 8);
      }
      if (row.done) {
        this.add.text(mcx, mcy, '✓', { fontFamily: FONT, fontSize: '12px', color: '#1a181c' }).setOrigin(0.5).setDepth(depth + 2);
      }
      const nameCol = row.current || row.done ? palette.text : '#7a737a';
      const nameT = this.add.text(x + 32, mcy, row.name, { fontFamily: FONT, fontSize: '16px', color: nameCol }).setOrigin(0, 0.5).setDepth(depth + 1);
      if (row.done) {
        const line = this.add.graphics().setDepth(depth + 2);
        line.lineStyle(2, muted, 1);
        line.lineBetween(x + 32, mcy, x + 32 + nameT.width, mcy);
      }
      this.add.text(x + width - 8, mcy, `${row.cleared}/${row.total}`, { fontFamily: FONT, fontSize: '15px', color: row.current ? palette.accent : nameCol }).setOrigin(1, 0.5).setDepth(depth + 1);
    });
  }

  // --------------------------- board ---------------------------

  private cellOrigin(y: number, x: number): { ox: number; oy: number } {
    const step = this.cellSide + GAP;
    return { ox: BX + x * step, oy: BY + y * step };
  }
  private cellCenter(y: number, x: number): { cx: number; cy: number } {
    const { ox, oy } = this.cellOrigin(y, x);
    return { cx: ox + this.cellSide / 2, cy: oy + this.cellSide / 2 };
  }

  private buildBoard(): void {
    this.chips = [];
    this.bigObjs = [];
    const plateTex = roundedTex(this, this.cellSide, this.cellSide, Math.max(8, Math.round(this.cellSide * 0.11)));
    const plateColor = brighten(COLORS.bg, 14);
    for (let y = 0; y < this.size; y++) {
      this.chips.push([]);
      this.bigObjs.push([]);
      for (let x = 0; x < this.size; x++) {
        this.chips[y].push(new Map());
        this.bigObjs[y].push(null);
        const { cx, cy } = this.cellCenter(y, x);
        this.add.image(cx, cy, plateTex).setTint(plateColor).setDepth(0);
        const cell = this.board.cells[y][x];
        if (cell.value !== null) this.renderBig(y, x, cell.value, false);
        else for (const slot of this.candSlots(y, x)) if (cell.candidates.includes(slot.value)) this.makeChip(y, x, slot.value, slot.cx, slot.cy, slot.sub);
      }
    }
  }

  private candSlots(y: number, x: number): Array<{ value: number; cx: number; cy: number; sub: number }> {
    const cols = this.candCols;
    const rows = this.candRows;
    const cell = this.cellSide;
    const { ox, oy } = this.cellOrigin(y, x);
    const inset = Math.max(3, Math.floor(cell / 22));
    const avail = cell - 2 * inset;
    const sub = Math.floor(Math.min(avail / cols, avail / rows));
    const gx = ox + Math.floor((cell - sub * cols) / 2);
    const gy = oy + Math.floor((cell - sub * rows) / 2);
    const out: Array<{ value: number; cx: number; cy: number; sub: number }> = [];
    for (let index = 0; index < this.size; index++) {
      const dy = Math.floor(index / cols);
      const dx = index % cols;
      const inRow = Math.min(cols, this.size - dy * cols);
      const rowOff = Math.floor(((cols - inRow) * sub) / 2);
      out.push({ value: (y + 1) * 10 + index + 1, cx: gx + rowOff + dx * sub + sub / 2, cy: gy + dy * sub + sub / 2, sub });
    }
    return out;
  }

  private makeChip(y: number, x: number, value: number, cx: number, cy: number, sub: number): void {
    const base = (sub - 3) / 80;
    const color = rowColor(value);
    const img = this.add.image(cx, cy, this.tileTex).setScale(base).setTint(color).setDepth(5);
    const outline = this.add.image(cx, cy, strokedRoundedTex(this, 80, 80, 16, 4)).setScale(base).setTint(0xffffff).setAlpha(0).setDepth(6);
    const txt = this.add.text(cx, cy, symbolFor(value), { fontFamily: FONT, fontStyle: 'bold', fontSize: `${Math.max(11, Math.round(sub * 0.5))}px`, color: '#ffffff' }).setOrigin(0.5).setDepth(7);
    img.setInteractive({ useHandCursor: true });
    const chip: Chip = { img, txt, outline, value, cx, cy, sub, base };
    img.on('pointerover', () => { if (!this.busy && !this.finished && !this.popup) this.hoverStart(chip, [value]); });
    img.on('pointerout', () => this.hoverEnd());
    img.on('pointerdown', (p: Phaser.Input.Pointer) => this.onDown(y, x, value, p));
    this.chips[y][x].set(value, chip);
  }

  private lift(chip: Chip, on: boolean): void {
    this.tweens.killTweensOf([chip.img, chip.txt, chip.outline]);
    if (on) {
      chip.img.setTint(brighten(rowColor(chip.value), 56)).setDepth(20);
      chip.outline.setDepth(21).setAlpha(0.9);
      chip.txt.setDepth(22);
      const hb = chip.base * 1.1;
      this.tweens.add({ targets: [chip.img, chip.outline], scaleX: hb, scaleY: hb, duration: 120, ease: 'Back.easeOut' });
      this.tweens.add({ targets: chip.txt, scaleX: 1.1, scaleY: 1.1, duration: 120, ease: 'Back.easeOut' });
      this.tweens.add({ targets: [chip.img, chip.outline, chip.txt], y: chip.cy - 7, duration: 120 });
    } else {
      chip.img.setTint(rowColor(chip.value));
      this.tweens.add({ targets: [chip.img, chip.outline], scaleX: chip.base, scaleY: chip.base, duration: 120 });
      this.tweens.add({ targets: chip.txt, scaleX: 1, scaleY: 1, duration: 120 });
      this.tweens.add({ targets: chip.outline, alpha: 0, duration: 120 });
      this.tweens.add({
        targets: [chip.img, chip.outline, chip.txt], y: chip.cy, duration: 120,
        onComplete: () => { if (chip.img.active) { chip.img.setDepth(5); chip.outline.setDepth(6); chip.txt.setDepth(7); } },
      });
    }
  }

  // -------------------- cross-highlight hover + tooltips --------------------

  private chipGlow(c: Chip): Glowable {
    const col = rowColor(c.value);
    return { img: c.img, txt: c.txt, outline: c.outline, tintBase: col, tintHi: brighten(col, 56), scale: c.base, homeY: c.cy, canHop: true };
  }
  private bigGlow(b: BigCell): Glowable {
    return { img: b.img, txt: b.txt, outline: b.outline, tintBase: 0xffffff, tintHi: 0xffffff, scale: b.base, homeY: b.cy, canHop: true };
  }
  private clueGlow(m: ClueMini): Glowable {
    const col = rowColor(m.value);
    return { img: m.img, txt: m.txt, outline: m.outline, tintBase: col, tintHi: brighten(col, 56), scale: m.scale, homeY: m.img.y, canHop: false };
  }

  private glowablesForValues(values: number[]): Glowable[] {
    const set = new Set(values);
    const out: Glowable[] = [];
    for (let y = 0; y < this.size; y++) for (let x = 0; x < this.size; x++) {
      for (const [v, chip] of this.chips[y][x]) if (set.has(v)) out.push(this.chipGlow(chip));
      const big = this.bigObjs[y][x];
      if (big && set.has(big.value)) out.push(this.bigGlow(big));
    }
    for (const group of this.clueGroups) {
      if (group.dim) continue;
      for (const m of group.minis) if (set.has(m.value)) out.push(this.clueGlow(m));
    }
    return out;
  }

  private glow(g: Glowable, on: boolean, hop: boolean): void {
    if (!g.img.active) return;
    const movers = [g.img, g.outline, g.txt].filter(Boolean) as Phaser.GameObjects.GameObject[];
    const scalers = [g.img, g.outline].filter(Boolean) as Phaser.GameObjects.GameObject[];
    this.tweens.killTweensOf(movers);
    if (on) {
      g.img.setTint(g.tintHi);
      if (g.outline) g.outline.setAlpha(0.7);
      this.tweens.add({ targets: scalers, scaleX: g.scale * 1.06, scaleY: g.scale * 1.06, duration: 120, ease: 'Back.easeOut' });
      if (hop && g.canHop) this.tweens.add({ targets: movers, y: g.homeY - 9, duration: 170, yoyo: true, ease: 'Quad.easeOut' });
    } else {
      g.img.setTint(g.tintBase);
      if (g.outline) this.tweens.add({ targets: g.outline, alpha: 0, duration: 120 });
      this.tweens.add({ targets: scalers, scaleX: g.scale, scaleY: g.scale, duration: 120 });
      this.tweens.add({ targets: movers, y: g.homeY, duration: 120 });
    }
  }

  private hoverStart(source: Chip | BigCell | ClueGroup, values: number[]): void {
    this.hoverEnd();
    const direct = new Set<Phaser.GameObjects.Image>();
    if ('sub' in source) {
      this.hoverChip = source;
      this.lift(source, true);
      direct.add(source.img);
    } else if ('rule' in source) {
      this.hoverGroup = source;
      this.showTooltip(source);
      if (this.finished || source.dim) { /* tooltip only */ } else {
        for (const m of source.minis) { const g = this.clueGlow(m); this.glow(g, true, false); this.litGlow.push(g); direct.add(m.img); }
      }
    } else {
      const g = this.bigGlow(source);
      this.glow(g, true, false);
      this.litGlow.push(g);
      direct.add(source.img);
    }
    this.spreadTimer = this.time.delayedCall(HOVER_SPREAD_MS, () => {
      let lit = false;
      for (const g of this.glowablesForValues(values)) {
        if (direct.has(g.img)) continue;
        this.glow(g, true, true);
        this.litGlow.push(g);
        lit = true;
      }
      if (lit) audio.play('spread');
    });
  }

  private hoverEnd(): void {
    this.spreadTimer?.remove();
    this.spreadTimer = undefined;
    if (this.hoverChip) { this.lift(this.hoverChip, false); this.hoverChip = null; }
    for (const g of this.litGlow) this.glow(g, false, false);
    this.litGlow = [];
    this.hideTooltip();
    this.hoverGroup = null;
  }

  private showTooltip(group: ClueGroup): void {
    if (!settings.tooltips) return;
    this.hideTooltip();
    const segs = ruleSegments(group.rule);
    const tile = 26;
    const fontSize = 16;
    const pad = 12;
    const gap = 7;
    const tmp = this.add.text(0, 0, '', { fontFamily: FONT, fontSize: `${fontSize}px` }).setVisible(false);
    type Tok = { kind: 'cell' | 'word'; val: string | number; w: number };
    const toks: Tok[] = [];
    for (const s of segs) {
      if (s.kind === 'cell') toks.push({ kind: 'cell', val: s.value, w: tile });
      else for (const word of s.value.split(' ')) { tmp.setText(word); toks.push({ kind: 'word', val: word, w: tmp.width }); }
    }
    const maxW = 260;
    const lines: Tok[][] = [[]];
    let lineW = 0;
    for (const tk of toks) {
      const add = tk.w + (lineW > 0 ? gap : 0);
      if (lineW > 0 && lineW + add > maxW) { lines.push([]); lineW = tk.w; } else lineW += add;
      lines[lines.length - 1].push(tk);
    }
    tmp.destroy();
    const lineH = Math.max(tile, fontSize + 6) + 4;
    const widths = lines.map((ln) => ln.reduce((a, t) => a + t.w, 0) + gap * Math.max(0, ln.length - 1));
    const pw = Math.max(...widths) + pad * 2;
    const ph = lineH * lines.length + pad * 2;
    const objs: Phaser.GameObjects.GameObject[] = [];
    const bg = this.add.image(0, 0, roundedTex(this, Math.ceil(pw), Math.ceil(ph), 12)).setOrigin(0, 0).setTint(brighten(COLORS.panel, 24)).setAlpha(0.7);
    objs.push(bg);
    lines.forEach((ln, li) => {
      let x = pad;
      const cy = pad + li * lineH + lineH / 2;
      for (const tk of ln) {
        if (tk.kind === 'cell') {
          const v = tk.val as number;
          objs.push(this.add.image(x + tile / 2, cy, this.miniTex).setDisplaySize(tile, tile).setTint(rowColor(v)));
          objs.push(this.add.text(x + tile / 2, cy, symbolFor(v), { fontFamily: FONT, fontStyle: 'bold', fontSize: '15px', color: '#ffffff' }).setOrigin(0.5));
        } else {
          objs.push(this.add.text(x, cy, tk.val as string, { fontFamily: FONT, fontSize: `${fontSize}px`, color: palette.text }).setOrigin(0, 0.5));
        }
        x += tk.w + gap;
      }
    });
    let tx = group.gx - 14 - pw;
    if (tx < 8) tx = group.gx + RULE_CELL * 3 + 14;
    const ty = Math.max(8, Math.min(GAME.height - ph - 8, group.gy + RULE_CELL / 2 - ph / 2));
    this.tooltip = this.add.container(tx, ty, objs).setDepth(80);
  }

  private hideTooltip(): void {
    this.tooltip?.destroy();
    this.tooltip = undefined;
  }

  private destroyChip(chip: Chip, delay: number): void {
    if (this.hoverChip === chip) this.hoverEnd();
    this.tweens.killTweensOf([chip.img, chip.txt, chip.outline]);
    chip.img.disableInteractive();
    chip.outline.setAlpha(0);
    let done = false;
    const kill = () => { if (done) return; done = true; chip.img.destroy(); chip.txt.destroy(); chip.outline.destroy(); };
    this.tweens.add({ targets: [chip.img, chip.txt, chip.outline], scaleX: 0, scaleY: 0, alpha: 0, delay, duration: 200, ease: 'Back.easeIn', onComplete: kill });
    this.time.delayedCall(delay + 360, kill);
  }

  private renderBig(y: number, x: number, n: number, animate: boolean): void {
    const map = this.chips[y][x];
    if (this.hoverChip && map.get(this.hoverChip.value) === this.hoverChip) this.hoverEnd();
    for (const c of map.values()) { this.tweens.killTweensOf([c.img, c.txt, c.outline]); c.img.destroy(); c.txt.destroy(); c.outline.destroy(); }
    map.clear();
    const { cx, cy } = this.cellCenter(y, x);
    const color = rowColor(n);
    const base = this.cellSide / 160;
    const start = animate ? base * 0.3 : base;
    const img = this.add.image(cx, cy, bigCellTex(this, color)).setScale(start).setDepth(5);
    const outline = this.add.image(cx, cy, strokedRoundedTex(this, 160, 160, 18, 5)).setScale(start).setTint(0xffffff).setAlpha(0).setDepth(6);
    const txt = this.add.text(cx, cy, symbolFor(n), { fontFamily: FONT, fontStyle: 'bold', fontSize: `${Math.max(28, Math.round(this.cellSide * 0.46))}px`, color: '#ffffff' }).setOrigin(0.5).setScale(animate ? 0.3 : 1).setDepth(7);
    const big: BigCell = { img, txt, outline, value: n, cx, cy, base };
    this.bigObjs[y][x] = big;
    img.setInteractive({ useHandCursor: true });
    img.on('pointerover', () => { if (!this.busy && !this.finished && !this.popup) this.hoverStart(big, [n]); });
    img.on('pointerout', () => this.hoverEnd());
    if (animate) {
      this.tweens.add({ targets: [img, outline], scaleX: base, scaleY: base, duration: 440, ease: 'Back.easeOut' });
      this.tweens.add({ targets: txt, scaleX: 1, scaleY: 1, duration: 440, ease: 'Back.easeOut' });
      this.fx.bigBurst(cx, cy, this.cellSide, this.cellSide, color);
    }
  }

  private playEntrance(): void {
    const STEP = 45;
    let maxDelay = 0;
    this.busy = true;
    for (let y = 0; y < this.size; y++) for (let x = 0; x < this.size; x++) {
      const delay = (y + x) * STEP;
      maxDelay = Math.max(maxDelay, delay);
      const big = this.bigObjs[y][x];
      const pairs: Array<{ o: Phaser.GameObjects.Image | Phaser.GameObjects.Text; home: number }> = [];
      if (big) pairs.push({ o: big.img, home: big.base }, { o: big.txt, home: 1 });
      else for (const c of this.chips[y][x].values()) pairs.push({ o: c.img, home: c.base }, { o: c.txt, home: 1 });
      for (const { o, home } of pairs) {
        o.setScale(home * 0.5).setAlpha(0);
        this.tweens.add({ targets: o, scaleX: home, scaleY: home, alpha: 1, delay, duration: 260, ease: 'Back.easeOut' });
      }
    }
    this.time.delayedCall(maxDelay + 280, () => { this.busy = false; });
  }

  // --------------------------- input ---------------------------

  private bindInput(): void {
    this.input.on('pointerup', () => {
      this.clearHold();
      if (this.press && !this.press.fired) { const { y, x, n } = this.press; this.press.fired = true; this.act(y, x, n, false); }
      this.press = null;
      this.longPress?.remove();
      this.longPress = undefined;
    });
  }

  private onDown(y: number, x: number, n: number, pointer: Phaser.Input.Pointer): void {
    if (this.busy || this.finished || this.popup) return;
    if (pointer.rightButtonDown()) { this.act(y, x, n, true); return; }
    this.press = { y, x, n, fired: false };
    const chip = this.chips[y][x].get(n);
    if (chip) this.startHold(chip);
    this.longPress = this.time.delayedCall(HOLD_MS, () => { this.clearHold(); if (this.press && !this.press.fired) { this.press.fired = true; this.act(y, x, n, true); } });
  }

  private startHold(chip: Chip): void {
    this.clearHold();
    const g = this.add.graphics().setDepth(25);
    const r = Math.max(12, chip.sub * 0.6);
    this.holdRing = g;
    this.holdTween = this.tweens.addCounter({
      from: 0, to: 1, duration: HOLD_MS, ease: 'Linear',
      onUpdate: (tw) => {
        const t = tw.getValue() ?? 0;
        g.clear();
        g.lineStyle(4, 0x000000, 0.35); g.strokeCircle(chip.cx, chip.cy, r);
        g.lineStyle(4, 0xffe27a, 0.95); g.beginPath();
        g.arc(chip.cx, chip.cy, r, -Math.PI / 2, -Math.PI / 2 + t * Math.PI * 2, false); g.strokePath();
      },
    });
  }

  private clearHold(): void {
    this.holdTween?.stop(); this.holdTween = undefined;
    this.holdRing?.destroy(); this.holdRing = undefined;
  }

  /** A board gesture during the tutorial. Enforces block-0's tap/hold split and
   *  scores mistakes in the logic blocks (port of presenter tutorial handlers). */
  private act(y: number, x: number, n: number, isDefine: boolean): void {
    if (this.busy || this.finished || this.popup) return;
    const cell = this.board.cells[y][x];
    if (cell.value !== null || !cell.candidates.includes(n)) return;
    this.hoverEnd();
    const lv = this.level;

    // block 0 gesture gating: the un-taught gesture is a silent no-op nudge —
    // but on a hold-only level, a few taps earn a "hold the button" reminder.
    if (lv.block === 0 && !isDefine && !lv.tapOk) {
      this.wrongFeedback(y, x, n, false);
      this.misuseTaps += 1;
      if (this.misuseTaps === 6) this.openPopup({ text: GESTURE_HOLD_TEXT, buttonLabel: 'Got it', tag: 'TIP', animation: 'hold_to_define' });
      return;
    }
    if (lv.block === 0 && isDefine && !lv.holdOk) { this.wrongFeedback(y, x, n, false); return; }

    if (!lv.free) {
      const correct = lv.solution[y][x] === n;
      // popping the answer, or defining a non-answer, is the mistake
      if (isDefine ? !correct : correct) { this.mistake(y, x, n); return; }
    }

    const cs = isDefine ? this.board.define(y, x, n) : this.board.pop(y, x, n);
    this.applyChange(cs);
  }

  private applyChange(cs: ChangeSet): void {
    let maxStep = 0;
    for (const s of cs.struck) maxStep = Math.max(maxStep, s.step);
    for (const r of cs.resolved) maxStep = Math.max(maxStep, r.step);

    for (const s of cs.struck) {
      const chip = this.chips[s.y][s.x].get(s.n);
      if (!chip) continue;
      this.chips[s.y][s.x].delete(s.n);
      const delay = s.step * STEP_MS;
      this.destroyChip(chip, delay);
      this.time.delayedCall(delay + 60, () => this.fx.smallBurst(chip.cx, chip.cy, rowColor(s.n)));
    }
    for (const r of cs.resolved) {
      const delay = r.step * STEP_MS;
      const key = audio.pickForStep(Math.floor(r.step));
      this.time.delayedCall(delay, () => { this.renderBig(r.y, r.x, r.n, true); audio.play(key); });
    }
    if (cs.resolved.length > 0) audio.play('solve');
    else if (cs.struck.length > 0) audio.play('pick');
    if (cs.resolved.length >= 2) {
      const f = cs.resolved[0];
      const { cx, cy } = this.cellCenter(f.y, f.x);
      this.time.delayedCall(120, () => this.fx.comboText(cx, cy - 8, `+${cs.resolved.length} chain!`));
    }
    this.autoDimClues();

    const done = this.board.isWon;
    if (cs.resolved.length > 0 || cs.struck.length > 1) {
      this.busy = true;
      this.time.delayedCall(maxStep * STEP_MS + 420, () => { this.busy = false; if (done && !this.finished) this.finishLevel(); });
    } else if (done) {
      this.finishLevel();
    }
  }

  private wrongFeedback(y: number, x: number, n: number, sound: boolean): void {
    const { cx, cy } = this.cellCenter(y, x);
    this.fx.wrong(cx, cy, this.cellSide);
    if (sound) audio.play('wrong');
    const chip = this.chips[y][x].get(n);
    if (chip) {
      this.tweens.killTweensOf([chip.img, chip.txt, chip.outline]);
      chip.img.setDepth(5).setScale(chip.base).setTint(rowColor(chip.value)).setPosition(chip.cx, chip.cy);
      chip.outline.setDepth(6).setScale(chip.base).setAlpha(0).setPosition(chip.cx, chip.cy);
      chip.txt.setDepth(7).setScale(1).setPosition(chip.cx, chip.cy);
      this.tweens.add({ targets: [chip.img, chip.txt, chip.outline], x: chip.cx + 5, duration: 45, yoyo: true, repeat: 3, onComplete: () => { chip.img.x = chip.cx; chip.txt.x = chip.cx; chip.outline.x = chip.cx; } });
    }
  }

  private mistake(y: number, x: number, n: number): void {
    this.wrongFeedback(y, x, n, true);
    const text = this.dir.recordMistake();
    if (text) this.openPopup({ text, buttonLabel: 'Got it', tag: 'TIP' });
  }

  // --------------------------- clues ---------------------------

  private buildClues(): void {
    if (!this.level.clues.length) return;
    this.add.text(CLUE_X + PANEL / 2, 60, 'C L U E S', { fontFamily: FONT, fontStyle: 'bold', fontSize: '20px', color: palette.text }).setOrigin(0.5).setLetterSpacing(2);
    const ruleW = RULE_CELL * 3;
    const startY = 120;
    const rowH = RULE_CELL + 22;
    this.level.clues.forEach((rule, i) => {
      const gx = CLUE_X + (PANEL - ruleW) / 2;
      const gy = startY + i * rowH;
      this.makeClueGroup(rule, gx, gy);
    });
  }

  private makeClueGroup(rule: Rule, gx: number, gy: number): void {
    const objs: Phaser.GameObjects.GameObject[] = [];
    const minis: ClueMini[] = [];
    const miniScale = (RULE_CELL - 4) / 64;
    for (let j = 0; j < 3; j++) {
      const v = rule[j];
      const sx = gx + j * RULE_CELL + RULE_CELL / 2;
      const sy = gy + RULE_CELL / 2;
      if (typeof v === 'number') {
        const img = this.add.image(sx, sy, this.miniTex).setDisplaySize(RULE_CELL - 4, RULE_CELL - 4).setTint(rowColor(v));
        const outline = this.add.image(sx, sy, strokedRoundedTex(this, 64, 64, 12, 5)).setScale(miniScale).setTint(0xffffff).setAlpha(0);
        const t = this.add.text(sx, sy, symbolFor(v), { fontFamily: FONT, fontStyle: 'bold', fontSize: '22px', color: '#ffffff' }).setOrigin(0.5);
        objs.push(img, t); // outline NOT in objs (dim must not leave it visible)
        minis.push({ img, txt: t, outline, value: v, scale: miniScale });
      } else {
        objs.push(this.add.text(sx, sy, OP_SYMBOL[v] ?? String(v), { fontFamily: FONT, fontStyle: 'bold', fontSize: '24px', color: palette.accent }).setOrigin(0.5));
      }
    }
    const group: ClueGroup = { objs, minis, rule, gx, gy, dim: false };
    this.clueGroups.push(group);
    const hit = this.add.rectangle(gx, gy, RULE_CELL * 3, RULE_CELL, 0xffffff, 0).setOrigin(0, 0).setInteractive({ useHandCursor: true });
    hit.on('pointerover', () => { if (!this.popup) this.hoverStart(group, group.minis.map((m) => m.value)); });
    hit.on('pointerout', () => { if (this.hoverGroup === group) this.hoverEnd(); });
    hit.on('pointerdown', () => {
      group.dim = !group.dim;
      group.objs.forEach((o) => (o as Phaser.GameObjects.Image).setAlpha(group.dim ? 0.32 : 1));
      for (const m of group.minis) { this.tweens.killTweensOf([m.img, m.outline, m.txt]); m.outline.setAlpha(0); m.img.setScale(m.scale).setTint(rowColor(m.value)); m.txt.setScale(1); }
      if (group.dim && this.hoverGroup === group) this.hoverEnd();
    });
  }

  private valueSolved(n: number): boolean {
    for (let y = 0; y < this.size; y++) for (let x = 0; x < this.size; x++) if (this.board.cells[y][x].value === n) return true;
    return false;
  }

  private autoDimClues(): void {
    for (const group of this.clueGroups) {
      if (group.dim) continue;
      if (!group.rule.every((v) => typeof v !== 'number' || this.valueSolved(v))) continue;
      group.dim = true;
      group.objs.forEach((o) => (o as Phaser.GameObjects.Image).setAlpha(0.32));
      for (const m of group.minis) { this.tweens.killTweensOf([m.img, m.outline, m.txt]); m.outline.setAlpha(0); m.img.setScale(m.scale).setTint(rowColor(m.value)); m.txt.setScale(1); }
      if (this.hoverGroup === group) this.hoverEnd();
    }
  }

  // --------------------------- popups / flow ---------------------------

  private showIntro(): void {
    const intro = this.dir.introText();
    if (intro) {
      const anim: TutorialAnim | undefined = this.dir.block === 0 ? 'pop_to_solve' : undefined;
      const spotlight = this.dir.block === 1 && this.clueGroups.length
        ? { x: CLUE_X + 8, y: 100, w: PANEL - 16, h: 60 + this.level.clues.length * (RULE_CELL + 22) }
        : undefined;
      this.openPopup({ text: intro, buttonLabel: this.dir.block === 0 ? "Let's play!" : 'Got it', tag: 'TUTORIAL', animation: anim, spotlight });
      return;
    }
    const note = this.dir.gestureIntro();
    if (note) this.openPopup({ text: note, buttonLabel: 'Got it', tag: 'TIP', animation: 'hold_to_define' });
  }

  private openPopup(opts: { text: string; buttonLabel?: string; tag?: string; animation?: TutorialAnim; spotlight?: { x: number; y: number; w: number; h: number } }): void {
    this.popup?.destroy();
    this.popup = new TutorialPopup(this, { ...opts, onDone: () => { this.popup = undefined; } });
  }

  private finishLevel(): void {
    if (this.finished) return;
    this.finished = true;
    const result = this.dir.completeLevel();
    settings.tutorialBlocks = this.dir.blocksDone;
    audio.play('win');
    if (result.outcome === 'block' || result.outcome === 'replay' || result.outcome === 'tutorial') this.fx.celebrate();
    this.time.delayedCall(result.outcome === 'level' || result.outcome === 'reset' ? 250 : 500, () => this.showResult(result));
  }

  private showResult(result: CompleteResult): void {
    this.lastResult = result;
    const message = result.final || result.praise || result.reminder || (result.goalHint ? GOAL_HINT : null);
    const isEnd = result.outcome === 'tutorial';
    const cx = GAME.width / 2;
    const lines = message ? this.wrapLines(message, 420) : [];
    const trackerRows = this.dir.tracker();
    const ph = 150 + lines.length * 24 + trackerRows.length * 38 + 80;
    const cy = GAME.height / 2;
    const top = cy - ph / 2;

    this.add.rectangle(cx, cy, GAME.width, GAME.height, 0x000000, 0.66).setDepth(200).setInteractive();
    this.add.image(cx, cy, roundedTex(this, 480, ph, 22)).setTint(COLORS.panel).setDepth(201);
    this.add.image(cx, cy, strokedRoundedTex(this, 480, ph, 22, 3)).setTint(0xffd678).setDepth(201);
    this.add.text(cx, top + 46, TITLE[result.outcome] ?? 'LEVEL CLEAR', { fontFamily: FONT, fontStyle: 'bold', fontSize: '30px', color: '#ffe27a' }).setOrigin(0.5).setDepth(202);

    let y = top + 84;
    for (const ln of lines) { this.add.text(cx, y, ln, { fontFamily: FONT, fontSize: '17px', color: palette.accent, align: 'center' }).setOrigin(0.5).setDepth(202); y += 24; }
    y += 6;
    this.add.text(cx, y, 'TUTORIAL PROGRESS', { fontFamily: FONT, fontSize: '13px', color: '#7a737a' }).setOrigin(0.5).setDepth(202);
    this.drawTracker(trackerRows, cx - 210, y + 16, 420, 202);

    const by = top + ph - 64;
    const b = makeButton(this, cx, by, 240, 50, isEnd ? 'To the menu' : 'Continue', () => this.advance(result), { fontSize: 20, fill: COLORS.accent, textColor: '#1c1a1e' });
    b.root.setDepth(203);
  }

  private advance(result: CompleteResult): void {
    if (result.outcome === 'replay' || result.outcome === 'tutorial') {
      if (result.outcome === 'tutorial') stats.unlock(['tutorial']);
      this.registry.remove('tutorialDirector');
      this.scene.start('menu');
    } else {
      this.scene.restart();
    }
  }

  private toMenu(): void {
    // keep the director in the registry so progress isn't lost
    this.scene.start('menu');
  }

  private skip(): void {
    this.dir.skipAll();
    settings.tutorialBlocks = 6;
    stats.unlock(['tutorial']);
    this.registry.remove('tutorialDirector');
    this.scene.start('menu');
  }

  // ---- text wrap helper ----
  private wrapLines(text: string, maxW: number): string[] {
    const probe = this.add.text(0, 0, '', { fontFamily: FONT, fontSize: '17px' }).setVisible(false);
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
