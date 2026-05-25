import Phaser from 'phaser';
import { COLORS, GAME, palette } from '../config';

// Board is SIZE×SIZE; each cell starts with SIZE candidate values.
const SIZE = 4;

/**
 * Placeholder board — proves out grid layout, the Mocha palette and pointer
 * input. This is NOT the real puzzle yet: the actual candidate/clue model,
 * the cascade resolution, and the seeded daily generator all need porting from
 * the pygame `model/` tree. See ../../README.md and ../../../CLAUDE.md.
 */
export class GameScene extends Phaser.Scene {
  constructor() {
    super('game');
  }

  create(): void {
    this.add
      .text(GAME.width / 2, 56, 'EINSTEIN', {
        fontFamily: 'Arial, sans-serif',
        fontStyle: 'bold',
        fontSize: '52px',
        color: palette.text,
      })
      .setOrigin(0.5)
      .setLetterSpacing(13);

    this.add
      .text(GAME.width / 2, 104, 'Phaser port — scaffold', {
        fontFamily: 'Arial, sans-serif',
        fontSize: '18px',
        color: palette.accent,
      })
      .setOrigin(0.5);

    this.buildBoard();
  }

  private buildBoard(): void {
    const span = Math.min(GAME.width, GAME.height) - 160;
    const cell = span / SIZE;
    const x0 = (GAME.width - span) / 2;
    const y0 = (GAME.height - span) / 2 + 30;
    const pad = cell * 0.08;

    for (let r = 0; r < SIZE; r++) {
      for (let c = 0; c < SIZE; c++) {
        const cx = x0 + c * cell;
        const cy = y0 + r * cell;
        this.add
          .rectangle(cx, cy, cell - 4, cell - 4, COLORS.panel)
          .setOrigin(0)
          .setStrokeStyle(2, COLORS.accent, 0.25);
        this.buildCandidates(cx + pad, cy + pad, cell - 2 * pad);
      }
    }
  }

  /** A cell's candidate sub-grid: one colored square per possible value. */
  private buildCandidates(x: number, y: number, size: number): void {
    const cols = Math.ceil(Math.sqrt(SIZE));
    const sub = size / cols;
    const gap = sub * 0.16;
    for (let v = 0; v < SIZE; v++) {
      const sc = v % cols;
      const sr = Math.floor(v / cols);
      const color = COLORS.rows[String(v + 1)] ?? COLORS.accent;
      const sq = this.add
        .rectangle(x + sc * sub, y + sr * sub, sub - gap, sub - gap, color)
        .setOrigin(0)
        .setInteractive({ useHandCursor: true });
      // "pop" a candidate — placeholder for the real elimination logic.
      sq.on('pointerdown', () => sq.setVisible(false));
    }
  }
}
