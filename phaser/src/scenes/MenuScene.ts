import Phaser from 'phaser';
import { COLORS, GAME, FONT, palette, applyRenderScale } from '../config';
import { makeButton, BtnHandle } from '../ui/button';
import { audio } from '../audio/sound';
import { stats } from '../model/stats';
import { settings } from '../model/settings';
import { sizeLocks, diffLocks, sizeUnlocked } from '../model/progression';
import { ACHIEVEMENTS, achievementInfo } from '../model/achievements';
import { TutorialDirector } from '../model/tutorial';

const SIZES = [4, 5, 6];
const DIFFS = ['Easy', 'Normal', 'Hard'];

const SIZE_LOCK_MSG = 'Win 3 puzzles in the previous board size to unlock this.';
const DIFF_LOCK_MSG = 'Win 3 puzzles in every size of the previous difficulty to unlock this.';

export class MenuScene extends Phaser.Scene {
  private size = 4;
  private difficulty = 0;
  private sizeBtns: BtnHandle[] = [];
  private diffBtns: BtnHandle[] = [];
  private sizeLockMarks: Phaser.GameObjects.Text[] = [];
  private diffLockMarks: Phaser.GameObjects.Text[] = [];
  private notice?: Phaser.GameObjects.Text;
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
    const cx = GAME.width / 2;

    audio.startMusic();
    this.buildAudioToggles();
    this.buildZenToggle();
    this.buildTutorialButton();

    // U toggles the debug unlock-all (mirrors pressing U in the pygame build).
    this.input.keyboard?.on('keydown-U', () => {
      settings.unlockAll = !settings.unlockAll;
      this.showNotice(settings.unlockAll ? 'Debug: everything unlocked' : 'Debug: progression locks on');
      this.refreshLocks();
    });

    this.add
      .text(cx, 88, 'EINSTEIN', { fontFamily: FONT, fontStyle: 'bold', fontSize: '76px', color: palette.text })
      .setOrigin(0.5)
      .setLetterSpacing(16);
    this.add
      .text(cx, 146, 'a logic-grid deduction puzzle', { fontFamily: FONT, fontSize: '20px', color: palette.accent })
      .setOrigin(0.5);

    Object.values(COLORS.rows).forEach((color, i, arr) => {
      this.add.circle(cx - ((arr.length - 1) * 26) / 2 + i * 26, 184, 6, color);
    });

    this.add.text(cx, 234, 'BOARD SIZE', { fontFamily: FONT, fontSize: '16px', color: palette.accent }).setOrigin(0.5);
    this.sizeBtns = SIZES.map((s, i) => {
      const w = 150;
      const x = cx - (SIZES.length - 1) * (w + 16) * 0.5 + i * (w + 16);
      const b = makeButton(this, x, 278, w, 54, `${s}×${s}`, () => this.selectSize(s), { selected: s === this.size });
      const lock = this.add.text(x + w / 2 - 18, 278, '🔒', { fontSize: '18px' }).setOrigin(0.5).setVisible(false);
      lock.setDepth(b.root.depth + 1);
      this.sizeLockMarks.push(lock);
      return b;
    });

    this.add.text(cx, 348, 'DIFFICULTY', { fontFamily: FONT, fontSize: '16px', color: palette.accent }).setOrigin(0.5);
    this.diffBtns = DIFFS.map((d, i) => {
      const w = 150;
      const x = cx - (DIFFS.length - 1) * (w + 16) * 0.5 + i * (w + 16);
      const b = makeButton(this, x, 392, w, 54, d, () => this.selectDiff(i), { selected: i === this.difficulty });
      const lock = this.add.text(x + w / 2 - 18, 392, '🔒', { fontSize: '18px' }).setOrigin(0.5).setVisible(false);
      lock.setDepth(b.root.depth + 1);
      this.diffLockMarks.push(lock);
      return b;
    });

    makeButton(this, cx, 480, 260, 66, 'PLAY', () => this.play(), {
      fontSize: 28, fill: COLORS.rows['4'], textColor: '#ffffff',
    });

    this.add
      .text(
        cx, 566,
        'Tap a tile to remove a wrong value · right-click or long-press to lock it in.\n' +
          'Each row is one colour — read the glyph to tell values apart.',
        { fontFamily: FONT, fontSize: '16px', color: palette.accent, align: 'center', lineSpacing: 6 },
      )
      .setOrigin(0.5);

    this.buildProgress(cx);
    this.refreshLocks();
  }

  // ---------------------- progression UI ----------------------

  private buildProgress(cx: number): void {
    const earned = new Set(stats.achievements);
    this.add
      .text(cx, 626,
        `Wins ${stats.totalWins}    ·    Best streak ${stats.bestStreak}    ·    Badges ${earned.size}/${ACHIEVEMENTS.length}`,
        { fontFamily: FONT, fontStyle: 'bold', fontSize: '17px', color: palette.text })
      .setOrigin(0.5);

    // a row of badge stars: gold if earned, dim if not; hover shows name + desc.
    const gap = 46;
    const startX = cx - ((ACHIEVEMENTS.length - 1) * gap) / 2;
    ACHIEVEMENTS.forEach((a, i) => {
      const got = earned.has(a.id);
      const star = this.add
        .text(startX + i * gap, 672, got ? '★' : '☆', {
          fontFamily: FONT, fontSize: '28px', color: got ? '#ffd678' : '#5b545b',
        })
        .setOrigin(0.5)
        .setInteractive({ useHandCursor: true });
      star.on('pointerover', () => {
        const info = achievementInfo(a.id);
        this.showBadgeTip(star.x, `${got ? info.name : '???'} — ${got ? info.desc : 'locked'}`);
      });
      star.on('pointerout', () => this.hideBadgeTip());
    });
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
    });
    this.diffBtns.forEach((b, i) => {
      this.diffLockMarks[i].setVisible(dl[i]);
      b.root.setAlpha(dl[i] ? 0.45 : 1);
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
    this.scene.start('game', { size: this.size, difficulty: this.difficulty, zen: settings.zen });
  }

  /** Zen toggle (top-left, mirroring the audio toggles): a calm, no-lives
   *  solve. The state persists; PLAY then launches the board in Zen mode. */
  private buildZenToggle(): void {
    const w = 156;
    const x = w / 2 + 24;
    let zen: BtnHandle;
    zen = makeButton(this, x, 40, w, 40, this.zenLabel(), () => {
      settings.zen = !settings.zen;
      zen.setSelected(settings.zen);
      zen.setText(this.zenLabel());
      this.showNotice(settings.zen ? 'Zen on — no lives, just solve' : 'Zen off');
    }, { fontSize: 15, selected: settings.zen });
  }

  private zenLabel(): string {
    return settings.zen ? '☯  ZEN ON' : '☯  ZEN OFF';
  }

  /** Top-left tutorial button (under the Zen toggle): replays the onboarding,
   *  or resumes it if the player left part-way through. */
  private buildTutorialButton(): void {
    const w = 156;
    const x = w / 2 + 24;
    const label = settings.tutorialDone ? '↺  TUTORIAL' : '▶  TUTORIAL';
    makeButton(this, x, 88, w, 40, label, () => {
      const d = new TutorialDirector(settings.tutorialBlocks);
      if (settings.tutorialDone) d.restartAll(); // a full replay from block 0
      this.registry.set('tutorialDirector', d);
      this.scene.start('tutorial');
    }, { fontSize: 15 });
  }

  private showNotice(msg: string): void {
    this.notice?.destroy();
    this.notice = this.add
      .text(GAME.width / 2, 524, msg, { fontFamily: FONT, fontSize: '15px', color: '#e0b070', align: 'center' })
      .setOrigin(0.5)
      .setDepth(40);
    const n = this.notice;
    this.tweens.add({ targets: n, alpha: 0, delay: 2200, duration: 600, onComplete: () => n.destroy() });
  }

  // ---------------------- audio toggles ----------------------

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
}
