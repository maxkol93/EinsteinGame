"""Persistent player settings: volume, difficulty, tooltips, touch
mode and whether the tutorial has been seen.

Same storage strategy as model.stats — a JSON blob in the home directory on
desktop, browser localStorage in the pygbag/web build — and just as
defensive: any failure simply means settings do not persist this session.
"""
import json
import os
import sys


_IS_WEB = sys.platform == 'emscripten'
_STORE_KEY = 'einsteingame_settings'

_DIFFICULTIES = (0, 1, 2)        # easy / normal / hard
_SIZES = (4, 5, 6)               # 3×3 was retired

_DEFAULTS = {
    'volume': 0.7,
    # ambient music loop — quieter than the SFX by default
    'music': 0.5,
    'difficulty': 0,
    'size': 4,
    'tooltips': True,
    'touch': False,
    # accessibility: damp screenshake / slow-mo / particle bursts
    'reduce_motion': False,
    # Zen mode — mistakes never end the run; the board is a calm solve
    'zen': False,
    # how many of the 6 onboarding blocks the player has cleared (0..6).
    # 6 means the whole tutorial is done and every game mode is unlocked.
    'tutorial_blocks': 0,
    # debug flag (set by hidden 'U' key) — once true, every difficulty and
    # board size is unlocked regardless of the per-mode win counts
    'unlock_all': False,
}

TUTORIAL_BLOCKS = 6


class Settings(object):
    def __init__(self):
        self._data = dict(_DEFAULTS)
        self._load()

    # ------------------------------------------------------------------
    @staticmethod
    def _file_path():
        return os.path.join(os.path.expanduser('~'),
                            '.einsteingame_settings.json')

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
        if isinstance(stored, dict):
            self._coerce(stored)

    def _coerce(self, stored):
        """Pull only known, validated keys out of whatever was stored."""
        try:
            v = float(stored.get('volume', self._data['volume']))
            self._data['volume'] = min(1.0, max(0.0, v))
        except (ValueError, TypeError):
            pass
        try:
            mv = float(stored.get('music', self._data['music']))
            self._data['music'] = min(1.0, max(0.0, mv))
        except (ValueError, TypeError):
            pass
        try:
            d = int(stored.get('difficulty', self._data['difficulty']))
            if d in _DIFFICULTIES:
                self._data['difficulty'] = d
        except (ValueError, TypeError):
            pass
        try:
            sz = int(stored.get('size', self._data['size']))
            if sz in _SIZES:
                self._data['size'] = sz
        except (ValueError, TypeError):
            pass
        for flag in ('tooltips', 'touch', 'zen', 'unlock_all',
                     'reduce_motion'):
            if flag in stored:
                self._data[flag] = bool(stored[flag])
        # tutorial progress — a 0..6 block count. Accept the legacy boolean
        # `tutorial_seen` (an old all-or-nothing flag) as "all blocks done".
        try:
            tb = int(stored.get('tutorial_blocks',
                                self._data['tutorial_blocks']))
            self._data['tutorial_blocks'] = min(TUTORIAL_BLOCKS, max(0, tb))
        except (ValueError, TypeError):
            pass
        if (stored.get('tutorial_seen') is True
                and self._data['tutorial_blocks'] == 0):
            self._data['tutorial_blocks'] = TUTORIAL_BLOCKS

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
    def get(self, key):
        return self._data.get(key, _DEFAULTS.get(key))

    def set(self, key, value):
        """Update one setting and persist immediately."""
        if key not in _DEFAULTS:
            return
        if self._data.get(key) == value:
            return
        self._data[key] = value
        self._save()
