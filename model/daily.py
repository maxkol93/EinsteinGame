# -*- coding: utf-8 -*-
"""The Daily Puzzle.

One puzzle per calendar day, identical for every player: the board size,
difficulty and RNG seed are all derived deterministically from the date, so
two people on the same day solve the exact same board (and can compare).
"""
import datetime


# Day 1 of the daily series. The "Daily #N" number counts from here.
_EPOCH = datetime.date(2026, 1, 1).toordinal()

# A week-long rotation so the daily varies but stays fair — mostly Normal,
# with a couple of Hard days, on 5x5 and 6x6 boards.
_DAILY_SIZE = (5, 6, 5, 6, 5, 6, 5)
_DAILY_DIFF = (1, 1, 2, 1, 1, 2, 1)


def today_ordinal():
    """Today's date as a proleptic-Gregorian ordinal (a plain day counter)."""
    return datetime.date.today().toordinal()


def daily_config(day=None):
    """The fully-determined puzzle for `day` (default: today).

    Returns a dict with the board `size`, `difficulty`, the generator `seed`,
    the raw `day` ordinal and the human-facing `number` (Daily #N)."""
    if day is None:
        day = today_ordinal()
    i = day % 7
    return {
        'day': day,
        'number': day - _EPOCH + 1,
        'size': _DAILY_SIZE[i],
        'difficulty': _DAILY_DIFF[i],
        # a large odd multiplier scatters consecutive days far apart
        'seed': (day * 2654435761) & 0x7FFFFFFF,
    }
