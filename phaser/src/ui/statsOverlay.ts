import Phaser from 'phaser';
import { COLORS, GAME, FONT, palette, brighten, PORTRAIT } from '../config';
import { makeButton } from './button';
import { roundedTex, strokedRoundedTex } from './textures';
import { stats, modeKey } from '../model/stats';
import { ACHIEVEMENTS } from '../model/achievements';

const MILESTONES = [3, 5, 10, 20, 50];
const DIFFS: Array<[string, number]> = [['Easy', 0], ['Normal', 1], ['Hard', 2]];
const SIZES = [4, 5, 6];

function fmtTime(s: number | null): string {
  if (!s) return '--:--';
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
}

/**
 * The progress screen (port of pygame AchievementsOverlay): a left column of
 * achievement badges and a right table — daily/weekly/monthly + nine
 * difficulty×size rows — each with best time, wins and five milestone stars at
 * 5/10/20/50/100. Locked milestones are grey stars; earned are gold.
 */
export function openStatsOverlay(scene: Phaser.Scene): void {
  if (PORTRAIT) {
    openStatsOverlayPortrait(scene);
    return;
  }

  const cx = GAME.width / 2;
  const cy = GAME.height / 2;
  const pw = Math.min(GAME.width - 40, 720);
  const ph = Math.min(GAME.height - 60, 600);
  const depth = 120;
  const objs: Phaser.GameObjects.GameObject[] = [];
  const add = <T extends Phaser.GameObjects.GameObject>(o: T): T => { objs.push(o); return o; };
  let tip: Phaser.GameObjects.Text | undefined;

  const top = cy - ph / 2;
  const left = cx - pw / 2;
  const pad = 30;

  add(scene.add.rectangle(cx, cy, GAME.width, GAME.height, 0x000000, 0.66).setDepth(depth).setInteractive());
  add(scene.add.image(cx, cy, roundedTex(scene, pw, ph, 20)).setTint(COLORS.panel).setDepth(depth + 1));
  add(scene.add.image(cx, cy, strokedRoundedTex(scene, pw, ph, 20, 2)).setTint(brighten(COLORS.panel, 36)).setDepth(depth + 1));
  add(scene.add.text(cx, top + 32, 'P R O G R E S S', { fontFamily: FONT, fontStyle: 'bold', fontSize: '26px', color: palette.text }).setOrigin(0.5).setLetterSpacing(3).setDepth(depth + 2));

  const bodyTop = top + 64;
  const bodyBottom = top + ph - 78;
  const bodyH = bodyBottom - bodyTop;

  // ---- LEFT: achievement badges (gold medals), vertical column ----
  const lx = left + pad;
  const lw = 210;
  add(scene.add.text(lx, bodyTop, 'ACHIEVEMENTS', { fontFamily: FONT, fontStyle: 'bold', fontSize: '12px', color: palette.accent }).setOrigin(0, 0.5).setDepth(depth + 2).setLetterSpacing(1));
  const earned = new Set(stats.achievements);
  const aRowH = (bodyH - 24) / ACHIEVEMENTS.length;
  const showTip = (bx: number, by: number, text: string) => {
    tip?.destroy();
    tip = scene.add.text(Phaser.Math.Clamp(bx, left + 70, left + pw - 70), by, text, {
      fontFamily: FONT, fontSize: '12px', color: palette.text, backgroundColor: '#151317cc', padding: { x: 8, y: 4 }, wordWrap: { width: 240 },
    }).setOrigin(0, 0.5).setDepth(depth + 6);
  };
  ACHIEVEMENTS.forEach((a, i) => {
    const got = earned.has(a.id);
    const ry = bodyTop + 24 + i * aRowH + aRowH / 2;
    const g = add(scene.add.graphics().setDepth(depth + 2));
    g.fillStyle(got ? 0xffd678 : brighten(COLORS.panel, 16), 1);
    g.fillCircle(lx + 13, ry, 13);
    g.lineStyle(2, got ? brighten(0xffd678, -30) : brighten(COLORS.panel, 40), 1);
    g.strokeCircle(lx + 13, ry, 13);
    add(scene.add.text(lx + 13, ry, '★', { fontFamily: FONT, fontSize: '14px', color: got ? '#1c1a1e' : '#5b555b' }).setOrigin(0.5).setDepth(depth + 3));
    add(scene.add.text(lx + 34, ry, got ? a.name : '???', { fontFamily: FONT, fontSize: '14px', color: got ? palette.text : '#6b656b' }).setOrigin(0, 0.5).setDepth(depth + 2));
    const hit = add(scene.add.rectangle(lx + lw / 2, ry, lw, aRowH, 0xffffff, 0).setInteractive({ useHandCursor: true }).setDepth(depth + 4));
    hit.on('pointerover', () => showTip(lx + lw + 6, ry, got ? a.desc : `Locked — ${a.desc}`));
    hit.on('pointerout', () => { tip?.destroy(); tip = undefined; });
  });

  // a divider between the two panes
  const divX = lx + lw + 16;
  add(scene.add.rectangle(divX, bodyTop + bodyH / 2, 1, bodyH, brighten(COLORS.panel, 40), 1).setDepth(depth + 2));

  // ---- RIGHT: the progress table, rows spread to fill the height ----
  const tx = divX + 24;
  const tw = left + pw - pad - tx;
  const nameW = 122;
  const bestW = 64;
  const winsW = 40;
  const starGap = Math.min(30, (tw - nameW - bestW - winsW - 8) / MILESTONES.length);
  const starsX = tx + nameW + bestW + winsW;
  const rows = 3 + DIFFS.length * SIZES.length; // 12 with 3 sizes
  const rowH = Math.min(30, (bodyH - 28) / (rows + 1));

  let y = bodyTop + 6;
  // header
  const head = (hx: number, label: string, origin = 0) => add(scene.add.text(hx, y, label, { fontFamily: FONT, fontStyle: 'bold', fontSize: '11px', color: palette.accent }).setOrigin(origin, 0.5).setDepth(depth + 2).setLetterSpacing(1));
  head(tx, 'MODE');
  head(tx + nameW, 'BEST');
  head(tx + nameW + bestW, 'WINS');
  MILESTONES.forEach((m, i) => add(scene.add.text(starsX + i * starGap + starGap / 2, y, String(m), { fontFamily: FONT, fontStyle: 'bold', fontSize: '10px', color: '#8a838a' }).setOrigin(0.5).setDepth(depth + 2)));
  y += rowH + 4;

  const dataRow = (name: string, best: number | null, wins: number): void => {
    add(scene.add.text(tx, y, name, { fontFamily: FONT, fontSize: '14px', color: palette.text }).setOrigin(0, 0.5).setDepth(depth + 2));
    add(scene.add.text(tx + nameW, y, fmtTime(best), { fontFamily: FONT, fontSize: '14px', color: palette.text }).setOrigin(0, 0.5).setDepth(depth + 2));
    add(scene.add.text(tx + nameW + bestW, y, String(wins), { fontFamily: FONT, fontSize: '14px', color: palette.accent }).setOrigin(0, 0.5).setDepth(depth + 2));
    MILESTONES.forEach((m, i) => {
      const got = wins >= m;
      add(scene.add.text(starsX + i * starGap + starGap / 2, y, got ? '★' : '☆', { fontFamily: FONT, fontSize: '15px', color: got ? '#ffd678' : '#534d53' }).setOrigin(0.5).setDepth(depth + 2));
    });
    y += rowH;
  };

  // seeded rows now use their completion COUNT for the milestone stars (streak
  // dropped, per request)
  for (const kind of ['daily', 'weekly', 'monthly'] as const) {
    const b = stats.seeded(kind);
    dataRow(kind[0].toUpperCase() + kind.slice(1), b.best_time, b.count);
  }
  y += 6;
  const summary = stats.summary();
  for (const [dname, d] of DIFFS) {
    for (const sz of SIZES) {
      const m = summary.modes[modeKey(d, sz)];
      dataRow(`${dname} ${sz}×${sz}`, m?.best ?? null, m?.levels ?? 0);
    }
  }

  const back = makeButton(scene, cx, top + ph - 36, 240, 46, 'Back', () => { tip?.destroy(); objs.forEach((o) => o.destroy()); }, { fontSize: 18, fill: COLORS.accent, textColor: '#1c1a1e' });
  back.root.setDepth(depth + 3);
  objs.push(back.root);
}

/** Portrait-specific layout: full-width stats table on top, achievement badges below. */
function openStatsOverlayPortrait(scene: Phaser.Scene): void {
  const cx = GAME.width / 2;
  const cy = GAME.height / 2;
  const depth = 120;
  const objs: Phaser.GameObjects.GameObject[] = [];
  const add = <T extends Phaser.GameObjects.GameObject>(o: T): T => { objs.push(o); return o; };

  const pad = 28;
  const pw = GAME.width - 40;
  const innerW = pw - 2 * pad;

  // Table rows: 3 seeded + 9 diff×size = 12; plus header
  const tblRowH = 24;
  const tblHeaderH = 28;
  const tblH = tblHeaderH + 12 * tblRowH + 6;

  // Achievement grid: 2 columns, 5 rows
  const achCols = 2;
  const achRowH = 36;
  const achRows = Math.ceil(ACHIEVEMENTS.length / achCols);
  const achH = 24 + achRows * achRowH; // label + rows

  const ph = Math.round(64 + tblH + 20 + achH + 20 + 50 + 28);
  const top = cy - ph / 2;
  const left = cx - pw / 2;

  add(scene.add.rectangle(cx, cy, GAME.width, GAME.height, 0x000000, 0.66).setDepth(depth).setInteractive());
  add(scene.add.image(cx, cy, roundedTex(scene, pw, ph, 20)).setTint(COLORS.panel).setDepth(depth + 1));
  add(scene.add.image(cx, cy, strokedRoundedTex(scene, pw, ph, 20, 2)).setTint(brighten(COLORS.panel, 36)).setDepth(depth + 1));
  add(scene.add.text(cx, top + 34, 'P R O G R E S S', { fontFamily: FONT, fontStyle: 'bold', fontSize: '26px', color: palette.text }).setOrigin(0.5).setLetterSpacing(3).setDepth(depth + 2));

  // ---- full-width stats table ----
  const tx = left + pad;
  const nameW = 130;
  const bestW = 64;
  const winsW = 44;
  const starArea = innerW - nameW - bestW - winsW;
  const starGap = starArea / MILESTONES.length;
  const starsX = tx + nameW + bestW + winsW;

  let y = top + 64;

  // header
  const head = (hx: number, label: string) => add(scene.add.text(hx, y + tblHeaderH / 2, label, { fontFamily: FONT, fontStyle: 'bold', fontSize: '13px', color: palette.accent }).setOrigin(0, 0.5).setDepth(depth + 2).setLetterSpacing(1));
  head(tx, 'MODE');
  head(tx + nameW, 'BEST');
  head(tx + nameW + bestW, 'WINS');
  MILESTONES.forEach((m, i) => add(scene.add.text(starsX + i * starGap + starGap / 2, y + tblHeaderH / 2, String(m), { fontFamily: FONT, fontStyle: 'bold', fontSize: '12px', color: '#8a838a' }).setOrigin(0.5).setDepth(depth + 2)));
  y += tblHeaderH;

  const summary = stats.summary();
  const dataRow = (name: string, best: number | null, wins: number): void => {
    add(scene.add.text(tx, y + tblRowH / 2, name, { fontFamily: FONT, fontSize: '15px', color: palette.text }).setOrigin(0, 0.5).setDepth(depth + 2));
    add(scene.add.text(tx + nameW, y + tblRowH / 2, fmtTime(best), { fontFamily: FONT, fontSize: '15px', color: palette.text }).setOrigin(0, 0.5).setDepth(depth + 2));
    add(scene.add.text(tx + nameW + bestW, y + tblRowH / 2, String(wins), { fontFamily: FONT, fontSize: '15px', color: palette.accent }).setOrigin(0, 0.5).setDepth(depth + 2));
    MILESTONES.forEach((m, i) => {
      const got = wins >= m;
      add(scene.add.text(starsX + i * starGap + starGap / 2, y + tblRowH / 2, got ? '★' : '☆', { fontFamily: FONT, fontSize: '17px', color: got ? '#ffd678' : '#534d53' }).setOrigin(0.5).setDepth(depth + 2));
    });
    y += tblRowH;
  };

  for (const kind of ['daily', 'weekly', 'monthly'] as const) {
    const b = stats.seeded(kind);
    dataRow(kind[0].toUpperCase() + kind.slice(1), b.best_time, b.count);
  }
  y += 4;
  for (const [dname, d] of DIFFS) {
    for (const sz of SIZES) {
      const m = summary.modes[modeKey(d, sz)];
      dataRow(`${dname} ${sz}×${sz}`, m?.best ?? null, m?.levels ?? 0);
    }
  }

  // horizontal divider
  y += 10;
  const divG = add(scene.add.graphics().setDepth(depth + 2));
  divG.lineStyle(1, brighten(COLORS.panel, 40), 1);
  divG.lineBetween(left + pad, y, left + pw - pad, y);
  y += 10;

  // ---- achievement badges (2-column grid) ----
  add(scene.add.text(cx, y + 12, 'ACHIEVEMENTS', { fontFamily: FONT, fontStyle: 'bold', fontSize: '14px', color: palette.accent }).setOrigin(0.5).setLetterSpacing(1).setDepth(depth + 2));
  y += 24;

  const earned = new Set(stats.achievements);
  const achItemW = Math.floor(innerW / achCols);
  ACHIEVEMENTS.forEach((a, i) => {
    const col = i % achCols;
    const row = Math.floor(i / achCols);
    const ax = tx + col * achItemW;
    const ay = y + row * achRowH + achRowH / 2;
    const got = earned.has(a.id);

    const g = add(scene.add.graphics().setDepth(depth + 2));
    g.fillStyle(got ? 0xffd678 : brighten(COLORS.panel, 16), 1);
    g.fillCircle(ax + 13, ay, 13);
    g.lineStyle(2, got ? brighten(0xffd678, -30) : brighten(COLORS.panel, 40), 1);
    g.strokeCircle(ax + 13, ay, 13);
    add(scene.add.text(ax + 13, ay, '★', { fontFamily: FONT, fontSize: '14px', color: got ? '#1c1a1e' : '#5b555b' }).setOrigin(0.5).setDepth(depth + 3));
    add(scene.add.text(ax + 34, ay, got ? a.name : '???', { fontFamily: FONT, fontSize: '15px', color: got ? palette.text : '#6b656b' }).setOrigin(0, 0.5).setDepth(depth + 2));
  });

  // ---- back button ----
  const back = makeButton(scene, cx, top + ph - 34, Math.round(pw * 0.6), 46, 'Back', () => { objs.forEach((o) => o.destroy()); }, { fontSize: 20, fill: COLORS.accent, textColor: '#1c1a1e' });
  back.root.setDepth(depth + 3);
  objs.push(back.root);
}
