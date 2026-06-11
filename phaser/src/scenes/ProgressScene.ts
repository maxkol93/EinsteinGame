import Phaser from 'phaser';
import { COLORS, GAME, FONT, palette, applyRenderScale } from '../config';
import { makeButton } from '../ui/button';
import { stats, SIZES } from '../model/stats';

const DIFFS = ['Easy', 'Normal', 'Hard'];
const DIFF_COLORS = [0x89b4fa, 0xa6e3a1, 0xf38ba8];
const STAR_AT = [5, 10, 20, 50, 100];

function starsFor(wins: number): number {
  return STAR_AT.filter((m) => wins >= m).length;
}

export class ProgressScene extends Phaser.Scene {
  constructor() {
    super('progress');
  }

  create(): void {
    applyRenderScale(this);
    this.cameras.main.setBackgroundColor(COLORS.bg);

    const cx = GAME.width / 2;

    this.add.text(cx, 46, 'PROGRESS', {
      fontFamily: FONT, fontStyle: 'bold', fontSize: '36px', color: palette.text,
    }).setOrigin(0.5);

    const tableTop = 90;
    const tableH = this.buildTable(tableTop);
    this.buildAchievements(tableTop + tableH + 24);

    makeButton(this, 80, 42, 120, 46, '← Back', () => this.scene.start('menu'), { fontSize: 16 });
  }

  private buildTable(y0: number): number {
    const tableW = GAME.width - 80;
    const ox = 40;
    const rowH = 38;
    const labelW = 200;
    const winsW = 80;
    const starColW = Math.floor((tableW - labelW - winsW) / STAR_AT.length);

    // Header
    const headerY = y0 + 18;
    this.add.text(ox + labelW / 2, headerY, 'Mode', {
      fontFamily: FONT, fontStyle: 'bold', fontSize: '15px', color: palette.accent,
    }).setOrigin(0.5);
    this.add.text(ox + labelW + winsW / 2, headerY, 'Wins', {
      fontFamily: FONT, fontStyle: 'bold', fontSize: '15px', color: palette.accent,
    }).setOrigin(0.5);
    STAR_AT.forEach((m: number, i: number) => {
      const sx = ox + labelW + winsW + i * starColW + starColW / 2;
      this.add.text(sx, headerY, `${m}★`, {
        fontFamily: FONT, fontSize: '13px', color: palette.accent,
      }).setOrigin(0.5);
    });

    const hdrDivY = y0 + 34;
    const hdg = this.add.graphics();
    hdg.lineStyle(1, 0xffffff, 0.14);
    hdg.lineBetween(ox, hdrDivY, ox + tableW, hdrDivY);

    let rowIdx = 0;
    for (const diff of [0, 1, 2]) {
      for (const size of SIZES) {
        const ry = hdrDivY + 8 + rowIdx * rowH + rowH / 2;
        const wins = stats.winsFor(diff, size);

        if (rowIdx % 2 === 0) {
          const rbg = this.add.graphics();
          rbg.fillStyle(0xffffff, 0.03);
          rbg.fillRect(ox, hdrDivY + 8 + rowIdx * rowH, tableW, rowH - 2);
        }

        const swatchX = ox + 10;
        const sg = this.add.graphics();
        sg.fillStyle(DIFF_COLORS[diff], 1);
        sg.fillRoundedRect(swatchX, ry - 9, 8, 18, 3);

        this.add.text(swatchX + 18, ry, `${DIFFS[diff]} ${size}×${size}`, {
          fontFamily: FONT, fontSize: '17px', color: palette.text,
        }).setOrigin(0, 0.5);

        this.add.text(ox + labelW + winsW / 2, ry, String(wins), {
          fontFamily: FONT, fontStyle: 'bold', fontSize: '18px',
          color: wins > 0 ? palette.text : '#555',
        }).setOrigin(0.5);

        STAR_AT.forEach((m: number, i: number) => {
          const sx = ox + labelW + winsW + i * starColW + starColW / 2;
          this.add.text(sx, ry, '★', {
            fontFamily: FONT, fontSize: '20px',
            color: wins >= m ? '#ffe27a' : '#383838',
          }).setOrigin(0.5);
        });

        rowIdx++;
      }

      if (diff < 2) {
        const dg = this.add.graphics();
        dg.lineStyle(1, 0xffffff, 0.09);
        dg.lineBetween(ox, hdrDivY + 8 + rowIdx * rowH - 4, ox + tableW, hdrDivY + 8 + rowIdx * rowH - 4);
      }
    }

    const totalH = 42 + rowIdx * rowH + 8;
    const tbg = this.add.graphics();
    tbg.lineStyle(1, 0xffffff, 0.1);
    tbg.strokeRoundedRect(ox, y0, tableW, totalH, 10);
    return totalH;
  }

  private buildAchievements(y0: number): void {
    if (y0 + 80 > GAME.height - 72) return;
    const ox = 40;
    const tableW = GAME.width - 80;

    this.add.text(ox + tableW / 2, y0 + 20, 'ACHIEVEMENTS', {
      fontFamily: FONT, fontStyle: 'bold', fontSize: '18px', color: palette.accent,
    }).setOrigin(0.5);

    const earned = new Set(stats.achievements);
    const ACH: Array<{ id: string; label: string; desc: string }> = [
      { id: 'first_win', label: 'First Win', desc: 'Complete your first puzzle' },
      { id: 'trilogy', label: 'Trilogy', desc: 'Win 3 puzzles in a row' },
      { id: 'hard_boiled', label: 'Hard Boiled', desc: 'Win a Hard 6×6 puzzle' },
      { id: 'quicksilver', label: 'Quicksilver', desc: 'Beat par time on any board' },
      { id: 'century', label: 'Century', desc: 'Win 100 games in total' },
    ];

    const cols = 3;
    const itemW = Math.floor(tableW / cols);
    const itemH = 56;
    ACH.forEach((a, i) => {
      const col = i % cols;
      const row = Math.floor(i / cols);
      const ax = ox + col * itemW + itemW / 2;
      const ay = y0 + 46 + row * itemH + itemH / 2;
      const have = earned.has(a.id);

      const ig = this.add.graphics();
      ig.fillStyle(have ? 0xffe27a : 0x313244, 1);
      ig.fillCircle(ax - itemW / 2 + 22, ay, 12);
      this.add.text(ax - itemW / 2 + 22, ay, have ? '★' : '·', {
        fontFamily: FONT, fontSize: have ? '14px' : '22px',
        color: have ? '#1e1e2e' : '#555',
      }).setOrigin(0.5);

      this.add.text(ax - itemW / 2 + 40, ay - 8, a.label, {
        fontFamily: FONT, fontStyle: 'bold', fontSize: '15px',
        color: have ? '#ffe27a' : palette.text,
      }).setOrigin(0, 0.5);
      this.add.text(ax - itemW / 2 + 40, ay + 10, a.desc, {
        fontFamily: FONT, fontSize: '12px', color: palette.accent,
      }).setOrigin(0, 0.5);
    });
  }
}
