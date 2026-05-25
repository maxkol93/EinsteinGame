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

// Base design resolution; Scale.FIT letterboxes it to any viewport.
export const GAME = {
  width: 1280,
  height: 720,
};
