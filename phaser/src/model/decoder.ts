// Glyph each cell value renders as — mirror of view/decoder.py. Row (tens
// digit) picks the alphabet; value (units digit, 1..6) picks the glyph.
export const DECODE_SYMBOL: Record<number, string> = {
  11: '1', 12: '2', 13: '3', 14: '4', 15: '5', 16: '6', 17: '7',
  // Row 2: geometric shapes — easy to name, sharp at small sizes
  21: '▲', 22: '■', 23: '●', 24: '◆', 25: '★', 26: '✚', 27: '♣',
  31: 'A', 32: 'B', 33: 'C', 34: 'D', 35: 'E', 36: 'F', 37: 'G',
  // Row 4: weather symbols — universally recognisable, distinct silhouettes
  41: '☀', 42: '☁', 43: '☔', 44: '❄', 45: '⚡', 46: '✦', 47: '☃',
  51: 'α', 52: 'β', 53: 'ω', 54: 'δ', 55: 'π', 56: 'φ', 57: 'σ',
  61: '-', 62: '+', 63: '×', 64: '÷', 65: '=', 66: '%', 67: '∞',
  71: '♩', 72: '♪', 73: '♫', 74: '♬', 75: '♭', 76: '♮', 77: '♯',
};

export function symbolFor(value: number): string {
  return DECODE_SYMBOL[value] ?? '?';
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
