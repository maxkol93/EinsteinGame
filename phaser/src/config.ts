// The Mocha palette is single-sourced in ../../shared/palette.json (a mirror of
// the pygame view/palettes.py). Don't redefine colors here — edit the JSON.
import Phaser from 'phaser';
import paletteJson from '../../shared/palette.json';

export const palette = paletteJson;

/** Convert a "#rrggbb" string to the 0xrrggbb number Phaser expects. */
export const hex = (s: string): number => parseInt(s.replace('#', ''), 16);

export const COLORS = {
  bg: hex(palette.bg),
  panel: hex(palette.panel),
  text: palette.text, // text styles take "#rrggbb" strings
  accent: hex(palette.accent),
  rows: Object.fromEntries(
    Object.entries(palette.rows).map(([k, v]) => [k, hex(v as string)]),
  ) as Record<string, number>,
};

/** Row (category) colour for a cell value, by its tens digit. */
export const rowColor = (value: number): number =>
  COLORS.rows[String(Math.floor(value / 10))] ?? COLORS.accent;

/** Lighten/darken a 0xrrggbb colour by `amt` per channel (clamped). */
export function brighten(color: number, amt: number): number {
  const r = Math.max(0, Math.min(255, ((color >> 16) & 0xff) + amt));
  const g = Math.max(0, Math.min(255, ((color >> 8) & 0xff) + amt));
  const b = Math.max(0, Math.min(255, (color & 0xff) + amt));
  return (r << 16) | (g << 8) | b;
}

export const FONT = '"DejaVu Sans", Arial, sans-serif';

// Orientation: a taller-than-wide viewport (a phone held upright) gets the
// portrait layout — a top info strip, a width-maximised board, and the clues
// below it. Desktop / landscape keeps the side-panel layout. Mirrors the pygame
// _detect_portrait() decision.
function detectPortrait(): boolean {
  try {
    return typeof window !== 'undefined' && window.innerHeight > window.innerWidth * 1.05;
  } catch {
    return false;
  }
}
export const PORTRAIT = detectPortrait();

// Canvas: landscape mirrors the pygame side-panel build (left panel, 615px
// board, right clue panel); portrait mirrors the 760×1256 mobile build.
export const GAME = PORTRAIT ? { width: 760, height: 1256 } : { width: 1295, height: 735 };

// Supersample factor: the game logic/layout stays in GAME.width×GAME.height
// coords, but the actual render buffer is RENDER_SCALE× bigger and each scene's
// camera zooms by the same factor (and re-centres). Net effect — every pixel
// (text AND textures) is rendered at 2× density, so it stays sharp when
// Scale.FIT stretches the canvas to fill a large/HiDPI screen.
export const RENDER_SCALE = 2;

/** Apply the supersample zoom+centre to a scene's main camera. Call first in
 *  each rendering scene's create(). */
export function applyRenderScale(scene: Phaser.Scene): void {
  scene.cameras.main.setZoom(RENDER_SCALE);
  scene.cameras.main.centerOn(GAME.width / 2, GAME.height / 2);
}
