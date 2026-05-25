import Phaser from 'phaser';
import { COLORS, GAME, palette } from '../config';
import { makeButton, UIButton } from '../ui/button';

const SIZES = [4, 5, 6];
const DIFFS = ['Easy', 'Normal', 'Hard'];

export class MenuScene extends Phaser.Scene {
  private size = 4;
  private difficulty = 0;
  private sizeBtns: UIButton[] = [];
  private diffBtns: UIButton[] = [];

  constructor() {
    super('menu');
  }

  init(data: { size?: number; difficulty?: number }): void {
    if (data?.size) this.size = data.size;
    if (data?.difficulty != null) this.difficulty = data.difficulty;
  }

  create(): void {
    const cx = GAME.width / 2;

    this.add
      .text(cx, 96, 'EINSTEIN', {
        fontFamily: 'Arial, sans-serif',
        fontStyle: 'bold',
        fontSize: '72px',
        color: palette.text,
      })
      .setOrigin(0.5)
      .setLetterSpacing(16);

    this.add
      .text(cx, 150, 'a logic-grid deduction puzzle', {
        fontFamily: 'Arial, sans-serif',
        fontSize: '20px',
        color: palette.accent,
      })
      .setOrigin(0.5);

    // colour dots, echoing the loader brand
    Object.values(COLORS.rows).forEach((color, i, arr) => {
      this.add.circle(cx - ((arr.length - 1) * 26) / 2 + i * 26, 188, 6, color);
    });

    // board size
    this.add
      .text(cx, 250, 'BOARD SIZE', { fontFamily: 'Arial', fontSize: '16px', color: palette.accent })
      .setOrigin(0.5);
    this.sizeBtns = SIZES.map((s, i) => {
      const w = 150;
      const x = cx - (SIZES.length - 1) * (w + 16) * 0.5 + i * (w + 16);
      return makeButton(this, x, 296, w, 54, `${s}×${s}`, () => this.selectSize(s), {
        selected: s === this.size,
      });
    });

    // difficulty
    this.add
      .text(cx, 366, 'DIFFICULTY', { fontFamily: 'Arial', fontSize: '16px', color: palette.accent })
      .setOrigin(0.5);
    this.diffBtns = DIFFS.map((d, i) => {
      const w = 150;
      const x = cx - (DIFFS.length - 1) * (w + 16) * 0.5 + i * (w + 16);
      return makeButton(this, x, 412, w, 54, d, () => this.selectDiff(i), {
        selected: i === this.difficulty,
      });
    });

    // play
    makeButton(this, cx, 506, 260, 64, 'PLAY', () => this.play(), {
      fontSize: 28,
      fill: COLORS.rows['4'],
      textColor: '#1c1819',
    });

    this.add
      .text(
        cx,
        604,
        'Tap a tile to remove a wrong value.\nRight-click or long-press a tile to lock it in as the answer.\nEach row is one colour — read the glyph to tell values apart.',
        {
          fontFamily: 'Arial',
          fontSize: '17px',
          color: palette.accent,
          align: 'center',
          lineSpacing: 6,
        },
      )
      .setOrigin(0.5);
  }

  private selectSize(s: number): void {
    this.size = s;
    this.sizeBtns.forEach((b, i) => b.setSelected(SIZES[i] === s));
  }

  private selectDiff(i: number): void {
    this.difficulty = i;
    this.diffBtns.forEach((b, j) => b.setSelected(j === i));
  }

  private play(): void {
    this.scene.start('game', { size: this.size, difficulty: this.difficulty });
  }
}
