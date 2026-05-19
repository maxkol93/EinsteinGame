# -*- coding: utf-8 -*-
"""Achievements — a fixed set of badges the player collects.

The game already tracks every number an achievement needs (wins, streaks,
times, stars). `evaluate()` simply reads a context snapshot and reports which
badges that snapshot satisfies; the caller diffs it against what is already
unlocked to find the freshly-earned ones.
"""

# id -> (display name, one-line description). Order is the display order.
ACHIEVEMENTS = [
    ('first_win',  'First Light',  'Win your first puzzle'),
    ('flawless',   'Flawless',     'Solve a board with zero mistakes'),
    ('three_star', 'Top Marks',    'Earn a three-star grade'),
    ('speed',      'Quicksilver',  'Beat the par time on a board'),
    ('streak5',    'On a Roll',    'Win five puzzles in a row'),
    ('hard6',      'Brain Melt',   'Win a 6x6 board on Hard'),
    ('tutorial',   'Schooled',     'Finish the whole tutorial'),
    ('daily7',     'Daily Habit',  'Reach a seven-day daily streak'),
    ('zen',        'Inner Peace',  'Finish a board in Zen mode'),
    ('veteran',    'Veteran',      'Win twenty-five puzzles'),
]

ACHIEVEMENT_IDS = [a[0] for a in ACHIEVEMENTS]
_INFO = {a[0]: (a[1], a[2]) for a in ACHIEVEMENTS}


def info(achievement_id):
    """(name, description) for an id, or a safe fallback."""
    return _INFO.get(achievement_id, (achievement_id, ''))


def evaluate(ctx):
    """The set of achievement ids the context snapshot currently satisfies.

    Every lookup is defensive — a partial context (e.g. one built only to
    report 'tutorial finished') simply satisfies fewer badges."""
    g = ctx.get
    won = bool(g('won', False))
    earned = set()
    if g('total_wins', 0) >= 1:
        earned.add('first_win')
    if g('total_wins', 0) >= 25:
        earned.add('veteran')
    if won and g('mistakes', 1) == 0:
        earned.add('flawless')
    if g('stars', 0) >= 3:
        earned.add('three_star')
    if won and g('par') and g('seconds', 10 ** 9) <= g('par'):
        earned.add('speed')
    if g('win_streak', 0) >= 5:
        earned.add('streak5')
    if won and g('size') == 6 and g('difficulty') == 2:
        earned.add('hard6')
    if g('tutorial_done', False):
        earned.add('tutorial')
    if g('daily_streak', 0) >= 7:
        earned.add('daily7')
    if won and g('zen', False):
        earned.add('zen')
    return earned
