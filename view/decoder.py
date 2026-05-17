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


def describe_rule(values):
    """A plain-language reading of a displayed rule (its 3 cell values).

    Markers: '^' same column, '<->' neighbouring columns, '...' left-of.
    Three integers instead mean three consecutive columns, left to right.
    """
    a, b, c = values
    if b == '^':
        return '%s is in the same column as %s' % (symbol_for(a),
                                                   symbol_for(c))
    if b == '<->':
        return '%s and %s are in neighbouring columns' % (symbol_for(a),
                                                          symbol_for(c))
    if b == '...':
        return '%s is somewhere left of %s' % (symbol_for(a), symbol_for(c))
    return '%s, %s, %s fill three columns, left to right' % (
        symbol_for(a), symbol_for(b), symbol_for(c))
