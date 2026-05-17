#!/usr/bin/env python3
"""Procedural SFX generator for Einstein game.

Run once to (re)create the placeholder sound bank in ``view/sounds/``::

    python3 tools/gen_sounds.py

The synthesis is pure standard library — no numpy needed. Output is written
as OGG (the format pygbag needs for the web build). Conversion uses ffmpeg:
the bundled one from ``pip install imageio-ffmpeg`` is used if present,
otherwise a system ``ffmpeg``. With no encoder at all it falls back to WAV
and warns — the desktop build is happy either way, but the web build needs
OGG.

The generated sounds are soft synth placeholders — good enough to ship, but
swap in hand-picked ones any time (see view/sounds/README.md).
"""
import math
import os
import random
import shutil
import struct
import subprocess
import tempfile
import wave

SR = 44100
OUT_DIR = os.path.normpath(os.path.join(os.path.dirname(__file__),
                                        '..', 'view', 'sounds'))


def _find_ffmpeg():
    try:
        import imageio_ffmpeg
        return imageio_ffmpeg.get_ffmpeg_exe()
    except Exception:
        return shutil.which('ffmpeg')


# --------------------------------------------------------------------------
# tiny synth toolkit
# --------------------------------------------------------------------------
def _wave(phase, kind):
    x = phase - math.floor(phase)
    if kind == 'sine':
        return math.sin(2 * math.pi * phase)
    if kind == 'tri':
        return 4 * abs(x - 0.5) - 1
    if kind == 'saw':
        return 2 * x - 1
    if kind == 'square':
        return 1.0 if x < 0.5 else -1.0
    return math.sin(2 * math.pi * phase)


def tone(f0, f1=None, dur=0.2, vol=0.3, kind='sine', decay=4.0,
         attack=0.004, partials=(1.0,), glide='exp'):
    """One synth voice: pitch glide f0->f1 with an exponential amp decay."""
    if f1 is None:
        f1 = f0
    n = max(1, int(dur * SR))
    atk = max(1, int(attack * SR))
    out = [0.0] * n
    phase = 0.0
    for i in range(n):
        t = i / n
        if glide == 'exp' and f0 > 0 and f1 > 0:
            f = f0 * (f1 / f0) ** t
        else:
            f = f0 + (f1 - f0) * t
        phase += f / SR
        env = math.exp(-decay * t)
        if i < atk:
            env *= i / atk
        s = 0.0
        for k, amp in enumerate(partials, 1):
            s += amp * _wave(phase * k, kind)
        out[i] = s * env * vol
    return out


def noise(dur, vol, decay=8.0, lp=1.0):
    """Lowpass-filtered noise burst (lp in (0, 1]; smaller = darker)."""
    n = max(1, int(dur * SR))
    out = [0.0] * n
    prev = 0.0
    for i in range(n):
        t = i / n
        prev += (random.uniform(-1, 1) - prev) * lp
        out[i] = prev * math.exp(-decay * t) * vol
    return out


def shape(track, fn):
    """Multiply a track by an envelope function of normalised time."""
    n = len(track)
    return [s * fn(i / n) for i, s in enumerate(track)] if n else track


def delay(track, seconds):
    return [0.0] * int(seconds * SR) + list(track)


def mix(*tracks):
    n = max((len(t) for t in tracks), default=0)
    out = [0.0] * n
    for t in tracks:
        for i, s in enumerate(t):
            out[i] += s
    return out


def _soft_clip(track):
    return [math.tanh(s) for s in track]


def _normalize(track, peak=0.86):
    m = max((abs(s) for s in track), default=0.0)
    if m < 1e-6:
        return track
    g = peak / m
    return [s * g for s in track]


_FFMPEG = _find_ffmpeg()


def write(name, track):
    """Write one sound as ``<name>.ogg`` (or ``.wav`` if no encoder)."""
    track = _normalize(_soft_clip(track))
    raw = b''.join(struct.pack('<h', int(max(-1.0, min(1.0, s)) * 32767))
                   for s in track)
    tmp_wav = os.path.join(tempfile.gettempdir(), 'einstein_%s.wav' % name)
    with wave.open(tmp_wav, 'w') as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(SR)
        w.writeframes(raw)
    dur = len(track) / SR
    if _FFMPEG:
        out = os.path.join(OUT_DIR, name + '.ogg')
        subprocess.run([_FFMPEG, '-y', '-loglevel', 'error', '-i', tmp_wav,
                        '-c:a', 'libvorbis', '-q:a', '5', out], check=True)
        os.remove(tmp_wav)
        print('  wrote %-14s %.2fs' % (name + '.ogg', dur))
    else:
        out = os.path.join(OUT_DIR, name + '.wav')
        shutil.move(tmp_wav, out)
        print('  wrote %-14s %.2fs  (WAV - install imageio-ffmpeg for OGG)'
              % (name + '.wav', dur))


# --------------------------------------------------------------------------
# the sound bank
# --------------------------------------------------------------------------
def build():
    os.makedirs(OUT_DIR, exist_ok=True)
    random.seed(7)
    print('Generating SFX into', OUT_DIR)

    # hover — a very soft, short tick when the cursor lands on a tile
    write('hover', tone(1760, 1900, 0.055, 0.5, 'sine', decay=17,
                            attack=0.002, partials=(1.0, 0.16)))

    # spread — gentle rising shimmer when the value-match highlight fans out
    write('spread', mix(
        tone(1245, 1320, 0.17, 0.42, 'sine', decay=9, partials=(1.0, 0.2)),
        delay(tone(1660, 1760, 0.16, 0.32, 'sine', decay=9), 0.05),
    ))

    # click — crisp UI button click
    write('click', mix(
        noise(0.035, 0.6, decay=65, lp=0.55),
        tone(640, 360, 0.06, 0.5, 'tri', decay=24),
    ))

    # pick — bright "pip" when a small tile is cleared
    write('pick', mix(
        tone(720, 1280, 0.11, 0.62, 'sine', decay=11,
             partials=(1.0, 0.3, 0.1)),
        noise(0.02, 0.22, decay=90, lp=0.4),
    ))

    # solve — satisfying bloom chord + ping when a cell is solved
    write('solve', mix(
        tone(523.25, 523.25, 0.34, 0.42, 'sine', decay=5.5,
             partials=(1.0, 0.4, 0.15)),
        delay(tone(659.25, 659.25, 0.32, 0.36, 'sine', decay=5.5,
                   partials=(1.0, 0.35)), 0.025),
        delay(tone(783.99, 783.99, 0.34, 0.34, 'sine', decay=5.0,
                   partials=(1.0, 0.3)), 0.05),
        delay(tone(1567.98, 1567.98, 0.28, 0.16, 'sine', decay=7), 0.05),
        noise(0.03, 0.28, decay=80, lp=0.5),
    ))

    # wrong — low descending "thunk"
    write('wrong', mix(
        tone(196, 90, 0.30, 0.7, 'tri', decay=6.0,
             partials=(1.0, 0.5, 0.25)),
        tone(150, 70, 0.30, 0.4, 'sine', decay=6.5),
        noise(0.10, 0.33, decay=24, lp=0.25),
    ))

    # win — ascending major arpeggio with a sparkle tail
    win_notes = [523.25, 659.25, 783.99, 1046.50]
    voices = []
    for i, f in enumerate(win_notes):
        d = 0.55 if i < 3 else 0.92
        voices.append(delay(
            tone(f, f, d, 0.45, 'sine', decay=3.2 if i == 3 else 4.6,
                 partials=(1.0, 0.4, 0.16, 0.06)),
            i * 0.12))
    voices.append(delay(noise(0.5, 0.1, decay=5, lp=0.14), 0.36))
    write('win', mix(*voices))

    # lose — slow descending minor figure
    lose_notes = [440.0, 349.23, 293.66, 220.0]
    voices = []
    for i, f in enumerate(lose_notes):
        d = 0.5 if i < 3 else 0.95
        voices.append(delay(
            tone(f, f * 0.995, d, 0.5, 'tri', decay=3.4,
                 partials=(1.0, 0.35, 0.12)),
            i * 0.17))
    write('lose', mix(*voices))

    # start — soft upward whoosh for the board cascade
    sweep = shape(noise(0.42, 0.5, decay=0.6, lp=0.06),
                  lambda t: math.sin(math.pi * t) ** 1.4)
    swell = shape(mix(
        tone(220, 460, 0.4, 0.18, 'sine', decay=1.1, glide='exp'),
        tone(330, 690, 0.4, 0.11, 'sine', decay=1.1, glide='exp'),
    ), lambda t: math.sin(math.pi * min(1.0, t)) ** 1.2)
    write('start', mix(sweep, swell))

    print('Done.')


if __name__ == '__main__':
    build()
