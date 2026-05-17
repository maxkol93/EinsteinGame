"""Color palettes. Each row gets a base color; backgrounds are drawn as
soft top-light gradients from that base.

Design notes:
- Rows must stay distinguishable but the whole set must read as one mood.
- Use analogous hues + balanced saturation rather than rainbow primaries.
- Background is several stops darker than the lightest row so the field
  reads as recessed and the cells pop forward.
"""

PALETTES = {
    'mocha': {
        'name': 'Mocha — warm muted',
        'bg': (28, 24, 26),
        'panel': (22, 19, 21),
        'text': (245, 240, 236),
        'accent': (205, 195, 190),
        'rows': {
            1: (200, 137, 142),   # dusty rose
            2: (197, 123, 90),    # terracotta clay
            3: (197, 163, 87),    # mustard gold
            4: (143, 163, 122),   # sage olive
            5: (110, 138, 141),   # cold sage-teal
            6: (128, 97, 116),    # plum mocha
        },
    },
    'nord': {
        'name': 'Nord — cool harmony',
        'bg': (37, 43, 56),
        'panel': (29, 35, 47),
        'text': (236, 239, 244),
        'accent': (180, 190, 210),
        'rows': {
            1: (191, 97, 106),    # aurora red
            2: (208, 135, 112),   # aurora orange
            3: (235, 203, 139),   # snow yellow
            4: (163, 190, 140),   # frost green
            5: (94, 129, 172),    # frost blue
            6: (180, 142, 173),   # aurora purple
        },
    },
    'sunset': {
        'name': 'Sunset — gradient warm→cool',
        'bg': (26, 30, 46),
        'panel': (20, 24, 38),
        'text': (245, 240, 240),
        'accent': (210, 180, 200),
        'rows': {
            1: (231, 111, 81),    # coral
            2: (244, 162, 97),    # peach
            3: (233, 196, 106),   # wheat gold
            4: (138, 177, 167),   # sage
            5: (98, 122, 167),    # slate blue
            6: (114, 80, 124),    # plum
        },
    },
}


def get_palette(name):
    return PALETTES.get(name, PALETTES['mocha'])
