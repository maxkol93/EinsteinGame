"""Persistent player settings: volume, palette, difficulty, tooltips, touch
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

_PALETTES = ('mocha', 'nord', 'sunset')
_COMPLEXITIES = (20, 10, 0)

_DEFAULTS = {
    'volume': 0.7,
    'palette': 'mocha',
    'complexity': 20,
    'tooltips': True,
    'touch': False,
    'tutorial_seen': False,
}


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
        if stored.get('palette') in _PALETTES:
            self._data['palette'] = stored['palette']
        try:
            c = int(stored.get('complexity', self._data['complexity']))
            if c in _COMPLEXITIES:
                self._data['complexity'] = c
        except (ValueError, TypeError):
            pass
        for flag in ('tooltips', 'touch', 'tutorial_seen'):
            if flag in stored:
                self._data[flag] = bool(stored[flag])

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
