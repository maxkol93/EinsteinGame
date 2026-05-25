"""Persistent player progress.

What the player keeps between sessions:

* per-(difficulty × board size) wins, losses, best time and accumulated play
  time — used by the stats screen's milestone-star table and by the mode
  progression (3 wins in a size unlock the next size; 3 wins in every size
  of a difficulty unlock the next difficulty).
* the daily / weekly / monthly seeded-puzzle counters (last day solved,
  streak, best streak, total solved, best time).
* the win streak and the badge set.

Stored as JSON. On the desktop it lives in the user's home directory; in the
pygbag/web build it is kept in the browser's localStorage. Every access is
defensive — a missing file, a read-only filesystem or no storage at all must
never crash the game, it just means the stats do not persist.
"""
import json
import os
import sys


_DIFF_KEY = {0: 'easy', 1: 'normal', 2: 'hard'}
_IS_WEB = sys.platform == 'emscripten'
_STORE_KEY = 'einsteingame_stats'

_SIZES = (4, 5, 6)
_DIFFS = ('easy', 'normal', 'hard')

# Par time (seconds) per (board size, difficulty index). Kept for the
# "Quicksilver" achievement — the in-game scoring no longer surfaces it.
_PAR = {
    4: (45, 75, 120),
    5: (70, 120, 185),
    6: (95, 165, 255),
}


def par_time(size, difficulty):
    """The par time for a board, clamped to a known size."""
    row = _PAR.get(size, _PAR[6])
    return row[max(0, min(2, difficulty))]


def mode_key(difficulty, size):
    """The stats key for one (difficulty, size) slot — e.g. ``easy_4``."""
    return '%s_%d' % (_DIFF_KEY.get(difficulty, 'easy'), size)


def _empty_entry():
    return {'levels': 0, 'losses': 0, 'best': None, 'total_time': 0}


def _empty_seeded():
    return {'last': 0, 'streak': 0, 'best': 0, 'count': 0, 'best_time': None}


def _empty():
    data = {
        'modes': {mode_key(d, s): _empty_entry()
                  for d in range(3) for s in _SIZES},
        'streak': 0,
        'best_streak': 0,
        'daily': _empty_seeded(),
        'weekly': _empty_seeded(),
        'monthly': _empty_seeded(),
        'achievements': [],
    }
    return data


class Stats(object):
    def __init__(self):
        self._data = _empty()
        self._load()

    # ------------------------------------------------------------------
    @staticmethod
    def _file_path():
        return os.path.join(os.path.expanduser('~'),
                            '.einsteingame_stats.json')

    def _load(self):
        raw = None
        try:
            if _IS_WEB:
                import platform
                raw = platform.window.localStorage.getItem(_STORE_KEY)
            else:
                path = self._file_path()
                if os.path.exists(path):
                    with open(path, 'r', encoding='utf-8') as f:
                        raw = f.read()
        except Exception:
            raw = None
        if not raw:
            return
        try:
            stored = json.loads(str(raw))
        except (ValueError, TypeError):
            return
        if not isinstance(stored, dict):
            return
        modes = stored.get('modes')
        if isinstance(modes, dict):
            for key, target in self._data['modes'].items():
                entry = modes.get(key)
                if not isinstance(entry, dict):
                    continue
                for fld in ('levels', 'losses', 'total_time'):
                    val = entry.get(fld)
                    if isinstance(val, (int, float)) and val >= 0:
                        target[fld] = int(val)
                best = entry.get('best')
                if isinstance(best, (int, float)) and best > 0:
                    target['best'] = int(best)
        for fld in ('streak', 'best_streak'):
            val = stored.get(fld)
            if isinstance(val, (int, float)) and val >= 0:
                self._data[fld] = int(val)
        for seeded in ('daily', 'weekly', 'monthly'):
            block = stored.get(seeded)
            if not isinstance(block, dict):
                continue
            for fld in ('last', 'streak', 'best', 'count'):
                val = block.get(fld)
                if isinstance(val, (int, float)) and val >= 0:
                    self._data[seeded][fld] = int(val)
            bt = block.get('best_time')
            if isinstance(bt, (int, float)) and bt > 0:
                self._data[seeded]['best_time'] = int(bt)
        badges = stored.get('achievements')
        if isinstance(badges, list):
            self._data['achievements'] = [str(b) for b in badges]

    def _save(self):
        try:
            payload = json.dumps(self._data)
            if _IS_WEB:
                import platform
                platform.window.localStorage.setItem(_STORE_KEY, payload)
            else:
                with open(self._file_path(), 'w', encoding='utf-8') as f:
                    f.write(payload)
        except Exception:
            pass

    # ------------------------------------------------------------------
    def record_win(self, difficulty, size, seconds, count_streak=True):
        """Count one solved level for a (difficulty, size) slot. Returns the
        previous best time in that slot (or None if this was the first win).

        Zen wins and retries call this with ``count_streak=False`` and the
        presenter additionally skips the call entirely when records should
        not be tracked at all."""
        key = mode_key(difficulty, size)
        entry = self._data['modes'].get(key)
        if entry is None:
            return None
        previous_best = entry.get('best')
        entry['levels'] += 1
        seconds = max(0, int(seconds))
        entry['total_time'] += seconds
        if seconds > 0 and (previous_best is None
                            or seconds < previous_best):
            entry['best'] = seconds
        if count_streak:
            self._data['streak'] += 1
            self._data['best_streak'] = max(self._data['best_streak'],
                                            self._data['streak'])
        self._save()
        return previous_best

    def record_loss(self, difficulty, size):
        key = mode_key(difficulty, size)
        entry = self._data['modes'].get(key)
        if entry is None:
            return
        entry['losses'] += 1
        self._data['streak'] = 0
        self._save()

    def record_seeded(self, kind, ordinal, seconds):
        """Mark a seeded puzzle (daily / weekly / monthly) for the given
        ordinal cleared. Advances the streak (an adjacent ordinal extends it,
        a gap restarts it). Returns the previous best time, or None."""
        if kind not in ('daily', 'weekly', 'monthly'):
            return None
        block = self._data[kind]
        previous_best = block.get('best_time')
        if block['last'] == ordinal:
            return previous_best                       # already logged
        block['streak'] = (block['streak'] + 1
                            if block['last'] == ordinal - 1 else 1)
        block['best'] = max(block['best'], block['streak'])
        block['last'] = ordinal
        block['count'] += 1
        seconds = max(0, int(seconds))
        if seconds > 0 and (previous_best is None
                            or seconds < previous_best):
            block['best_time'] = seconds
        self._save()
        return previous_best

    def unlock(self, ids):
        """Add achievement ids; return the list that were genuinely new."""
        have = set(self._data['achievements'])
        fresh = [i for i in ids if i not in have]
        if fresh:
            self._data['achievements'].extend(fresh)
            self._save()
        return fresh

    # ------------------------------------------------------------------
    @property
    def win_streak(self):
        return self._data['streak']

    @property
    def best_streak(self):
        return self._data['best_streak']

    @property
    def total_wins(self):
        return sum(m['levels'] for m in self._data['modes'].values())

    @property
    def achievements(self):
        return list(self._data['achievements'])

    def daily(self):
        return dict(self._data['daily'])

    def wins_for(self, difficulty, size):
        """How many wins the player has in one (difficulty, size) slot —
        used by the mode-unlock progression."""
        entry = self._data['modes'].get(mode_key(difficulty, size))
        return int(entry['levels']) if entry else 0

    def best_for(self, difficulty, size):
        entry = self._data['modes'].get(mode_key(difficulty, size))
        return entry['best'] if entry else None

    def summary(self):
        """A fresh copy for the view: per-mode entries, plus the streaks and
        seeded-puzzle figures."""
        out = {
            'modes': {k: dict(v) for k, v in self._data['modes'].items()},
            'streak': self._data['streak'],
            'best_streak': self._data['best_streak'],
            'daily': dict(self._data['daily']),
            'weekly': dict(self._data['weekly']),
            'monthly': dict(self._data['monthly']),
            'total_wins': self.total_wins,
        }
        return out
