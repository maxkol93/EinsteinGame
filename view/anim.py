"""Easing helpers shared by the UI widgets and effects.

Good game-feel comes from a small, consistent set of curves:
- ``approach`` for frame-rate-independent "chase the target" animation,
- ``ease_out_back`` for the snappy overshoot on things that pop in,
- ``ease_out_cubic`` / ``ease_out_quad`` for smooth settles.
"""
import math


def clamp01(x):
    return 0.0 if x < 0.0 else (1.0 if x > 1.0 else x)


def lerp(a, b, t):
    return a + (b - a) * t


def lerp_color(a, b, t):
    t = clamp01(t)
    return tuple(int(round(a[i] + (b[i] - a[i]) * t)) for i in range(3))


def approach(current, target, dt, speed):
    """Exponential approach toward ``target`` — independent of frame rate.

    ``speed`` is roughly "how many e-folds per second"; 12-20 feels snappy.
    """
    k = 1.0 - math.exp(-speed * dt)
    return current + (target - current) * k


def ease_out_cubic(t):
    t = clamp01(t)
    return 1.0 - (1.0 - t) ** 3


def ease_in_cubic(t):
    t = clamp01(t)
    return t ** 3


def ease_out_quad(t):
    t = clamp01(t)
    return 1.0 - (1.0 - t) ** 2


def ease_in_out_cubic(t):
    t = clamp01(t)
    if t < 0.5:
        return 4.0 * t ** 3
    return 1.0 - ((-2.0 * t + 2.0) ** 3) / 2.0


def ease_out_back(t, overshoot=1.70158):
    """Settles slightly past 1.0 then back — great for pop-in scaling."""
    t = clamp01(t)
    c1 = overshoot
    c3 = c1 + 1.0
    u = t - 1.0
    return 1.0 + c3 * u ** 3 + c1 * u ** 2


def ease_out_elastic(t):
    t = clamp01(t)
    if t == 0.0 or t == 1.0:
        return t
    c4 = (2.0 * math.pi) / 3.0
    return math.pow(2.0, -10.0 * t) * math.sin((t * 10.0 - 0.75) * c4) + 1.0


def pulse(t):
    """0 -> 1 -> 0 over t in [0, 1] (sine hump)."""
    return math.sin(math.pi * clamp01(t))
