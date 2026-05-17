"""Persistent per-difficulty progress: levels solved and the best time.

Stored as JSON. On the desktop it lives in the user's home directory; in the
pygbag/web build it is kept in the browser's localStorage. Every access is
defensive — a missing file, a read-only filesystem or no storage at all must
never crash the game, it just means the stats do not persist.
"""
import json
import os
import sys


_COMPLEXITY_KEY = {20: 'easy', 10: 'normal', 0: 'hard'}
_IS_WEB = sys.platform == 'emscripten'
_STORE_KEY = 'einsteingame_stats'

# Par time (seconds) per difficulty — beating it earns the third star.
_PAR_SECONDS = {20: 80, 10: 150, 0: 250}


def _empty_entry():
    return {'levels': 0, 'best': None, 'best_score': 0, 'best_stars': 0}


def _empty():
    return {'easy': _empty_entry(), 'normal': _empty_entry(),
            'hard': _empty_entry()}


def score_and_stars(complexity, seconds, mistakes):
    """Rate a finished round. Score rewards speed and a clean run; stars are
    a 1-3 grade (winning at all is always worth at least one)."""
    par = _PAR_SECONDS.get(complexity, 150)
    seconds = max(1, int(seconds))
    mistakes = max(0, int(mistakes))
    score = 3000 - int(seconds * 3.0) - mistakes * 450
    score = max(50, score)
    if mistakes == 0 and seconds <= par:
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
        for key in self._data:
            entry = stored.get(key) if isinstance(stored, dict) else None
            if not isinstance(entry, dict):
                continue
            try:
                self._data[key]['levels'] = max(0, int(entry.get('levels', 0)))
            except (ValueError, TypeError):
                pass
            best = entry.get('best')
            if isinstance(best, (int, float)) and best > 0:
                self._data[key]['best'] = int(best)
            for fld in ('best_score', 'best_stars'):
                val = entry.get(fld)
                if isinstance(val, (int, float)) and val > 0:
                    self._data[key][fld] = int(val)

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
    def record_win(self, complexity, seconds, score=0, stars=0):
        """Count one solved level; keep the fastest time, top score and best
        star grade for its mode."""
        key = _COMPLEXITY_KEY.get(complexity)
        if key is None:
            return
        entry = self._data[key]
        entry['levels'] += 1
        seconds = int(seconds)
        if seconds > 0 and (entry['best'] is None or seconds < entry['best']):
            entry['best'] = seconds
        if int(score) > entry.get('best_score', 0):
            entry['best_score'] = int(score)
        if int(stars) > entry.get('best_stars', 0):
            entry['best_stars'] = int(stars)
        self._save()

    def summary(self):
        """A fresh copy safe to hand to the view layer."""
        return {k: dict(v) for k, v in self._data.items()}
