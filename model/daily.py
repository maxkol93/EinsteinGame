# -*- coding: utf-8 -*-
"""Seeded puzzles — daily, weekly and monthly.

Three rotating challenges, each one identical for every player. The size,
difficulty and RNG seed are derived deterministically from the calendar
period, so two people playing the same period get the exact same board (and
can compare times).
"""
import datetime


_EPOCH = datetime.date(2026, 1, 1)
_EPOCH_DAY = _EPOCH.toordinal()


# A week-long rotation so the daily varies but stays fair — mostly Normal,
# with a couple of Hard days, on 4x4 .. 6x6 boards.
_DAILY_SIZE = (5, 6, 5, 6, 4, 6, 5)
_DAILY_DIFF = (1, 1, 2, 1, 1, 2, 1)


def today_ordinal():
    """Today's date as a proleptic-Gregorian ordinal (a plain day counter)."""
    return datetime.date.today().toordinal()


def _isoweek_ordinal(date=None):
    """An ordinal that ticks once per ISO week (Monday-anchored)."""
    if date is None:
        date = datetime.date.today()
    monday = date - datetime.timedelta(days=date.weekday())
    return monday.toordinal()


def _month_ordinal(date=None):
    """An ordinal that ticks once per calendar month."""
    if date is None:
        date = datetime.date.today()
    return date.year * 12 + (date.month - 1)


def daily_config(day=None):
    """The fully-determined daily puzzle for `day` (default: today)."""
    if day is None:
        day = today_ordinal()
    i = day % 7
    return {
        'kind': 'daily',
        'day': day,
        'number': day - _EPOCH_DAY + 1,
        'size': _DAILY_SIZE[i],
        'difficulty': _DAILY_DIFF[i],
        'seed': (day * 2654435761) & 0x7FFFFFFF,
    }


def weekly_config(date=None):
    """A harder, larger weekly puzzle — Mondays roll a new one."""
    week_day = _isoweek_ordinal(date)              # Monday ordinal of the week
    epoch_week_day = _isoweek_ordinal(_EPOCH)
    week_index = (week_day - epoch_week_day) // 7  # whole weeks since epoch
    return {
        'kind': 'weekly',
        'day': week_day,
        'number': week_index + 1,
        'size': 6,
        'difficulty': 2,                       # Hard — the week-long brain teaser
        'seed': (week_day * 40503) & 0x7FFFFFFF,
    }


def monthly_config(date=None):
    """A flagship monthly puzzle — once every calendar month."""
    month = _month_ordinal(date)
    epoch_month = _month_ordinal(_EPOCH)
    return {
        'kind': 'monthly',
        'day': month,
        'number': month - epoch_month + 1,
        'size': 6,
        'difficulty': 2,
        'seed': (month * 0x9E3779B1) & 0x7FFFFFFF,
    }
