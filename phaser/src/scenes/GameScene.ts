import Phaser from 'phaser';
import { COLORS, GAME, FONT, palette, rowColor, brighten, applyRenderScale } from '../config';
import { generatePuzzle, FieldAndRules, COMPLEXITY } from '../model/fieldAndRules';
import { PuzzleBoard, ChangeSet } from '../model/board';
import { symbolFor, glyphOriginY, ruleSegments } from '../model/decoder';
import { Rule } from '../model/types';
import { makeButton, BtnHandle } from '../ui/button';
import { roundedTex, strokedRoundedTex, bigCellTex, shadowTex, shadowStripTex, vignetteTex, hatchTex } from '../ui/textures';
import { Fx } from '../fx/fx';
import { audio } from '../audio/sound';
import { stats, parTime } from '../model/stats';
import { evaluate, achievementInfo } from '../model/achievements';
import { SeededKind } from '../model/daily';
import { settings } from '../model/settings';
import { PORTRAIT } from '../config';

// Layout: landscape mirrors the pygame side-panel build; portrait mirrors the
// mobile build (a top info strip, a width-maximised board, clues below it).
const GAP = 3;
const TOP_H = 176; // portrait top-strip height
const SPAN = PORTRAIT ? GAME.width - 12 : 615; // board fills almost full width
const MARGIN = PORTRAIT ? 6 : 60;
const PANEL = PORTRAIT ? GAME.width : 280; // landscape side-panel width
const BX = PORTRAIT ? 6 : PANEL + MARGIN; // board origin x
const BY = PORTRAIT ? TOP_H : MARGIN; // board origin y
const CLUE_X = PORTRAIT ? 0 : BX + SPAN + MARGIN; // clues area x (full width in portrait)
const CLUES_TOP_Y = BY + SPAN + 16; // portrait: clues start below the board
const RULE_CELL = PORTRAIT ? 54 : 38; // bigger clue tiles on mobile
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
interface ClueGroup { objs: Phaser.GameObjects.GameObject[]; minis: ClueMini[]; rule: Rule; gx: number; gy: number; dim: boolean; cellSize: number; hit: Phaser.GameObjects.Rectangle; }
interface HintTarget { chip: Chip; group: ClueGroup | null; reason: string; }

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
  private seededKind?: SeededKind;
  private seededPeriod?: number;
  private seededNumber?: number;

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
  private idleHintMs: number | null = null;
  private idleTimer?: Phaser.Time.TimerEvent;
  private hintBtn?: BtnHandle;
  private armed: { y: number; x: number; n: number } | null = null;
  private armedCleanup?: () => void;
  // touch tap-to-select on a clue: the highlighted (but not yet dimmed) clue
  private armedClue: ClueGroup | null = null;
  private zoomOverlay?: Phaser.GameObjects.Container;
  private zoomBackdrop?: Phaser.GameObjects.Rectangle;
  private remainingText?: Phaser.GameObjects.Text;
  private touchInterceptor = false;
  private menuBtn?: BtnHandle;
  private cellHits: Phaser.GameObjects.Rectangle[][] = [];
  private focusedClue: ClueGroup | null = null;
  private focusHoverGroup: ClueGroup | null = null; // dimmed clue under the cursor in focus
  // Focus-mode cell decorations (hatch + relationship arrows). `follow` ones are
  // pinned to a tile each frame (so they hop/lift/scale with it); `static` ones
  // sit in a candidate cell's empty margins and don't move.
  private focusDecor: Array<{ obj: Phaser.GameObjects.Image | Phaser.GameObjects.Text; img: Phaser.GameObjects.Image; homeScale: number; offX: number; offY: number; hatch: boolean; baseScale: number }> = [];
  private focusStatic: Phaser.GameObjects.GameObject[] = [];
  private focusOverlay?: Phaser.GameObjects.Rectangle;
  private focusVignette?: Phaser.GameObjects.Image;
  private clueTypeIndicator?: Phaser.GameObjects.Container;

  constructor() {
    super('game');
  }

  init(data: { size?: number; difficulty?: number; seed?: number; retry?: boolean; zen?: boolean; seededKind?: SeededKind; seededPeriod?: number; seededNumber?: number }): void {
    this.size = data?.size ?? 4;
    this.difficulty = data?.difficulty ?? 0;
    this.seed = data?.seed ?? 0;
    this.isRetry = !!data?.retry;
    this.zen = !!data?.zen;
    this.seededKind = data?.seededKind;
    this.seededPeriod = data?.seededPeriod;
    this.seededNumber = data?.seededNumber;
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
    this.zoomOverlay = undefined;
    this.touchInterceptor = false;
    this.focusedClue = null;
    this.focusHoverGroup = null;
    this.focusDecor = [];
    this.focusStatic = [];
    this.focusOverlay = undefined;
    this.focusVignette = undefined;
    this.clueTypeIndicator = undefined;
    this.cellHits = [];
  }

  create(): void {
    applyRenderScale(this);
    this.input.mouse?.disableContextMenu();
    this.cameras.main.setBackgroundColor(COLORS.bg);
    this.fx = new Fx(this);
    this.fx.setReduced(settings.reduceMotion);

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

    this.liftShadow = this.add.image(0, 0, SHADOW).setTint(0x000000).setAlpha(0).setDepth(19);

    this.buildBackground();
    this.buildPanel();
    this.buildBoard();
    this.buildClues();
    this.bindInput();
    this.startTimer();

    // The HINT button is OFFERED after idle (not auto-fired): 20s Easy, 40s
    // Normal, never on Hard. Always available in Zen. Pressing it shows a hint.
    this.idleHintMs = this.zen ? null : [20000, 40000, null][this.difficulty];
    this.hintBtn?.root.setVisible(this.zen);
    this.resetIdle();

    audio.playMusic('game');
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
    const g = this.add.graphics().setDepth(-10);
    g.fillStyle(panelColor, 1);

    if (PORTRAIT) {
      // top info strip + the clues area below the board
      const stripH = BY - 12;
      g.fillRect(0, 0, GAME.width, stripH);
      g.fillRect(0, CLUES_TOP_Y - 14, GAME.width, GAME.height - (CLUES_TOP_Y - 14));
      g.lineStyle(1, divider, 1);
      g.lineBetween(0, stripH, GAME.width, stripH);
      g.lineBetween(0, CLUES_TOP_Y - 14, GAME.width, CLUES_TOP_Y - 14);
      return;
    }

    const leftEdge = BX - 22; // left panel's right edge
    const rightEdge = BX + SPAN + 22; // right panel's left edge
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
    const cplx = COMPLEXITY[this.size][this.difficulty];
    const modeLabel = this.seededKind
      ? `${this.seededKind.toUpperCase()}  ·  ${this.size}×${this.size}`
      : this.zen
        ? `ZEN  ·  ${this.size}×${this.size}`
        : `${DIFF[this.difficulty]}  ·  ${this.size}×${this.size}`;

    if (PORTRAIT) {
      // a horizontal top strip: MENU | TIME | HINT, then lives/zen + mode below
      this.menuBtn = makeButton(this, 96, 36, 156, 46, '☰  MENU', () => this.toMenu(), { fontSize: 18 });
      this.hintBtn = makeButton(this, GAME.width - 96, 36, 156, 46, 'HINT', () => this.hint(), { fontSize: 18, fill: brighten(COLORS.panel, 44) });
      this.timerText = this.add.text(GAME.width / 2, 36, '00:00', { fontFamily: FONT, fontStyle: 'bold', fontSize: '40px', color: palette.text }).setOrigin(0.5);
      if (this.zen) {
        this.add.text(GAME.width / 2 - 150, 118, '∞', { fontFamily: FONT, fontStyle: 'bold', fontSize: '34px', color: '#86b89a' }).setOrigin(0.5);
      } else {
        for (let i = 0; i < MAX_LIVES; i++) {
          const { cx, cy } = this.heartPos(i);
          this.hearts.push(this.add.text(cx, cy, '♥', { fontFamily: FONT, fontSize: '30px', color: '#e05a68' }).setOrigin(0.5));
        }
        this.updateLives();
      }
      this.add.text(GAME.width / 2 + 70, 110, modeLabel, { fontFamily: FONT, fontStyle: 'bold', fontSize: '18px', color: palette.text }).setOrigin(0.5);
      this.remainingText = this.add.text(GAME.width / 2 + 70, 132, '', { fontFamily: FONT, fontSize: '12px', color: palette.accent }).setOrigin(0.5);
      this.updateRemaining();
      return;
    }

    this.menuBtn = makeButton(this, PANEL / 2, 42, PANEL - 60, 48, '☰  MENU', () => this.toMenu(), { fontSize: 19 });
    // Mode label sits just below the MENU button
    this.add.text(PANEL / 2, 80, modeLabel, { fontFamily: FONT, fontSize: '12px', color: palette.accent }).setOrigin(0.5);

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

    this.add.text(PANEL / 2, 258, 'C E L L S  L E F T', { fontFamily: FONT, fontSize: '11px', color: palette.accent }).setOrigin(0.5);
    this.remainingText = this.add.text(PANEL / 2, 290, '', { fontFamily: FONT, fontStyle: 'bold', fontSize: '30px', color: palette.text }).setOrigin(0.5);
    this.updateRemaining();

    this.hintBtn = makeButton(this, PANEL / 2, GAME.height - 60, PANEL - 60, 46, 'HINT', () => this.hint(), { fontSize: 18, fill: brighten(COLORS.panel, 44) });
  }

  private heartPos(i: number): { cx: number; cy: number } {
    if (PORTRAIT) {
      const start = GAME.width / 2 - 150 - ((MAX_LIVES - 1) * 36) / 2;
      return { cx: start + i * 36, cy: 118 };
    }
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
    this.cellHits = [];
    // A faint ghost plate behind every cell so the grid reads even when a cell
    // is empty (window.py draws a rounded fill of brighten(bg, 14) per cell).
    const plateTex = roundedTex(this, this.cellSide, this.cellSide, Math.max(8, Math.round(this.cellSide * 0.11)));
    const plateColor = brighten(COLORS.bg, 14);
    for (let y = 0; y < this.size; y++) {
      this.chips.push([]);
      this.bigObjs.push([]);
      this.cellHits.push([]);
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
        // Portrait: a transparent rectangle covering the whole cell opens zoom
        // when tapped (collider on the full cell area, not just individual chips).
        if (PORTRAIT) {
          const { ox: cOx, oy: cOy } = this.cellOrigin(y, x);
          const capturedY = y; const capturedX = x;
          const cellHit = this.add.rectangle(
            cOx + this.cellSide / 2, cOy + this.cellSide / 2,
            this.cellSide, this.cellSide, 0, 0,
          ).setDepth(8).setInteractive({ useHandCursor: true });
          cellHit.on('pointerdown', () => {
            if (this.busy || this.gameOver || this.zoomOverlay) return;
            const c = this.board.cells[capturedY][capturedX];
            // mark that a board element handled this tap (so the global
            // empty-tap handler doesn't exit focus / clear highlights)
            this.touchInterceptor = true;
            if (c.value !== null) { this.highlightSolved(capturedY, capturedX, c.value); return; }
            if (c.candidates.length === 0) return;
            this.openZoom(capturedY, capturedX);
          });
          this.cellHits[y].push(cellHit);
        } else {
          this.cellHits[y].push(null!);
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
      .setOrigin(0.5, glyphOriginY(value)).setDepth(7);

    const chip: Chip = { img, txt, outline, value, cx, cy, sub, base };

    // Portrait: the whole-cell hit rectangle handles taps; chips are visual only.
    if (!PORTRAIT) {
      img.setInteractive({ useHandCursor: true });
      img.on('pointerover', () => {
        if (this.busy || this.gameOver) return;
        this.hoverStart(chip, [value], { liftChip: chip });
      });
      img.on('pointerout', () => { if (this.hoverSource === chip) this.hoverEnd(); });
      img.on('pointerdown', (pointer: Phaser.Input.Pointer) => this.onChipDown(y, x, value, pointer));
    }

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
      if (this.focusedClue && group !== this.focusedClue) continue; // dimmed in focus
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
      if (hop && g.canHop) {
        // Raise depth so hopping chips always render above their neighbours.
        g.img.setDepth(15);
        if (g.outline) g.outline.setDepth(16);
        if (g.txt) g.txt.setDepth(17);
        this.tweens.add({ targets: movers, y: g.homeY - 9, duration: 170, yoyo: true, ease: 'Quad.easeOut' });
      }
    } else {
      g.img.setTint(g.tintBase);
      if (g.outline) this.tweens.add({ targets: g.outline, alpha: 0, duration: 120 });
      this.tweens.add({ targets: scalers, scaleX: g.scale, scaleY: g.scale, duration: 120 });
      this.tweens.add({
        targets: movers, y: g.homeY, duration: 120,
        onComplete: () => {
          // Restore base depth (skip directly-lifted chips at depth 20+).
          if (g.canHop && g.img.active && g.img.depth < 20) {
            g.img.setDepth(5);
            if (g.outline) g.outline.setDepth(6);
            if (g.txt) g.txt.setDepth(7);
          }
        },
      });
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
        // tile-shaped shadow, barely bigger than the chip, low-and-aside so the
        // small lift reads as "raised a little"
        this.liftShadow.setPosition(cx + 3, cy + 7).setDisplaySize(sub * 1.08, sub * 1.08).setDepth(19);
        this.tweens.add({ targets: this.liftShadow, alpha: 0.62, duration: 120 });
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

  /** Tap a solved cell (mobile): light its value up everywhere — the big cell
   *  itself and that value's tiles in every clue. Clears on the next empty tap. */
  private highlightSolved(y: number, x: number, n: number): void {
    if (this.gameOver || this.focusedClue) return;
    const big = this.bigObjs[y][x];
    if (!big) return;
    this.hoverStart(big, [n], { glowNow: [this.bigGlow(big)] });
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
      .setOrigin(0.5, glyphOriginY(n))
      .setScale(animate ? 0.3 : 1)
      .setDepth(7);

    const big: BigCell = { img, txt, outline, value: n, cx, cy, base };
    this.bigObjs[y][x] = big;
    if (!PORTRAIT) {
      img.setInteractive({ useHandCursor: true });
      img.on('pointerover', () => {
        if (this.busy || this.gameOver) return;
        this.hoverStart(big, [n], { glowNow: [this.bigGlow(big)] });
      });
      img.on('pointerout', () => { if (this.hoverSource === big) this.hoverEnd(); });
      // a solved cell is an "active" element — tapping it must not exit focus
      img.on('pointerdown', () => { this.touchInterceptor = true; });
    }

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
        if (settings.touch) this.tapSelect(y, x, n);
        else this.doAction(y, x, n, false);
      }
      this.press = null;
      this.longPress?.remove();
      this.longPress = undefined;
    });
    // Tap on empty space (anything that isn't a chip / clue / active cell):
    // exit focus mode, drop the tooltip, clear any selection/highlight. Board
    // elements set `touchInterceptor` in their own pointerdown so this is
    // skipped when an actual cell/clue was tapped.
    this.input.on('pointerdown', () => {
      if (this.touchInterceptor) { this.touchInterceptor = false; return; }
      // While the zoom is open, taps inside it (candidates / backdrop) are its
      // own — never treat them as an empty tap that would exit focus mode.
      if (this.zoomOverlay) return;
      if (this.focusedClue) { this.exitClueFocus(); return; } // item: exit focus on empty tap
      this.hideTooltip();
      this.hideClueTypeIndicator();
      this.hoverEnd(); // drop any solved-cell highlight
      if (settings.touch) { this.clearArmed(); this.clearClueHighlight(); }
    });
  }

  /** Touch tap-to-select: the first tap ARMS a candidate (a pulsing frame +
   *  "tap again"); a second tap on the SAME candidate commits the pop. Tapping
   *  a different candidate re-arms it. (Long-press still defines.) */
  private tapSelect(y: number, x: number, n: number): void {
    if (this.armed && this.armed.y === y && this.armed.x === x && this.armed.n === n) {
      this.clearArmed();
      this.doAction(y, x, n, false);
    } else {
      this.setArmed(y, x, n);
    }
  }

  private setArmed(y: number, x: number, n: number): void {
    this.clearArmed();
    this.clearClueHighlight();
    const chip = this.chips[y][x].get(n);
    if (!chip) return;
    this.armed = { y, x, n };
    const g = this.add.graphics().setDepth(24);
    const r = chip.sub * 0.72;
    const tween = this.tweens.addCounter({
      from: 0.4, to: 1, duration: 480, yoyo: true, repeat: -1, ease: 'Sine.easeInOut',
      onUpdate: (tw) => { const a = tw.getValue() ?? 1; g.clear(); g.lineStyle(3, COLORS.accent, a); g.strokeRoundedRect(chip.cx - r, chip.cy - r, r * 2, r * 2, 8); },
    });
    this.armedCleanup = () => { tween.stop(); g.destroy(); };
    this.hoverStart(chip, [chip.value], { liftChip: chip });
  }

  private clearArmed(): void {
    this.armedCleanup?.();
    this.armedCleanup = undefined;
    this.armed = null;
    this.hoverEnd();
  }

  private onChipDown(y: number, x: number, n: number, pointer: Phaser.Input.Pointer): void {
    if (this.busy || this.gameOver) return;
    if (pointer.rightButtonDown()) { this.doAction(y, x, n, true); return; }
    // a real candidate was pressed — block the global empty-tap handler
    this.touchInterceptor = true;
    // Portrait + non-touch mode: tap a multi-candidate cell to zoom it.
    if (PORTRAIT && !settings.touch && !this.zoomOverlay) {
      const cell = this.board.cells[y][x];
      if (cell.value === null && cell.candidates.length > 1) {
        this.openZoom(y, x);
        return;
      }
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
    this.clearArmed(); // any committed move clears the touch-arm
    this.clearHint(); // any move dismisses the hint highlight
    this.resetIdle(); // a move restarts the idle-hint countdown
    this.hoverEnd(); // drop any highlight before the board mutates
    if (!this.focusedClue) this.clearClueHighlight(); // keep focus through a matched-cell pop
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
      this.time.delayedCall(delay + 60, () => this.fx.smallBurst(chip.cx, chip.cy, rowColor(s.n), chip.sub));
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
        this.updateRemaining();
      });
    }
    if (cs.resolved.length > 0) {
      audio.play('solve');
    } else if (cs.struck.length > 0) {
      // a plain pop that resolved nothing still answers the tap
      audio.randomPick();
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
        this.refreshHover();
        this.refreshFocus();
        if (!this.gameOver && this.board.isWon) this.finish(true);
      });
    } else if (this.board.isWon) {
      this.finish(true);
    } else {
      this.refreshFocus();
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
      this.tweens.killTweensOf([chip.img, chip.txt, chip.outline]);
      // Normalise out of any hover-lift first — doAction's hoverEnd() started a
      // return tween that we just killed, so without this the chip would hang
      // raised + outlined in the air after a wrong tap.
      chip.img.setDepth(5).setScale(chip.base).setTint(rowColor(chip.value)).setPosition(chip.cx, chip.cy);
      chip.outline.setDepth(6).setScale(chip.base).setAlpha(0).setPosition(chip.cx, chip.cy);
      chip.txt.setDepth(7).setScale(1).setPosition(chip.cx, chip.cy);
      // an absolute-x jitter (not '+=5') so repeated wrong taps never drift
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

  /** A still-active candidate the clue forbids, with the clue as the reason —
   *  plus a plain-language `reason` string explaining WHY it can be popped. */
  private ruleEliminates(group: ClueGroup): HintTarget | null {
    const sym = (v: number): string => symbolFor(v);
    const [a, b, c] = group.rule;
    if (b === '^' && typeof a === 'number' && typeof c === 'number') {
      const ya = Math.floor(a / 10) - 1;
      const yc = Math.floor(c / 10) - 1;
      for (let x = 0; x < this.size; x++) {
        if (!this.valueAtCell(ya, x, a)) { const btn = this.candidateButton(yc, x, c); if (btn) return { chip: btn, group, reason: `${sym(c)} shares a column with ${sym(a)} (clue ↕), but ${sym(a)} is already ruled out of this column — so ${sym(c)} can't be here.` }; }
        if (!this.valueAtCell(yc, x, c)) { const btn = this.candidateButton(ya, x, a); if (btn) return { chip: btn, group, reason: `${sym(a)} shares a column with ${sym(c)} (clue ↕), but ${sym(c)} is already ruled out of this column — so ${sym(a)} can't be here.` }; }
      }
      return null;
    }
    if (b === '<->' && typeof a === 'number' && typeof c === 'number') {
      const ya = Math.floor(a / 10) - 1;
      const yc = Math.floor(c / 10) - 1;
      for (let x = 0; x < this.size; x++) {
        if (this.valueAtCell(ya, x, a)) {
          const has = (x > 0 && this.valueAtCell(yc, x - 1, c)) || (x < this.size - 1 && this.valueAtCell(yc, x + 1, c));
          if (!has) { const btn = this.candidateButton(ya, x, a); if (btn) return { chip: btn, group, reason: `${sym(a)} must be next to ${sym(c)} (clue ↔), but neither neighbouring column can hold ${sym(c)} — so ${sym(a)} can't be here.` }; }
        }
        if (this.valueAtCell(yc, x, c)) {
          const has = (x > 0 && this.valueAtCell(ya, x - 1, a)) || (x < this.size - 1 && this.valueAtCell(ya, x + 1, a));
          if (!has) { const btn = this.candidateButton(yc, x, c); if (btn) return { chip: btn, group, reason: `${sym(c)} must be next to ${sym(a)} (clue ↔), but neither neighbouring column can hold ${sym(a)} — so ${sym(c)} can't be here.` }; }
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
      for (const x of aCols) if (x >= maxC) { const btn = this.candidateButton(Math.floor(a / 10) - 1, x, a); if (btn) return { chip: btn, group, reason: `${sym(a)} must be left of ${sym(c)} (clue …), but there's no room for ${sym(c)} further right — so ${sym(a)} can't be here.` }; }
      for (const x of cCols) if (x <= minC && x <= Math.min(...aCols)) { const btn = this.candidateButton(Math.floor(c / 10) - 1, x, c); if (btn) return { chip: btn, group, reason: `${sym(c)} must be right of ${sym(a)} (clue …), but there's no room for ${sym(a)} further left — so ${sym(c)} can't be here.` }; }
      return null;
    }
    // triple — only suggest a candidate that the deductive solver can actually
    // eliminate from the current board state (avoids hinting a random "safe" pop
    // that the triple clue doesn't logically justify right now).
    if (typeof a === 'number' && typeof b === 'number' && typeof c === 'number') {
      const validPops = new Set(
        this.model.hintPops(this.board.cells, [group.rule]).map((p) => `${p.y}:${p.x}:${p.n}`),
      );
      for (const v of [a, b, c]) {
        const y = Math.floor(v / 10) - 1;
        for (let x = 0; x < this.size; x++) {
          const btn = this.candidateButton(y, x, v);
          if (btn && this.board.solution[y][x] !== v && validPops.has(`${y}:${x}:${v}`)) {
            return { chip: btn, group, reason: `${sym(v)} here would break the clue ${sym(a)} ${sym(b)} ${sym(c)} — it can't be the answer for this cell.` };
          }
        }
      }
      return null;
    }
    return null;
  }

  private findHintTarget(): HintTarget | null {
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
        if (chip) return { chip, group: null, reason: `${symbolFor(n)} can't be the answer for this cell — it's safe to pop.` };
      }
    }
    return null;
  }

  private clearHint(): void {
    if (!this.hintActive) return;
    this.hintActive.restore();
    this.hintActive = null;
  }

  /** Apply the current reduce-motion setting live (the menu toggle calls this
   *  on the paused game so it takes effect immediately, not next game). */
  applyReduceMotion(): void {
    this.fx?.setReduced(settings.reduceMotion);
  }

  /** Called when "Show tooltips" is toggled off in the (paused) options menu:
   *  drop any tooltip currently hanging on the board. */
  applyTooltips(): void {
    if (!settings.tooltips) this.hideTooltip();
  }

  /** Restart the idle countdown; when it elapses the HINT button is REVEALED
   *  (it then stays available for the rest of the round). */
  private resetIdle(): void {
    this.idleTimer?.remove();
    this.idleTimer = undefined;
    if (this.idleHintMs == null) return;
    if (this.hintBtn?.root.visible) return; // already offered — leave it up
    this.idleTimer = this.time.delayedCall(this.idleHintMs, () => {
      this.hintBtn?.root.setVisible(true);
    });
  }

  private hint(): void {
    if (this.busy || this.gameOver) return;
    this.clearHint();
    const target = this.findHintTarget();
    if (!target) return;
    const { chip, group, reason } = target;
    const hideMsg = this.showHintMessage(reason);

    // using the hint hides the button again and restarts the idle countdown
    // (so it re-appears after another idle window). Zen keeps it always up.
    if (!this.zen) {
      this.hintBtn?.root.setVisible(false);
      this.resetIdle();
    }

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

    // a pulsing gold FRAME around the candidate's cell and (if any) the clue, on
    // top of the outline — so the hint is unmistakable
    const frame = this.add.graphics().setDepth(24);
    const fr = chip.sub * 0.74;
    const frameTween = this.tweens.addCounter({
      from: 0.35, to: 1, duration: 560, yoyo: true, repeat: -1, ease: 'Sine.easeInOut',
      onUpdate: (tw) => {
        const a = tw.getValue() ?? 1;
        frame.clear();
        frame.lineStyle(3, 0xffd678, a);
        frame.strokeRoundedRect(chip.cx - fr, chip.cy - fr, fr * 2, fr * 2, 8);
        if (group) frame.strokeRoundedRect(group.gx - 7, group.gy - 7, group.cellSize * 3 + 14, group.cellSize + 14, 10);
      },
    });

    this.hintActive = {
      restore: () => {
        hideMsg();
        pulse.stop();
        pulseTxt.stop();
        frameTween.stop();
        frame.destroy();
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

  /** A banner explaining WHY the hinted candidate can be popped (port of the
   *  pygame hint reasoning text). Sits along the bottom and is cleared together
   *  with the hint highlight. */
  private showHintMessage(text: string): () => void {
    const wrap = (PORTRAIT ? GAME.width : SPAN) - 52;
    const txt = this.add.text(0, 0, text, { fontFamily: FONT, fontSize: PORTRAIT ? '20px' : '17px', color: '#ffe9c2', align: 'center', wordWrap: { width: wrap } }).setOrigin(0.5);
    const pw = Math.ceil(txt.width + 40);
    const ph = Math.ceil(txt.height + 26);
    const bg = this.add.image(0, 0, roundedTex(this, pw, ph, 14)).setTint(brighten(COLORS.panel, 8)).setAlpha(0.97);
    const border = this.add.image(0, 0, strokedRoundedTex(this, pw, ph, 14, 2)).setTint(0xffd678).setAlpha(0.8);
    const x = PORTRAIT ? GAME.width / 2 : BX + SPAN / 2;
    const y = GAME.height - ph / 2 - 16;
    const cont = this.add.container(x, y, [bg, border, txt]).setDepth(85).setScale(0.94);
    this.tweens.add({ targets: cont, scale: 1, duration: 180, ease: 'Back.easeOut' });
    return () => { this.tweens.killTweensOf(cont); cont.destroy(); };
  }

  // --------------------------- clues ---------------------------

  private buildClues(): void {
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

    // Lay the panel out as a list of "items": each clue, plus a separator slot
    // inserted wherever the clue type changes. A separator occupies a full clue
    // row (so the vertical step never breaks) but only draws a thin line.
    type Item = { rule: Rule } | { sep: true };
    const items: Item[] = [];
    let prevRank = -1;
    for (const rule of rules) {
      const rk = rank(rule);
      if (prevRank !== -1 && rk !== prevRank) items.push({ sep: true });
      items.push({ rule });
      prevRank = rk;
    }

    if (PORTRAIT) {
      // clues spread below the board in as many columns as fit the full width;
      // if all items don't fit at the default tile size, shrink until they do.
      this.add.text(GAME.width / 2, CLUES_TOP_Y - 2, 'C L U E S', { fontFamily: FONT, fontStyle: 'bold', fontSize: '18px', color: palette.text }).setOrigin(0.5);
      const colGap = 18;
      const top = CLUES_TOP_Y + 24;
      const availH = GAME.height - top - 8;
      let ruleCell = RULE_CELL;
      for (;;) {
        const rw = ruleCell * 3;
        const c = Math.max(1, Math.floor((GAME.width - 2 * MARGIN + colGap) / (rw + colGap)));
        if (Math.ceil(items.length / c) * (ruleCell + 10) <= availH || ruleCell <= 28) break;
        ruleCell -= 2;
      }
      const pRuleW = ruleCell * 3;
      const cols = Math.max(1, Math.floor((GAME.width - 2 * MARGIN + colGap) / (pRuleW + colGap)));
      const rowH = ruleCell + 10;
      const totalW = cols * pRuleW + (cols - 1) * colGap;
      const startX = (GAME.width - totalW) / 2;
      const perCol = Math.ceil(items.length / cols);
      const sepH = Math.round(rowH / 2); // separator slot is half a clue row
      const colY = new Array(cols).fill(top);
      items.forEach((it, i) => {
        const tx = Math.floor(i / perCol);
        const gx = startX + tx * (pRuleW + colGap);
        const gy = colY[tx];
        const colEnd = i % perCol === perCol - 1;
        if ('sep' in it) {
          // a separator that ends a column is dropped (no dangling line/gap)
          if (!colEnd) { this.makeClueSeparator(gx, gy, pRuleW, sepH); colY[tx] += sepH; }
        } else {
          this.makeClueGroup(it.rule, gx, gy, ruleCell);
          colY[tx] += rowH;
        }
      });
      return;
    }

    // Desktop: centre the clue block in the region between the board's right
    // edge and the window border, so the gap from the board equals the gap from
    // the border (equal left/right padding).
    const regionL = BX + SPAN;
    const regionW = GAME.width - regionL;
    this.add
      .text(regionL + regionW / 2, 24, 'C L U E S', { fontFamily: FONT, fontStyle: 'bold', fontSize: '20px', color: palette.text })
      .setOrigin(0.5);
    const colGap = 14;
    const availH = GAME.height - RULES_TOP - 8;

    // Auto-size: shrink the tile to fit 2 columns; if still too many, allow a
    // 3rd column (shrinking further until 3 columns fit the region).
    let ruleCell = RULE_CELL;
    const perColAt = (rc: number): number => Math.max(1, Math.floor(availH / (rc + 9)));
    const numColsNeeded = (rc: number): number => Math.ceil(items.length / perColAt(rc));
    while (ruleCell > 24 && numColsNeeded(ruleCell) > 2) ruleCell -= 2;
    let numCols = numColsNeeded(ruleCell);
    if (numCols > 2) {
      numCols = 3;
      while (ruleCell > 24 && 3 * ruleCell * 3 + 2 * colGap > regionW) ruleCell--;
      const perCol3 = Math.ceil(items.length / numCols);
      while (ruleCell > 24 && perCol3 * (ruleCell + 9) > availH) ruleCell--;
    }

    const finalRuleW = ruleCell * 3;
    const totalW = numCols * finalRuleW + (numCols - 1) * colGap;
    const startX = regionL + (regionW - totalW) / 2;
    const perCol = Math.ceil(items.length / numCols);
    const rowStep = ruleCell + 9;
    const sepH = Math.round(rowStep / 2); // separator slot is half a clue row
    const colY = new Array(numCols).fill(RULES_TOP);
    items.forEach((it, i) => {
      const tx = Math.floor(i / perCol);
      const gx = startX + tx * (finalRuleW + colGap);
      const gy = colY[tx];
      const colEnd = i % perCol === perCol - 1;
      if ('sep' in it) {
        // a separator that ends a column is dropped (no dangling line/gap)
        if (!colEnd) { this.makeClueSeparator(gx, gy, finalRuleW, sepH); colY[tx] += sepH; }
      } else {
        this.makeClueGroup(it.rule, gx, gy, ruleCell);
        colY[tx] += rowStep;
      }
    });
  }

  /** A thin horizontal divider, drawn centred in its (half-height) slot. */
  private makeClueSeparator(gx: number, gy: number, w: number, slotH: number): void {
    this.add
      .rectangle(gx, gy + slotH / 2, w, 2, brighten(COLORS.panel, 34), 0.55)
      .setOrigin(0, 0.5);
  }

  private makeClueGroup(rule: Rule, gx: number, gy: number, cellSize = RULE_CELL): void {
    const objs: Phaser.GameObjects.GameObject[] = [];
    const minis: ClueMini[] = [];
    const miniScale = (cellSize - 3) / 64;
    const valFontSize = `${Math.max(10, Math.round((PORTRAIT ? 27 : 19) * cellSize / RULE_CELL))}px`;
    const opFontSize = `${Math.max(10, Math.round((PORTRAIT ? 30 : 22) * cellSize / RULE_CELL))}px`;
    for (let j = 0; j < 3; j++) {
      const v = rule[j];
      const sx = gx + j * cellSize + cellSize / 2;
      const sy = gy + cellSize / 2;
      if (typeof v === 'number') {
        const img = this.add.image(sx, sy, MINI).setDisplaySize(cellSize - 3, cellSize - 3).setTint(rowColor(v));
        const outline = this.add
          .image(sx, sy, strokedRoundedTex(this, 64, 64, 12, 5))
          .setScale(miniScale).setTint(0xffffff).setAlpha(0);
        const t = this.add
          .text(sx, sy, symbolFor(v), { fontFamily: FONT, fontStyle: 'bold', fontSize: valFontSize, color: '#ffffff' })
          .setOrigin(0.5, glyphOriginY(v));
        // outline is NOT in objs — the dim pass must not leave it visible at
        // 0.32; it's controlled only via glow/dimGroup.
        objs.push(img, t);
        minis.push({ img, txt: t, outline, value: v, scale: miniScale });
      } else {
        const t = this.add
          .text(sx, sy, OP_SYMBOL[v] ?? String(v), { fontFamily: FONT, fontStyle: 'bold', fontSize: opFontSize, color: palette.accent })
          .setOrigin(0.5);
        objs.push(t);
      }
    }

    const group: ClueGroup = { objs, minis, rule, gx, gy, dim: false, cellSize, hit: null! };
    this.clueGroups.push(group);

    const hit = this.add
      .rectangle(gx, gy, cellSize * 3, cellSize, 0xffffff, 0)
      .setOrigin(0, 0)
      .setInteractive({ useHandCursor: true });
    group.hit = hit;

    if (PORTRAIT) {
      hit.on('pointerdown', () => {
        this.touchInterceptor = true;
        this.tapClue(group);
      });
    } else {
      // Desktop: hover highlights board cells; click enters/exits focus mode.
      hit.on('pointerover', () => {
        if (this.gameOver || group.dim) return;
        if (this.focusedClue) {
          // In focus mode the focused clue is already lit; a dimmed clue gets a
          // muted outline so you can see (and switch to) it without leaving focus.
          if (group !== this.focusedClue) this.focusHoverClue(group, true);
          return;
        }
        this.showClueTypeIndicator(group.rule);
        this.showTooltip(group);
        this.hoverStart(group, group.minis.map((m) => m.value), { glowNow: group.minis.map((m) => this.clueGlow(m)) });
      });
      hit.on('pointerout', () => {
        if (this.focusedClue) {
          if (group !== this.focusedClue) this.focusHoverClue(group, false);
          return;
        }
        this.hideClueTypeIndicator();
        this.hideTooltip();
        if (this.hoverSource === group) this.hoverEnd();
      });
      hit.on('pointerdown', (pointer: Phaser.Input.Pointer) => {
        if (pointer.rightButtonDown() || this.gameOver || group.dim) return;
        this.touchInterceptor = true;
        if (this.focusedClue === group) {
          this.exitClueFocus();
        } else {
          this.enterClueFocus(group);
        }
      });
    }
  }

  /** Mobile tap on a clue: enter focus mode straight away (no intermediate
   *  highlight-only step); tapping the focused clue again exits. */
  private tapClue(group: ClueGroup): void {
    if (this.gameOver || group.dim) return;
    if (this.focusedClue === group) { this.exitClueFocus(); return; }
    this.clearArmed();
    this.enterClueFocus(group);
  }

  /** Drop any clue highlight (board glow + tooltip + type indicator). */
  private clearClueHighlight(): void {
    this.hideClueTypeIndicator();
    if (!this.armedClue) return;
    if (this.hoverSource === this.armedClue) this.hoverEnd();
    this.hideTooltip();
    this.armedClue = null;
  }

  private updateRemaining(): void {
    if (!this.remainingText) return;
    let rem = 0;
    for (let y = 0; y < this.size; y++)
      for (let x = 0; x < this.size; x++)
        if (this.board.cells[y][x].value === null) rem++;
    this.remainingText.setText(PORTRAIT ? `${rem} left` : String(rem));
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
    if (!settings.tooltips) return;
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
    const bg = this.add.image(0, 0, roundedTex(this, Math.ceil(pw), Math.ceil(ph), 12)).setOrigin(0, 0).setTint(brighten(COLORS.panel, 24)).setAlpha(0.7);
    objs.push(bg);
    lines.forEach((ln, li) => {
      let x = pad;
      const cy = pad + li * lineH + lineH / 2;
      for (const tk of ln) {
        if (tk.kind === 'cell') {
          const v = tk.val as number;
          objs.push(this.add.image(x + tile / 2, cy, MINI).setDisplaySize(tile, tile).setTint(rowColor(v)));
          objs.push(this.add.text(x + tile / 2, cy, symbolFor(v), { fontFamily: FONT, fontStyle: 'bold', fontSize: '15px', color: '#ffffff' }).setOrigin(0.5, glyphOriginY(v)));
        } else {
          objs.push(this.add.text(x, cy, tk.val as string, { fontFamily: FONT, fontSize: `${fontSize}px`, color: palette.text }).setOrigin(0, 0.5));
        }
        x += tk.w + gap;
      }
    });

    // Portrait: static position above the clues strip.
    // Desktop: dynamic position to the LEFT of each clue, vertically centred on it.
    let tx: number, ty: number;
    if (PORTRAIT) {
      tx = GAME.width / 2 - pw / 2;
      ty = CLUES_TOP_Y - 14 - ph;
    } else {
      tx = group.gx - pw - 10;
      ty = group.gy + group.cellSize / 2 - ph / 2;
    }
    tx = Math.max(4, Math.min(GAME.width - pw - 4, tx));
    ty = Math.max(4, Math.min(GAME.height - ph - 4, ty));
    this.tooltip = this.add.container(tx, ty, objs).setDepth(80);
  }

  private hideTooltip(): void {
    this.tooltip?.destroy();
    this.tooltip = undefined;
  }

  // --------------------------- clue type indicator ---------------------------

  /** Focus-mode header above the board: the focused clue spelled out as a full
   *  tooltip — coloured cell tiles + the connecting words — on one narrow line. */
  private showClueTypeIndicator(rule: Rule): void {
    this.hideClueTypeIndicator();

    const segs = ruleSegments(rule);
    const tile = PORTRAIT ? 24 : 22;
    const fontSize = PORTRAIT ? 15 : 14;
    const gap = 6;
    const padX = 14;
    const ph = (PORTRAIT ? 42 : 36);

    // Build the tokens left-to-right, measuring text as we go.
    const tmp = this.add.text(0, 0, '', { fontFamily: FONT, fontSize: `${fontSize}px` }).setVisible(false);
    type Tok = { kind: 'cell'; val: number; w: number } | { kind: 'word'; val: string; w: number };
    const toks: Tok[] = [];
    for (const s of segs) {
      if (s.kind === 'cell') toks.push({ kind: 'cell', val: s.value, w: tile });
      else { tmp.setText(s.value); toks.push({ kind: 'word', val: s.value, w: tmp.width }); }
    }
    tmp.destroy();

    const contentW = toks.reduce((a, t) => a + t.w, 0) + gap * Math.max(0, toks.length - 1);
    const pw = Math.ceil(contentW + padX * 2);

    // A separate little square to the LEFT of the tooltip shows the relationship
    // symbol (↕ same-column, ↔ neighbours, … left-of). Three-in-a-row has no
    // single symbol, so it gets no square.
    const op = rule[1];
    const sqSym = op === '^' ? '↕' : op === '<->' ? '↔' : op === '...' ? '…' : null;
    const sqSide = ph;
    const sqGap = 8;
    const shift = sqSym ? (sqSide + sqGap) / 2 : 0; // nudge the tooltip right to keep the pair centred

    const cx = PORTRAIT ? GAME.width / 2 : BX + SPAN / 2;
    const cy = PORTRAIT ? TOP_H - 22 : Math.round(BY / 2);

    const objs: Phaser.GameObjects.GameObject[] = [];
    if (sqSym) {
      const sqx = shift - pw / 2 - sqGap - sqSide / 2;
      objs.push(this.add.image(sqx, 0, roundedTex(this, sqSide, sqSide, 10)).setTint(brighten(COLORS.panel, 24)).setAlpha(0.92));
      objs.push(this.add.text(sqx, 0, sqSym, { fontFamily: FONT, fontStyle: 'bold', fontSize: `${PORTRAIT ? 24 : 20}px`, color: palette.text }).setOrigin(0.5));
    }
    objs.push(this.add.image(shift, 0, roundedTex(this, pw, ph, 10)).setTint(brighten(COLORS.panel, 24)).setAlpha(0.92));
    let x = shift - contentW / 2;
    for (const tk of toks) {
      const tcx = x + tk.w / 2;
      if (tk.kind === 'cell') {
        objs.push(this.add.image(tcx, 0, MINI).setDisplaySize(tile, tile).setTint(rowColor(tk.val)));
        objs.push(this.add.text(tcx, 0, symbolFor(tk.val), { fontFamily: FONT, fontStyle: 'bold', fontSize: `${tile - 8}px`, color: '#ffffff' }).setOrigin(0.5, glyphOriginY(tk.val)));
      } else {
        objs.push(this.add.text(x, 0, tk.val, { fontFamily: FONT, fontSize: `${fontSize}px`, color: palette.text }).setOrigin(0, 0.5));
      }
      x += tk.w + gap;
    }

    this.clueTypeIndicator = this.add.container(cx, cy, objs).setDepth(82);
  }

  private hideClueTypeIndicator(): void {
    if (!this.clueTypeIndicator) return;
    this.clueTypeIndicator.destroy();
    this.clueTypeIndicator = undefined;
  }

  // --------------------------- clue focus mode ---------------------------

  // Focus mode dims everything except the focused clue and its matched cells,
  // which stay fully interactive (hover/lift/pop/hold). A soft dim overlay +
  // radial vignette + a one-shot pop fade it in. Non-matched chips/clues are
  // dimmed by alpha and deactivated; the menu button stays lit and active.
  private static readonly FOCUS_DIM = 0.18;
  private static readonly FOCUS_DEPTH = 12; // focused clue + lit content sit here
  private static readonly OVERLAY_DEPTH = 4; // above background, below chips

  /** Enter focus on `group`, or — if already in focus — switch the focus to
   *  `group` in place. Switching keeps the dim overlay up and just cross-fades
   *  which clue/cells are bright (no full brightness flash between clues).
   *  PC: click a clue to enter, click another to switch, click it again to exit.
   *  Mobile: tap a clue to enter, tap another to switch, tap it to exit. */
  private enterClueFocus(group: ClueGroup): void {
    if (group.dim) return;
    if (this.focusedClue === group) return;
    const switching = this.focusedClue !== null;
    // Clear any transient hover glow / floating tooltip / muted hover outline so
    // nothing is left hanging once the new clue takes focus.
    this.hoverEnd();
    this.hideTooltip();
    this.clearFocusHover();
    this.snapTilesHome(); // a mid-hover hop/lift mustn't freeze when its tween is killed below
    this.focusedClue = group;
    this.armedClue = null; // focus supersedes the mobile "armed" state

    if (!switching) {
      // First entry: a flat dim over the whole scene (background/panels) + a
      // radial vignette, both below the chips so lit content isn't darkened.
      const ov = this.add
        .rectangle(GAME.width / 2, GAME.height / 2, GAME.width, GAME.height, 0x000000, 0)
        .setDepth(GameScene.OVERLAY_DEPTH);
      this.focusOverlay = ov;
      const vig = this.add
        .image(GAME.width / 2, GAME.height / 2, vignetteTex(this, GAME.width, GAME.height))
        .setDisplaySize(GAME.width, GAME.height)
        .setAlpha(0)
        .setDepth(GameScene.OVERLAY_DEPTH);
      this.focusVignette = vig;
      this.tweens.add({ targets: ov, fillAlpha: 0.5, duration: 240, ease: 'Quad.easeOut' });
      this.tweens.add({ targets: vig, alpha: 1, duration: 280, ease: 'Quad.easeOut' });
      // Keep the menu button lit + clickable above the dim.
      this.menuBtn?.root.setDepth(96);
    }

    this.applyFocusVisuals(group, true);
    this.showClueTypeIndicator(group.rule);

    // A gentle one-shot emphasis pop on the now-focused clue.
    const pop = group.objs.filter((o) => o.active);
    this.tweens.add({ targets: pop, scaleX: 1.07, scaleY: 1.07, duration: 150, yoyo: true, ease: 'Sine.easeOut' });
  }

  /** Hover feedback on a DIMMED clue while in focus mode: a muted outline (and a
   *  hair of scale) so it reads as a switch target, without un-dimming it. */
  private focusHoverClue(group: ClueGroup, on: boolean): void {
    if (group.dim || group === this.focusedClue) return;
    if (on) {
      if (this.focusHoverGroup && this.focusHoverGroup !== group) this.focusHoverClue(this.focusHoverGroup, false);
      this.focusHoverGroup = group;
    } else if (this.focusHoverGroup === group) {
      this.focusHoverGroup = null;
    }
    const sc = on ? 1.04 : 1;
    for (const m of group.minis) {
      this.tweens.killTweensOf([m.img, m.outline]);
      m.outline.setTint(0xffffff).setDepth(GameScene.FOCUS_DEPTH);
      this.tweens.add({ targets: [m.img, m.outline], scaleX: m.scale * sc, scaleY: m.scale * sc, duration: 120, ease: on ? 'Back.easeOut' : 'Quad.easeOut' });
      this.tweens.add({ targets: m.outline, alpha: on ? 0.4 : 0, duration: 120 });
    }
  }

  private clearFocusHover(): void {
    if (this.focusHoverGroup) this.focusHoverClue(this.focusHoverGroup, false);
  }

  /** Snap every chip / big cell back to its home position, scale and depth,
   *  killing any in-flight hover hop/lift tween — so nothing is left frozen in
   *  mid-air when entering focus during a hover animation. */
  private snapTilesHome(): void {
    for (let y = 0; y < this.size; y++) {
      for (let x = 0; x < this.size; x++) {
        for (const [, c] of this.chips[y][x]) {
          this.tweens.killTweensOf([c.img, c.txt, c.outline]);
          c.img.setPosition(c.cx, c.cy).setScale(c.base).setDepth(5);
          c.txt.setPosition(c.cx, c.cy).setScale(1).setDepth(7);
          c.outline.setPosition(c.cx, c.cy).setScale(c.base).setAlpha(0).setDepth(6);
        }
        const b = this.bigObjs[y][x];
        if (b) {
          this.tweens.killTweensOf([b.img, b.txt, b.outline]);
          b.img.setPosition(b.cx, b.cy).setScale(b.base).setDepth(5);
          b.txt.setPosition(b.cx, b.cy).setScale(1).setDepth(7);
          b.outline.setPosition(b.cx, b.cy).setScale(b.base).setAlpha(0).setDepth(6);
        }
      }
    }
    if (this.liftShadow) { this.tweens.killTweensOf(this.liftShadow); this.liftShadow.setAlpha(0); }
  }

  /** Set alpha / interactivity / depth on every board chip and clue to reflect
   *  the focus on `group`: matched stay bright + active, the rest dim + inert. */
  private applyFocusVisuals(group: ClueGroup, animate: boolean): void {
    const set = new Set(group.minis.map((m) => m.value));
    const dim = GameScene.FOCUS_DIM;
    const op = group.rule[1];
    // Per-clue-type cell cues (rebuilt each pass so they track the board):
    //  • three-in-a-row → hatch the CENTRE value's cells (+ the centre mini)
    //  • left-of (…)    → hatch the left value's LEFTMOST + right value's RIGHTMOST cell
    //  • same-column(^) / neighbours(↔) → directional arrows on matched cells
    const center = typeof op === 'number' ? (group.rule[1] as number) : null;
    let lrLeft: { y: number; x: number; v: number } | null = null;
    let lrRight: { y: number; x: number; v: number } | null = null;
    if (op === '...') {
      const lv = group.rule[0] as number; const rv = group.rule[2] as number;
      const lc = this.extremeCell(lv, true); const rc = this.extremeCell(rv, false);
      if (lc) lrLeft = { ...lc, v: lv };
      if (rc) lrRight = { ...rc, v: rv };
    }
    const arrowMode: 'col' | 'adj' | null = op === '^' ? 'col' : op === '<->' ? 'adj' : null;
    const hatchHere = (y: number, x: number, v: number): boolean =>
      (center !== null && v === center) ||
      (lrLeft !== null && y === lrLeft.y && x === lrLeft.x && v === lrLeft.v) ||
      (lrRight !== null && y === lrRight.y && x === lrRight.x && v === lrRight.v);
    this.clearFocusDecor();

    const setAlpha = (objs: Phaser.GameObjects.GameObject[], a: number): void => {
      for (const o of objs) {
        if (!o.active) continue;
        if (animate) { this.tweens.killTweensOf(o); this.tweens.add({ targets: o, alpha: a, duration: 220, ease: 'Quad.easeOut' }); }
        else (o as Phaser.GameObjects.Image).setAlpha(a);
      }
    };

    for (let y = 0; y < this.size; y++) {
      for (let x = 0; x < this.size; x++) {
        for (const [v, chip] of this.chips[y][x]) {
          const on = set.has(v);
          if (chip.img.input) chip.img.input.enabled = on;
          setAlpha([chip.img, chip.txt], on ? 1 : dim);
          if (on && hatchHere(y, x, v)) this.addFocusHatch(chip.img, chip.base);
        }
        const big = this.bigObjs[y][x];
        const bigOn = big ? set.has(big.value) : false;
        if (big) {
          if (big.img.input) big.img.input.enabled = bigOn;
          setAlpha([big.img, big.txt], bigOn ? 1 : dim);
          if (bigOn && hatchHere(y, x, big.value)) this.addFocusHatch(big.img, big.base);
        }
        // directional arrows: follow a matched big cell, else sit in a matched
        // candidate cell's empty margins
        if (arrowMode) {
          const { cx, cy } = this.cellCenter(y, x);
          if (big && bigOn) this.addFocusArrows(arrowMode, cx, cy, this.cellSide, { img: big.img, base: big.base });
          else if (!big && this.board.cells[y][x].candidates.some((c) => set.has(c))) this.addFocusArrows(arrowMode, cx, cy, this.cellSide);
        }
        const rect = this.cellHits[y]?.[x];
        if (rect?.input) {
          const cell = this.board.cells[y][x];
          rect.input.enabled = (cell.value !== null && set.has(cell.value)) || cell.candidates.some((c) => set.has(c));
        }
      }
    }

    for (const grp of this.clueGroups) {
      const focused = grp === group;
      // every non-solved clue stays clickable so you can switch focus to it
      // without leaving focus mode (auto-dimmed/solved clues are inert).
      if (grp.hit.input) grp.hit.input.enabled = !grp.dim;
      // raise above the dim so depth is consistent (focused bright, rest dimmed)
      for (const o of grp.objs) (o as Phaser.GameObjects.Image).setDepth(GameScene.FOCUS_DEPTH);
      // clear any leftover muted-hover outline/scale so it doesn't hang after a switch
      for (const m of grp.minis) {
        m.outline.setDepth(GameScene.FOCUS_DEPTH);
        if (animate) this.tweens.killTweensOf([m.img, m.outline]);
        m.outline.setAlpha(0).setScale(m.scale);
        m.img.setScale(m.scale);
        m.txt.setDepth(GameScene.FOCUS_DEPTH); // reset (only the hatched centre is raised)
        // hatch the focused tri-clue's CENTRE tile in the panel too
        if (focused && center !== null && m.value === center) {
          m.txt.setDepth(GameScene.FOCUS_DEPTH + 2); // keep the symbol above the hatch
          this.addFocusHatch(m.img, m.scale);
        }
      }
      setAlpha(grp.objs, focused ? 1 : grp.dim ? 0.32 : dim);
    }
  }

  /** Leftmost (or rightmost) board cell in value `v`'s row that still holds `v`
   *  (solved there, or `v` is still a candidate). Used for the left-of (…) cue. */
  private extremeCell(v: number, leftmost: boolean): { y: number; x: number } | null {
    const y = Math.floor(v / 10) - 1;
    if (y < 0 || y >= this.size) return null;
    const xs = leftmost ? [...Array(this.size).keys()] : [...Array(this.size).keys()].reverse();
    for (const x of xs) {
      const cell = this.board.cells[y][x];
      if (cell.value === v || (cell.value === null && cell.candidates.includes(v))) return { y, x };
    }
    return null;
  }

  /** Overlay a soft diagonal hatch pinned to `target` (it tracks the tile's
   *  hop/lift/scale each frame via update()). */
  private addFocusHatch(target: Phaser.GameObjects.Image, baseScale: number): void {
    const h = this.add
      .image(target.x, target.y, hatchTex(this))
      .setDisplaySize(target.displayWidth, target.displayHeight)
      .setTint(0xffffff)
      .setAlpha(0.32)
      .setDepth(target.depth + 1);
    this.focusDecor.push({ obj: h, img: target, homeScale: baseScale, offX: 0, offY: 0, hatch: true, baseScale });
  }

  /** Light-grey relationship arrows in a matched cell's empty top/bottom band
   *  (same-column → ↑/↓; neighbours → ↑/↓ plus ←/→). When `follow` is given the
   *  arrows track that big cell; otherwise they sit statically in the cell. */
  private addFocusArrows(mode: 'col' | 'adj', cx: number, cy: number, size: number, follow?: { img: Phaser.GameObjects.Image; base: number }): void {
    const band = size * 0.40; // distance from centre to the top/bottom band
    const sx = size * 0.27;
    const fs = Math.max(10, Math.round(size * 0.15));
    const specs: Array<[string, number, number]> = mode === 'col'
      ? [['▲', 0, -band], ['▼', 0, band]]
      : [['◀', -sx, -band], ['▲', 0, -band], ['▶', sx, -band], ['◀', -sx, band], ['▼', 0, band], ['▶', sx, band]];
    for (const [glyph, ox, oy] of specs) {
      const t = this.add
        .text(cx + ox, cy + oy, glyph, { fontFamily: FONT, fontStyle: 'bold', fontSize: `${fs}px`, color: '#cfcfcf' })
        .setOrigin(0.5).setAlpha(0.5)
        .setDepth(follow ? follow.img.depth + 1 : 8);
      if (follow) this.focusDecor.push({ obj: t, img: follow.img, homeScale: follow.base, offX: ox, offY: oy, hatch: false, baseScale: 1 });
      else this.focusStatic.push(t);
    }
  }

  private clearFocusDecor(): void {
    for (const d of this.focusDecor) d.obj.destroy();
    this.focusDecor = [];
    for (const o of this.focusStatic) o.destroy();
    this.focusStatic = [];
  }

  /** Keep follow-decorations pinned to their tiles (hop / lift / scale); drop any
   *  whose tile was destroyed (e.g. a cell resolving mid-cascade). */
  update(): void {
    if (this.focusDecor.length === 0) return;
    for (let i = this.focusDecor.length - 1; i >= 0; i--) {
      const d = this.focusDecor[i];
      const img = d.img;
      if (!img.active) { d.obj.destroy(); this.focusDecor.splice(i, 1); continue; }
      d.obj.setDepth(img.depth + 1);
      if (d.hatch) {
        d.obj.setPosition(img.x, img.y);
        (d.obj as Phaser.GameObjects.Image).setDisplaySize(img.displayWidth, img.displayHeight);
      } else {
        const r = img.scaleX / d.homeScale;
        d.obj.setPosition(img.x + d.offX * r, img.y + d.offY * r);
        d.obj.setScale(d.baseScale * r);
      }
    }
  }

  /** Re-apply the focus visuals after a board change (new big cells from a
   *  cascade need dimming too); auto-exit if the focused clue got solved. */
  private refreshFocus(): void {
    if (!this.focusedClue) return;
    if (this.focusedClue.dim) { this.exitClueFocus(); return; }
    this.applyFocusVisuals(this.focusedClue, false);
    this.showClueTypeIndicator(this.focusedClue.rule);
  }

  private exitClueFocus(): void {
    if (!this.focusedClue) return;
    this.focusedClue = null;
    this.focusHoverGroup = null;
    this.clearFocusDecor();

    this.focusOverlay?.destroy();
    this.focusOverlay = undefined;
    this.focusVignette?.destroy();
    this.focusVignette = undefined;
    this.menuBtn?.root.setDepth(0);

    // Restore every chip / big cell to full alpha + interactive.
    for (let y = 0; y < this.size; y++) {
      for (let x = 0; x < this.size; x++) {
        for (const [, chip] of this.chips[y][x]) {
          if (!chip.img.active) continue;
          this.tweens.killTweensOf([chip.img, chip.txt]);
          chip.img.setAlpha(1); chip.txt.setAlpha(1);
          if (chip.img.input) chip.img.input.enabled = true;
        }
        const big = this.bigObjs[y][x];
        if (big?.img.active) {
          this.tweens.killTweensOf([big.img, big.txt]);
          big.img.setAlpha(1); big.txt.setAlpha(1);
          if (big.img.input) big.img.input.enabled = true;
        }
        const rect = this.cellHits[y]?.[x];
        if (rect?.input) rect.input.enabled = true;
      }
    }

    // Restore clue depths + alpha (auto-dimmed clues keep their 0.32) and clear
    // any leftover muted-hover outline/scale.
    for (const grp of this.clueGroups) {
      this.tweens.killTweensOf(grp.objs);
      for (const o of grp.objs) (o as Phaser.GameObjects.Image).setDepth(0).setAlpha(grp.dim ? 0.32 : 1);
      for (const m of grp.minis) {
        this.tweens.killTweensOf([m.img, m.outline]);
        m.outline.setDepth(0).setAlpha(0).setScale(m.scale);
        m.img.setScale(m.scale);
      }
      if (grp.hit.input) grp.hit.input.enabled = true;
    }

    this.hideClueTypeIndicator();
  }

  // --------------------------- end ---------------------------

  private finish(won: boolean): void {
    if (this.gameOver) return;
    this.gameOver = true;
    this.hoverEnd();
    this.exitClueFocus();
    this.hideClueTypeIndicator();
    this.timerEvent?.remove();
    this.hideTooltip();

    this.recordResult(won);

    if (won) {
      this.fx.celebrate();
      audio.play('win');
    } else {
      this.fx.defeat();
      // the fatal move already fired 'wrong' this same frame; let it breathe so
      // the lose sting isn't masked by (and audible over) the wrong sound
      this.time.delayedCall(320, () => audio.play('lose'));
    }

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
      // a seeded puzzle additionally records into its own daily/weekly/monthly
      // block and shows its own best time
      let seededBest: number | null = null;
      if (this.seededKind && this.seededPeriod !== undefined) {
        stats.recordSeeded(this.seededKind, this.seededPeriod, this.seconds);
        seededBest = stats.seeded(this.seededKind).best_time;
      }
      this.newRecord = prevBest === null || this.seconds < prevBest;
      const best = this.seededKind ? seededBest : stats.bestFor(this.difficulty, this.size);
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
          dailyStreak: stats.seeded('daily').streak,
          zen: false,
        }),
      );
      this.freshBadges = fresh.map((id) => achievementInfo(id).name);
    } else {
      stats.recordLoss(this.difficulty, this.size);
    }
  }

  private getShareTag(): string {
    const diffNames = ['Easy', 'Normal', 'Hard'];
    return this.seededKind
      ? `${this.seededKind.charAt(0).toUpperCase() + this.seededKind.slice(1)} #${this.seededNumber ?? this.seededPeriod}`
      : `${this.size}×${this.size}  ${diffNames[this.difficulty] ?? ''}`.trim();
  }

  private copyResult(onCopied: () => void): void {
    const time = `${Math.floor(this.seconds / 60)}:${String(this.seconds % 60).padStart(2, '0')}`;
    const mistakes = this.mistakes === 1 ? '1 mistake' : `${this.mistakes} mistakes`;
    const text = [
      `Einstein — ${this.getShareTag()}`,
      `${time} · ${mistakes}`,
      'zidan-banan.itch.io/einstein-game',
    ].join('\n');

    // execCommand works inside iframes (no Permissions Policy restriction).
    try {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.style.cssText = 'position:fixed;top:-9999px;opacity:0';
      document.body.appendChild(ta); ta.focus(); ta.select();
      const ok = document.execCommand('copy');
      document.body.removeChild(ta);
      if (ok) { onCopied(); return; }
    } catch { /* fall through */ }

    navigator.clipboard?.writeText(text).then(onCopied).catch(() => {});
  }

  private refreshHover(): void {
    if (this.gameOver) return;
    const ptr = this.input.activePointer;
    if (!ptr) return;
    const px = ptr.worldX;
    const py = ptr.worldY;
    for (let y = 0; y < this.size; y++) {
      for (let x = 0; x < this.size; x++) {
        const { ox, oy } = this.cellOrigin(y, x);
        if (px < ox || px > ox + this.cellSide || py < oy || py > oy + this.cellSide) continue;
        const big = this.bigObjs[y][x];
        if (big) {
          this.hoverStart(big, [big.value], { glowNow: [this.bigGlow(big)] });
        } else {
          for (const [, chip] of this.chips[y][x]) {
            const hs = chip.sub / 2;
            if (Math.abs(px - chip.cx) < hs && Math.abs(py - chip.cy) < hs) {
              this.hoverStart(chip, [chip.value], { liftChip: chip });
              break;
            }
          }
        }
        return;
      }
    }
  }

  /** Zoom a candidate cell to ~76 % of the board width so it's tappable.
   *  Only triggered in PORTRAIT + non-touch mode (zoom replaces single-tap pop). */
  private openZoom(cellY: number, cellX: number): void {
    if (this.zoomOverlay) return;
    const cell = this.board.cells[cellY][cellX];
    if (!cell || cell.value !== null) return;
    const side = Math.round(SPAN * 0.76);
    const cx = GAME.width / 2;
    const cy = GAME.height / 2;

    // In focus mode only the focused clue's values stay bright; the rest of the
    // zoomed cell dims exactly like it does on the board behind.
    const focusSet = this.focusedClue ? new Set(this.focusedClue.minis.map((m) => m.value)) : null;

    // Backdrop: separate from the panel so it never scales with the animation.
    // It fades in immediately to full coverage, tap it to close. Depth sits
    // above the tooltip (80) so the zoom panel covers it, never clips behind it.
    const backdrop = this.add.rectangle(cx, cy, GAME.width, GAME.height, 0x000000, 0).setInteractive().setDepth(85);
    backdrop.on('pointerdown', () => this.closeZoom());
    this.tweens.add({ targets: backdrop, fillAlpha: 0.72, duration: 180 });
    this.zoomBackdrop = backdrop;

    // Panel children positioned at local (0,0) = panel centre.
    // The container starts at the tapped cell and grows to canvas centre.
    const objs: Phaser.GameObjects.GameObject[] = [];
    const panelTex = roundedTex(this, side, side, Math.round(side * 0.1));
    // darker plate under focus, matching the dimmed board behind it
    const panel = this.add.image(0, 0, panelTex).setTint(brighten(COLORS.bg, focusSet ? 6 : 18));
    objs.push(panel);

    const inset = Math.max(4, Math.floor(side / 22));
    const avail = side - 2 * inset;
    const sub = Math.floor(Math.min(avail / this.candCols, avail / this.candRows));
    // local coords relative to panel centre (0,0)
    const baseX = -side / 2 + inset + Math.floor((avail - sub * this.candCols) / 2);
    const baseY = -side / 2 + inset + Math.floor((avail - sub * this.candRows) / 2);

    // Hold-to-define state shared across all chip handlers in this zoom session.
    let zoomPressedV = -1;
    let zoomPressFired = false;
    let zoomRing: Phaser.GameObjects.Graphics | undefined;
    let zoomRingTween: Phaser.Tweens.Tween | undefined;
    const clearZoomPress = (): void => {
      zoomRingTween?.stop(); zoomRingTween = undefined;
      zoomRing?.destroy(); zoomRing = undefined;
      zoomPressedV = -1; zoomPressFired = false;
    };

    for (let index = 0; index < this.size; index++) {
      const v = (cellY + 1) * 10 + index + 1;
      if (!cell.candidates.includes(v)) continue;
      const dy = Math.floor(index / this.candCols);
      const dx = index % this.candCols;
      const inRow = Math.min(this.candCols, this.size - dy * this.candCols);
      const rowOff = Math.floor(((this.candCols - inRow) * sub) / 2);
      // local (container-relative) position
      const chipLx = baseX + rowOff + dx * sub + sub / 2;
      const chipLy = baseY + dy * sub + sub / 2;
      // world position after animation (container ends at cx, cy, scale 1)
      const chipWx = cx + chipLx;
      const chipWy = cy + chipLy;
      const base = (sub - 3) / 80;
      const color = rowColor(v);
      // matched values stay bright + interactive; non-matched dim + inert (focus)
      const dimmed = focusSet ? !focusSet.has(v) : false;
      const img = this.add.image(chipLx, chipLy, TILE).setScale(base).setTint(color);
      const txt = this.add.text(chipLx, chipLy, symbolFor(v), {
        fontFamily: FONT, fontStyle: 'bold',
        fontSize: `${Math.max(13, Math.round(sub * 0.5))}px`, color: '#ffffff',
      }).setOrigin(0.5, glyphOriginY(v));
      if (dimmed) {
        img.setAlpha(GameScene.FOCUS_DIM);
        txt.setAlpha(GameScene.FOCUS_DIM);
        objs.push(img, txt);
        continue;
      }
      img.setInteractive({ useHandCursor: true });
      img.on('pointerover', () => img.setTint(brighten(color, 56)));
      img.on('pointerout', () => { img.setTint(color); if (zoomPressedV === v) clearZoomPress(); });
      img.on('pointerdown', () => {
        clearZoomPress();
        zoomPressedV = v; zoomPressFired = false;
        const gr = this.add.graphics().setDepth(90);
        zoomRing = gr;
        const r = Math.max(18, sub * 0.58);
        zoomRingTween = this.tweens.addCounter({
          from: 0, to: 1, duration: HOLD_MS, ease: 'Linear',
          onUpdate: (tw) => {
            const t = tw.getValue() ?? 0;
            gr.clear();
            gr.lineStyle(5, 0x000000, 0.35); gr.strokeCircle(chipWx, chipWy, r);
            gr.lineStyle(5, 0xffe27a, 0.95); gr.beginPath();
            gr.arc(chipWx, chipWy, r, -Math.PI / 2, -Math.PI / 2 + t * Math.PI * 2, false); gr.strokePath();
          },
          onComplete: () => { zoomPressFired = true; clearZoomPress(); this.closeZoom(false); this.doAction(cellY, cellX, v, true); },
        });
      });
      img.on('pointerup', () => {
        if (zoomPressedV === v && !zoomPressFired) { clearZoomPress(); this.closeZoom(false); this.doAction(cellY, cellX, v, false); }
      });
      objs.push(img, txt);
    }

    // Container starts at the tapped cell's centre, scaled to cell size → animates to canvas centre at full size.
    const { ox, oy } = this.cellOrigin(cellY, cellX);
    const startScale = Math.min(1, this.cellSide / side);
    const container = this.add.container(ox + this.cellSide / 2, oy + this.cellSide / 2, objs).setDepth(86).setScale(startScale).setAlpha(0.4);
    this.tweens.add({ targets: container, x: cx, y: cy, scale: 1, alpha: 1, duration: 260, ease: 'Back.easeOut' });
    this.zoomOverlay = container;
  }

  private closeZoom(animate = true): void {
    if (!this.zoomOverlay) return;
    const c = this.zoomOverlay;
    const bd = this.zoomBackdrop;
    this.zoomOverlay = undefined;
    this.zoomBackdrop = undefined;
    c.each((child: Phaser.GameObjects.GameObject) => {
      (child as Phaser.GameObjects.Image).disableInteractive?.();
    });
    bd?.disableInteractive();
    if (animate) {
      this.tweens.add({ targets: c, alpha: 0, scale: 0.85, duration: 160, ease: 'Quad.easeIn', onComplete: () => { c.destroy(); bd?.destroy(); } });
      this.tweens.add({ targets: bd, fillAlpha: 0, duration: 160 });
    } else {
      c.destroy(); bd?.destroy();
    }
  }

  private showEndPanel(won: boolean): void {
    const hasBadges = won && this.freshBadges.length > 0;
    const showCopy = false;
    const bestLine = won
      ? this.zen
        ? 'Zen — not recorded'
        : this.isRetry
          ? 'Retry — not recorded'
          : this.bestText
            ? `best ${this.bestText}`
            : ''
      : '';

    // Measure top-down, then centre the panel around the content. Everything
    // scales up on mobile (portrait) so the plaque is comfortably legible.
    const f = PORTRAIT ? 1.4 : 1;
    const fs = (n: number): string => `${Math.round(n * f)}px`;
    const PAD = 34 * f;
    let h = PAD;
    if (won && this.newRecord) h += 30 * f;
    h += 52 * f; // title
    h += 32 * f; // subtitle
    if (bestLine) h += 24 * f;
    if (hasBadges) h += (18 + 6 + this.freshBadges.length * 26) * f;
    if (showCopy) h += (16 + 36) * f;
    h += 26 * f; // gap before buttons
    const btnH = 52 * f;
    const menuH = 48 * f;
    h += btnH + 14 * f + menuH + PAD;

    const pw = Math.round(480 * f);
    const ph = h;
    const cx = GAME.width / 2;
    const cyPanel = GAME.height / 2;
    const top = cyPanel - ph / 2;

    this.add.rectangle(cx, cyPanel, GAME.width, GAME.height, 0x000000, 0.62).setDepth(100);
    this.add.image(cx, cyPanel, roundedTex(this, pw, Math.round(ph), 18)).setTint(COLORS.panel).setDepth(101);
    // gold border on a win, red on a loss (mirrors the pygame plaque)
    this.add.image(cx, cyPanel, strokedRoundedTex(this, pw, Math.round(ph), 18, 3)).setTint(won ? 0xffd678 : 0xe05a68).setDepth(101);

    let y = top + PAD;

    if (won && this.newRecord) {
      const banner = this.add
        .text(cx, y + 15 * f, '★  NEW RECORD!  ★', { fontFamily: FONT, fontStyle: 'bold', fontSize: fs(22), color: '#ffd678' })
        .setOrigin(0.5).setDepth(102);
      this.tweens.add({ targets: banner, scale: 1.08, duration: 520, yoyo: true, repeat: -1, ease: 'Sine.easeInOut' });
      y += 30 * f;
    }

    this.add
      .text(cx, y + 26 * f, won ? 'SOLVED!' : 'OUT OF LIVES', {
        fontFamily: FONT, fontStyle: 'bold', fontSize: fs(42), color: won ? '#ffe27a' : '#e05a68',
      })
      .setOrigin(0.5).setDepth(102);
    y += 52 * f;

    this.add
      .text(cx, y + 16 * f, won ? `Time ${this.fmt(this.seconds)}   ·   ${this.mistakes} mistakes` : 'Better luck on the next board', {
        fontFamily: FONT, fontSize: fs(20), color: palette.accent,
      })
      .setOrigin(0.5).setDepth(102);
    y += 32 * f;

    if (bestLine) {
      this.add
        .text(cx, y + 12 * f, bestLine, { fontFamily: FONT, fontSize: fs(16), color: palette.accent })
        .setOrigin(0.5).setDepth(102);
      y += 24 * f;
    }

    if (hasBadges) {
      this.add
        .text(cx, y + 8 * f, 'NEW BADGE', { fontFamily: FONT, fontStyle: 'bold', fontSize: fs(14), color: '#ffd678' })
        .setOrigin(0.5).setDepth(102);
      y += (18 + 6) * f;
      for (const name of this.freshBadges) {
        this.add
          .text(cx, y + 13 * f, `★  ${name}`, { fontFamily: FONT, fontSize: fs(18), color: palette.text })
          .setOrigin(0.5).setDepth(102);
        y += 26 * f;
      }
    }

    if (showCopy) {
      const copyBtnY = y + (16 + 18) * f;
      const copyRow: Phaser.GameObjects.GameObject[] = [];
      const copyBtn = makeButton(this, cx, copyBtnY, 260 * f, 36 * f, 'Copy result', () => {
        this.copyResult(() => {
          copyRow.forEach((o) => o.destroy());
          const done = this.add.text(cx, copyBtnY, '✓  Copied!', {
            fontFamily: FONT, fontStyle: 'bold', fontSize: `${Math.round(16 * f)}px`, color: '#86c87a',
          }).setOrigin(0.5).setDepth(103);
          this.tweens.add({ targets: done, alpha: 0, delay: 1500, duration: 400, onComplete: () => done.destroy() });
        });
      }, { fontSize: Math.round(16 * f) });
      copyBtn.root.setDepth(102);
      copyRow.push(copyBtn.root);
      y += (16 + 36) * f;
    }

    const btnY = y + 52 * f;
    const bw = 200 * f; // comfortable margin inside the panel
    const b1 = makeButton(this, cx - bw / 2 - 8 * f, btnY, bw, btnH, 'New board', () => this.scene.restart({ size: this.size, difficulty: this.difficulty, zen: this.zen }), { fontSize: Math.round(19 * f), fill: COLORS.rows['4'], textColor: '#ffffff' });
    const b2 = makeButton(this, cx + bw / 2 + 8 * f, btnY, bw, btnH, 'Retry this board', () => this.scene.restart({ size: this.size, difficulty: this.difficulty, seed: this.seed, retry: true, zen: this.zen }), { fontSize: Math.round(19 * f) });
    const b3 = makeButton(this, cx, btnY + btnH / 2 + 14 * f + menuH / 2, 280 * f, menuH, 'Menu', () => this.scene.start('menu', this.menuData()), { fontSize: Math.round(18 * f) });
    [b1, b2, b3].forEach((b) => b.root.setDepth(102));
  }

  private menuData(): { size: number; difficulty: number } {
    return { size: this.size, difficulty: this.difficulty };
  }

  /** Leave to the menu. A live, unfinished board is PAUSED and the menu opens
   *  over it (so Continue can resume it); a finished board is shut down (the
   *  menu then only offers a fresh game). */
  private toMenu(): void {
    if (this.gameOver) {
      this.scene.start('menu', this.menuData());
    } else {
      this.hoverEnd();
      this.exitClueFocus();
      this.hideClueTypeIndicator();
      this.hideTooltip();
      this.scene.pause();
      this.scene.launch('menu', this.menuData());
      this.scene.bringToTop('menu'); // scenes render in config order, not launch order
    }
  }
}
