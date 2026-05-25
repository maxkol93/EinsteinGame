// The Mocha palette is single-sourced in ../../shared/palette.json (a mirror of
// the pygame view/palettes.py). Don't redefine colors here — edit the JSON.
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

// Canvas matches the pygame landscape build (view/window.py): a left panel, the
// 615px board, and a right clue panel.
export const GAME = {
  width: 1295,
  height: 735,
};
