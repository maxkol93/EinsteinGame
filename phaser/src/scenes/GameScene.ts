import Phaser from 'phaser';
import { COLORS, GAME, FONT, palette, rowColor, brighten, applyRenderScale } from '../config';
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
const HOLD_MS = 350; // long-press duration to "define" a cell
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
interface ClueMini { img: Phaser.GameObjects.Image; txt: Phaser.GameObjects.Text; outline: Phaser.GameObjects.Image; value: number; scale: number; }
interface PressInfo { y: number; x: number; n: number; fired: boolean; }
interface ClueGroup { objs: Phaser.GameObjects.GameObject[]; minis: ClueMini[]; rule: Rule; gx: number; gy: number; dim: boolean; }

// A uniform "highlightable" used by the cross-hover system (board chips, big
// cells and clue minis all reduce to this). tintBase/tintHi are the rest/hover
// tints: white-textured chips tint to their row colour, but a big cell's colour
// is BAKED into its texture, so it must stay 0xffffff (tinting it by the colour
// multiplies → it darkens, the bug where cells changed colour after hover).
interface Glowable {
  img: Phaser.GameObjects.Image;
  txt?: Phaser.GameObjects.Text;
  outline?: Phaser.GameObjects.Image;
  tintBase: number;
  tintHi: number;
  scale: number;
  homeY: number;
  canHop: boolean; // clue minis only glow — they must not hop on the board
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
  private hintActive: { restore: () => void } | null = null;
  private holdRing?: Phaser.GameObjects.Graphics;
  private holdTween?: Phaser.Tweens.Tween;

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
    this.hintActive = null;
    this.hearts = [];
    this.clueGroups = [];
    this.tooltip = undefined;
    this.hoverSource = null;
    this.directLiftChip = null;
    this.directGlow = [];
    this.litSpread = [];
  }

  create(): void {
    applyRenderScale(this);
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

    this.playEntrance();

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

  /** Cascade entrance: cells are born diagonally (pygame _cell_t_birth =
   *  (y+x)*step), fading + scaling in with a little overshoot. Input is held
   *  until the wave finishes. */
  private playEntrance(): void {
    const STEP = 45;
    let maxDelay = 0;
    this.busy = true;
    for (let y = 0; y < this.size; y++) {
      for (let x = 0; x < this.size; x++) {
        const delay = (y + x) * STEP;
        maxDelay = Math.max(maxDelay, delay);
        const big = this.bigObjs[y][x];
        const pairs: Array<{ o: Phaser.GameObjects.Image | Phaser.GameObjects.Text; home: number }> = [];
        if (big) {
          pairs.push({ o: big.img, home: big.base }, { o: big.txt, home: 1 });
        } else {
          for (const c of this.chips[y][x].values()) pairs.push({ o: c.img, home: c.base }, { o: c.txt, home: 1 });
        }
        for (const { o, home } of pairs) {
          o.setScale(home * 0.5).setAlpha(0);
          this.tweens.add({
            targets: o, scaleX: home, scaleY: home, alpha: 1,
            delay, duration: 260, ease: 'Back.easeOut',
          });
        }
      }
    }
    this.time.delayedCall(maxDelay + 280, () => { this.busy = false; });
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
    const col = rowColor(c.value);
    return { img: c.img, txt: c.txt, outline: c.outline, tintBase: col, tintHi: brighten(col, 56), scale: c.base, homeY: c.cy, canHop: true };
  }

  private bigGlow(b: BigCell): Glowable {
    // colour is baked into the big-cell texture — keep the tint neutral (white)
    // both at rest and on hover; the glow reads via the outline + scale instead.
    return { img: b.img, txt: b.txt, outline: b.outline, tintBase: 0xffffff, tintHi: 0xffffff, scale: b.base, homeY: b.cy, canHop: true };
  }

  private clueGlow(m: ClueMini): Glowable {
    const col = rowColor(m.value);
    return { img: m.img, txt: m.txt, outline: m.outline, tintBase: col, tintHi: brighten(col, 56), scale: m.scale, homeY: m.img.y, canHop: false };
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
    // belt-and-braces: make sure the shared lift drop-shadow is never left up
    if (this.liftShadow && this.liftShadow.alpha > 0) {
      this.tweens.killTweensOf(this.liftShadow);
      this.tweens.add({ targets: this.liftShadow, alpha: 0, duration: 120 });
    }
  }

  /** Tear a candidate chip down reliably: kill any in-flight (hover) tweens and
   *  detach input first, then a squash-and-pop, with a guaranteed destroy even
   *  if the tween is interrupted — so a popped chip never lingers on screen. */
  private destroyChip(chip: Chip, delay: number): void {
    // if the chip being torn down is the one currently lifted under the cursor,
    // end the hover first so its lift/outline/drop-shadow don't hang in the air
    if (this.directLiftChip === chip) this.hoverEnd();
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
    // a cell resolving under the cursor must not leave a hover lift hanging
    if (this.directLiftChip && map.has(this.directLiftChip.value) && this.chips[y][x].get(this.directLiftChip.value) === this.directLiftChip) {
      this.hoverEnd();
    }
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
      this.tweens.add({ targets: [img, outline], scaleX: base, scaleY: base, duration: 440, ease: 'Back.easeOut' });
      this.tweens.add({ targets: txt, scaleX: 1, scaleY: 1, duration: 440, ease: 'Back.easeOut' });
      this.fx.bigBurst(cx, cy, this.cellSide, this.cellSide, color);
    }
  }

  // --------------------------- input ---------------------------

  private bindInput(): void {
    this.input.on('pointerup', () => {
      this.clearHoldProgress();
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
    const chip = this.chips[y][x].get(n);
    if (chip) this.startHoldProgress(chip);
    this.longPress = this.time.delayedCall(HOLD_MS, () => {
      this.clearHoldProgress();
      if (this.press && !this.press.fired) {
        this.press.fired = true;
        this.doAction(y, x, n, true);
      }
    });
  }

  /** A radial fill ring shown while a candidate is held — once it completes the
   *  long-press "define" fires (pygame's hold-to-define progress ring). */
  private startHoldProgress(chip: Chip): void {
    this.clearHoldProgress();
    const g = this.add.graphics().setDepth(25);
    const r = Math.max(12, chip.sub * 0.6);
    this.holdRing = g;
    this.holdTween = this.tweens.addCounter({
      from: 0, to: 1, duration: HOLD_MS, ease: 'Linear',
      onUpdate: (tw) => {
        const t = tw.getValue() ?? 0;
        g.clear();
        g.lineStyle(4, 0x000000, 0.35);
        g.strokeCircle(chip.cx, chip.cy, r);
        g.lineStyle(4, 0xffe27a, 0.95);
        g.beginPath();
        g.arc(chip.cx, chip.cy, r, -Math.PI / 2, -Math.PI / 2 + t * Math.PI * 2, false);
        g.strokePath();
      },
    });
  }

  private clearHoldProgress(): void {
    this.holdTween?.stop();
    this.holdTween = undefined;
    this.holdRing?.destroy();
    this.holdRing = undefined;
  }

  private doAction(y: number, x: number, n: number, isDefine: boolean): void {
    if (this.busy || this.gameOver) return;
    const cell = this.board.cells[y][x];
    if (cell.value !== null || !cell.candidates.includes(n)) return;
    this.clearHint(); // any move dismisses the hint highlight
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

    if (cs.resolved.length >= 2) {
      const f = cs.resolved[0];
      const { cx, cy } = this.cellCenter(f.y, f.x);
      this.time.delayedCall(120, () => this.fx.comboText(cx, cy - 8, `+${cs.resolved.length} chain!`));
    }

    // any clue whose values are now all solved auto-dims (matches the board
    // state immediately; the big cells animate in over the cascade)
    this.autoDimClues();

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

  // --------------------------- hint ---------------------------
  // Port of window.py find_hint_target / _rule_eliminates / show_hint: ring a
  // candidate that an *unsatisfied clue* logically forbids (and light that clue
  // so the player sees WHY), falling back to a solution-derived safe pop. The
  // highlight persists until the player's next move (clearHint).

  private valueAtCell(y: number, x: number, n: number): boolean {
    const cell = this.board.cells[y]?.[x];
    if (!cell) return false;
    return cell.value !== null ? cell.value === n : cell.candidates.includes(n);
  }

  private candidateButton(y: number, x: number, n: number): Chip | null {
    const cell = this.board.cells[y]?.[x];
    if (!cell || cell.value !== null || !cell.candidates.includes(n)) return null;
    return this.chips[y][x].get(n) ?? null;
  }

  private valueColumns(n: number): number[] {
    const y = Math.floor(n / 10) - 1;
    if (y < 0 || y >= this.size) return [];
    const cols: number[] = [];
    for (let x = 0; x < this.size; x++) if (this.valueAtCell(y, x, n)) cols.push(x);
    return cols;
  }

  private ruleSatisfied(values: Rule): boolean {
    return values.every((v) => typeof v !== 'number' || this.valueSolved(v));
  }

  /** A still-active candidate the clue forbids, with the clue as the reason. */
  private ruleEliminates(group: ClueGroup): { chip: Chip; group: ClueGroup } | null {
    const [a, b, c] = group.rule;
    if (b === '^' && typeof a === 'number' && typeof c === 'number') {
      const ya = Math.floor(a / 10) - 1;
      const yc = Math.floor(c / 10) - 1;
      for (let x = 0; x < this.size; x++) {
        if (!this.valueAtCell(ya, x, a)) { const btn = this.candidateButton(yc, x, c); if (btn) return { chip: btn, group }; }
        if (!this.valueAtCell(yc, x, c)) { const btn = this.candidateButton(ya, x, a); if (btn) return { chip: btn, group }; }
      }
      return null;
    }
    if (b === '<->' && typeof a === 'number' && typeof c === 'number') {
      const ya = Math.floor(a / 10) - 1;
      const yc = Math.floor(c / 10) - 1;
      for (let x = 0; x < this.size; x++) {
        if (this.valueAtCell(ya, x, a)) {
          const has = (x > 0 && this.valueAtCell(yc, x - 1, c)) || (x < this.size - 1 && this.valueAtCell(yc, x + 1, c));
          if (!has) { const btn = this.candidateButton(ya, x, a); if (btn) return { chip: btn, group }; }
        }
        if (this.valueAtCell(yc, x, c)) {
          const has = (x > 0 && this.valueAtCell(ya, x - 1, a)) || (x < this.size - 1 && this.valueAtCell(ya, x + 1, a));
          if (!has) { const btn = this.candidateButton(yc, x, c); if (btn) return { chip: btn, group }; }
        }
      }
      return null;
    }
    if (b === '...' && typeof a === 'number' && typeof c === 'number') {
      const aCols = this.valueColumns(a);
      const cCols = this.valueColumns(c);
      if (!aCols.length || !cCols.length) return null;
      const maxC = Math.max(...cCols);
      const minC = Math.min(...cCols);
      for (const x of aCols) if (x >= maxC) { const btn = this.candidateButton(Math.floor(a / 10) - 1, x, a); if (btn) return { chip: btn, group }; }
      for (const x of cCols) if (x <= minC && x <= Math.min(...aCols)) { const btn = this.candidateButton(Math.floor(c / 10) - 1, x, c); if (btn) return { chip: btn, group }; }
      return null;
    }
    // triple — lean on the known answer: ring an active candidate the solution
    // rules out, with the triple clue as the reason.
    if (typeof a === 'number' && typeof b === 'number' && typeof c === 'number') {
      for (const v of [a, b, c]) {
        const y = Math.floor(v / 10) - 1;
        for (let x = 0; x < this.size; x++) {
          const btn = this.candidateButton(y, x, v);
          if (btn && this.board.solution[y][x] !== v) return { chip: btn, group };
        }
      }
    }
    return null;
  }

  private findHintTarget(): { chip: Chip; group: ClueGroup | null } | null {
    for (const group of this.clueGroups) {
      if (group.dim) continue;
      if (this.ruleSatisfied(group.rule)) continue;
      const res = this.ruleEliminates(group);
      if (res) return res;
    }
    // fallback: a guaranteed-safe candidate from the answer grid
    for (let y = 0; y < this.size; y++) {
      for (let x = 0; x < this.size; x++) {
        const cell = this.board.cells[y][x];
        if (cell.value !== null || cell.candidates.length <= 1) continue;
        const correct = this.board.solution[y][x];
        const n = cell.candidates.find((v) => v !== correct);
        if (n === undefined) continue;
        const chip = this.chips[y][x].get(n);
        if (chip) return { chip, group: null };
      }
    }
    return null;
  }

  private clearHint(): void {
    if (!this.hintActive) return;
    this.hintActive.restore();
    this.hintActive = null;
  }

  private hint(): void {
    if (this.busy || this.gameOver) return;
    this.clearHint();
    const target = this.findHintTarget();
    if (!target) return;
    const { chip, group } = target;

    audio.play('spread');
    this.fx.ring(chip.cx, chip.cy, 0xffd678, 36, 560, 4);
    this.tweens.killTweensOf([chip.img, chip.txt, chip.outline]);
    chip.outline.setTint(0xffd678).setAlpha(0.95);
    const pulse = this.tweens.add({
      targets: [chip.img, chip.outline], scaleX: chip.base * 1.14, scaleY: chip.base * 1.14,
      duration: 460, yoyo: true, repeat: -1, ease: 'Sine.easeInOut',
    });
    const pulseTxt = this.tweens.add({
      targets: chip.txt, scaleX: 1.14, scaleY: 1.14,
      duration: 460, yoyo: true, repeat: -1, ease: 'Sine.easeInOut',
    });

    const clueGlows: Glowable[] = group ? group.minis.map((m) => this.clueGlow(m)) : [];
    for (const g of clueGlows) this.glow(g, true, false);

    this.hintActive = {
      restore: () => {
        pulse.stop();
        pulseTxt.stop();
        this.tweens.killTweensOf([chip.img, chip.txt, chip.outline]);
        if (chip.img.active) {
          chip.img.setScale(chip.base).setTint(rowColor(chip.value));
          chip.txt.setScale(1);
          chip.outline.setScale(chip.base).setTint(0xffffff).setAlpha(0);
        }
        for (const g of clueGlows) this.glow(g, false, false);
      },
    };
  }

  // --------------------------- clues ---------------------------

  private buildClues(): void {
    this.add
      .text(CLUE_X + PANEL / 2, 24, 'C L U E S', { fontFamily: FONT, fontStyle: 'bold', fontSize: '20px', color: palette.text })
      .setOrigin(0.5);

    // Group clues by type so the panel reads in a consistent order:
    // same-column (^), neighbours (<->), left-of (...), then three-in-a-row.
    const rank = (r: Rule): number => {
      const op = r[1];
      if (op === '^') return 0;
      if (op === '<->') return 1;
      if (op === '...') return 2;
      return 3; // triple (all-number)
    };
    const rules = [...this.model.displayableRules].sort((a, b) => rank(a) - rank(b));

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
        const outline = this.add
          .image(sx, sy, strokedRoundedTex(this, 64, 64, 12, 5))
          .setScale(miniScale).setTint(0xffffff).setAlpha(0);
        const t = this.add
          .text(sx, sy, symbolFor(v), { fontFamily: FONT, fontStyle: 'bold', fontSize: '19px', color: '#ffffff' })
          .setOrigin(0.5);
        // outline is NOT in objs — the dim pass must not leave it visible at
        // 0.32; it's controlled only via glow/dimGroup.
        objs.push(img, t);
        minis.push({ img, txt: t, outline, value: v, scale: miniScale });
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
      if (group.dim) this.undimGroup(group);
      else this.dimGroup(group);
    });
  }

  /** True once value `n` sits in a solved big cell (board state, not the
   *  delayed visuals). Mirrors window.py `_value_solved`. */
  private valueSolved(n: number): boolean {
    for (let y = 0; y < this.size; y++) {
      for (let x = 0; x < this.size; x++) {
        if (this.board.cells[y][x].value === n) return true;
      }
    }
    return false;
  }

  /** Press (dim) any clue whose every referenced value is now solved — the
   *  constraint is concrete and can't teach anything more. Port of
   *  window.py auto_dim_satisfied_rules; called after every board change. */
  private autoDimClues(): void {
    for (const group of this.clueGroups) {
      if (group.dim) continue;
      const satisfied = group.rule.every((v) => typeof v !== 'number' || this.valueSolved(v));
      if (satisfied) this.dimGroup(group);
    }
  }

  /** Press (dim) a clue: fade its tiles AND clear any glow outline/scale left
   *  on its minis (the dim must not leave a hanging highlight). */
  private dimGroup(group: ClueGroup): void {
    group.dim = true;
    group.objs.forEach((o) => (o as Phaser.GameObjects.Image).setAlpha(0.32));
    for (const m of group.minis) {
      this.tweens.killTweensOf([m.img, m.outline, m.txt]);
      m.outline.setAlpha(0);
      m.img.setScale(m.scale).setTint(rowColor(m.value));
      m.txt.setScale(1);
    }
    if (this.hoverSource === group) this.hoverEnd();
  }

  private undimGroup(group: ClueGroup): void {
    group.dim = false;
    group.objs.forEach((o) => (o as Phaser.GameObjects.Image).setAlpha(1));
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
    // semi-transparent so the board stays readable behind the tooltip
    const bg = this.add.image(0, 0, roundedTex(this, Math.ceil(pw), Math.ceil(ph), 12)).setOrigin(0, 0).setTint(brighten(COLORS.panel, 24)).setAlpha(0.6);
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
