# -*- coding: utf-8 -*-
decode_symbol = {
            11: '1',
            12: '2',
            13: '3',
            14: '4',
            15: '5',
            16: '6',
            21: 'Ⅰ',
            22: 'Ⅱ',
            23: 'Ⅲ',
            24: 'Ⅳ',
            25: 'Ⅴ',
            26: 'Ⅵ',
            31: 'A',
            32: 'B',
            33: 'C',
            34: 'D',
            35: 'E',
            36: 'F',
            41: '₽',
            42: '$',
            43: '€',
            44: '฿',
            # 44: '₿',
            45: '£',
            46: '¥',
            51: 'α',
            52: 'β',
            53: 'ω',
            54: 'δ',
            55: 'π',
            56: 'φ',
            61: '-',
            62: '+',
            63: '×',
            64: '÷',
            65: '=',
            66: '%'
        }


def symbol_for(value):
    """The glyph a cell value renders as (or '?' if unknown)."""
    return decode_symbol.get(value, '?')


def rule_segments(values):
    """Structured reading of a rule for the tooltip: a list of segments,
    each ('text', str) or ('cell', value). 'cell' segments render as a small
    coloured tile (the real board colour), not just the bare glyph.

    Markers: '^' same column, '<->' neighbouring columns, '...' left-of.
    Three integers instead mean three consecutive columns, in that order
    read either left-to-right or right-to-left.
    """
    a, b, c = values
    if b == '^':
        return [('cell', a), ('text', 'is in the same column as'),
                ('cell', c)]
    if b == '<->':
        return [('cell', a), ('text', 'and'), ('cell', c),
                ('text', 'are in neighbouring columns')]
    if b == '...':
        return [('cell', a), ('text', 'is somewhere to the left of'),
                ('cell', c)]
    return [('cell', a), ('cell', b), ('cell', c),
            ('text', 'fill three columns in a row, in this order —'),
            ('text', 'left-to-right or right-to-left')]


def describe_rule(values):
    """The same reading as rule_segments(), flattened to a plain string."""
    out = []
    for kind, val in rule_segments(values):
        out.append(symbol_for(val) if kind == 'cell' else val)
    return ' '.join(out)
