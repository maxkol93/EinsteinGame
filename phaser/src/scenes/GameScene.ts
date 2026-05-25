import Phaser from 'phaser';
import { COLORS, GAME, palette } from '../config';
import { generatePuzzle, FieldAndRules, COMPLEXITY } from '../model/fieldAndRules';
import { PuzzleBoard, ChangeSet } from '../model/board';
import { symbolFor, ruleSegments } from '../model/decoder';
import { Rule } from '../model/types';
import { makeButton } from '../ui/button';

const MAX_LIVES = 3;
const STEP_MS = 90; // delay per cascade step
const DIFF_LABEL = ['EASY', 'NORMAL', 'HARD'];

interface PressInfo {
  y: number;
  x: number;
  n: number;
  fired: boolean;
}

export class GameScene extends Phaser.Scene {
  private size = 4;
  private difficulty = 0;
  private seed = 0;

  private model!: FieldAndRules;
  private board!: PuzzleBoard;

  // rendering
  private boardX0 = 0;
  private boardY0 = 0;
  private cellSide = 0;
  private chips: Array<Array<Map<number, Phaser.GameObjects.Container>>> = [];
  private cellBg: Phaser.GameObjects.Rectangle[][] = [];
  private bigText: Array<Array<Phaser.GameObjects.Text | null>> = [];

  // hud
  private timerText!: Phaser.GameObjects.Text;
  private hearts: Phaser.GameObjects.Text[] = [];
  private lives = MAX_LIVES;
  private mistakes = 0;
  private seconds = 0;
  private timerEvent?: Phaser.Time.TimerEvent;

  // state
  private busy = false;
  private gameOver = false;
  private press: PressInfo | null = null;
  private longPress?: Phaser.Time.TimerEvent;

  constructor() {
    super('game');
  }

  init(data: { size?: number; difficulty?: number; seed?: number }): void {
    this.size = data?.size ?? 4;
    this.difficulty = data?.difficulty ?? 0;
    this.seed = data?.seed ?? 0;
    // reset per-run state (scene.restart reuses the instance)
    this.lives = MAX_LIVES;
    this.mistakes = 0;
    this.seconds = 0;
    this.busy = false;
    this.gameOver = false;
    this.press = null;
    this.hearts = [];
  }

  create(): void {
    this.input.mouse?.disableContextMenu();
    this.cameras.main.setBackgroundColor(COLORS.bg);

    try {
      const gen = generatePuzzle(this.size, this.difficulty, this.seed || undefined);
      this.model = gen.model;
      this.seed = gen.seed;
    } catch (e) {
      this.add.text(GAME.width / 2, GAME.height / 2, 'Failed to generate a board.\nTap to return to menu.', {
        fontFamily: 'Arial', fontSize: '24px', color: palette.text, align: 'center',
      }).setOrigin(0.5);
      this.input.once('pointerdown', () => this.scene.start('menu', this.menuData()));
      return;
    }

    this.board = new PuzzleBoard(this.size, this.model.solution, this.model.definedStartCells);

    this.buildTopBar();
    this.buildBoard();
    this.buildClues();
    this.bindInput();
    this.startTimer();

    if (this.board.isWon) this.time.delayedCall(200, () => this.finish(true));
  }

  // --------------------------- HUD ---------------------------

  private buildTopBar(): void {
    makeButton(this, 80, 34, 120, 44, '☰ Menu', () => this.scene.start('menu', this.menuData()), {
      fontSize: 18,
    });

    this.timerText = this.add
      .text(GAME.width / 2, 34, '00:00', {
        fontFamily: 'Arial', fontStyle: 'bold', fontSize: '30px', color: palette.text,
      })
      .setOrigin(0.5);

    const cplx = COMPLEXITY[this.size][this.difficulty];
    this.add
      .text(GAME.width / 2, 62, `${DIFF_LABEL[this.difficulty]} · ${this.size}×${this.size} · ${cplx} given`, {
        fontFamily: 'Arial', fontSize: '14px', color: palette.accent,
      })
      .setOrigin(0.5);

    // hearts on the right
    for (let i = 0; i < MAX_LIVES; i++) {
      const h = this.add
        .text(GAME.width - 40 - (MAX_LIVES - 1 - i) * 36, 34, '♥', {
          fontFamily: 'Arial', fontSize: '30px', color: '#e05a68',
        })
        .setOrigin(0.5);
      this.hearts.push(h);
    }
    this.updateLives();
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
      delay: 1000,
      loop: true,
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

  private buildBoard(): void {
    const regionW = 660;
    const regionH = GAME.height - 110;
    const span = Math.min(regionW, regionH);
    this.cellSide = span / this.size;
    this.boardX0 = 30 + (regionW - span) / 2;
    this.boardY0 = 92 + (regionH - span) / 2;

    this.chips = [];
    this.cellBg = [];
    this.bigText = [];
    for (let y = 0; y < this.size; y++) {
      this.chips.push([]);
      this.cellBg.push([]);
      this.bigText.push([]);
      for (let x = 0; x < this.size; x++) {
        const { cx, cy } = this.cellCenter(y, x);
        const bg = this.add
          .rectangle(cx, cy, this.cellSide - 6, this.cellSide - 6, COLORS.panel)
          .setStrokeStyle(2, COLORS.accent, 0.18);
        this.cellBg[y].push(bg);
        this.chips[y].push(new Map());
        this.bigText[y].push(null);

        const cell = this.board.cells[y][x];
        if (cell.value !== null) {
          this.renderBig(y, x, cell.value, false);
        } else {
          for (const v of cell.candidates) this.makeChip(y, x, v);
        }
      }
    }
  }

  private cellCenter(y: number, x: number): { cx: number; cy: number } {
    return {
      cx: this.boardX0 + x * this.cellSide + this.cellSide / 2,
      cy: this.boardY0 + y * this.cellSide + this.cellSide / 2,
    };
  }

  private makeChip(y: number, x: number, value: number): void {
    const cols = Math.ceil(Math.sqrt(this.size));
    const rows = Math.ceil(this.size / cols);
    const area = this.cellSide - this.cellSide * 0.16;
    const cw = area / cols;
    const ch = area / rows;
    const idx = (value % 10) - 1;
    const col = idx % cols;
    const row = Math.floor(idx / cols);
    const { cx, cy } = this.cellCenter(y, x);
    const ox = cx - area / 2 + cw / 2 + col * cw;
    const oy = cy - area / 2 + ch / 2 + row * ch;
    const color = COLORS.rows[String(Math.floor(value / 10))] ?? COLORS.accent;

    const bg = this.add.rectangle(0, 0, cw - cw * 0.16, ch - ch * 0.16, color, 0.92);
    const t = this.add
      .text(0, 0, symbolFor(value), {
        fontFamily: 'Arial', fontStyle: 'bold',
        fontSize: `${Math.min(cw, ch) * 0.5}px`, color: '#1c1819',
      })
      .setOrigin(0.5);
    const chip = this.add.container(ox, oy, [bg, t]);
    chip.setSize(cw, ch);
    chip.setInteractive(new Phaser.Geom.Rectangle(-cw / 2, -ch / 2, cw, ch), Phaser.Geom.Rectangle.Contains);
    (chip as unknown as { bg: Phaser.GameObjects.Rectangle }).bg = bg;
    chip.on('pointerover', () => bg.setScale(1.06));
    chip.on('pointerout', () => bg.setScale(1));
    chip.on('pointerdown', (pointer: Phaser.Input.Pointer) => this.onChipDown(y, x, value, pointer));

    this.chips[y][x].set(value, chip);
  }

  private renderBig(y: number, x: number, n: number, animate: boolean): void {
    const map = this.chips[y][x];
    for (const c of map.values()) c.destroy();
    map.clear();
    const color = COLORS.rows[String(Math.floor(n / 10))] ?? COLORS.accent;
    this.cellBg[y][x].setFillStyle(color, 1).setStrokeStyle(3, COLORS.accent, 0.55);
    const { cx, cy } = this.cellCenter(y, x);
    const t = this.add
      .text(cx, cy, symbolFor(n), {
        fontFamily: 'Arial', fontStyle: 'bold',
        fontSize: `${this.cellSide * 0.5}px`, color: '#1c1819',
      })
      .setOrigin(0.5);
    this.bigText[y][x] = t;
    if (animate) {
      t.setScale(0);
      this.tweens.add({ targets: t, scale: 1, duration: 230, ease: 'Back.easeOut' });
      this.tweens.add({ targets: this.cellBg[y][x], scaleX: 1.07, scaleY: 1.07, duration: 130, yoyo: true });
    }
  }

  // --------------------------- input ---------------------------

  private bindInput(): void {
    this.input.on('pointerup', () => {
      if (this.press && !this.press.fired) {
        const { y, x, n } = this.press;
        this.press.fired = true;
        this.doAction(y, x, n, false); // tap → pop
      }
      this.press = null;
      this.longPress?.remove();
      this.longPress = undefined;
    });
  }

  private onChipDown(y: number, x: number, n: number, pointer: Phaser.Input.Pointer): void {
    if (this.busy || this.gameOver) return;
    if (pointer.rightButtonDown()) {
      this.doAction(y, x, n, true); // right-click → define
      return;
    }
    this.press = { y, x, n, fired: false };
    this.longPress = this.time.delayedCall(350, () => {
      if (this.press && !this.press.fired) {
        this.press.fired = true;
        this.doAction(y, x, n, true); // long-press → define
      }
    });
  }

  private doAction(y: number, x: number, n: number, isDefine: boolean): void {
    if (this.busy || this.gameOver) return;
    const cell = this.board.cells[y][x];
    if (cell.value !== null || !cell.candidates.includes(n)) return;

    const correct = this.board.isAnswer(y, x, n);
    // popping the answer, or defining a non-answer, is the mistake
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
      this.tweens.add({
        targets: chip, scaleX: 0, scaleY: 0, alpha: 0,
        delay: s.step * STEP_MS, duration: 150, ease: 'Back.easeIn',
        onComplete: () => chip.destroy(),
      });
    }
    for (const r of cs.resolved) {
      this.time.delayedCall(r.step * STEP_MS + 60, () => this.renderBig(r.y, r.x, r.n, true));
    }

    if (cs.resolved.length > 0 || cs.struck.length > 1) {
      this.busy = true;
      this.time.delayedCall(maxStep * STEP_MS + 280, () => {
        this.busy = false;
        if (!this.gameOver && this.board.isWon) this.finish(true);
      });
    } else if (this.board.isWon) {
      this.finish(true);
    }
  }

  private registerWrong(y: number, x: number, n: number): void {
    this.mistakes += 1;
    const chip = this.chips[y][x].get(n);
    if (chip) {
      const bg = (chip as unknown as { bg: Phaser.GameObjects.Rectangle }).bg;
      this.tweens.add({ targets: chip, x: `+=5`, duration: 45, yoyo: true, repeat: 3 });
      if (bg) {
        const orig = bg.fillColor;
        bg.setFillStyle(0xe05a68, 1);
        this.time.delayedCall(320, () => bg.setFillStyle(orig, 0.92));
      }
    }
    this.cameras.main.shake(160, 0.006);
    this.lives -= 1;
    this.updateLives();
    if (this.lives <= 0) this.finish(false);
  }

  // --------------------------- clues ---------------------------

  private buildClues(): void {
    const x0 = 712;
    const width = GAME.width - x0 - 30;
    const y0 = 92;
    const height = GAME.height - y0 - 24;
    const rules = this.model.displayableRules;

    this.add.text(x0, y0, 'CLUES', {
      fontFamily: 'Arial', fontStyle: 'bold', fontSize: '20px', color: palette.text,
    });

    const top = y0 + 38;
    const rowH = Math.min(48, (height - 38) / Math.max(rules.length, 1));
    rules.forEach((rule, i) => this.renderClueLine(rule, x0, top + i * rowH, width, rowH));
  }

  private renderClueLine(rule: Rule, x0: number, y: number, width: number, rowH: number): void {
    const tile = Math.min(rowH * 0.74, 30);
    const fontSize = Math.min(rowH * 0.42, 18);
    const objs: Array<Phaser.GameObjects.Rectangle | Phaser.GameObjects.Text> = [];
    let cx = x0 + 4;
    const cy = y + rowH / 2;

    for (const seg of ruleSegments(rule)) {
      if (seg.kind === 'cell') {
        const color = COLORS.rows[String(Math.floor(seg.value / 10))] ?? COLORS.accent;
        const r = this.add.rectangle(cx + tile / 2, cy, tile, tile, color, 0.95).setStrokeStyle(1, COLORS.accent, 0.4);
        const g = this.add
          .text(cx + tile / 2, cy, symbolFor(seg.value), {
            fontFamily: 'Arial', fontStyle: 'bold', fontSize: `${tile * 0.56}px`, color: '#1c1819',
          })
          .setOrigin(0.5);
        objs.push(r, g);
        cx += tile + 6;
      } else {
        const t = this.add
          .text(cx, cy, seg.value, { fontFamily: 'Arial', fontSize: `${fontSize}px`, color: palette.accent })
          .setOrigin(0, 0.5);
        objs.push(t);
        cx += t.width + 8;
      }
    }

    // whole-line hit area to dim a clue you've used up
    const hit = this.add
      .rectangle(x0, y + 2, width, rowH - 4, 0xffffff, 0)
      .setOrigin(0, 0)
      .setInteractive({ useHandCursor: true });
    let dim = false;
    hit.on('pointerdown', () => {
      dim = !dim;
      objs.forEach((o) => o.setAlpha(dim ? 0.32 : 1));
    });
  }

  // --------------------------- end ---------------------------

  private finish(won: boolean): void {
    if (this.gameOver) return;
    this.gameOver = true;
    this.timerEvent?.remove();

    // created last, so they sit above the board by insertion order (no depth
    // juggling — bringing the panel to the top would bury the buttons)
    this.add.rectangle(GAME.width / 2, GAME.height / 2, GAME.width, GAME.height, 0x000000, 0.62);
    const panelW = 460;
    const panelH = 300;
    this.add
      .rectangle(GAME.width / 2, GAME.height / 2, panelW, panelH, COLORS.panel)
      .setStrokeStyle(2, COLORS.accent, 0.5);
    const cx = GAME.width / 2;
    const top = GAME.height / 2 - panelH / 2;

    this.add
      .text(cx, top + 52, won ? 'SOLVED!' : 'OUT OF LIVES', {
        fontFamily: 'Arial', fontStyle: 'bold', fontSize: '40px',
        color: won ? '#f5e7b0' : '#e05a68',
      })
      .setOrigin(0.5);
    this.add
      .text(cx, top + 104, won ? `Time ${this.fmt(this.seconds)}  ·  ${this.mistakes} mistakes` : 'Better luck next board', {
        fontFamily: 'Arial', fontSize: '20px', color: palette.accent,
      })
      .setOrigin(0.5);

    makeButton(this, cx - 120, top + 176, 220, 52, 'New board', () => this.scene.restart({ size: this.size, difficulty: this.difficulty }), {
      fontSize: 20, fill: COLORS.rows['4'], textColor: '#1c1819',
    });
    makeButton(this, cx + 120, top + 176, 220, 52, 'Retry this board', () => this.scene.restart({ size: this.size, difficulty: this.difficulty, seed: this.seed }), {
      fontSize: 20,
    });
    makeButton(this, cx, top + 240, 220, 48, 'Menu', () => this.scene.start('menu', this.menuData()), {
      fontSize: 18,
    });
  }

  private menuData(): { size: number; difficulty: number } {
    return { size: this.size, difficulty: this.difficulty };
  }
}
