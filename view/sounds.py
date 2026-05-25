"""Lightweight sound manager.

Loads the short SFX bank from ``view/sounds/`` and plays effects by name.
Everything degrades gracefully: if the mixer cannot initialise (headless CI,
the web build before the user interacts with the page, no audio device) the
manager simply stays silent — it never raises.
"""
import os

import pygame


# logical effect names; each loads <name>.ogg (preferred) or <name>.wav.
# pick_2/3/4 are higher-pitched variants of pick, played by cascade depth so a
# chain reads as a rising arpeggio (combo-pitch).
# NOTE: 'hover' was dropped — on the web (emscripten) the SDL mixer stutters
# under a steady trickle of voices, and a per-hover tick is the densest, least
# valuable one. Fewer, deliberate sounds keep the audio thread from lagging.
_SOUND_KEYS = ['spread', 'click', 'pick', 'pick_2', 'pick_3',
               'pick_4', 'solve', 'wrong', 'win', 'lose', 'start']

# A looping ambient bed, played on a reserved channel with its own volume.
_MUSIC_KEY = 'ambient_loop'

# Per-sound trim so one master volume slider stays musically balanced.
# Tuned against the normalised SFX bank (every file peaks at -3 dBFS), so
# these set the *mix*: subtle UI ticks, prominent game events.
_SOUND_GAIN = {
    'hover': 0.25, 'spread': 0.45, 'click': 0.80, 'pick': 0.60,
    'pick_2': 0.60, 'pick_3': 0.60, 'pick_4': 0.60,
    'solve': 0.80, 'wrong': 0.85, 'win': 0.95, 'lose': 0.90, 'start': 0.72,
}

# Minimum gap (seconds) between repeats of the *same* sound. Every effect is
# throttled now — a rapid burst of identical triggers (a cascade of pops, a
# spammed wrong click, the hover ticking as the cursor sweeps the board) used
# to fire several copies a few milliseconds apart, which comb-filters into a
# flange-y "the sound played three times" mush and stacks toward clipping.
_SOUND_THROTTLE = {
    'hover': 0.06, 'spread': 0.18, 'click': 0.06, 'pick': 0.045,
    'pick_2': 0.045, 'pick_3': 0.045, 'pick_4': 0.045,
    'solve': 0.05, 'wrong': 0.15, 'win': 0.30, 'lose': 0.30, 'start': 0.20,
}
_DEFAULT_THROTTLE = 0.06

# pitch step (0-based cascade depth) -> sound key
_PICK_LADDER = ('pick', 'pick_2', 'pick_3', 'pick_4')


class SoundManager(object):
    # Channel 0 is reserved for the ambient music loop so a burst of SFX never
    # steals it (Sound.play() auto-allocates among the non-reserved channels).
    _MUSIC_CHANNEL = 0

    def __init__(self, base_dir=None):
        self._dir = base_dir or os.path.join(os.path.dirname(__file__),
                                              'sounds')
        self._sounds = {}
        self._last_play = {}
        self._volume = 0.7
        self._enabled = False
        self._clock_ms = 0
        # ambient music
        self._music = None
        self._music_channel = None
        self._music_volume = 0.5
        self._music_on = False
        self._last_music_check = 0
        self._load()

    # ------------------------------------------------------------------
    def _load(self):
        try:
            if not pygame.mixer.get_init():
                pygame.mixer.init()
            # keep the channel count modest — every mixed voice costs the
            # emscripten audio thread, and the cascade no longer needs many
            pygame.mixer.set_num_channels(8)
            # keep channel 0 out of the auto-allocation pool for the music loop
            pygame.mixer.set_reserved(1)
            self._music_channel = pygame.mixer.Channel(self._MUSIC_CHANNEL)
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
        for ext in ('.ogg', '.wav'):
            path = os.path.join(self._dir, _MUSIC_KEY + ext)
            if os.path.exists(path):
                try:
                    self._music = pygame.mixer.Sound(path)
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

    @property
    def music_volume(self):
        return self._music_volume

    def set_music_volume(self, value):
        self._music_volume = max(0.0, min(1.0, float(value)))
        if self._music_channel is not None:
            try:
                self._music_channel.set_volume(self._music_volume)
            except pygame.error:
                pass

    def start_music(self):
        """Begin (or resume) the ambient loop on its reserved channel. Safe to
        call repeatedly — it never restarts an already-playing loop. On the web
        build the audio context may be suspended until the first user gesture;
        the loop simply becomes audible once it resumes."""
        if self._music is None or self._music_channel is None:
            return
        self._music_on = True
        try:
            if not self._music_channel.get_busy():
                self._music_channel.play(self._music, loops=-1)
            self._music_channel.set_volume(self._music_volume)
        except pygame.error:
            pass

    def stop_music(self):
        self._music_on = False
        if self._music_channel is not None:
            try:
                self._music_channel.stop()
            except pygame.error:
                pass

    def ensure_music(self):
        """Re-assert the loop if it was asked to play but isn't (covers the
        web build, where it cannot actually start until a user gesture)."""
        if (self._music_on and self._music_channel is not None
                and not self._music_channel.get_busy()):
            self.start_music()

    @staticmethod
    def pick_for_step(step):
        """The pick-sound key for a cascade depth (0-based), capped at the
        top of the pitch ladder."""
        return _PICK_LADDER[max(0, min(step, len(_PICK_LADDER) - 1))]

    def tick(self, dt_ms):
        """Advance the internal clock used for repeat-throttling, and now and
        then re-assert the music loop (the web build can't start it until the
        first user gesture resumes the audio context)."""
        self._clock_ms += dt_ms
        if self._music_on and (self._clock_ms - self._last_music_check) > 1500:
            self._last_music_check = self._clock_ms
            self.ensure_music()

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
            # Just play — no pre-stop. snd.stop() is an extra mixer op per
            # trigger that the emscripten audio thread handles poorly; the
            # per-key throttle above already keeps identical samples from
            # stacking close enough to flange.
            snd.play()
        except pygame.error:
            pass
