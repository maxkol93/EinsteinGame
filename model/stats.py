"""Persistent player progress: per-difficulty results, the win streak, the
Daily-Puzzle streak and the set of unlocked achievements.

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

# Par time (seconds) per (board size, difficulty index) — beating it earns
# the third star. Bigger boards and harder modes get more room.
_PAR = {
    3: (20, 35, 55),
    4: (45, 75, 120),
    5: (70, 120, 185),
    6: (95, 165, 255),
}
_SIZE_WEIGHT = {3: 0.5, 4: 0.7, 5: 0.85, 6: 1.0}


def par_time(size, difficulty):
    """The par (third-star) time for a board, clamped to a known size."""
    row = _PAR.get(size, _PAR[6])
    return row[max(0, min(2, difficulty))]


def _empty_entry():
    return {'levels': 0, 'losses': 0, 'best': None, 'best_score': 0,
            'best_stars': 0, 'total_time': 0}


def _empty():
    return {
        'modes': {'easy': _empty_entry(), 'normal': _empty_entry(),
                  'hard': _empty_entry()},
        'streak': 0,
        'best_streak': 0,
        'daily': {'last': 0, 'streak': 0, 'best': 0, 'count': 0},
        'achievements': [],
    }


def score_and_stars(size, difficulty, seconds, mistakes, hints=0):
    """Rate a finished round. Score rewards speed and a clean run and scales
    with board size; stars are a 1-3 grade (a win is always worth one)."""
    par = par_time(size, difficulty)
    seconds = max(1, int(seconds))
    mistakes = max(0, int(mistakes))
    hints = max(0, int(hints))
    score = 3000 - int(seconds * 3.0) - mistakes * 450 - hints * 250
    score = int(score * _SIZE_WEIGHT.get(size, 1.0))
    score = max(50, score)
    if mistakes == 0 and hints == 0 and seconds <= par:
        stars = 3
    elif mistakes <= 1 and seconds <= par * 2:
        stars = 2
    else:
        stars = 1
    return score, stars


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
        # the legacy save had the three mode entries at the top level; the
        # current one nests them under 'modes' alongside streak/daily/badges
        modes = stored.get('modes') if isinstance(stored.get('modes'),
                                                  dict) else stored
        for key in self._data['modes']:
            entry = modes.get(key)
            if not isinstance(entry, dict):
                continue
            for fld in ('levels', 'losses', 'best_score', 'best_stars',
                        'total_time'):
                val = entry.get(fld)
                if isinstance(val, (int, float)) and val > 0:
                    self._data['modes'][key][fld] = int(val)
            best = entry.get('best')
            if isinstance(best, (int, float)) and best > 0:
                self._data['modes'][key]['best'] = int(best)
        for fld in ('streak', 'best_streak'):
            val = stored.get(fld)
            if isinstance(val, (int, float)) and val >= 0:
                self._data[fld] = int(val)
        daily = stored.get('daily')
        if isinstance(daily, dict):
            for fld in ('last', 'streak', 'best', 'count'):
                val = daily.get(fld)
                if isinstance(val, (int, float)) and val >= 0:
                    self._data['daily'][fld] = int(val)
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
    def record_win(self, difficulty, seconds, score=0, stars=0,
                    count_streak=True):
        """Count one solved level; keep the fastest time, top score, best
        star grade and accumulate total play time for its mode. `count_streak`
        is False for Zen wins — a mode you cannot lose has no meaningful run."""
        key = _DIFF_KEY.get(difficulty)
        if key is None:
            return
        entry = self._data['modes'][key]
        entry['levels'] += 1
        seconds = max(0, int(seconds))
        entry['total_time'] += seconds
        if seconds > 0 and (entry['best'] is None or seconds < entry['best']):
            entry['best'] = seconds
        if int(score) > entry.get('best_score', 0):
            entry['best_score'] = int(score)
        if int(stars) > entry.get('best_stars', 0):
            entry['best_stars'] = int(stars)
        if count_streak:
            self._data['streak'] += 1
            self._data['best_streak'] = max(self._data['best_streak'],
                                            self._data['streak'])
        self._save()

    def record_loss(self, difficulty):
        key = _DIFF_KEY.get(difficulty)
        if key is None:
            return
        self._data['modes'][key]['losses'] += 1
        self._data['streak'] = 0
        self._save()

    def record_daily(self, day):
        """Mark the Daily Puzzle for ordinal `day` solved; advance the daily
        streak (a calendar day later keeps it, a gap restarts it)."""
        d = self._data['daily']
        if d['last'] == day:
            return                       # already logged today
        d['streak'] = d['streak'] + 1 if d['last'] == day - 1 else 1
        d['best'] = max(d['best'], d['streak'])
        d['last'] = day
        d['count'] += 1
        self._save()

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

    def summary(self):
        """A fresh copy for the view: per-mode entries with a win rate and
        average time, plus the streak and daily figures."""
        out = {}
        for key, entry in self._data['modes'].items():
            e = dict(entry)
            wins, losses = e['levels'], e['losses']
            games = wins + losses
            e['winrate'] = int(round(100.0 * wins / games)) if games else 0
            e['avg'] = int(round(e['total_time'] / wins)) if wins else 0
            out[key] = e
        out['streak'] = self._data['streak']
        out['best_streak'] = self._data['best_streak']
        out['daily'] = dict(self._data['daily'])
        out['total_wins'] = self.total_wins
        return out
