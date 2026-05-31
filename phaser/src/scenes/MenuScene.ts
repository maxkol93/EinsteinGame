import Phaser from 'phaser';
import { COLORS, GAME, FONT, palette } from '../config';
import { makeButton, BtnHandle } from '../ui/button';
import { audio } from '../audio/sound';

const SIZES = [4, 5, 6];
const DIFFS = ['Easy', 'Normal', 'Hard'];

export class MenuScene extends Phaser.Scene {
  private size = 4;
  private difficulty = 0;
  private sizeBtns: BtnHandle[] = [];
  private diffBtns: BtnHandle[] = [];

  constructor() {
    super('menu');
  }

  init(data: { size?: number; difficulty?: number }): void {
    if (data?.size) this.size = data.size;
    if (data?.difficulty != null) this.difficulty = data.difficulty;
  }

  create(): void {
    this.cameras.main.setBackgroundColor(COLORS.bg);
    const cx = GAME.width / 2;

    audio.startMusic();
    this.buildAudioToggles();

    this.add
      .text(cx, 96, 'EINSTEIN', { fontFamily: FONT, fontStyle: 'bold', fontSize: '76px', color: palette.text })
      .setOrigin(0.5)
      .setLetterSpacing(16);
    this.add
      .text(cx, 154, 'a logic-grid deduction puzzle', { fontFamily: FONT, fontSize: '20px', color: palette.accent })
      .setOrigin(0.5);

    Object.values(COLORS.rows).forEach((color, i, arr) => {
      this.add.circle(cx - ((arr.length - 1) * 26) / 2 + i * 26, 194, 6, color);
    });

    this.add.text(cx, 252, 'BOARD SIZE', { fontFamily: FONT, fontSize: '16px', color: palette.accent }).setOrigin(0.5);
    this.sizeBtns = SIZES.map((s, i) => {
      const w = 150;
      const x = cx - (SIZES.length - 1) * (w + 16) * 0.5 + i * (w + 16);
      return makeButton(this, x, 298, w, 54, `${s}×${s}`, () => this.selectSize(s), { selected: s === this.size });
    });

    this.add.text(cx, 370, 'DIFFICULTY', { fontFamily: FONT, fontSize: '16px', color: palette.accent }).setOrigin(0.5);
    this.diffBtns = DIFFS.map((d, i) => {
      const w = 150;
      const x = cx - (DIFFS.length - 1) * (w + 16) * 0.5 + i * (w + 16);
      return makeButton(this, x, 416, w, 54, d, () => this.selectDiff(i), { selected: i === this.difficulty });
    });

    makeButton(this, cx, 512, 260, 66, 'PLAY', () => this.play(), {
      fontSize: 28, fill: COLORS.rows['4'], textColor: '#ffffff',
    });

    this.add
      .text(
        cx, 614,
        'Tap a tile to remove a wrong value.\n' +
          'Right-click or long-press a tile to lock it in as the answer.\n' +
          'Each row is one colour — read the glyph to tell values apart.',
        { fontFamily: FONT, fontSize: '17px', color: palette.accent, align: 'center', lineSpacing: 7 },
      )
      .setOrigin(0.5);
  }

  /** Two toggles in the top-right corner: SFX and music on/off (persisted). */
  private buildAudioToggles(): void {
    const w = 132;
    const x = GAME.width - w / 2 - 24;
    let sfx: BtnHandle;
    let music: BtnHandle;
    sfx = makeButton(this, x, 40, w, 40, this.sfxLabel(), () => {
      audio.setSfxEnabled(!audio.sfxEnabled);
      sfx.setSelected(audio.sfxEnabled);
      sfx.setText(this.sfxLabel());
    }, { fontSize: 15, selected: audio.sfxEnabled });
    music = makeButton(this, x, 88, w, 40, this.musicLabel(), () => {
      audio.setMusicEnabled(!audio.musicEnabled);
      music.setSelected(audio.musicEnabled);
      music.setText(this.musicLabel());
    }, { fontSize: 15, selected: audio.musicEnabled });
  }

  private sfxLabel(): string {
    return audio.sfxEnabled ? '♪  SFX ON' : '·  SFX OFF';
  }

  private musicLabel(): string {
    return audio.musicEnabled ? '♫  MUSIC ON' : '·  MUSIC OFF';
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
