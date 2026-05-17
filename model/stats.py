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


def _empty():
    return {'easy': {'levels': 0, 'best': None},
            'normal': {'levels': 0, 'best': None},
            'hard': {'levels': 0, 'best': None}}


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
    def record_win(self, complexity, seconds):
        """Count one solved level and keep the fastest time for its mode."""
        key = _COMPLEXITY_KEY.get(complexity)
        if key is None:
            return
        entry = self._data[key]
        entry['levels'] += 1
        seconds = int(seconds)
        if seconds > 0 and (entry['best'] is None or seconds < entry['best']):
            entry['best'] = seconds
        self._save()

    def summary(self):
        """A fresh copy safe to hand to the view layer."""
        return {k: dict(v) for k, v in self._data.items()}
