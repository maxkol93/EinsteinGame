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
            1: (168, 115, 119),   # dusty rose
            2: (165, 103, 76),    # terracotta clay
            3: (165, 137, 73),    # mustard gold
            4: (120, 137, 102),   # sage olive
            5: (92, 116, 118),    # cold sage-teal
            6: (108, 81, 97),     # plum mocha
        },
    },
    'nord': {
        'name': 'Nord — cool harmony',
        'bg': (37, 43, 56),
        'panel': (29, 35, 47),
        'text': (236, 239, 244),
        'accent': (180, 190, 210),
        'rows': {
            1: (160, 81, 89),     # aurora red
            2: (175, 113, 94),    # aurora orange
            3: (197, 171, 117),   # snow yellow
            4: (137, 160, 118),   # frost green
            5: (79, 108, 144),    # frost blue
            6: (151, 119, 145),   # aurora purple
        },
    },
    'sunset': {
        'name': 'Sunset — gradient warm→cool',
        'bg': (26, 30, 46),
        'panel': (20, 24, 38),
        'text': (245, 240, 240),
        'accent': (210, 180, 200),
        'rows': {
            1: (194, 93, 68),     # coral
            2: (205, 136, 81),    # peach
            3: (196, 165, 89),    # wheat gold
            4: (116, 149, 140),   # sage
            5: (82, 102, 140),    # slate blue
            6: (96, 67, 104),     # plum
        },
    },
}


def get_palette(name):
    return PALETTES.get(name, PALETTES['mocha'])
