import Phaser from 'phaser';
import { COLORS, GAME, FONT, palette, rowColor, brighten } from '../config';
import { generatePuzzle, FieldAndRules, COMPLEXITY } from '../model/fieldAndRules';
import { PuzzleBoard, ChangeSet } from '../model/board';
import { symbolFor, ruleSegments } from '../model/decoder';
import { Rule } from '../model/types';
import { makeButton } from '../ui/button';
import { roundedTex, strokedRoundedTex, bigCellTex, shadowTex, shadowStripTex } from '../ui/textures';
import { Fx } from '../fx/fx';
import { audio } from '../audio/sound';
import { stats, parTime } from '../model/stats';
import { evaluate, achievementInfo } from '../model/achievements';

// Layout mirrors the pygame landscape build (view/window.py).
const SPAN = 615;
const GAP = 3;
const MARGIN = 60;
const PANEL = 280;
const BX = PANEL + MARGIN; // board origin x = 340
const BY = MARGIN; // board origin y = 60
const CLUE_X = BX + SPAN + MARGIN; // right panel x = 1015
const RULE_CELL = 38;
const RULES_TOP = 54;
const STEP_MS = 130;
const MAX_LIVES = 3;
const DIFF = ['EASY', 'NORMAL', 'HARD'];
const OP_SYMBOL: Record<string, string> = { '^': '↕', '<->': '↔', '...': '…' };
const HOVER_SPREAD_MS = 200; // pygame HOVER_PROPAGATE_DELAY before twins light up

let TILE = '';
let MINI = '';
let SHADOW = '';

interface Chip {
  img: Phaser.GameObjects.Image;
  txt: Phaser.GameObjects.Text;
  outline: Phaser.GameObjects.Image;
  value: number;
  cx: number;
  cy: number;
  sub: number;
  base: number;
}
interface BigCell {
  img: Phaser.GameObjects.Image;
  txt: Phaser.GameObjects.Text;
  outline: Phaser.GameObjects.Image;
  value: number;
  cx: number;
  cy: number;
  base: number;
}
interface ClueMini { img: Phaser.GameObjects.Image; txt: Phaser.GameObjects.Text; value: number; scale: number; }
interface PressInfo { y: number; x: number; n: number; fired: boolean; }
interface ClueGroup { objs: Phaser.GameObjects.GameObject[]; minis: ClueMini[]; rule: Rule; gx: number; gy: number; dim: boolean; }

// A uniform "highlightable" used by the cross-hover system (board chips, big
// cells and clue minis all reduce to this).
interface Glowable {
  img: Phaser.GameObjects.Image;
  txt?: Phaser.GameObjects.Text;
  outline?: Phaser.GameObjects.Image;
  color: number;
  scale: number;
  homeY: number;
}

export class GameScene extends Phaser.Scene {
  private size = 4;
  private difficulty = 0;
  private seed = 0;
  private isRetry = false;
  private zen = false;

  // results filled in at finish(), read by showEndPanel()
  private bestText: string | null = null;
  private newRecord = false;
  private freshBadges: string[] = [];

  private model!: FieldAndRules;
  private board!: PuzzleBoard;
  private fx!: Fx;

  private cellSide = 0;
  private candCols = 2;
  private candRows = 2;
  private chips: Array<Array<Map<number, Chip>>> = [];
  private bigObjs: Array<Array<BigCell | null>> = [];
  private clueGroups: ClueGroup[] = [];
  private tooltip?: Phaser.GameObjects.Container;

  // cross-highlight hover state
  private liftShadow?: Phaser.GameObjects.Image;
  private hoverSource: Chip | BigCell | ClueGroup | null = null;
  private spreadTimer?: Phaser.Time.TimerEvent;
  private directLiftChip: Chip | null = null;
  private directGlow: Glowable[] = [];
  private litSpread: Glowable[] = [];

  private timerText!: Phaser.GameObjects.Text;
  private hearts: Phaser.GameObjects.Text[] = [];
  private lives = MAX_LIVES;
  private mistakes = 0;
  private seconds = 0;
  private timerEvent?: Phaser.Time.TimerEvent;

  private busy = false;
  private gameOver = false;
  private press: PressInfo | null = null;
  private longPress?: Phaser.Time.TimerEvent;

  constructor() {
    super('game');
  }

  init(data: { size?: number; difficulty?: number; seed?: number; retry?: boolean; zen?: boolean }): void {
    this.size = data?.size ?? 4;
    this.difficulty = data?.difficulty ?? 0;
    this.seed = data?.seed ?? 0;
    this.isRetry = !!data?.retry;
    this.zen = !!data?.zen;
    this.bestText = null;
    this.newRecord = false;
    this.freshBadges = [];
    this.lives = MAX_LIVES;
    this.mistakes = 0;
    this.seconds = 0;
    this.busy = false;
    this.gameOver = false;
    this.press = null;
    this.hearts = [];
    this.clueGroups = [];
    this.tooltip = undefined;
    this.hoverSource = null;
    this.directLiftChip = null;
    this.directGlow = [];
    this.litSpread = [];
  }

  create(): void {
    this.input.mouse?.disableContextMenu();
    this.cameras.main.setBackgroundColor(COLORS.bg);
    this.fx = new Fx(this);

    TILE = roundedTex(this, 80, 80, 16);
    MINI = roundedTex(this, 64, 64, 12);
    SHADOW = shadowTex(this);

    try {
      const gen = generatePuzzle(this.size, this.difficulty, this.seed || undefined);
      this.model = gen.model;
      this.seed = gen.seed;
    } catch {
      this.add.text(GAME.width / 2, GAME.height / 2, 'Failed to generate a board.\nTap to return to menu.', {
        fontFamily: FONT, fontSize: '24px', color: palette.text, align: 'center',
      }).setOrigin(0.5);
      this.input.once('pointerdown', () => this.scene.start('menu', this.menuData()));
      return;
    }

    this.cellSide = Math.floor((SPAN - (this.size - 1) * GAP) / this.size);
    this.candCols = Math.ceil(Math.sqrt(this.size));
    this.candRows = Math.ceil(this.size / this.candCols);
    this.board = new PuzzleBoard(this.size, this.model.solution, this.model.definedStartCells);

    this.liftShadow = this.add.image(0, 0, SHADOW).setAlpha(0).setDepth(19);

    this.buildBackground();
    this.buildPanel();
    this.buildBoard();
    this.buildClues();
    this.bindInput();
    this.startTimer();

    audio.startMusic();
    audio.play('start');

    if (this.board.isWon) this.time.delayedCall(250, () => this.finish(true));
  }

  // ------------------------ background panels ------------------------

  /** The left (menu/time/lives) and right (clues) panels: a brighten(bg,13)
   *  backing, a lighter divider line, and a soft shadow strip cast onto the
   *  board — mirrors window.py _draw_left_panel / _draw_rules_panel. */
  private buildBackground(): void {
    const panelColor = brighten(COLORS.bg, 13);
    const divider = brighten(panelColor, 30);
    const leftEdge = BX - 22; // left panel's right edge
    const rightEdge = BX + SPAN + 22; // right panel's left edge

    const g = this.add.graphics().setDepth(-10);
    g.fillStyle(panelColor, 1);
    g.fillRect(0, 0, leftEdge, GAME.height);
    g.fillRect(rightEdge, 0, GAME.width - rightEdge, GAME.height);
    g.lineStyle(1, divider, 1);
    g.lineBetween(leftEdge, 0, leftEdge, GAME.height);
    g.lineBetween(rightEdge, 0, rightEdge, GAME.height);

    this.add.image(leftEdge, 0, shadowStripTex(this, false, GAME.height)).setOrigin(0, 0).setDepth(-9);
    this.add.image(rightEdge - 16, 0, shadowStripTex(this, true, GAME.height)).setOrigin(0, 0).setDepth(-9);
  }

  // --------------------------- left panel ---------------------------

  private buildPanel(): void {
    makeButton(this, PANEL / 2, 42, PANEL - 60, 48, '☰  MENU', () => this.scene.start('menu', this.menuData()), { fontSize: 19 });

    this.add.text(PANEL / 2, 120, 'T I M E', { fontFamily: FONT, fontSize: '14px', color: palette.accent }).setOrigin(0.5);
    this.timerText = this.add
      .text(PANEL / 2, 152, '00:00', { fontFamily: FONT, fontStyle: 'bold', fontSize: '40px', color: palette.text })
      .setOrigin(0.5);

    if (this.zen) {
      // Zen: no lives to lose — show a calm infinity instead of the hearts.
      this.add.text(PANEL / 2, 188, 'Z E N', { fontFamily: FONT, fontSize: '14px', color: palette.accent }).setOrigin(0.5);
      this.add.text(PANEL / 2, 224, '∞', { fontFamily: FONT, fontStyle: 'bold', fontSize: '40px', color: '#86b89a' }).setOrigin(0.5);
    } else {
      this.add.text(PANEL / 2, 188, 'L I V E S', { fontFamily: FONT, fontSize: '14px', color: palette.accent }).setOrigin(0.5);
      for (let i = 0; i < MAX_LIVES; i++) {
        const { cx, cy } = this.heartPos(i);
        this.hearts.push(this.add.text(cx, cy, '♥', { fontFamily: FONT, fontSize: '32px', color: '#e05a68' }).setOrigin(0.5));
      }
      this.updateLives();
    }

    const cplx = COMPLEXITY[this.size][this.difficulty];
    this.add
      .text(PANEL / 2, 268, this.zen ? `ZEN  ·  ${this.size}×${this.size}` : `${DIFF[this.difficulty]}  ·  ${this.size}×${this.size}`, {
        fontFamily: FONT, fontStyle: 'bold', fontSize: '18px', color: palette.text,
      })
      .setOrigin(0.5);
    this.add
      .text(PANEL / 2, 292, `${cplx} cells given`, { fontFamily: FONT, fontSize: '13px', color: palette.accent })
      .setOrigin(0.5);

    makeButton(this, PANEL / 2, GAME.height - 60, PANEL - 60, 46, 'HINT', () => this.hint(), { fontSize: 18 });
  }

  private heartPos(i: number): { cx: number; cy: number } {
    const start = PANEL / 2 - ((MAX_LIVES - 1) * 38) / 2;
    return { cx: start + i * 38, cy: 224 };
  }

  private updateLives(): void {
    this.hearts.forEach((h, i) => {
      const alive = i < this.lives;
      h.setColor(alive ? '#e05a68' : '#3b353b');
      h.setText(alive ? '♥' : '♡');
    });
  }

  private startTimer(): void {
    this.timerEvent = this.time.addEvent({
      delay: 1000, loop: true,
      callback: () => {
        if (this.gameOver) return;
        this.seconds += 1;
        this.timerText.setText(this.fmt(this.seconds));
      },
    });
  }

  private fmt(s: number): string {
    return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
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
    // A faint ghost plate behind every cell so the grid reads even when a cell
    // is empty (window.py draws a rounded fill of brighten(bg, 14) per cell).
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
        if (cell.value !== null) {
          this.renderBig(y, x, cell.value, false);
        } else {
          // only render candidates the model still holds — a value already
          // placed in this row was struck out, so its slot stays empty.
          for (const slot of this.candSlots(y, x)) {
            if (cell.candidates.includes(slot.value)) this.makeChip(y, x, slot.value, slot.cx, slot.cy, slot.sub);
          }
        }
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
      const tx = gx + rowOff + dx * sub;
      const ty = gy + dy * sub;
      out.push({ value: (y + 1) * 10 + index + 1, cx: tx + sub / 2, cy: ty + sub / 2, sub });
    }
    return out;
  }

  private makeChip(y: number, x: number, value: number, cx: number, cy: number, sub: number): void {
    const base = (sub - 3) / 80;
    const color = rowColor(value);
    const img = this.add.image(cx, cy, TILE).setScale(base).setTint(color).setDepth(5);
    const outline = this.add.image(cx, cy, strokedRoundedTex(this, 80, 80, 16, 4)).setScale(base).setTint(0xffffff).setAlpha(0).setDepth(6);
    const txt = this.add
      .text(cx, cy, symbolFor(value), {
        fontFamily: FONT, fontStyle: 'bold',
        fontSize: `${Math.max(11, Math.round(sub * 0.5))}px`, color: '#ffffff',
      })
      .setOrigin(0.5).setDepth(7);
    img.setInteractive({ useHandCursor: true });

    const chip: Chip = { img, txt, outline, value, cx, cy, sub, base };
    img.on('pointerover', () => {
      if (this.busy || this.gameOver) return;
      this.hoverStart(chip, [value], { liftChip: chip });
    });
    img.on('pointerout', () => { if (this.hoverSource === chip) this.hoverEnd(); });
    img.on('pointerdown', (pointer: Phaser.Input.Pointer) => this.onChipDown(y, x, value, pointer));

    this.chips[y][x].set(value, chip);
  }

  // ---------------------- cross-highlight hover ----------------------

  private chipGlow(c: Chip): Glowable {
    return { img: c.img, txt: c.txt, outline: c.outline, color: rowColor(c.value), scale: c.base, homeY: c.cy };
  }

  private bigGlow(b: BigCell): Glowable {
    return { img: b.img, txt: b.txt, outline: b.outline, color: rowColor(b.value), scale: b.base, homeY: b.cy };
  }

  private clueGlow(m: ClueMini): Glowable {
    return { img: m.img, txt: m.txt, color: rowColor(m.value), scale: m.scale, homeY: m.img.y };
  }

  /** Every highlightable on screen whose value is in `values`. */
  private glowablesForValues(values: number[]): Glowable[] {
    const set = new Set(values);
    const out: Glowable[] = [];
    for (let y = 0; y < this.size; y++) {
      for (let x = 0; x < this.size; x++) {
        for (const [v, chip] of this.chips[y][x]) if (set.has(v)) out.push(this.chipGlow(chip));
        const big = this.bigObjs[y][x];
        if (big && set.has(big.value)) out.push(this.bigGlow(big));
      }
    }
    for (const group of this.clueGroups) {
      if (group.dim) continue; // crossed-out clue never highlights
      for (const m of group.minis) if (set.has(m.value)) out.push(this.clueGlow(m));
    }
    return out;
  }

  /** Brighten + outline + (optional) one-shot hop on a highlightable. */
  private glow(g: Glowable, on: boolean, hop: boolean): void {
    if (!g.img.active) return;
    const movers = [g.img, g.outline, g.txt].filter(Boolean) as Phaser.GameObjects.GameObject[];
    const scalers = [g.img, g.outline].filter(Boolean) as Phaser.GameObjects.GameObject[];
    this.tweens.killTweensOf(movers);
    if (on) {
      g.img.setTint(brighten(g.color, 56));
      if (g.outline) g.outline.setAlpha(0.7);
      this.tweens.add({ targets: scalers, scaleX: g.scale * 1.06, scaleY: g.scale * 1.06, duration: 120, ease: 'Back.easeOut' });
      if (hop) this.tweens.add({ targets: movers, y: g.homeY - 9, duration: 170, yoyo: true, ease: 'Quad.easeOut' });
    } else {
      g.img.setTint(g.color);
      if (g.outline) this.tweens.add({ targets: g.outline, alpha: 0, duration: 120 });
      this.tweens.add({ targets: scalers, scaleX: g.scale, scaleY: g.scale, duration: 120 });
      this.tweens.add({ targets: movers, y: g.homeY, duration: 120 });
    }
  }

  /** Directly-hovered candidate lifts: scale up, rise, drop shadow, outline. */
  private liftChip(chip: Chip, on: boolean): void {
    const { img, txt, outline, base, cx, cy, sub } = chip;
    this.tweens.killTweensOf([img, txt, outline]);
    if (on) {
      img.setTint(brighten(rowColor(chip.value), 56));
      img.setDepth(20); outline.setDepth(21); txt.setDepth(22);
      outline.setAlpha(0.9);
      const hb = base * 1.1;
      this.tweens.add({ targets: [img, outline], scaleX: hb, scaleY: hb, duration: 120, ease: 'Back.easeOut' });
      this.tweens.add({ targets: txt, scaleX: 1.1, scaleY: 1.1, duration: 120, ease: 'Back.easeOut' });
      this.tweens.add({ targets: [img, outline, txt], y: cy - 7, duration: 120, ease: 'Quad.easeOut' });
      if (this.liftShadow) {
        this.tweens.killTweensOf(this.liftShadow);
        this.liftShadow.setPosition(cx, cy + 7).setDisplaySize(sub * 1.32, sub * 1.32).setDepth(19);
        this.tweens.add({ targets: this.liftShadow, alpha: 0.5, duration: 120 });
      }
    } else {
      img.setTint(rowColor(chip.value));
      this.tweens.add({ targets: [img, outline], scaleX: base, scaleY: base, duration: 120 });
      this.tweens.add({ targets: txt, scaleX: 1, scaleY: 1, duration: 120 });
      this.tweens.add({ targets: outline, alpha: 0, duration: 120 });
      this.tweens.add({
        targets: [img, outline, txt], y: cy, duration: 120,
        onComplete: () => { if (img.active) { img.setDepth(5); outline.setDepth(6); txt.setDepth(7); } },
      });
      if (this.liftShadow) { this.tweens.killTweensOf(this.liftShadow); this.tweens.add({ targets: this.liftShadow, alpha: 0, duration: 120 }); }
    }
  }

  private hoverStart(source: Chip | BigCell | ClueGroup, values: number[], opts: { liftChip?: Chip; glowNow?: Glowable[] }): void {
    this.hoverEnd();
    this.hoverSource = source;
    if (opts.liftChip) { this.directLiftChip = opts.liftChip; this.liftChip(opts.liftChip, true); }
    if (opts.glowNow) { this.directGlow = opts.glowNow; for (const g of opts.glowNow) this.glow(g, true, false); }
    // twins/linked cells fan out after a short delay (pygame propagation)
    this.spreadTimer = this.time.delayedCall(HOVER_SPREAD_MS, () => {
      const direct = new Set<Phaser.GameObjects.Image>();
      if (this.directLiftChip) direct.add(this.directLiftChip.img);
      for (const g of this.directGlow) direct.add(g.img);
      this.litSpread = [];
      for (const g of this.glowablesForValues(values)) {
        if (direct.has(g.img)) continue;
        this.glow(g, true, true);
        this.litSpread.push(g);
      }
      if (this.litSpread.length > 0) audio.play('spread');
    });
  }

  private hoverEnd(): void {
    this.spreadTimer?.remove();
    this.spreadTimer = undefined;
    if (this.directLiftChip) { this.liftChip(this.directLiftChip, false); this.directLiftChip = null; }
    for (const g of this.directGlow) this.glow(g, false, false);
    this.directGlow = [];
    for (const g of this.litSpread) this.glow(g, false, false);
    this.litSpread = [];
    this.hoverSource = null;
  }

  /** Tear a candidate chip down reliably: kill any in-flight (hover) tweens and
   *  detach input first, then a squash-and-pop, with a guaranteed destroy even
   *  if the tween is interrupted — so a popped chip never lingers on screen. */
  private destroyChip(chip: Chip, delay: number): void {
    this.tweens.killTweensOf([chip.img, chip.txt, chip.outline]);
    chip.img.disableInteractive();
    chip.outline.setAlpha(0);
    let done = false;
    const kill = () => {
      if (done) return;
      done = true;
      chip.img.destroy(); chip.txt.destroy(); chip.outline.destroy();
    };
    // Back.easeIn overshoots up before collapsing — the squash-and-pop
    this.tweens.add({
      targets: [chip.img, chip.txt, chip.outline], scaleX: 0, scaleY: 0, alpha: 0,
      delay, duration: 200, ease: 'Back.easeIn', onComplete: kill,
    });
    this.time.delayedCall(delay + 360, kill);
  }

  private renderBig(y: number, x: number, n: number, animate: boolean): void {
    const map = this.chips[y][x];
    for (const c of map.values()) {
      this.tweens.killTweensOf([c.img, c.txt, c.outline]);
      c.img.destroy(); c.txt.destroy(); c.outline.destroy();
    }
    map.clear();
    const { cx, cy } = this.cellCenter(y, x);
    const color = rowColor(n);
    const base = this.cellSide / 160;
    const start = animate ? base * 0.3 : base;
    // colour baked into the texture (gradient + thin highlight band), no tint
    const img = this.add.image(cx, cy, bigCellTex(this, color)).setScale(start).setDepth(5);
    const outline = this.add.image(cx, cy, strokedRoundedTex(this, 160, 160, 18, 5)).setScale(start).setTint(0xffffff).setAlpha(0).setDepth(6);
    const txt = this.add
      .text(cx, cy, symbolFor(n), {
        fontFamily: FONT, fontStyle: 'bold',
        fontSize: `${Math.max(28, Math.round(this.cellSide * 0.46))}px`, color: '#ffffff',
      })
      .setOrigin(0.5)
      .setScale(animate ? 0.3 : 1)
      .setDepth(7);

    const big: BigCell = { img, txt, outline, value: n, cx, cy, base };
    this.bigObjs[y][x] = big;
    img.setInteractive({ useHandCursor: true });
    img.on('pointerover', () => {
      if (this.busy || this.gameOver) return;
      this.hoverStart(big, [n], { glowNow: [this.bigGlow(big)] });
    });
    img.on('pointerout', () => { if (this.hoverSource === big) this.hoverEnd(); });

    if (animate) {
      this.tweens.add({ targets: [img, outline], scaleX: base, scaleY: base, duration: 340, ease: 'Back.easeOut' });
      this.tweens.add({ targets: txt, scaleX: 1, scaleY: 1, duration: 340, ease: 'Back.easeOut' });
      this.fx.bigBurst(cx, cy, this.cellSide, this.cellSide, color);
    }
  }

  // --------------------------- input ---------------------------

  private bindInput(): void {
    this.input.on('pointerup', () => {
      if (this.press && !this.press.fired) {
        const { y, x, n } = this.press;
        this.press.fired = true;
        this.doAction(y, x, n, false);
      }
      this.press = null;
      this.longPress?.remove();
      this.longPress = undefined;
    });
  }

  private onChipDown(y: number, x: number, n: number, pointer: Phaser.Input.Pointer): void {
    if (this.busy || this.gameOver) return;
    if (pointer.rightButtonDown()) {
      this.doAction(y, x, n, true);
      return;
    }
    this.press = { y, x, n, fired: false };
    this.longPress = this.time.delayedCall(350, () => {
      if (this.press && !this.press.fired) {
        this.press.fired = true;
        this.doAction(y, x, n, true);
      }
    });
  }

  private doAction(y: number, x: number, n: number, isDefine: boolean): void {
    if (this.busy || this.gameOver) return;
    const cell = this.board.cells[y][x];
    if (cell.value !== null || !cell.candidates.includes(n)) return;
    this.hoverEnd(); // drop any highlight before the board mutates
    const correct = this.board.isAnswer(y, x, n);
    if (isDefine ? !correct : correct) {
      this.registerWrong(y, x, n);
      return;
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

    // Audio mirrors view/window.py: each *resolving* cell ticks a 'pick' at its
    // combo pitch (cascade depth → rising arpeggio); the many row-strike shimmer
    // pops above stay silent (a pick per struck candidate was noisy). One 'solve'
    // chime per resolving action sits under the run.
    for (const r of cs.resolved) {
      const delay = r.step * STEP_MS;
      const key = audio.pickForStep(Math.floor(r.step));
      this.time.delayedCall(delay, () => {
        this.renderBig(r.y, r.x, r.n, true);
        audio.play(key);
      });
    }
    if (cs.resolved.length > 0) {
      audio.play('solve');
    } else if (cs.struck.length > 0) {
      // a plain pop that resolved nothing still answers the tap
      audio.play('pick');
    }

    if (cs.resolved.length >= 3) {
      const f = cs.resolved[0];
      const { cx, cy } = this.cellCenter(f.y, f.x);
      this.time.delayedCall(120, () => this.fx.comboText(cx, cy - 8, `+${cs.resolved.length} chain!`));
    }

    if (cs.resolved.length > 0 || cs.struck.length > 1) {
      this.busy = true;
      this.time.delayedCall(maxStep * STEP_MS + 420, () => {
        this.busy = false;
        if (!this.gameOver && this.board.isWon) this.finish(true);
      });
    } else if (this.board.isWon) {
      this.finish(true);
    }
  }

  private registerWrong(y: number, x: number, n: number): void {
    this.mistakes += 1;
    audio.play('wrong');
    // Flood the WHOLE cell red + downward spray + ring + edge-vignette pulse
    // (pygame wrong_click takes the full cell rect, not the small candidate).
    const { cx, cy } = this.cellCenter(y, x);
    this.fx.wrong(cx, cy, this.cellSide);
    const chip = this.chips[y][x].get(n);
    if (chip) {
      // an absolute-x jitter (not '+=5') so repeated wrong taps never drift
      this.tweens.killTweensOf([chip.img, chip.txt, chip.outline]);
      this.tweens.add({
        targets: [chip.img, chip.txt, chip.outline], x: chip.cx + 5,
        duration: 45, yoyo: true, repeat: 3,
        onComplete: () => { chip.img.x = chip.cx; chip.txt.x = chip.cx; chip.outline.x = chip.cx; },
      });
    }
    // Zen: the run can never end — give the feedback but keep all lives.
    if (this.zen) return;
    this.lives -= 1;
    this.updateLives();
    const hp = this.heartPos(Math.max(0, this.lives));
    this.fx.heartBreak(hp.cx, hp.cy);
    if (this.lives <= 0) this.finish(false);
  }

  private hint(): void {
    if (this.busy || this.gameOver) return;
    // a safe pop: any candidate that is NOT the answer can be removed
    for (let y = 0; y < this.size; y++) {
      for (let x = 0; x < this.size; x++) {
        const cell = this.board.cells[y][x];
        if (cell.value !== null) continue;
        const safe = cell.candidates.find((v) => !this.board.isAnswer(y, x, v));
        if (safe === undefined) continue;
        const chip = this.chips[y][x].get(safe);
        if (!chip) continue;
        this.fx.ring(chip.cx, chip.cy, 0xffd678, 34, 560, 4);
        this.tweens.killTweensOf([chip.img, chip.txt, chip.outline]);
        chip.outline.setAlpha(0.95);
        this.tweens.add({ targets: [chip.img, chip.outline], scaleX: chip.base * 1.16, scaleY: chip.base * 1.16, duration: 200, yoyo: true, repeat: 2 });
        this.tweens.add({ targets: chip.txt, scaleX: 1.16, scaleY: 1.16, duration: 200, yoyo: true, repeat: 2 });
        // one-shot hop (pygame trigger_hop) so the indirectly-lit cell jumps
        this.tweens.add({ targets: [chip.img, chip.txt, chip.outline], y: chip.cy - 12, duration: 220, yoyo: true, ease: 'Quad.easeOut' });
        this.tweens.add({ targets: chip.outline, alpha: 0, delay: 760, duration: 320 });
        return;
      }
    }
  }

  // --------------------------- clues ---------------------------

  private buildClues(): void {
    this.add
      .text(CLUE_X + PANEL / 2, 24, 'C L U E S', { fontFamily: FONT, fontStyle: 'bold', fontSize: '20px', color: palette.text })
      .setOrigin(0.5);

    const rules = [...this.model.displayableRules].sort((a, b) => {
      const ka = typeof a[1] === 'string' ? 1 : 0;
      const kb = typeof b[1] === 'string' ? 1 : 0;
      return kb - ka; // operator clues first, like the pygame layout
    });

    const ruleW = RULE_CELL * 3;
    const colGap = 16;
    const padX = Math.floor((PANEL - 2 * ruleW - colGap) / 2);
    const rowH = RULE_CELL + 9;

    rules.forEach((rule, i) => {
      const ty = i % 14;
      const tx = Math.floor(i / 14);
      const gx = CLUE_X + padX + tx * (ruleW + colGap);
      const gy = RULES_TOP + ty * rowH;
      this.makeClueGroup(rule, gx, gy);
    });
  }

  private makeClueGroup(rule: Rule, gx: number, gy: number): void {
    const objs: Phaser.GameObjects.GameObject[] = [];
    const minis: ClueMini[] = [];
    const miniScale = (RULE_CELL - 3) / 64;
    for (let j = 0; j < 3; j++) {
      const v = rule[j];
      const sx = gx + j * RULE_CELL + RULE_CELL / 2;
      const sy = gy + RULE_CELL / 2;
      if (typeof v === 'number') {
        const img = this.add.image(sx, sy, MINI).setDisplaySize(RULE_CELL - 3, RULE_CELL - 3).setTint(rowColor(v));
        const t = this.add
          .text(sx, sy, symbolFor(v), { fontFamily: FONT, fontStyle: 'bold', fontSize: '19px', color: '#ffffff' })
          .setOrigin(0.5);
        objs.push(img, t);
        minis.push({ img, txt: t, value: v, scale: miniScale });
      } else {
        const t = this.add
          .text(sx, sy, OP_SYMBOL[v] ?? String(v), { fontFamily: FONT, fontStyle: 'bold', fontSize: '22px', color: palette.accent })
          .setOrigin(0.5);
        objs.push(t);
      }
    }

    const group: ClueGroup = { objs, minis, rule, gx, gy, dim: false };
    this.clueGroups.push(group);

    const hit = this.add
      .rectangle(gx, gy, RULE_CELL * 3, RULE_CELL, 0xffffff, 0)
      .setOrigin(0, 0)
      .setInteractive({ useHandCursor: true });
    hit.on('pointerover', () => {
      this.showTooltip(group);
      if (this.gameOver || group.dim) return;
      this.hoverStart(group, group.minis.map((m) => m.value), { glowNow: group.minis.map((m) => this.clueGlow(m)) });
    });
    hit.on('pointerout', () => {
      this.hideTooltip();
      if (this.hoverSource === group) this.hoverEnd();
    });
    hit.on('pointerdown', () => {
      group.dim = !group.dim;
      group.objs.forEach((o) => (o as Phaser.GameObjects.Image).setAlpha(group.dim ? 0.32 : 1));
      if (group.dim && this.hoverSource === group) this.hoverEnd();
    });
  }

  private showTooltip(group: ClueGroup): void {
    this.hideTooltip();
    const segs = ruleSegments(group.rule);
    const tile = 26;
    const fontSize = 16;
    const pad = 12;
    const gap = 7;

    // measure
    const tmp = this.add.text(0, 0, '', { fontFamily: FONT, fontSize: `${fontSize}px` }).setVisible(false);
    type Tok = { kind: 'cell' | 'word'; val: string | number; w: number };
    const toks: Tok[] = [];
    for (const s of segs) {
      if (s.kind === 'cell') toks.push({ kind: 'cell', val: s.value, w: tile });
      else for (const word of s.value.split(' ')) { tmp.setText(word); toks.push({ kind: 'word', val: word, w: tmp.width }); }
    }
    // wrap
    const maxW = 280;
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
    const bg = this.add.image(0, 0, roundedTex(this, Math.ceil(pw), Math.ceil(ph), 12)).setOrigin(0, 0).setTint(brighten(COLORS.panel, 32)).setAlpha(0.96);
    objs.push(bg);
    lines.forEach((ln, li) => {
      let x = pad;
      const cy = pad + li * lineH + lineH / 2;
      for (const tk of ln) {
        if (tk.kind === 'cell') {
          const v = tk.val as number;
          objs.push(this.add.image(x + tile / 2, cy, MINI).setDisplaySize(tile, tile).setTint(rowColor(v)));
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

  // --------------------------- end ---------------------------

  private finish(won: boolean): void {
    if (this.gameOver) return;
    this.gameOver = true;
    this.hoverEnd();
    this.timerEvent?.remove();
    this.hideTooltip();

    this.recordResult(won);

    if (won) { this.fx.celebrate(); audio.play('win'); }
    else { this.fx.defeat(); audio.play('lose'); }

    this.time.delayedCall(won ? 260 : 220, () => this.showEndPanel(won));
  }

  /** Persist the outcome + earn achievements, exactly like presenter.py's
   *  _finish_round: a Retry never counts (no record, no streak, no badges). */
  private recordResult(won: boolean): void {
    if (this.isRetry) return; // a replay of the same board doesn't count
    if (this.zen) {
      // Zen never records a win/loss/streak/progression — only the calm-solve
      // badge. (Loss can't happen in Zen anyway.)
      if (won) {
        const fresh = stats.unlock(evaluate({ won: true, zen: true }));
        this.freshBadges = fresh.map((id) => achievementInfo(id).name);
      }
      return;
    }
    if (won) {
      const prevBest = stats.recordWin(this.difficulty, this.size, this.seconds, true);
      this.newRecord = prevBest === null || this.seconds < prevBest;
      const best = stats.bestFor(this.difficulty, this.size);
      this.bestText = best ? this.fmt(best) : null;
      const fresh = stats.unlock(
        evaluate({
          won: true,
          totalWins: stats.totalWins,
          mistakes: this.mistakes,
          seconds: this.seconds,
          par: parTime(this.size, this.difficulty),
          size: this.size,
          difficulty: this.difficulty,
          winStreak: stats.winStreak,
          zen: false,
        }),
      );
      this.freshBadges = fresh.map((id) => achievementInfo(id).name);
    } else {
      stats.recordLoss(this.difficulty, this.size);
    }
  }

  private showEndPanel(won: boolean): void {
    const hasBadges = won && this.freshBadges.length > 0;
    const bestLine = won
      ? this.zen
        ? 'Zen — not recorded'
        : this.isRetry
          ? 'Retry — not recorded'
          : this.bestText
            ? `best ${this.bestText}`
            : ''
      : '';

    // Measure top-down, then centre the panel around the content so nothing
    // collides with the buttons regardless of how many badges were earned.
    const PAD = 34;
    let h = PAD;
    if (won && this.newRecord) h += 30;
    h += 52; // title
    h += 32; // subtitle
    if (bestLine) h += 24;
    if (hasBadges) h += 18 + 6 + this.freshBadges.length * 26;
    h += 26; // gap before buttons
    const btnBlock = 52 + 14 + 48;
    h += btnBlock + PAD;

    const pw = 480;
    const ph = h;
    const cx = GAME.width / 2;
    const cyPanel = GAME.height / 2;
    const top = cyPanel - ph / 2;

    this.add.rectangle(cx, cyPanel, GAME.width, GAME.height, 0x000000, 0.62).setDepth(100);
    this.add.image(cx, cyPanel, roundedTex(this, pw, ph, 18)).setTint(COLORS.panel).setDepth(101);

    let y = top + PAD;

    if (won && this.newRecord) {
      const banner = this.add
        .text(cx, y + 15, '★  NEW RECORD!  ★', { fontFamily: FONT, fontStyle: 'bold', fontSize: '22px', color: '#ffd678' })
        .setOrigin(0.5).setDepth(102);
      this.tweens.add({ targets: banner, scale: 1.08, duration: 520, yoyo: true, repeat: -1, ease: 'Sine.easeInOut' });
      y += 30;
    }

    this.add
      .text(cx, y + 26, won ? 'SOLVED!' : 'OUT OF LIVES', {
        fontFamily: FONT, fontStyle: 'bold', fontSize: '42px', color: won ? '#ffe27a' : '#e05a68',
      })
      .setOrigin(0.5).setDepth(102);
    y += 52;

    this.add
      .text(cx, y + 16, won ? `Time ${this.fmt(this.seconds)}   ·   ${this.mistakes} mistakes` : 'Better luck on the next board', {
        fontFamily: FONT, fontSize: '20px', color: palette.accent,
      })
      .setOrigin(0.5).setDepth(102);
    y += 32;

    if (bestLine) {
      this.add
        .text(cx, y + 12, bestLine, { fontFamily: FONT, fontSize: '16px', color: palette.accent })
        .setOrigin(0.5).setDepth(102);
      y += 24;
    }

    if (hasBadges) {
      this.add
        .text(cx, y + 8, 'NEW BADGE', { fontFamily: FONT, fontStyle: 'bold', fontSize: '14px', color: '#ffd678' })
        .setOrigin(0.5).setDepth(102);
      y += 18 + 6;
      for (const name of this.freshBadges) {
        this.add
          .text(cx, y + 13, `★  ${name}`, { fontFamily: FONT, fontSize: '18px', color: palette.text })
          .setOrigin(0.5).setDepth(102);
        y += 26;
      }
    }

    const btnY = y + 26 + 26;
    const b1 = makeButton(this, cx - 120, btnY, 224, 52, 'New board', () => this.scene.restart({ size: this.size, difficulty: this.difficulty, zen: this.zen }), { fontSize: 20, fill: COLORS.rows['4'], textColor: '#ffffff' });
    const b2 = makeButton(this, cx + 120, btnY, 224, 52, 'Retry this board', () => this.scene.restart({ size: this.size, difficulty: this.difficulty, seed: this.seed, retry: true, zen: this.zen }), { fontSize: 20 });
    const b3 = makeButton(this, cx, btnY + 52 / 2 + 14 + 48 / 2, 224, 48, 'Menu', () => this.scene.start('menu', this.menuData()), { fontSize: 18 });
    [b1, b2, b3].forEach((b) => b.root.setDepth(102));
  }

  private menuData(): { size: number; difficulty: number } {
    return { size: this.size, difficulty: this.difficulty };
  }
}
