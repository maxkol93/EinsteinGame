import Phaser from 'phaser';
import { COLORS, GAME, FONT, palette, brighten } from '../config';
import { makeButton } from './button';
import { roundedTex, strokedRoundedTex } from './textures';
import { stats, modeKey } from '../model/stats';
import { ACHIEVEMENTS } from '../model/achievements';

const MILESTONES = [5, 10, 20, 50, 100];
const DIFFS: Array<[string, number]> = [['Easy', 0], ['Normal', 1], ['Hard', 2]];
const SIZES = [4, 5, 6];

function fmtTime(s: number | null): string {
  if (!s) return '--:--';
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
}

/**
 * The progress screen (port of pygame AchievementsOverlay): three seeded rows
 * (daily/weekly/monthly) + nine difficulty×size rows, each with best time,
 * wins and five milestone stars (5/10/20/50/100 wins), then the badge list.
 * Added to the scene; the Back button tears it all down.
 */
export function openStatsOverlay(scene: Phaser.Scene): void {
  const cx = GAME.width / 2;
  const cy = GAME.height / 2;
  const pw = 660;
  const rowH = 26;
  const depth = 120;
  const objs: Phaser.GameObjects.GameObject[] = [];
  const add = <T extends Phaser.GameObjects.GameObject>(o: T): T => { objs.push(o); return o; };

  const seededRows = 3;
  const modeRows = DIFFS.length * SIZES.length;
  const badgeRows = Math.ceil(ACHIEVEMENTS.length / 2);
  const ph = 90 + (seededRows + 1) * rowH + 8 + modeRows * rowH + 30 + badgeRows * 24 + 70;
  const top = cy - ph / 2;
  const left = cx - pw / 2;
  const pad = 30;

  add(scene.add.rectangle(cx, cy, GAME.width, GAME.height, 0x000000, 0.66).setDepth(depth).setInteractive());
  add(scene.add.image(cx, cy, roundedTex(scene, pw, ph, 20)).setTint(COLORS.panel).setDepth(depth + 1));
  add(scene.add.image(cx, cy, strokedRoundedTex(scene, pw, ph, 20, 2)).setTint(brighten(COLORS.panel, 36)).setDepth(depth + 1));
  add(scene.add.text(cx, top + 34, 'P R O G R E S S', { fontFamily: FONT, fontStyle: 'bold', fontSize: '26px', color: palette.text }).setOrigin(0.5).setLetterSpacing(3).setDepth(depth + 2));

  const tx = left + pad;
  const tw = pw - pad * 2;
  const nameW = 150;
  const bestW = 78;
  const winsW = 54;
  const starSize = 22;
  const starGap = 12;
  const starsTotal = MILESTONES.length * (starSize + starGap) - starGap;
  const starsX = tx + tw - starsTotal;

  const headerRow = (y: number, label: string): void => {
    add(scene.add.text(tx, y, label, { fontFamily: FONT, fontStyle: 'bold', fontSize: '12px', color: palette.accent }).setOrigin(0, 0.5).setDepth(depth + 2).setLetterSpacing(1));
  };
  const dataRow = (y: number, name: string, best: number | null, wins: number, withStars: boolean): void => {
    add(scene.add.text(tx, y, name, { fontFamily: FONT, fontSize: '15px', color: palette.text }).setOrigin(0, 0.5).setDepth(depth + 2));
    add(scene.add.text(tx + nameW, y, fmtTime(best), { fontFamily: FONT, fontSize: '15px', color: palette.text }).setOrigin(0, 0.5).setDepth(depth + 2));
    add(scene.add.text(tx + nameW + bestW, y, String(wins), { fontFamily: FONT, fontSize: '15px', color: palette.accent }).setOrigin(0, 0.5).setDepth(depth + 2));
    if (withStars) {
      MILESTONES.forEach((m, i) => {
        const got = wins >= m;
        add(scene.add.text(starsX + i * (starSize + starGap) + starSize / 2, y, got ? '★' : '☆', { fontFamily: FONT, fontSize: '17px', color: got ? '#ffd678' : '#534d53' }).setOrigin(0.5).setDepth(depth + 2));
      });
    } else {
      add(scene.add.text(tx + tw, y, `streak ${stats.seeded(name.toLowerCase() as 'daily').streak ?? 0}`, { fontFamily: FONT, fontSize: '13px', color: palette.accent }).setOrigin(1, 0.5).setDepth(depth + 2));
    }
  };

  let y = top + 74;
  headerRow(y, 'CHALLENGE                 BEST     WINS');
  y += rowH;
  for (const kind of ['daily', 'weekly', 'monthly'] as const) {
    const b = stats.seeded(kind);
    dataRow(y, kind[0].toUpperCase() + kind.slice(1), b.best_time, b.count, false);
    y += rowH;
  }
  y += 8;
  const summary = stats.summary();
  for (const [dname, d] of DIFFS) {
    for (const sz of SIZES) {
      const m = summary.modes[modeKey(d, sz)];
      dataRow(y, `${dname} ${sz}×${sz}`, m?.best ?? null, m?.levels ?? 0, true);
      y += rowH;
    }
  }

  y += 14;
  add(scene.add.text(cx, y, 'ACHIEVEMENTS', { fontFamily: FONT, fontStyle: 'bold', fontSize: '12px', color: palette.accent }).setOrigin(0.5).setDepth(depth + 2).setLetterSpacing(1));
  y += 24;
  const earned = new Set(stats.achievements);
  const colW = tw / 2;
  ACHIEVEMENTS.forEach((a, i) => {
    const col = i % 2;
    const row = Math.floor(i / 2);
    const ay = y + row * 24;
    const got = earned.has(a.id);
    add(scene.add.text(tx + col * colW, ay, `${got ? '★' : '☆'}  ${got ? a.name : '???'}`, { fontFamily: FONT, fontSize: '14px', color: got ? palette.text : '#6b656b' }).setOrigin(0, 0.5).setDepth(depth + 2));
  });

  const back = makeButton(scene, cx, top + ph - 38, 240, 46, 'Back', () => objs.forEach((o) => o.destroy()), { fontSize: 18, fill: COLORS.accent, textColor: '#1c1a1e' });
  back.root.setDepth(depth + 3);
  objs.push(back.root);
}
