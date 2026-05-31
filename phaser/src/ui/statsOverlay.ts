import Phaser from 'phaser';
import { COLORS, GAME, FONT, palette, brighten } from '../config';
import { makeButton } from './button';
import { roundedTex, strokedRoundedTex } from './textures';
import { stats, modeKey } from '../model/stats';
import { ACHIEVEMENTS, achievementInfo } from '../model/achievements';

const MILESTONES = [5, 10, 20, 50, 100];
const DIFFS: Array<[string, number]> = [['Easy', 0], ['Normal', 1], ['Hard', 2]];
const SIZES = [4, 5, 6];

function fmtTime(s: number | null): string {
  if (!s) return '--:--';
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
}

/**
 * The progress screen (port of pygame AchievementsOverlay): three seeded rows
 * (daily/weekly/monthly) + nine difficulty×size rows, each with best time, wins
 * and five milestone stars at 5/10/20/50/100 wins (the columns are labelled with
 * those thresholds). Below, the achievement badges as coloured circles with a
 * hover tooltip. Added to the scene; Back tears it all down.
 */
export function openStatsOverlay(scene: Phaser.Scene): void {
  const cx = GAME.width / 2;
  const cy = GAME.height / 2;
  const pw = 680;
  const rowH = 26;
  const depth = 120;
  const objs: Phaser.GameObjects.GameObject[] = [];
  const add = <T extends Phaser.GameObjects.GameObject>(o: T): T => { objs.push(o); return o; };
  let tip: Phaser.GameObjects.Text | undefined;

  const seededRows = 3;
  const modeRows = DIFFS.length * SIZES.length;
  const badgeCols = 5;
  const badgeRows = Math.ceil(ACHIEVEMENTS.length / badgeCols);
  const ph = 96 + rowH + (seededRows + 1) * rowH + 8 + modeRows * rowH + 36 + badgeRows * 64 + 70;
  const top = cy - ph / 2;
  const left = cx - pw / 2;
  const pad = 32;

  add(scene.add.rectangle(cx, cy, GAME.width, GAME.height, 0x000000, 0.66).setDepth(depth).setInteractive());
  add(scene.add.image(cx, cy, roundedTex(scene, pw, ph, 20)).setTint(COLORS.panel).setDepth(depth + 1));
  add(scene.add.image(cx, cy, strokedRoundedTex(scene, pw, ph, 20, 2)).setTint(brighten(COLORS.panel, 36)).setDepth(depth + 1));
  add(scene.add.text(cx, top + 34, 'P R O G R E S S', { fontFamily: FONT, fontStyle: 'bold', fontSize: '26px', color: palette.text }).setOrigin(0.5).setLetterSpacing(3).setDepth(depth + 2));

  const tx = left + pad;
  const tw = pw - pad * 2;
  const nameW = 150;
  const bestW = 70;
  const winsW = 48;
  // milestone columns: a block to the left of the right edge, generously spaced
  const starGap = 30;
  const starsX = tx + nameW + bestW + winsW + 14;

  // header row: column labels + the milestone thresholds
  let y = top + 70;
  const head = (lx: number, label: string) => add(scene.add.text(lx, y, label, { fontFamily: FONT, fontStyle: 'bold', fontSize: '11px', color: palette.accent }).setOrigin(0, 0.5).setDepth(depth + 2).setLetterSpacing(1));
  head(tx, 'MODE');
  head(tx + nameW, 'BEST');
  head(tx + nameW + bestW, 'WINS');
  add(scene.add.text(starsX - 18, y - 14, '★ at wins:', { fontFamily: FONT, fontSize: '10px', color: '#6b656b' }).setOrigin(1, 0.5).setDepth(depth + 2));
  MILESTONES.forEach((m, i) => {
    add(scene.add.text(starsX + i * starGap + 8, y, String(m), { fontFamily: FONT, fontStyle: 'bold', fontSize: '11px', color: palette.accent }).setOrigin(0.5).setDepth(depth + 2));
  });
  y += rowH;

  const dataRow = (name: string, best: number | null, wins: number, withStars: boolean, streakLabel?: string): void => {
    add(scene.add.text(tx, y, name, { fontFamily: FONT, fontSize: '15px', color: palette.text }).setOrigin(0, 0.5).setDepth(depth + 2));
    add(scene.add.text(tx + nameW, y, fmtTime(best), { fontFamily: FONT, fontSize: '15px', color: palette.text }).setOrigin(0, 0.5).setDepth(depth + 2));
    add(scene.add.text(tx + nameW + bestW, y, String(wins), { fontFamily: FONT, fontSize: '15px', color: palette.accent }).setOrigin(0, 0.5).setDepth(depth + 2));
    if (withStars) {
      MILESTONES.forEach((m, i) => {
        const got = wins >= m;
        add(scene.add.text(starsX + i * starGap + 8, y, got ? '★' : '·', { fontFamily: FONT, fontSize: got ? '16px' : '18px', color: got ? '#ffd678' : '#4e484e' }).setOrigin(0.5).setDepth(depth + 2));
      });
    } else if (streakLabel) {
      add(scene.add.text(tx + tw, y, streakLabel, { fontFamily: FONT, fontSize: '13px', color: palette.accent }).setOrigin(1, 0.5).setDepth(depth + 2));
    }
    y += rowH;
  };

  for (const kind of ['daily', 'weekly', 'monthly'] as const) {
    const b = stats.seeded(kind);
    dataRow(kind[0].toUpperCase() + kind.slice(1), b.best_time, b.count, false, `streak ${b.streak}`);
  }
  y += 8;
  const summary = stats.summary();
  for (const [dname, d] of DIFFS) {
    for (const sz of SIZES) {
      const m = summary.modes[modeKey(d, sz)];
      dataRow(`${dname} ${sz}×${sz}`, m?.best ?? null, m?.levels ?? 0, true);
    }
  }

  // ---- achievement badges: coloured circles + hover tooltip ----
  y += 16;
  add(scene.add.text(cx, y, 'ACHIEVEMENTS', { fontFamily: FONT, fontStyle: 'bold', fontSize: '12px', color: palette.accent }).setOrigin(0.5).setDepth(depth + 2).setLetterSpacing(1));
  y += 26;
  const earned = new Set(stats.achievements);
  const cellW = tw / badgeCols;
  const showTip = (bx: number, by: number, text: string) => {
    tip?.destroy();
    tip = scene.add.text(Phaser.Math.Clamp(bx, left + 90, left + pw - 90), by - 30, text, {
      fontFamily: FONT, fontSize: '13px', color: palette.text, backgroundColor: '#15131799', padding: { x: 8, y: 4 }, align: 'center',
    }).setOrigin(0.5).setDepth(depth + 5);
  };
  ACHIEVEMENTS.forEach((a, i) => {
    const col = i % badgeCols;
    const row = Math.floor(i / badgeCols);
    const bx = tx + col * cellW + cellW / 2;
    const by = y + row * 64 + 18;
    const got = earned.has(a.id);
    const ring = add(scene.add.graphics().setDepth(depth + 2));
    ring.fillStyle(got ? brighten(COLORS.accent, -10) : brighten(COLORS.panel, 18), 1);
    ring.fillCircle(bx, by, 18);
    ring.lineStyle(2, got ? COLORS.accent : brighten(COLORS.panel, 40), 1);
    ring.strokeCircle(bx, by, 18);
    // a medal glyph, gold when earned, dim otherwise (NOT a star — stars are the
    // milestone markers above)
    add(scene.add.text(bx, by, got ? '✓' : '?', { fontFamily: FONT, fontStyle: 'bold', fontSize: '17px', color: got ? '#1c1a1e' : '#6b656b' }).setOrigin(0.5).setDepth(depth + 3));
    add(scene.add.text(bx, by + 30, got ? a.name : '???', { fontFamily: FONT, fontSize: '12px', color: got ? palette.text : '#6b656b', align: 'center', wordWrap: { width: cellW - 8 } }).setOrigin(0.5, 0).setDepth(depth + 2));
    const hit = add(scene.add.circle(bx, by, 22, 0xffffff, 0).setInteractive({ useHandCursor: true }).setDepth(depth + 4));
    hit.on('pointerover', () => showTip(bx, by, got ? `${a.name}\n${a.desc}` : `Locked\n${a.desc}`));
    hit.on('pointerout', () => { tip?.destroy(); tip = undefined; });
  });

  const back = makeButton(scene, cx, top + ph - 38, 240, 46, 'Back', () => { tip?.destroy(); objs.forEach((o) => o.destroy()); }, { fontSize: 18, fill: COLORS.accent, textColor: '#1c1a1e' });
  back.root.setDepth(depth + 3);
  objs.push(back.root);
}
