// Glyph each cell value renders as — mirror of view/decoder.py. Row (tens
// digit) picks the alphabet; value (units digit, 1..7) picks the glyph.
// Categories are chosen to be easy to "say in your head" and crisp when small:
// 1 numbers · 2 latin letters · 3 math signs · 4 greek letters ·
// 5 geometric shapes · 6 more latin letters · (7 musical notes — hidden 7×7).
export const DECODE_SYMBOL: Record<number, string> = {
  11: '1', 12: '2', 13: '3', 14: '4', 15: '5', 16: '6', 17: '7',
  21: 'A', 22: 'B', 23: 'C', 24: 'D', 25: 'E', 26: 'F', 27: 'G',
  31: '-', 32: '+', 33: '×', 34: '÷', 35: '=', 36: '%', 37: '∞',
  41: 'α', 42: 'β', 43: 'ω', 44: 'δ', 45: 'π', 46: 'φ', 47: 'σ',
  // geometric shapes — ▰ (parallelogram) stands in for a trapezoid, which the
  // bundled DejaVu Sans has no glyph for.
  51: '▲', 52: '■', 53: '●', 54: '◆', 55: '★', 56: '▰', 57: '♣',
  61: 'U', 62: 'V', 63: 'W', 64: 'X', 65: 'Y', 66: 'Z', 67: 'T',
  71: '♩', 72: '♪', 73: '♫', 74: '♬', 75: '♭', 76: '♮', 77: '♯',
};

export function symbolFor(value: number): string {
  return DECODE_SYMBOL[value] ?? '?';
}

/** Vertical anchor for a glyph. The black geometric-shape glyphs (row 5) sit
 *  visually low when centred on their text box, so anchor them slightly below
 *  centre (origin-y > 0.5) which nudges the drawn shape upward. */
export function glyphOriginY(value: number): number {
  return Math.floor(value / 10) === 5 ? 0.58 : 0.5;
}

export type Segment = { kind: 'text'; value: string } | { kind: 'cell'; value: number };

/** Structured reading of a rule for display: text spans + coloured cell tiles. */
export function ruleSegments(values: Array<number | string>): Segment[] {
  const [a, b, c] = values;
  if (b === '^') {
    return [
      { kind: 'cell', value: a as number },
      { kind: 'text', value: 'same column as' },
      { kind: 'cell', value: c as number },
    ];
  }
  if (b === '<->') {
    return [
      { kind: 'cell', value: a as number },
      { kind: 'text', value: '&' },
      { kind: 'cell', value: c as number },
      { kind: 'text', value: 'neighbour columns' },
    ];
  }
  if (b === '...') {
    return [
      { kind: 'cell', value: a as number },
      { kind: 'text', value: 'left of' },
      { kind: 'cell', value: c as number },
    ];
  }
  // three-in-a-row
  return [
    { kind: 'cell', value: a as number },
    { kind: 'cell', value: b as number },
    { kind: 'cell', value: c as number },
    { kind: 'text', value: '3 in a row (either direction)' },
  ];
}
