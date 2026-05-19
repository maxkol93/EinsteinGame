"""Lightweight sound manager.

Loads the short SFX bank from ``view/sounds/`` and plays effects by name.
Everything degrades gracefully: if the mixer cannot initialise (headless CI,
the web build before the user interacts with the page, no audio device) the
manager simply stays silent — it never raises.
"""
import os

import pygame


# logical effect names; each loads <name>.ogg (preferred) or <name>.wav
_SOUND_KEYS = ['hover', 'spread', 'click', 'pick', 'solve', 'wrong',
               'win', 'lose', 'start']

# Per-sound trim so one master volume slider stays musically balanced.
# Tuned against the normalised SFX bank (every file peaks at -3 dBFS), so
# these set the *mix*: subtle UI ticks, prominent game events.
_SOUND_GAIN = {
    'hover': 0.25, 'spread': 0.45, 'click': 0.80, 'pick': 0.60,
    'solve': 0.80, 'wrong': 0.85, 'win': 0.95, 'lose': 0.90, 'start': 0.72,
}

# Minimum gap (seconds) between repeats of the *same* sound. Every effect is
# throttled now — a rapid burst of identical triggers (a cascade of pops, a
# spammed wrong click, the hover ticking as the cursor sweeps the board) used
# to fire several copies a few milliseconds apart, which comb-filters into a
# flange-y "the sound played three times" mush and stacks toward clipping.
_SOUND_THROTTLE = {
    'hover': 0.06, 'spread': 0.18, 'click': 0.06, 'pick': 0.045,
    'solve': 0.05, 'wrong': 0.15, 'win': 0.30, 'lose': 0.30, 'start': 0.20,
}
_DEFAULT_THROTTLE = 0.06


class SoundManager(object):
    def __init__(self, base_dir=None):
        self._dir = base_dir or os.path.join(os.path.dirname(__file__),
                                              'sounds')
        self._sounds = {}
        self._last_play = {}
        self._volume = 0.7
        self._enabled = False
        self._clock_ms = 0
        self._load()

    # ------------------------------------------------------------------
    def _load(self):
        try:
            if not pygame.mixer.get_init():
                pygame.mixer.init()
            # plenty of voices so an effect never cuts another short
            pygame.mixer.set_num_channels(16)
        except (pygame.error, AttributeError):
            self._enabled = False
            return
        for key in _SOUND_KEYS:
            for ext in ('.ogg', '.wav'):
                path = os.path.join(self._dir, key + ext)
                if not os.path.exists(path):
                    continue
                try:
                    self._sounds[key] = pygame.mixer.Sound(path)
                    break
                except (pygame.error, FileNotFoundError):
                    pass
        self._enabled = bool(self._sounds)
        self._apply_volume()

    def _apply_volume(self):
        for key, snd in self._sounds.items():
            snd.set_volume(self._volume * _SOUND_GAIN.get(key, 1.0))

    # ------------------------------------------------------------------
    @property
    def available(self):
        return self._enabled

    @property
    def volume(self):
        return self._volume

    def set_volume(self, value):
        self._volume = max(0.0, min(1.0, float(value)))
        self._apply_volume()

    def tick(self, dt_ms):
        """Advance the internal clock used for repeat-throttling."""
        self._clock_ms += dt_ms

    def play(self, key):
        if not self._enabled:
            return
        snd = self._sounds.get(key)
        if snd is None:
            return
        gap = _SOUND_THROTTLE.get(key, _DEFAULT_THROTTLE)
        if gap > 0.0:
            last = self._last_play.get(key, -1e9)
            if (self._clock_ms - last) < gap * 1000.0:
                return
        self._last_play[key] = self._clock_ms
        try:
            # Cut any still-ringing copy of this same effect before replaying
            # it. Two identical samples a few ms apart phase-cancel into a
            # hollow, flange-y artefact and their amplitudes sum toward
            # clipping; one clean voice per effect always sounds right.
            snd.stop()
            snd.play()
        except pygame.error:
            pass
