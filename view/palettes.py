"""The single game palette.

Theme switching was removed — the game always renders in this one warm-muted
palette. ``get_palette`` is kept (with its old signature) so callers don't all
need to change, but it ignores its argument now.
"""

PALETTE = {
    'name': 'Mocha — warm muted',
    'bg': (28, 24, 26),
    'panel': (22, 19, 21),
    'text': (245, 240, 236),
    'accent': (205, 195, 190),
    'rows': {
        1: (168, 115, 119),   # dusty rose
        2: (165, 103, 76),    # terracotta clay
        3: (165, 137, 73),    # mustard gold
        4: (120, 137, 102),   # sage olive
        5: (92, 116, 118),    # cold sage-teal
        6: (108, 81, 97),     # plum mocha
    },
}


def get_palette(name=None):
    return PALETTE
