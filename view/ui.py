"""Screen-level UI: the loading splash, the main menu, the win/lose plaques,
plus the small widgets they are built from (buttons, slider, segmented
control, hearts).

Everything here is self-contained and palette-driven. Widgets follow the same
"chase an animated target" pattern as the board tiles so the whole game has
one consistent, springy feel.
"""
import math
import os

import pygame

from view.anim import (approach, clamp01, ease_out_cubic, ease_out_back,
                       ease_out_quad, lerp, lerp_color, pulse)
from view.buttons import (rounded_fill, rounded_border, soft_shadow,
                          color_for_value)
from view.decoder import symbol_for


# --------------------------------------------------------------------------
# drawing helpers
# --------------------------------------------------------------------------
def _brighten(color, amount):
    return tuple(max(0, min(255, c + amount)) for c in color[:3])


def _fmt_time(seconds):
    seconds = max(0, int(seconds))
    return '%02d:%02d' % (seconds // 60, seconds % 60)


# Optional UI click-sound hook. The window registers a callback here once, so
# every overlay widget — buttons, the segmented controls, toggles, the volume
# slider — answers a press with the 'click' sound, without each overlay
# needing to carry a reference to the sound manager.
_CLICK_SFX = None


def set_click_sfx(callback):
    global _CLICK_SFX
    _CLICK_SFX = callback


# Every overlay is rendered at its natural size, then drawn (and hit-tested)
# scaled by this factor — so the portrait/mobile build can enlarge ALL popups
# uniformly for small screens without re-tuning each panel's fonts and layout.
_UI_SCALE = 1.0


def set_ui_scale(factor):
    global _UI_SCALE
    _UI_SCALE = max(0.5, float(factor))


_PANEL_SHADOW_CACHE = {}


def panel_shadow(w, h, radius):
    """A big, soft drop shadow for a plaque-sized panel (cached)."""
    key = (int(w), int(h), int(radius))
    cached = _PANEL_SHADOW_CACHE.get(key)
    if cached is not None:
        return cached
    pad = 44
    sw, sh = w + pad * 2, h + pad * 2
    surf = pygame.Surface((sw, sh), pygame.SRCALPHA)
    pygame.draw.rect(surf, (0, 0, 0, 165), (pad, pad + 16, w, h),
                     border_radius=radius + 6)
    small = pygame.transform.smoothscale(
        surf, (max(1, sw // 6), max(1, sh // 6)))
    surf = pygame.transform.smoothscale(small, (sw, sh))
    _PANEL_SHADOW_CACHE[key] = surf
    return surf


def draw_panel(surface, rect, bg_color, radius=22, border_color=None):
    """A rounded plaque: solid body, a soft top sheen, optional border.

    The sheen is a smooth vertical fade (not a hard half-fill) so there is no
    visible seam across the middle of the panel.
    """
    rect = pygame.Rect(rect)
    surface.blit(rounded_fill(rect.w, rect.h, bg_color, radius), rect.topleft)
    # top sheen — fades to nothing by mid-panel
    sheen = pygame.Surface((rect.w, rect.h), pygame.SRCALPHA)
    tint = _brighten(bg_color, 20)
    for yy in range(rect.h):
        f = 1.0 - (yy / rect.h) / 0.5
        if f <= 0.0:
            break
        a = int(150 * (f ** 1.6))
        pygame.draw.line(sheen, (*tint, a), (0, yy), (rect.w, yy))
    mask = rounded_fill(rect.w, rect.h, (255, 255, 255), radius)
    sheen.blit(mask, (0, 0), special_flags=pygame.BLEND_RGBA_MIN)
    surface.blit(sheen, rect.topleft)
    if border_color is not None:
        surface.blit(rounded_border(rect.w, rect.h, border_color, radius, 1),
                     rect.topleft)


def draw_text(surface, text, font, color, center=None, topleft=None,
              alpha=255):
    img = font.render(str(text), True, color)
    if alpha < 255:
        img = img.copy()
        img.set_alpha(alpha)
    if center is not None:
        surface.blit(img, img.get_rect(center=center))
    else:
        surface.blit(img, topleft)
    return img.get_size()


def draw_text_spaced(surface, text, font, color, center, spacing,
                     reveal=1.0):
    """Letter-spaced text with an optional per-letter rise/fade reveal."""
    glyphs = [font.render(ch, True, color) for ch in text]
    widths = [g.get_width() for g in glyphs]
    total = sum(widths) + spacing * (len(glyphs) - 1)
    x = center[0] - total / 2.0
    n = max(1, len(glyphs))
    for i, g in enumerate(glyphs):
        local = clamp01((reveal * (n + 4) - i) / 4.0)
        e = ease_out_back(local)
        a = int(255 * clamp01(local * 1.4))
        yoff = (1.0 - e) * -16.0
        gg = g
        if a < 255:
            gg = g.copy()
            gg.set_alpha(a)
        surface.blit(gg, (int(x), int(center[1] - g.get_height() / 2 + yoff)))
        x += widths[i] + spacing


# --------------------------------------------------------------------------
# hearts
# --------------------------------------------------------------------------
_HEART_CACHE = {}


def make_heart(size, color, filled=True):
    key = (size, tuple(color[:3]), filled)
    cached = _HEART_CACHE.get(key)
    if cached is not None:
        return cached
    ss = 4
    big = pygame.Surface((size * ss, size * ss), pygame.SRCALPHA)
    cx = size * ss * 0.5
    cy = size * ss * 0.44
    scale = size * ss / 35.0
    pts = []
    for deg in range(0, 360, 6):
        t = math.radians(deg)
        x = 16 * math.sin(t) ** 3
        y = (13 * math.cos(t) - 5 * math.cos(2 * t)
             - 2 * math.cos(3 * t) - math.cos(4 * t))
        pts.append((cx + x * scale, cy - y * scale))
    if filled:
        pygame.draw.polygon(big, (*color[:3], 255), pts)
        hl = pygame.Surface(big.get_size(), pygame.SRCALPHA)
        pygame.draw.ellipse(hl, (255, 255, 255, 70),
                            (cx - 11 * scale, cy - 12 * scale,
                             10 * scale, 7 * scale))
        big.blit(hl, (0, 0))
    else:
        pygame.draw.polygon(big, (*color[:3], 55), pts)
        pygame.draw.polygon(big, (*color[:3], 150), pts, max(3, int(scale * 3)))
    out = pygame.transform.smoothscale(big, (size, size))
    _HEART_CACHE[key] = out
    return out


# --------------------------------------------------------------------------
# stars
# --------------------------------------------------------------------------
STAR_GOLD = (255, 206, 110)
_STAR_CACHE = {}


def make_star(size, color, filled=True):
    """A 5-point star sprite (cached)."""
    key = (size, tuple(color[:3]), filled)
    cached = _STAR_CACHE.get(key)
    if cached is not None:
        return cached
    ss = 4
    big = pygame.Surface((size * ss, size * ss), pygame.SRCALPHA)
    cx = cy = size * ss / 2.0
    outer = size * ss * 0.47
    inner = outer * 0.42
    pts = []
    for i in range(10):
        ang = -math.pi / 2 + i * math.pi / 5
        rad = outer if i % 2 == 0 else inner
        pts.append((cx + rad * math.cos(ang), cy + rad * math.sin(ang)))
    if filled:
        pygame.draw.polygon(big, (*color[:3], 255), pts)
        pygame.draw.polygon(big, (*_brighten(color, 50), 255), pts, ss)
    else:
        pygame.draw.polygon(big, (*color[:3], 55), pts)
        pygame.draw.polygon(big, (*color[:3], 150), pts, max(3, ss))
    out = pygame.transform.smoothscale(big, (size, size))
    _STAR_CACHE[key] = out
    return out


def draw_stars(surface, center, count, size=30, gap=12, total=3):
    """A centred row of `total` stars, `count` of them filled gold."""
    span = total * size + (total - 1) * gap
    x = center[0] - span // 2
    for i in range(total):
        spr = make_star(size, STAR_GOLD, filled=(i < count))
        surface.blit(spr, (x, center[1] - size // 2))
        x += size + gap


def wrap_text(text, font, max_w):
    """Greedy word-wrap into a list of lines that each fit `max_w`."""
    lines, cur = [], ''
    for word in str(text).split():
        trial = (cur + ' ' + word).strip()
        if not cur or font.size(trial)[0] <= max_w:
            cur = trial
        else:
            lines.append(cur)
            cur = word
    if cur:
        lines.append(cur)
    return lines or ['']


# --------------------------------------------------------------------------
# widgets
# --------------------------------------------------------------------------
class TextButton(object):
    """A rounded label button that lifts, glows and squishes."""

    def __init__(self, rect, label, font, base_color, text_color,
                 on_click=None, radius=12, accent=None):
        self.rect = pygame.Rect(rect)
        self.label = label
        self.font = font
        self.base_color = base_color
        self.text_color = text_color
        self.accent = accent
        self.on_click = on_click
        self.radius = radius
        self.enabled = True
        self.visible = True
        self.hover = 0.0
        self._hover_target = 0.0
        self.press = 0.0
        self._held = False

    def update(self, dt, mouse_pos):
        over = (self.enabled and self.visible
                and self.rect.collidepoint(mouse_pos))
        self._hover_target = 1.0 if over else 0.0
        self.hover = approach(self.hover, self._hover_target, dt, 16)
        if self.press > 0.0:
            self.press = max(0.0, self.press - dt * 5.5)

    def handle_event(self, event):
        if not (self.enabled and self.visible):
            return False
        if event.type == pygame.MOUSEBUTTONDOWN and event.button == 1:
            if self.rect.collidepoint(event.pos):
                self._held = True
        elif event.type == pygame.MOUSEBUTTONUP and event.button == 1:
            hit = self._held and self.rect.collidepoint(event.pos)
            self._held = False
            if hit:
                self.press = 1.0
                if self.on_click:
                    self.on_click()
                return True
        return False

    def _render_face(self):
        w, h = self.rect.size
        face = pygame.Surface((w, h), pygame.SRCALPHA)
        color = self.base_color
        if not self.enabled:
            color = lerp_color(color, (90, 90, 95), 0.5)
        elif self.hover > 0.01:
            color = _brighten(color, int(40 * self.hover))
        face.blit(rounded_fill(w, h, color, self.radius), (0, 0))
        if self.accent is not None:
            face.blit(rounded_border(w, h, self.accent, self.radius, 2),
                      (0, 0))
        tcol = self.text_color
        if not self.enabled:
            tcol = lerp_color(tcol, color, 0.45)
        img = self.font.render(self.label, True, tcol)
        face.blit(img, img.get_rect(center=(w // 2, h // 2)))
        return face

    def draw(self, surface):
        if not self.visible:
            return
        w, h = self.rect.size
        lift = self.hover if self.enabled else 0.0
        scale = 1.0 + 0.035 * lift - 0.055 * self.press
        sw = max(1, int(round(w * scale)))
        sh = max(1, int(round(h * scale)))
        face = self._render_face()
        if (sw, sh) != (w, h):
            face = pygame.transform.smoothscale(face, (sw, sh))
        cx = self.rect.centerx
        cy = self.rect.centery - int(round(5 * lift))
        if lift > 0.02:
            shadow = soft_shadow(sw, sh, self.radius,
                                 alpha=int(110 * lift) + 25)
            surface.blit(shadow, (cx - shadow.get_width() // 2,
                                  cy - shadow.get_height() // 2
                                  + int(5 * lift) + 5))
        surface.blit(face, (cx - sw // 2, cy - sh // 2))


class Segmented(object):
    """A segmented control (used to pick difficulty / board size).

    Each option can be flagged ``locked``: it still renders but with a small
    padlock glyph, a dimmer face and click attempts emit a tooltip via the
    optional ``on_locked_attempt`` callback rather than selecting it."""

    def __init__(self, rect, options, index, font, base_color, active_color,
                 text_color, on_select=None, locked=None,
                 on_locked_attempt=None):
        self.rect = pygame.Rect(rect)
        self.options = options  # list of (label, value)
        self.index = index
        self.font = font
        self.base_color = base_color
        self.active_color = active_color
        self.text_color = text_color
        self.on_select = on_select
        self.on_locked_attempt = on_locked_attempt
        self.enabled = True
        self.locked = list(locked or [False] * len(options))
        self._hover = [0.0] * len(options)

    def _seg_rect(self, i):
        n = len(self.options)
        gap = 6
        w = (self.rect.w - gap * (n - 1)) / n
        return pygame.Rect(int(self.rect.x + i * (w + gap)), self.rect.y,
                           int(w), self.rect.h)

    def update(self, dt, mouse_pos):
        for i in range(len(self.options)):
            over = self._seg_rect(i).collidepoint(mouse_pos)
            self._hover[i] = approach(self._hover[i], 1.0 if over else 0.0,
                                      dt, 16)

    def handle_event(self, event):
        if not self.enabled:
            return False
        if event.type == pygame.MOUSEBUTTONDOWN and event.button == 1:
            for i in range(len(self.options)):
                if self._seg_rect(i).collidepoint(event.pos):
                    if i < len(self.locked) and self.locked[i]:
                        if self.on_locked_attempt:
                            self.on_locked_attempt(self.options[i][1])
                        return True
                    self.index = i
                    if self.on_select:
                        self.on_select(self.options[i][1])
                    return True
        return False

    def draw(self, surface):
        for i, (label, _value) in enumerate(self.options):
            r = self._seg_rect(i)
            active = (i == self.index)
            locked = i < len(self.locked) and self.locked[i]
            if not self.enabled:
                color = lerp_color(self.base_color, (58, 58, 62), 0.55)
                if active:
                    color = lerp_color(self.active_color, (96, 96, 100), 0.6)
                tcol = lerp_color(self.text_color, color, 0.5)
            elif locked:
                color = lerp_color(self.base_color, (40, 40, 44), 0.55)
                tcol = lerp_color(self.text_color, color, 0.5)
            else:
                if active:
                    color = self.active_color
                else:
                    color = _brighten(self.base_color,
                                      int(26 * self._hover[i]))
                tcol = (30, 30, 34) if active else self.text_color
            surface.blit(rounded_fill(r.w, r.h, color, 9), r.topleft)
            img = self.font.render(label, True, tcol)
            surface.blit(img, img.get_rect(center=r.center))
            if locked:
                # small padlock glyph anchored to the segment's top-right
                self._draw_lock(surface, r, tcol)

    @staticmethod
    def _draw_lock(surface, r, color):
        cx = r.right - 9
        cy = r.top + 9
        pygame.draw.rect(surface, color, (cx - 4, cy - 1, 8, 6),
                         border_radius=1)
        pygame.draw.arc(surface, color, (cx - 4, cy - 6, 8, 9),
                        math.pi * 0.05, math.pi * 0.95, 2)


class Slider(object):
    """Horizontal value slider in [0, 1]."""

    def __init__(self, rect, value, font, track_color, fill_color,
                 text_color, on_change=None):
        self.rect = pygame.Rect(rect)  # the track's visual rect
        self.value = clamp01(value)
        self.font = font
        self.track_color = track_color
        self.fill_color = fill_color
        self.text_color = text_color
        self.on_change = on_change
        self._drag = False
        self.hover = 0.0

    def _hit_rect(self):
        return self.rect.inflate(20, 26)

    def _value_at(self, x):
        return clamp01((x - self.rect.x) / max(1, self.rect.w))

    def _handle_x(self):
        return int(self.rect.x + self.value * self.rect.w)

    def update(self, dt, mouse_pos):
        over = self._hit_rect().collidepoint(mouse_pos) or self._drag
        self.hover = approach(self.hover, 1.0 if over else 0.0, dt, 16)

    def _set(self, x):
        v = self._value_at(x)
        if v != self.value:
            self.value = v
            if self.on_change:
                self.on_change(v)

    def handle_event(self, event):
        if event.type == pygame.MOUSEBUTTONDOWN and event.button == 1:
            if self._hit_rect().collidepoint(event.pos):
                self._drag = True
                self._set(event.pos[0])
                return True
        elif event.type == pygame.MOUSEBUTTONUP and event.button == 1:
            self._drag = False
        elif event.type == pygame.MOUSEMOTION and self._drag:
            self._set(event.pos[0])
            return True
        return False

    def draw(self, surface):
        r = self.rect
        cy = r.centery
        surface.blit(rounded_fill(r.w, 6, self.track_color, 3), (r.x, cy - 3))
        fw = max(0, self._handle_x() - r.x)
        if fw > 0:
            surface.blit(rounded_fill(fw, 6, self.fill_color, 3),
                         (r.x, cy - 3))
        hx = self._handle_x()
        radius = int(8 + 3 * self.hover)
        knob = pygame.Surface((radius * 2 + 8, radius * 2 + 8),
                              pygame.SRCALPHA)
        c = (radius + 4, radius + 4)
        pygame.draw.circle(knob, (0, 0, 0, 80), (c[0], c[1] + 2), radius)
        pygame.draw.circle(knob, _brighten(self.fill_color, 35), c, radius)
        pygame.draw.circle(knob, (255, 255, 255), c, radius, 2)
        surface.blit(knob, (hx - knob.get_width() // 2,
                            cy - knob.get_height() // 2))
        img = self.font.render('%d%%' % round(self.value * 100), True,
                               self.text_color)
        surface.blit(img, (r.right + 14, cy - img.get_height() // 2))


class Toggle(object):
    """A labelled on/off pill switch — the whole row is the hit target."""

    def __init__(self, rect, label, value, font, base_color, on_color,
                 text_color, on_change=None):
        self.rect = pygame.Rect(rect)
        self.label = label
        self.value = bool(value)
        self.font = font
        self.base_color = base_color
        self.on_color = on_color
        self.text_color = text_color
        self.on_change = on_change
        self.hover = 0.0
        self.knob = 1.0 if self.value else 0.0

    SWITCH_W = 48
    SWITCH_H = 26

    def _switch_rect(self):
        return pygame.Rect(self.rect.right - self.SWITCH_W,
                           self.rect.centery - self.SWITCH_H // 2,
                           self.SWITCH_W, self.SWITCH_H)

    def update(self, dt, mouse_pos):
        over = self.rect.collidepoint(mouse_pos)
        self.hover = approach(self.hover, 1.0 if over else 0.0, dt, 16)
        self.knob = approach(self.knob, 1.0 if self.value else 0.0, dt, 18)

    def handle_event(self, event):
        if event.type == pygame.MOUSEBUTTONDOWN and event.button == 1:
            if self.rect.collidepoint(event.pos):
                self.value = not self.value
                if self.on_change:
                    self.on_change(self.value)
                return True
        return False

    def draw(self, surface):
        tcol = _brighten(self.text_color, int(18 * self.hover))
        img = self.font.render(self.label, True, tcol)
        surface.blit(img, (self.rect.x,
                            self.rect.centery - img.get_height() // 2))
        sw = self._switch_rect()
        track = lerp_color(self.base_color, self.on_color, self.knob)
        surface.blit(rounded_fill(sw.w, sw.h, track, sw.h // 2), sw.topleft)
        kr = sw.h - 8
        kx = sw.x + 4 + int((sw.w - kr - 8) * self.knob)
        pygame.draw.circle(surface, (250, 250, 252),
                           (kx + kr // 2, sw.centery), kr // 2)


# --------------------------------------------------------------------------
# loading splash
# --------------------------------------------------------------------------
class LoadingScreen(object):
    MIN_TIME = 1.7

    def __init__(self, fonts_dir, palette):
        self._palette = palette
        self._title_font = pygame.font.Font(
            os.path.join(fonts_dir, 'DejaVuSans-Bold.ttf'), 52)
        self._sub_font = pygame.font.Font(
            os.path.join(fonts_dir, 'DejaVuSans.ttf'), 15)
        self.t = 0.0
        self.progress = 0.0
        self._fade = 0.0
        self.finished = False

    def update(self, dt):
        self.t += dt
        self.progress = ease_out_cubic(clamp01(self.t / self.MIN_TIME))
        if self.t >= self.MIN_TIME + 0.15:
            self._fade = min(1.0, self._fade + dt * 2.6)
            if self._fade >= 1.0:
                self.finished = True

    def draw(self, surface):
        w, h = surface.get_size()
        surface.fill(self._palette['bg'])
        cx = w // 2
        text = self._palette['text']
        accent = self._palette['accent']

        # six palette dots — a quiet nod to the game's six rows
        reveal = clamp01(self.t / 0.7)
        rows = self._palette['rows']
        n = 6
        dot_gap = 26
        total = dot_gap * (n - 1)
        for i in range(n):
            local = clamp01((reveal * (n + 3) - i) / 3.0)
            e = ease_out_back(local)
            dx = cx - total / 2 + i * dot_gap
            dy = h // 2 - 96
            rad = int(7 * e)
            if rad > 0:
                pygame.draw.circle(surface, rows[i + 1], (int(dx), dy), rad)

        draw_text_spaced(surface, 'EINSTEIN', self._title_font, text,
                         (cx, h // 2 - 24), spacing=10,
                         reveal=clamp01(self.t / 0.9))

        bar_w, bar_h = 240, 4
        bx, by = cx - bar_w // 2, h // 2 + 34
        surface.blit(rounded_fill(bar_w, bar_h,
                                  _brighten(self._palette['bg'], 22), 2),
                     (bx, by))
        fw = int(bar_w * self.progress)
        if fw > 0:
            surface.blit(rounded_fill(fw, bar_h, accent, 2), (bx, by))
            sheen_x = bx + (self.t * 150) % max(1, bar_w)
            sh = pygame.Surface((40, bar_h), pygame.SRCALPHA)
            for i in range(40):
                a = int(90 * pulse(i / 40.0))
                pygame.draw.line(sh, (255, 255, 255, a), (i, 0), (i, bar_h))
            prev = surface.get_clip()
            surface.set_clip(pygame.Rect(bx, by, fw, bar_h))
            surface.blit(sh, (sheen_x - 20, by),
                         special_flags=pygame.BLEND_RGBA_ADD)
            surface.set_clip(prev)

        dots = '.' * (1 + int(self.t * 3) % 3)
        draw_text(surface, 'loading' + dots, self._sub_font,
                  _brighten(self._palette['bg'], 70),
                  center=(cx, h // 2 + 60))

        if self._fade > 0.0:
            cover = pygame.Surface((w, h))
            cover.fill(self._palette['bg'])
            cover.set_alpha(int(255 * ease_out_quad(self._fade)))
            surface.blit(cover, (0, 0))


# --------------------------------------------------------------------------
# overlays
# --------------------------------------------------------------------------
class _Overlay(object):
    """Shared entrance/exit animation, dim background and drop shadow."""

    DIM_ALPHA = 170

    def __init__(self, screen_size, palette):
        self.screen_size = screen_size
        self.palette = palette
        self.anim = 0.0
        self.closing = False
        self.dead = False
        self.ui_scale = _UI_SCALE        # uniform enlargement (portrait/mobile)
        self.panel = pygame.Rect(0, 0, 10, 10)
        self.panel_color = _brighten(palette['panel'], 18)
        self.text_color = palette['text']
        self.accent = palette['accent']
        self.muted = _brighten(palette['panel'], 78)
        self.btn_base = _brighten(palette['panel'], 42)
        self._panel_bg = None

    def _entrance_curve(self):
        return ease_out_back(self.anim, overshoot=1.4)

    def close(self):
        self.closing = True

    def update(self, dt, mouse_pos):
        if self.closing:
            self.anim = max(0.0, self.anim - dt * 6.5)
            if self.anim <= 0.0:
                self.dead = True
        else:
            self.anim = min(1.0, self.anim + dt * 5.0)

    @property
    def interactive(self):
        return self.anim > 0.55 and not self.closing

    def _draw_dim(self, surface):
        w, h = self.screen_size
        dim = pygame.Surface((w, h))
        dim.fill((9, 8, 11))
        dim.set_alpha(int(self.DIM_ALPHA * clamp01(self.anim)))
        surface.blit(dim, (0, 0))

    def _panel_surface(self):
        raise NotImplementedError

    def draw(self, surface):
        self._draw_dim(surface)
        scale = self.ui_scale * lerp(0.9, 1.0, self._entrance_curve())
        alpha = int(255 * clamp01(self.anim * 1.7))
        content = self._panel_surface()
        cw, ch = content.get_size()
        sw, sh = max(1, int(cw * scale)), max(1, int(ch * scale))
        w, h = self.screen_size
        # drop shadow (stays panel-sized; the brief scale wobble is invisible)
        shadow = panel_shadow(cw, ch, 24)
        if self.ui_scale != 1.0:
            shadow = pygame.transform.smoothscale(
                shadow, (max(1, int(shadow.get_width() * self.ui_scale)),
                         max(1, int(shadow.get_height() * self.ui_scale))))
        shadow.set_alpha(int(215 * clamp01(self.anim)))
        surface.blit(shadow, (w // 2 - shadow.get_width() // 2,
                              h // 2 - shadow.get_height() // 2))
        if (sw, sh) != (cw, ch):
            content = pygame.transform.smoothscale(content, (sw, sh))
        if alpha < 255:
            content = content.copy()
            content.set_alpha(alpha)
        surface.blit(content, ((w - sw) // 2, (h - sh) // 2))

    def _to_local(self, pos):
        # map a screen point into unscaled panel-local coords (widgets lay out
        # at natural size; the panel is drawn enlarged by ui_scale)
        w, h = self.screen_size
        s = self.ui_scale
        ox = (w - self.panel.w * s) / 2.0
        oy = (h - self.panel.h * s) / 2.0
        return ((pos[0] - ox) / s, (pos[1] - oy) / s)

    def _route(self, event, widgets):
        if not self.interactive:
            return
        ev = event
        if hasattr(event, 'pos'):
            ev = pygame.event.Event(event.type,
                                    {**event.dict, 'pos': self._to_local(event.pos)})
        handled = False
        for wdg in widgets:
            if wdg.handle_event(ev):
                handled = True
        # one click tick per actual press — widgets activate on either the
        # down or the up edge, so a slider drag's MOUSEMOTION is excluded
        if (handled and _CLICK_SFX is not None
                and event.type in (pygame.MOUSEBUTTONDOWN,
                                    pygame.MOUSEBUTTONUP)):
            _CLICK_SFX()


class MenuOverlay(_Overlay):
    """Main menu: continue / new game, the three seeded puzzles (daily,
    weekly, monthly), difficulty + board size with progression locks, volume,
    tutorial · progress and the gameplay toggles."""

    PANEL_W = 462

    def __init__(self, screen_size, palette, fonts, difficulty, size, volume,
                 callbacks, tooltips=True, touch=False, zen=False,
                 finished=False, daily=None, weekly=None, monthly=None,
                 size_locks=None, diff_locks=None, music=0.5,
                 reduce_motion=False):
        super().__init__(screen_size, palette)
        self.fonts = fonts
        self.finished = finished
        self._daily = daily or {'number': 0, 'done': False, 'streak': 0}
        self._weekly = weekly or {'number': 0, 'done': False}
        self._monthly = monthly or {'number': 0, 'done': False}
        self._notice = None        # (text, timer) — shown when a lock is hit
        self._zen = bool(zen)
        pad = 26
        x = pad
        inner_w = self.PANEL_W - pad * 2

        y = 94
        if finished:
            # no live board to resume — just the path to a fresh one
            self.btn_continue = None
            self.btn_restart = TextButton(
                (x, y, inner_w, 48), 'New game', fonts['btn'],
                self.accent, (28, 26, 30),
                on_click=callbacks.get('restart'), radius=13)
            y += 48 + 12
        else:
            self.btn_continue = TextButton(
                (x, y, inner_w, 48), 'Continue', fonts['btn'],
                self.accent, (28, 26, 30),
                on_click=callbacks.get('continue'), radius=13)
            y += 48 + 8
            self.btn_restart = TextButton(
                (x, y, inner_w, 40), 'New game', fonts['btn'],
                self.btn_base, self.text_color,
                on_click=callbacks.get('restart'), radius=12)
            y += 40 + 12

        # three seeded-puzzle buttons in a single row
        gap = 8
        bw = (inner_w - gap * 2) // 3
        seeded_base = _brighten(palette['panel'], 30)
        self.btn_daily = TextButton(
            (x, y, bw, 44),
            self._seeded_label('Daily', self._daily),
            fonts['small'], seeded_base, self.text_color,
            on_click=self._make_seeded_click(callbacks.get('daily'),
                                              'Daily'),
            radius=11, accent=self.accent)
        self.btn_weekly = TextButton(
            (x + bw + gap, y, bw, 44),
            self._seeded_label('Weekly', self._weekly),
            fonts['small'], seeded_base, self.text_color,
            on_click=self._make_seeded_click(callbacks.get('weekly'),
                                              'Weekly'),
            radius=11)
        self.btn_monthly = TextButton(
            (x + 2 * (bw + gap), y, inner_w - 2 * (bw + gap), 44),
            self._seeded_label('Monthly', self._monthly),
            fonts['small'], seeded_base, self.text_color,
            on_click=self._make_seeded_click(callbacks.get('monthly'),
                                              'Monthly'),
            radius=11)
        y += 44 + 14

        self._diff_label_y = y
        y += 19
        diff_locks = list(diff_locks or [False, False, False])
        self.seg_diff = Segmented(
            (x, y, inner_w, 36), [('Easy', 0), ('Normal', 1), ('Hard', 2)],
            max(0, min(2, difficulty)), fonts['small'], self.btn_base,
            self.accent, self.text_color, on_select=callbacks.get('mode'),
            locked=diff_locks,
            on_locked_attempt=lambda v: self._show_lock_notice(
                'Win 3 puzzles in every board size of the previous '
                'difficulty to unlock this.'))
        y += 36 + 10

        self._size_label_y = y
        y += 19
        size_locks = list(size_locks or [False, False, False])
        self.seg_size = Segmented(
            (x, y, inner_w, 36),
            [('4×4', 4), ('5×5', 5), ('6×6', 6)],
            {4: 0, 5: 1, 6: 2}.get(size, 0), fonts['small'],
            self.btn_base, self.accent, self.text_color,
            on_select=callbacks.get('size'), locked=size_locks,
            on_locked_attempt=lambda v: self._show_lock_notice(
                'Win 3 puzzles in the previous board size to unlock this.'))
        y += 36 + 10

        self._vol_label_y = y
        y += 19
        self.slider = Slider(
            (x, y + 4, inner_w - 56, 16), volume, fonts['small'],
            _brighten(palette['panel'], 24), self.accent, self.text_color,
            on_change=callbacks.get('volume'))
        y += 16 + 12

        self._music_label_y = y
        y += 19
        self.slider_music = Slider(
            (x, y + 4, inner_w - 56, 16), music, fonts['small'],
            _brighten(palette['panel'], 24), self.accent, self.text_color,
            on_change=callbacks.get('music'))
        y += 16 + 14

        half = (inner_w - 10) // 2
        self.btn_howto = TextButton(
            (x, y, half, 40), 'Tutorial', fonts['small'],
            self.btn_base, self.text_color,
            on_click=callbacks.get('tutorial'), radius=12)
        self.btn_progress = TextButton(
            (x + half + 10, y, inner_w - half - 10, 40), 'Progress',
            fonts['small'], self.btn_base, self.text_color,
            on_click=callbacks.get('achievements'), radius=12)
        y += 40 + 12

        self.toggle_tips = Toggle(
            (x, y, inner_w, 26), 'Show tooltips', tooltips, fonts['small'],
            _brighten(palette['panel'], 26), self.accent, self.text_color,
            on_change=callbacks.get('tooltips'))
        y += 26 + 3
        self.toggle_touch = Toggle(
            (x, y, inner_w, 26), 'Tap to select  (touch)', touch,
            fonts['small'], _brighten(palette['panel'], 26), self.accent,
            self.text_color, on_change=callbacks.get('touch'))
        y += 26 + 3
        self.toggle_motion = Toggle(
            (x, y, inner_w, 26), 'Reduce motion', reduce_motion,
            fonts['small'], _brighten(palette['panel'], 26), self.accent,
            self.text_color, on_change=callbacks.get('reduce_motion'))
        y += 26 + 3
        self.toggle_zen = Toggle(
            (x, y, inner_w, 26), 'Zen mode  (records will not be counted)',
            zen, fonts['small'], _brighten(palette['panel'], 26), self.accent,
            self.text_color, on_change=callbacks.get('zen'))
        y += 26 + pad

        self.PANEL_H = y
        self.panel = pygame.Rect(0, 0, self.PANEL_W, self.PANEL_H)
        self.widgets = [w for w in (
            self.btn_continue, self.btn_restart, self.btn_daily,
            self.btn_weekly, self.btn_monthly,
            self.seg_diff, self.seg_size, self.slider, self.slider_music,
            self.btn_howto, self.btn_progress, self.toggle_tips,
            self.toggle_touch, self.toggle_motion, self.toggle_zen)
            if w is not None]
        # in zen mode the three seeded puzzles are inactive — Zen is the
        # no-score relax run and the daily/weekly/monthly are timed records
        if self._zen:
            for btn, name in ((self.btn_daily, 'Daily'),
                              (self.btn_weekly, 'Weekly'),
                              (self.btn_monthly, 'Monthly')):
                btn.enabled = False
                btn.on_click = (lambda n=name: self._show_lock_notice(
                    '%s puzzles are unavailable in Zen mode — turn Zen off '
                    'to play them.' % n))
                btn.enabled = True
        self._panel_bg = self._build_bg()

    def _seeded_label(self, name, info):
        n = info.get('number', 0) if info else 0
        label = '%s #%d' % (name, n) if n else name
        if info and info.get('done'):
            label += '  ✓'
        return label

    def _make_seeded_click(self, cb, name):
        def go():
            if self._zen:
                self._show_lock_notice(
                    '%s puzzles are unavailable in Zen mode — turn Zen off '
                    'to play them.' % name)
                return
            if cb:
                cb()
        return go

    def _show_lock_notice(self, text):
        self._notice = [text, 0.0]

    def _build_bg(self):
        surf = pygame.Surface((self.PANEL_W, self.PANEL_H), pygame.SRCALPHA)
        draw_panel(surf, (0, 0, self.PANEL_W, self.PANEL_H), self.panel_color,
                   radius=24, border_color=_brighten(self.panel_color, 26))
        cx = self.PANEL_W // 2
        draw_text_spaced(surf, 'EINSTEIN', self.fonts['h1'], self.text_color,
                         (cx, 42), spacing=4)
        draw_text(surf, 'main menu', self.fonts['tiny'], self.muted,
                  center=(cx, 66))
        for label, ly in (('DIFFICULTY', self._diff_label_y),
                          ('BOARD SIZE', self._size_label_y),
                          ('SOUND', self._vol_label_y),
                          ('MUSIC', self._music_label_y)):
            draw_text(surf, label, self.fonts['tiny'], self.muted,
                      topleft=(26, ly))
        return surf

    def update(self, dt, mouse_pos):
        super().update(dt, mouse_pos)
        local = self._to_local(mouse_pos)
        for wdg in self.widgets:
            wdg.update(dt, local)
        if self._notice is not None:
            self._notice[1] += dt
            if self._notice[1] > 4.0:
                self._notice = None

    def handle_event(self, event):
        self._route(event, self.widgets)

    def _panel_surface(self):
        surf = self._panel_bg.copy()
        for wdg in self.widgets:
            wdg.draw(surf)
        if self._notice is not None:
            self._draw_notice(surf, self._notice[0])
        return surf

    def _draw_notice(self, surf, text):
        lines = wrap_text(text, self.fonts['small'], self.PANEL_W - 80)
        line_h = self.fonts['small'].get_height()
        pad_x, pad_y = 16, 10
        widths = [self.fonts['small'].size(ln)[0] for ln in lines]
        pw = max(widths) + pad_x * 2
        ph = len(lines) * line_h + pad_y * 2
        pill = pygame.Surface((pw, ph), pygame.SRCALPHA)
        pill.blit(rounded_fill(pw, ph,
                               _brighten(self.palette['panel'], 38), 10),
                  (0, 0))
        pill.blit(rounded_border(pw, ph, self.accent, 10, 1), (0, 0))
        for i, ln in enumerate(lines):
            img = self.fonts['small'].render(ln, True, self.text_color)
            pill.blit(img, ((pw - img.get_width()) // 2,
                            pad_y + i * line_h))
        x = (self.PANEL_W - pw) // 2
        y = self.PANEL_H - ph - 12
        surf.blit(pill, (x, y))


class ResultOverlay(_Overlay):
    """The win / lose plaque.

    A win shows the run time and the player's best time on this exact
    (difficulty × size); if the run beat the previous best (or is the first
    win in that slot) a "NEW RECORD" banner pulses above. Either result
    offers Retry (same board) or New (a fresh one), and a win can copy a
    shareable result line."""

    PANEL_W = 470

    def __init__(self, screen_size, palette, fonts, won, message, time_text,
                 callbacks, best_text=None, new_record=False, badges=None,
                 daily=None):
        super().__init__(screen_size, palette)
        self.fonts = fonts
        self.won = won
        self.message = message
        self.time_text = time_text
        self.best_text = best_text
        self.new_record = bool(new_record)
        self.badges = list(badges or [])
        self.daily = daily
        self._cb_share = callbacks.get('share')
        if won:
            self.accent_color = STAR_GOLD
            self.title = 'YOU WIN'
        else:
            self.accent_color = (224, 86, 86)
            self.title = 'GAME OVER'
        pad = 32
        inner_w = self.PANEL_W - pad * 2

        # body content height — time block, then optional daily / badge lines
        self._daily_y = self._badge_y = None
        if won:
            y = 248
            if self.daily:
                self._daily_y = y
                y += 24
            if self.badges:
                self._badge_y = y
                y += 24
            by = y + 4
        else:
            by = 156

        self.widgets = []
        if won:
            self.btn_share = TextButton(
                (pad, by, inner_w, 36), 'Copy result', fonts['small'],
                _brighten(palette['panel'], 34), self.text_color,
                on_click=self._share, radius=11)
            self.widgets.append(self.btn_share)
            by += 36 + 10
        else:
            self.btn_share = None

        gap = 10
        bw = (inner_w - 2 * gap) // 3
        self.btn_menu = TextButton(
            (pad, by, bw, 48), 'Menu', fonts['btn'],
            _brighten(palette['panel'], 42), self.text_color,
            on_click=callbacks.get('menu'), radius=12)
        self.btn_retry = TextButton(
            (pad + bw + gap, by, bw, 48), 'Retry', fonts['btn'],
            _brighten(palette['panel'], 42), self.text_color,
            on_click=callbacks.get('retry'), radius=12)
        self.btn_new = TextButton(
            (pad + 2 * (bw + gap), by, inner_w - 2 * (bw + gap), 48),
            'New', fonts['btn'], self.accent_color, (28, 26, 30),
            on_click=callbacks.get('new'), radius=12)
        self.widgets += [self.btn_menu, self.btn_retry, self.btn_new]

        self.PANEL_H = by + 48 + pad
        self.panel = pygame.Rect(0, 0, self.PANEL_W, self.PANEL_H)
        self._title_pulse = 0.0
        self._panel_bg = self._build_bg()

    def _share(self):
        if self._cb_share:
            self._cb_share()
        if self.btn_share is not None:
            self.btn_share.label = 'Copied  ✓'

    def _entrance_curve(self):
        if self.won:
            return ease_out_back(self.anim, overshoot=2.0)
        return ease_out_cubic(min(1.0, self.anim * 1.35))  # a hard "slam"

    def _build_bg(self):
        surf = pygame.Surface((self.PANEL_W, self.PANEL_H), pygame.SRCALPHA)
        draw_panel(surf, (0, 0, self.PANEL_W, self.PANEL_H), self.panel_color,
                   radius=24, border_color=self.accent_color)
        cx = self.PANEL_W // 2
        pygame.draw.rect(surf, self.accent_color, (cx - 34, 88, 68, 4),
                         border_radius=2)
        # a win with a new record shows the pulsing banner here instead, so the
        # flavour line is dropped to avoid the two colliding
        if not (self.won and self.new_record):
            draw_text(surf, self.message, self.fonts['btn'], self.text_color,
                      center=(cx, 118))
        if self.won:
            # big "TIME" block — time first, best on the line below
            draw_text(surf, 'TIME', self.fonts['tiny'], self.muted,
                      center=(cx, 160))
            draw_text(surf, self.time_text, self.fonts['h1'], self.text_color,
                      center=(cx, 192))
            if self.best_text:
                draw_text(surf, 'best  ' + self.best_text,
                          self.fonts['small'], self.muted, center=(cx, 222))
            if self._daily_y is not None:
                draw_text(surf, '%s solved' % self.daily, self.fonts['small'],
                          self.accent_color, center=(cx, self._daily_y + 9))
            if self._badge_y is not None:
                txt = 'New badge — ' + ', '.join(self.badges[:2])
                if len(self.badges) > 2:
                    txt += ' +%d' % (len(self.badges) - 2)
                draw_text(surf, txt, self.fonts['small'], STAR_GOLD,
                          center=(cx, self._badge_y + 9))
        else:
            draw_text(surf, 'Time   ' + self.time_text, self.fonts['small'],
                      self.muted, center=(cx, 146))
        return surf

    def update(self, dt, mouse_pos):
        super().update(dt, mouse_pos)
        self._title_pulse += dt
        local = self._to_local(mouse_pos)
        for wdg in self.widgets:
            wdg.update(dt, local)

    def handle_event(self, event):
        self._route(event, self.widgets)

    def _panel_surface(self):
        surf = self._panel_bg.copy()
        cx = self.PANEL_W // 2
        glow = 0.5 + 0.5 * math.sin(self._title_pulse * 3.0)
        title_col = lerp_color(self.accent_color,
                               _brighten(self.accent_color, 45), glow)
        draw_text_spaced(surf, self.title, self.fonts['h1'], title_col,
                         (cx, 60), spacing=6)
        if self.won and self.new_record:
            # pulsing "NEW RECORD" banner above the time block
            ptxt = 'NEW RECORD!'
            pulse_t = 0.6 + 0.4 * math.sin(self._title_pulse * 5.0)
            pcol = lerp_color(STAR_GOLD, _brighten(STAR_GOLD, 45), pulse_t)
            img = self.fonts['btn'].render(ptxt, True, pcol)
            pw, ph = img.get_width() + 28, img.get_height() + 10
            pill = pygame.Surface((pw, ph), pygame.SRCALPHA)
            pill.blit(rounded_fill(pw, ph,
                                   (*_brighten(STAR_GOLD, -110), 230),
                                   ph // 2), (0, 0))
            pill.blit(rounded_border(pw, ph, pcol, ph // 2, 2), (0, 0))
            pill.blit(img, ((pw - img.get_width()) // 2,
                            (ph - img.get_height()) // 2))
            surf.blit(pill, (cx - pw // 2, 140 - ph // 2))
        for wdg in self.widgets:
            wdg.draw(surf)
        return surf


_MILESTONES = (5, 10, 20, 50, 100)


def _stars_for_wins(wins):
    """How many milestone stars (out of 5) the given win count has earned."""
    n = 0
    for ms in _MILESTONES:
        if wins >= ms:
            n += 1
    return n


class AchievementsOverlay(_Overlay):
    """The progress screen — three seeded-puzzle rows (daily / weekly /
    monthly) above nine ``difficulty × board size`` rows. Each row shows
    name, best time, wins and the five milestone stars earned at
    5 / 10 / 20 / 50 / 100 wins.

    A compact list of unlocked achievement badges follows below. The screen
    no longer renders the legacy 1-3 best-stars or the win-rate."""

    PANEL_W = 540

    _SIZES = (4, 5, 6)
    _DIFFS = (('Easy', 'easy', 0), ('Normal', 'normal', 1),
              ('Hard', 'hard', 2))

    def __init__(self, screen_size, palette, fonts, unlocked, summary,
                 on_close=None):
        super().__init__(screen_size, palette)
        from model.achievements import ACHIEVEMENTS
        self.fonts = fonts
        self._unlocked = set(unlocked or [])
        self._summary = summary or {}
        self._on_close = on_close
        self._achs = ACHIEVEMENTS

        pad = 26
        x = pad
        inner_w = self.PANEL_W - pad * 2
        self._row_h = 24
        self._table_x = pad
        self._table_w = inner_w

        self._head_y = 94
        self._seed_y = self._head_y + 20
        seed_rows = 3                          # daily / weekly / monthly
        self._gap_after_seed = 10
        self._modes_y = (self._seed_y
                         + seed_rows * self._row_h
                         + self._gap_after_seed)
        mode_rows = len(self._DIFFS) * len(self._SIZES)
        self._badge_label_y = (self._modes_y + mode_rows * self._row_h + 14)
        self._badge_y = self._badge_label_y + 20

        # badge list — name + a dot marker, three per row
        rows = (len(self._achs) + 2) // 3
        self._badge_row_h = 30
        by = self._badge_y + rows * self._badge_row_h + 14
        self.btn_close = TextButton(
            (x, by, inner_w, 48), 'Back', fonts['btn'], self.accent,
            (28, 26, 30), on_click=self._close, radius=13)
        self.widgets = [self.btn_close]
        self.PANEL_H = by + 48 + pad
        self.panel = pygame.Rect(0, 0, self.PANEL_W, self.PANEL_H)
        self._bg = self._build_bg()

    def _close(self):
        if self._on_close:
            self._on_close()
        self.close()

    # ------------------------------------------------------------------
    # column geometry — name | best | wins | 5 milestone stars
    # ------------------------------------------------------------------
    _NAME_W = 116
    _BEST_W = 64
    _WINS_W = 48
    _STAR_SIZE = 16
    _STAR_GAP = 12

    def _star_x(self, i):
        """X position (top-left) of milestone-star column `i` within the
        table area."""
        right = self._table_x + self._table_w
        total = len(_MILESTONES) * (self._STAR_SIZE + self._STAR_GAP) - self._STAR_GAP
        x0 = right - total
        return x0 + i * (self._STAR_SIZE + self._STAR_GAP)

    def _draw_row(self, surf, y, label, best, wins, stars_earned):
        cy = y + self._row_h // 2 - 2
        draw_text(surf, label, self.fonts['small'], self.text_color,
                  topleft=(self._table_x, cy - 8))
        best_txt = _fmt_time(best) if best else '--:--'
        bx = self._table_x + self._NAME_W
        draw_text(surf, best_txt, self.fonts['small'], self.text_color,
                  topleft=(bx, cy - 8))
        wx = bx + self._BEST_W
        wins_txt = str(wins) if wins else '0'
        draw_text(surf, wins_txt, self.fonts['small'], self.muted,
                  topleft=(wx, cy - 8))
        for i in range(len(_MILESTONES)):
            sx = self._star_x(i)
            on = i < stars_earned
            color = STAR_GOLD if on else lerp_color(self.muted,
                                                     self.panel_color, 0.45)
            spr = make_star(self._STAR_SIZE, color, filled=True)
            if not on:
                spr = spr.copy()
                spr.set_alpha(120)
            surf.blit(spr, (sx,
                            cy - self._STAR_SIZE // 2))

    def _draw_table_header(self, surf, y):
        cy = y + 4
        draw_text(surf, 'MODE', self.fonts['tiny'], self.muted,
                  topleft=(self._table_x, cy))
        draw_text(surf, 'TIME', self.fonts['tiny'], self.muted,
                  topleft=(self._table_x + self._NAME_W, cy))
        draw_text(surf, 'WINS', self.fonts['tiny'], self.muted,
                  topleft=(self._table_x + self._NAME_W + self._BEST_W, cy))
        for i, ms in enumerate(_MILESTONES):
            sx = self._star_x(i)
            img = self.fonts['tiny'].render(str(ms), True, self.muted)
            surf.blit(img, (sx + self._STAR_SIZE // 2 - img.get_width() // 2,
                            cy))

    def _seeded_entry(self, key):
        d = self._summary.get(key) or {}
        return (d.get('best'), d.get('count', 0))

    def _mode_entry(self, diff_key, size):
        modes = self._summary.get('modes') or {}
        e = modes.get('%s_%d' % (diff_key, size)) or {}
        return (e.get('best'), e.get('levels', 0))

    def _build_bg(self):
        surf = pygame.Surface((self.PANEL_W, self.PANEL_H), pygame.SRCALPHA)
        draw_panel(surf, (0, 0, self.PANEL_W, self.PANEL_H), self.panel_color,
                   radius=24, border_color=_brighten(self.panel_color, 26))
        cx = self.PANEL_W // 2
        draw_text_spaced(surf, 'PROGRESS', self.fonts['h1'], self.text_color,
                         (cx, 44), spacing=4)
        s = self._summary
        # streak + total-wins line under the header
        daily = s.get('daily', {}) or {}
        sub = ('Streak %d (best %d)  ·  Daily streak %d (best %d)  ·  '
               'Total wins %d') % (
                  s.get('streak', 0), s.get('best_streak', 0),
                  daily.get('streak', 0), daily.get('best', 0),
                  s.get('total_wins', 0))
        draw_text(surf, sub, self.fonts['tiny'], self.muted, center=(cx, 70))

        self._draw_table_header(surf, self._head_y)
        # seeded puzzles
        for i, key in enumerate(('daily', 'weekly', 'monthly')):
            best, wins = self._seeded_entry(key)
            label = key.title() + ' puzzle'
            ry = self._seed_y + i * self._row_h
            self._draw_row(surf, ry, label, best, wins,
                           _stars_for_wins(wins))
        # mode grid (3 difficulties × 3 sizes)
        for di, (label, key, _v) in enumerate(self._DIFFS):
            for si, sz in enumerate(self._SIZES):
                best, wins = self._mode_entry(key, sz)
                row_label = '%s   %d×%d' % (label, sz, sz)
                ry = (self._modes_y
                      + (di * len(self._SIZES) + si) * self._row_h)
                self._draw_row(surf, ry, row_label, best, wins,
                               _stars_for_wins(wins))

        # badges — a dot marker + name, three columns
        got = len(self._unlocked & {a[0] for a in self._achs})
        draw_text(surf, 'BADGES   %d / %d' % (got, len(self._achs)),
                  self.fonts['tiny'], self.muted,
                  topleft=(self._table_x, self._badge_label_y))
        third = self._table_w // 3
        name_h = self.fonts['small'].get_height()
        for i, (aid, name, _desc) in enumerate(self._achs):
            col = i % 3
            row = i // 3
            x = self._table_x + col * third
            y = self._badge_y + row * self._badge_row_h
            unlocked = aid in self._unlocked
            color = self.text_color if unlocked else self.muted
            cy = y + name_h // 2
            if unlocked:
                pygame.draw.circle(surf, STAR_GOLD, (x + 7, cy), 6)
            else:
                pygame.draw.circle(surf, self.muted, (x + 7, cy), 6, 2)
            draw_text(surf, name, self.fonts['small'], color,
                      topleft=(x + 20, y))
        return surf

    def update(self, dt, mouse_pos):
        super().update(dt, mouse_pos)
        local = self._to_local(mouse_pos)
        for w in self.widgets:
            w.update(dt, local)

    def handle_event(self, event):
        self._route(event, self.widgets)

    def _panel_surface(self):
        surf = self._bg.copy()
        for w in self.widgets:
            w.draw(surf)
        return surf


# --------------------------------------------------------------------------
# tutorial onboarding UI
# --------------------------------------------------------------------------
def draw_tutorial_progress(surface, x, y, width, tracker, fonts, palette,
                           row_h=30):
    """The 6-block onboarding tracker: one row per block, cleared blocks
    struck through with a check, the current block on a highlight pill.

    Each tracker row is (name, cleared_levels, total_levels, done, current).
    """
    accent = palette['accent']
    text = palette['text']
    muted = _brighten(palette['panel'], 70)
    small = fonts['small']
    tiny = fonts['tiny']
    for i, row in enumerate(tracker):
        # tolerate the older 4-tuple shape — (name, cleared, done, current) —
        # so saves from before block 0 was expanded keep working
        if len(row) == 5:
            name, cleared, total, done, current = row
        else:
            name, cleared, done, current = row
            total = 3
        ry = y + i * row_h
        rh = row_h - 4
        if current:
            surface.blit(rounded_fill(width, rh,
                                      _brighten(palette['panel'], 30), 8),
                         (x, ry))
        mcx, mcy = x + 15, ry + rh // 2
        if done:
            pygame.draw.circle(surface, accent, (mcx, mcy), 9)
            chk = tiny.render('✓', True, (26, 24, 28))
            surface.blit(chk, chk.get_rect(center=(mcx, mcy)))
        elif current:
            pygame.draw.circle(surface, accent, (mcx, mcy), 9, 2)
        else:
            pygame.draw.circle(surface, muted, (mcx, mcy), 8, 2)
        name_col = text if (current or done) else muted
        img = small.render(name, True, name_col)
        nx = x + 32
        surface.blit(img, (nx, mcy - img.get_height() // 2))
        if done:
            pygame.draw.line(surface, muted, (nx, mcy),
                             (nx + img.get_width(), mcy), 2)
        cnt = small.render('%d/%d' % (cleared, total), True,
                           accent if current else name_col)
        surface.blit(cnt, (x + width - cnt.get_width() - 8,
                           mcy - cnt.get_height() // 2))


class TutorialPopup(_Overlay):
    """A small message panel — the welcome, a block intro, or a teaching note
    on a mistake. One button dismisses it; an optional spotlight rings a part
    of the board behind the dim.

    The welcome and the "switch to hold" popups can carry a small looped
    animation (``animation='pop_to_solve'`` / ``'hold_to_define'``) that
    plays continuously inside the panel, so the new gesture is shown rather
    than only described."""

    PANEL_W = 560
    _ANIM_H = 110

    def __init__(self, screen_size, palette, fonts, text,
                 button_label='Got it', on_done=None, tag='TUTORIAL',
                 spotlight=None, animation=None):
        super().__init__(screen_size, palette)
        self.fonts = fonts
        self._on_done = on_done
        self._spotlight = spotlight
        self._clock = 0.0
        self._tag = tag
        self._animation = animation
        self._lines = wrap_text(text, fonts['small'], self.PANEL_W - 80)
        extra = self._ANIM_H if animation else 0
        self.PANEL_H = 66 + len(self._lines) * 23 + extra + 24 + 46 + 30
        self.panel = pygame.Rect(0, 0, self.PANEL_W, self.PANEL_H)
        self._anim_y = 66 + len(self._lines) * 23 + 6
        bw = 200
        self.btn = TextButton(
            ((self.PANEL_W - bw) // 2, self.PANEL_H - 30 - 46, bw, 46),
            button_label, fonts['btn'], self.accent, (28, 26, 30),
            on_click=self._finish, radius=12)
        self.widgets = [self.btn]
        self._bg = self._build_bg()

    def _finish(self):
        if self._on_done:
            self._on_done()
        self.close()

    def _build_bg(self):
        surf = pygame.Surface((self.PANEL_W, self.PANEL_H), pygame.SRCALPHA)
        draw_panel(surf, (0, 0, self.PANEL_W, self.PANEL_H), self.panel_color,
                   radius=22, border_color=_brighten(self.panel_color, 26))
        cx = self.PANEL_W // 2
        draw_text_spaced(surf, self._tag, self.fonts['tiny'], self.accent,
                         (cx, 32), spacing=3)
        ty = 66
        for ln in self._lines:
            draw_text(surf, ln, self.fonts['small'], self.text_color,
                      center=(cx, ty))
            ty += 23
        return surf

    def _draw_dim(self, surface):
        super()._draw_dim(surface)
        if self._spotlight is not None:
            p = 0.5 + 0.5 * math.sin(self._clock * 5.0)
            r = pygame.Rect(self._spotlight).inflate(14 + 8 * p, 14 + 8 * p)
            ring = rounded_border(r.w, r.h, self.accent, 18, 4)
            a = int(255 * clamp01(self.anim))
            if a < 255:
                ring = ring.copy()
                ring.set_alpha(a)
            surface.blit(ring, r.topleft)

    def update(self, dt, mouse_pos):
        super().update(dt, mouse_pos)
        self._clock += dt
        local = self._to_local(mouse_pos)
        for w in self.widgets:
            w.update(dt, local)

    def handle_event(self, event):
        self._route(event, self.widgets)

    def _panel_surface(self):
        surf = self._bg.copy()
        if self._animation == 'pop_to_solve':
            self._draw_pop_animation(surf)
        elif self._animation == 'hold_to_define':
            self._draw_hold_animation(surf)
        for w in self.widgets:
            w.draw(surf)
        return surf

    # ------------------------------------------------------------------
    # looped gesture animations
    # ------------------------------------------------------------------
    _ANIM_PERIOD = 3.6

    def _anim_progress(self):
        """A 0..1 looped phase that drives the gesture animations."""
        return (self._clock % self._ANIM_PERIOD) / self._ANIM_PERIOD

    # The animation cell is drawn exactly like a board cell so the popup reads
    # as a live snippet of the game: a real board row's three candidate values
    # (row 3 -> A, B, C), the board's row colour, the candidate sub-grid layout
    # and the same pop / bloom motion. These constants mirror GameWindow.
    _DEMO_VALUES = (31, 32, 33)
    _DEMO_SURVIVOR = 2          # index of the candidate that becomes the answer

    def _demo_rect(self):
        size = 94
        cx = self.PANEL_W // 2
        cy = self._anim_y + self._ANIM_H // 2
        return pygame.Rect(cx - size // 2, cy - size // 2, size, size)

    def _demo_slot_rects(self, rect):
        """The three candidate-tile rects, laid out exactly like a 3-candidate
        board cell: a 2-column grid with the last (single) row centred."""
        cols = rows = 2
        inset = max(3, rect.w // 22)
        avail = rect.w - 2 * inset
        sub = min(avail // cols, avail // rows)
        gx = rect.x + (rect.w - sub * cols) // 2
        gy = rect.y + (rect.h - sub * rows) // 2
        out = []
        for i in range(3):
            dy, dx = i // cols, i % cols
            in_row = min(cols, 3 - dy * cols)
            row_off = (cols - in_row) * sub // 2
            out.append(pygame.Rect(gx + row_off + dx * sub, gy + dy * sub,
                                   sub, sub))
        return out

    def _draw_cell_base(self, surf, rect):
        """A small piece of board behind the cell: the board background plus
        the faint ghost outline an empty cell shows on the real grid."""
        bg = self.palette['bg']
        pad = rect.inflate(20, 20)
        surf.blit(rounded_fill(pad.w, pad.h, bg, 16), pad.topleft)
        surf.blit(rounded_fill(rect.w, rect.h, _brighten(bg, 14), 14),
                  rect.topleft)

    def _draw_demo_chip(self, surf, slot, value, scale=1.0, alpha=255):
        """One candidate tile — row colour, white glyph, board-coloured border,
        the same look as a FieldButton on the board."""
        color = color_for_value(value) or (120, 120, 120)
        w = max(1, int(slot.w * scale))
        h = max(1, int(slot.h * scale))
        rad = max(2, w // 5)
        chip = pygame.Surface((w, h), pygame.SRCALPHA)
        chip.blit(rounded_fill(w, h, color, rad), (0, 0))
        chip.blit(rounded_border(w, h, self.palette['bg'], rad, 1), (0, 0))
        if w > 14:
            img = self.fonts['small'].render(symbol_for(value), True,
                                             (255, 255, 255))
            chip.blit(img, img.get_rect(center=(w // 2, h // 2)))
        if alpha < 255:
            chip.set_alpha(alpha)
        surf.blit(chip, chip.get_rect(center=slot.center))

    def _draw_demo_chip_pop(self, surf, slot, value, p):
        """A candidate playing its pop-out: a quick squash, then collapse and
        fade — the same curve the board's Ghost uses."""
        if p < 0.3:
            scale = 1.0 + 0.30 * (p / 0.3)
        else:
            scale = 1.30 * (1.0 - ease_out_quad((p - 0.3) / 0.7))
        alpha = int(255 * (1.0 - p) ** 0.7)
        if alpha <= 0 or scale < 0.05:
            return
        self._draw_demo_chip(surf, slot, value, scale=max(0.05, scale),
                             alpha=alpha)

    def _draw_demo_solved(self, surf, rect, value, scale=1.0):
        """The resolved big cell — row colour with a top sheen and the big
        glyph, blooming in with overshoot just like the board's BigSpawn."""
        color = color_for_value(value) or (140, 140, 140)
        w = max(1, int(rect.w * scale))
        h = max(1, int(rect.h * scale))
        rad = max(4, w // 8)
        cell = pygame.Surface((w, h), pygame.SRCALPHA)
        cell.blit(rounded_fill(w, h, color, rad), (0, 0))
        sheen = pygame.Surface((w, h), pygame.SRCALPHA)
        tint = _brighten(color, 36)
        for yy in range(h):
            f = 1.0 - (yy / h) / 0.5
            if f <= 0.0:
                break
            a = int(120 * (f ** 1.6))
            pygame.draw.line(sheen, (*tint, a), (0, yy), (w, yy))
        sheen.blit(rounded_fill(w, h, (255, 255, 255), rad), (0, 0),
                   special_flags=pygame.BLEND_RGBA_MIN)
        cell.blit(sheen, (0, 0))
        cell.blit(rounded_border(w, h, self.palette['bg'], rad, 1), (0, 0))
        img = self.fonts['h1'].render(symbol_for(value), True, (255, 255, 255))
        cell.blit(img, img.get_rect(center=(w // 2, h // 2)))
        surf.blit(cell, cell.get_rect(center=rect.center))

    def _draw_cursor(self, surf, x, y, pressed=False, fill=0.0):
        """A simple cursor arrow with an optional 'click' bloom or a growing
        radial fill ring (for the hold animation)."""
        if fill > 0.0:
            pad = 18
            d = pad * 2
            spr = pygame.Surface((d, d), pygame.SRCALPHA)
            cx = cy = d // 2
            radius = d // 2 - 3
            pygame.draw.circle(spr, (*self.accent, 60), (cx, cy), radius, 3)
            steps = max(2, int(fill * 48))
            for i in range(steps + 1):
                a = -math.pi / 2 + 2.0 * math.pi * fill * (i / steps)
                px = cx + radius * math.cos(a)
                py = cy + radius * math.sin(a)
                pygame.draw.circle(spr, (*self.accent, 230), (int(px),
                                                               int(py)), 3)
            surf.blit(spr, (x - cx, y - cy))
        pts = [(x, y), (x + 14, y + 11), (x + 6, y + 12), (x + 4, y + 19)]
        pygame.draw.polygon(surf, (250, 250, 252), pts)
        pygame.draw.polygon(surf, (28, 26, 30), pts, 2)
        if pressed:
            pygame.draw.circle(surf, (*self.accent, 180), (x + 2, y + 2), 9)

    def _draw_pop_animation(self, surf):
        """Welcome popup loop: the cursor taps two candidates, each popping
        out like on the board; the third remains and the cell solves itself."""
        t = self._anim_progress()
        rect = self._demo_rect()
        slots = self._demo_slot_rects(rect)
        vals = self._DEMO_VALUES
        keep = self._DEMO_SURVIVOR
        self._draw_cell_base(surf, rect)

        pop_dur = 0.16
        pop_start = {0: 0.22, 1: 0.52}      # tap order: top-left, top-right
        solve_start = 0.74

        if t >= solve_start:
            sp = clamp01((t - solve_start) / 0.18)
            scale = 0.40 + 0.60 * ease_out_back(sp, overshoot=2.0)
            self._draw_demo_solved(surf, rect, vals[keep], scale=scale)
            c = slots[keep].center
            self._draw_cursor(surf, c[0] - 6, c[1] - 6)
            return

        for i, slot in enumerate(slots):
            if i == keep:
                self._draw_demo_chip(surf, slot, vals[i])
                continue
            start = pop_start[i]
            if t < start:
                self._draw_demo_chip(surf, slot, vals[i])
            elif t < start + pop_dur:
                self._draw_demo_chip_pop(surf, slot, vals[i],
                                         (t - start) / pop_dur)

        if t < pop_start[1] - 0.06:
            tgt, near = slots[0].center, pop_start[0]
        else:
            tgt, near = slots[1].center, pop_start[1]
        press = (near - 0.05) < t < near + 0.02
        self._draw_cursor(surf, tgt[0] - 6, tgt[1] - 6, pressed=press)

    def _draw_hold_animation(self, surf):
        """Pre-level-4 popup loop: the cursor holds one candidate while a ring
        fills; the others pop and the cell snaps to the held value, exactly as
        a long-press 'define' looks on the board."""
        t = self._anim_progress()
        rect = self._demo_rect()
        slots = self._demo_slot_rects(rect)
        vals = self._DEMO_VALUES
        chosen = self._DEMO_SURVIVOR
        self._draw_cell_base(surf, rect)

        fill_start, fill_end = 0.22, 0.74
        pop_dur = 0.14

        if t >= fill_end:
            p = clamp01((t - fill_end) / pop_dur)
            for i, slot in enumerate(slots):
                if i != chosen and p < 1.0:
                    self._draw_demo_chip_pop(surf, slot, vals[i], p)
            sp = clamp01((t - fill_end) / 0.18)
            scale = 0.40 + 0.60 * ease_out_back(sp, overshoot=2.0)
            self._draw_demo_solved(surf, rect, vals[chosen], scale=scale)
            c = slots[chosen].center
            self._draw_cursor(surf, c[0] - 6, c[1] - 6)
            return

        holding = t >= fill_start
        for i, slot in enumerate(slots):
            dim = holding and i != chosen
            self._draw_demo_chip(surf, slot, vals[i],
                                 alpha=120 if dim else 255)
        fill = (clamp01((t - fill_start) / (fill_end - fill_start))
                if holding else 0.0)
        c = slots[chosen].center
        self._draw_cursor(surf, c[0] - 6, c[1] - 6, pressed=holding, fill=fill)


class TutorialResultOverlay(_Overlay):
    """The tutorial's win plaque — no stars/time/score, a single button, and
    a copy of the 6-block progress tracker."""

    PANEL_W = 480

    def __init__(self, screen_size, palette, fonts, title, message, tracker,
                 button_label='Continue', on_continue=None):
        super().__init__(screen_size, palette)
        self.fonts = fonts
        self.title = title
        self._tracker = tracker
        self._clock = 0.0
        self._on_continue = on_continue
        self.accent_color = STAR_GOLD
        self._msg_lines = (wrap_text(message, fonts['small'],
                                     self.PANEL_W - 72) if message else [])
        pad = 34
        self._msg_y = 104
        msg_h = len(self._msg_lines) * 22
        self._track_label_y = self._msg_y + msg_h + 12
        self._track_y = self._track_label_y + 24
        by = self._track_y + len(tracker) * 30 + 18
        self.btn = TextButton(
            (pad, by, self.PANEL_W - pad * 2, 50), button_label,
            fonts['btn'], self.accent, (28, 26, 30), on_click=self._go,
            radius=13)
        self.widgets = [self.btn]
        self.PANEL_H = by + 50 + pad
        self.panel = pygame.Rect(0, 0, self.PANEL_W, self.PANEL_H)
        self._bg = self._build_bg()

    def _go(self):
        if self._on_continue:
            self._on_continue()
        self.close()

    def _build_bg(self):
        surf = pygame.Surface((self.PANEL_W, self.PANEL_H), pygame.SRCALPHA)
        draw_panel(surf, (0, 0, self.PANEL_W, self.PANEL_H), self.panel_color,
                   radius=24, border_color=self.accent_color)
        cx = self.PANEL_W // 2
        pygame.draw.rect(surf, self.accent_color, (cx - 34, 78, 68, 4),
                         border_radius=2)
        ty = self._msg_y
        for ln in self._msg_lines:
            draw_text(surf, ln, self.fonts['small'], self.text_color,
                      center=(cx, ty))
            ty += 22
        draw_text(surf, 'TUTORIAL PROGRESS', self.fonts['tiny'], self.muted,
                  center=(cx, self._track_label_y))
        draw_tutorial_progress(surf, 34, self._track_y, self.PANEL_W - 68,
                               self._tracker, self.fonts, self.palette)
        return surf

    def update(self, dt, mouse_pos):
        super().update(dt, mouse_pos)
        self._clock += dt
        local = self._to_local(mouse_pos)
        for w in self.widgets:
            w.update(dt, local)

    def handle_event(self, event):
        self._route(event, self.widgets)

    def _panel_surface(self):
        surf = self._bg.copy()
        cx = self.PANEL_W // 2
        glow = 0.5 + 0.5 * math.sin(self._clock * 3.0)
        title_col = lerp_color(self.accent_color,
                               _brighten(self.accent_color, 45), glow)
        draw_text_spaced(surf, self.title, self.fonts['h1'], title_col,
                         (cx, 50), spacing=4)
        for w in self.widgets:
            w.draw(surf)
        return surf


class TutorialMenuOverlay(_Overlay):
    """The in-tutorial menu: continue, restart the whole tutorial, skip it.
    Game modes are shown locked; the 6-block tracker fills the lower half."""

    PANEL_W = 440

    def __init__(self, screen_size, palette, fonts, tracker, volume,
                 callbacks):
        super().__init__(screen_size, palette)
        self.fonts = fonts
        self._tracker = tracker
        pad = 30
        x = pad
        inner_w = self.PANEL_W - pad * 2
        y = 100
        self.btn_continue = TextButton(
            (x, y, inner_w, 50), 'Continue', fonts['btn'], self.accent,
            (28, 26, 30), on_click=callbacks.get('continue'), radius=14)
        y += 50 + 9
        half = (inner_w - 10) // 2
        self.btn_restart = TextButton(
            (x, y, half, 42), 'Restart tutorial', fonts['small'],
            self.btn_base, self.text_color,
            on_click=callbacks.get('restart'), radius=12)
        self.btn_skip = TextButton(
            (x + half + 10, y, half, 42), 'Skip tutorial', fonts['small'],
            self.btn_base, self.text_color, on_click=callbacks.get('skip'),
            radius=12)
        y += 42 + 16
        self._diff_label_y = y
        y += 20
        self.seg_diff = Segmented(
            (x, y, inner_w, 34), [('Easy', 0), ('Normal', 1), ('Hard', 2)],
            0, fonts['small'], self.btn_base, self.accent, self.text_color)
        self.seg_diff.enabled = False
        y += 34 + 10
        self.seg_size = Segmented(
            (x, y, inner_w, 34), [('4×4', 4), ('5×5', 5), ('6×6', 6)],
            0, fonts['small'], self.btn_base, self.accent, self.text_color)
        self.seg_size.enabled = False
        y += 34 + 10
        self._vol_label_y = y
        y += 20
        self.slider = Slider(
            (x, y + 4, inner_w - 56, 16), volume, fonts['small'],
            _brighten(palette['panel'], 24), self.accent, self.text_color,
            on_change=callbacks.get('volume'))
        y += 16 + 20
        self._track_label_y = y
        self._track_y = y + 22
        self.PANEL_H = self._track_y + 6 * 30 + 24
        self.panel = pygame.Rect(0, 0, self.PANEL_W, self.PANEL_H)
        self.widgets = [self.btn_continue, self.btn_restart, self.btn_skip,
                        self.seg_diff, self.seg_size, self.slider]
        self._bg = self._build_bg()

    def _build_bg(self):
        surf = pygame.Surface((self.PANEL_W, self.PANEL_H), pygame.SRCALPHA)
        draw_panel(surf, (0, 0, self.PANEL_W, self.PANEL_H), self.panel_color,
                   radius=24, border_color=_brighten(self.panel_color, 26))
        cx = self.PANEL_W // 2
        draw_text_spaced(surf, 'EINSTEIN', self.fonts['h1'], self.text_color,
                         (cx, 46), spacing=4)
        draw_text(surf, 'tutorial — modes unlock once it is done',
                  self.fonts['tiny'], self.muted, center=(cx, 72))
        draw_text(surf, 'LOCKED MODES', self.fonts['tiny'], self.muted,
                  topleft=(30, self._diff_label_y))
        draw_text(surf, 'VOLUME', self.fonts['tiny'], self.muted,
                  topleft=(30, self._vol_label_y))
        draw_text(surf, 'TUTORIAL PROGRESS', self.fonts['tiny'], self.muted,
                  topleft=(30, self._track_label_y))
        draw_tutorial_progress(surf, 30, self._track_y, self.PANEL_W - 60,
                               self._tracker, self.fonts, self.palette)
        return surf

    def update(self, dt, mouse_pos):
        super().update(dt, mouse_pos)
        local = self._to_local(mouse_pos)
        for w in self.widgets:
            w.update(dt, local)

    def handle_event(self, event):
        self._route(event, self.widgets)

    def _panel_surface(self):
        surf = self._bg.copy()
        for w in self.widgets:
            w.draw(surf)
        return surf


class BlockSelectOverlay(_Overlay):
    """Post-tutorial: pick one onboarding block to replay."""

    PANEL_W = 420

    def __init__(self, screen_size, palette, fonts, block_names,
                 on_pick=None, on_close=None):
        super().__init__(screen_size, palette)
        self.fonts = fonts
        self._on_pick = on_pick
        self._on_close = on_close
        pad = 30
        x = pad
        inner_w = self.PANEL_W - pad * 2
        y = 96
        self.widgets = []
        for i, name in enumerate(block_names):
            btn = TextButton((x, y, inner_w, 42),
                             '%d.  %s' % (i + 1, name), fonts['btn'],
                             self.btn_base, self.text_color, radius=12)
            btn.on_click = (lambda idx=i: self._pick(idx))
            self.widgets.append(btn)
            y += 42 + 8
        y += 6
        self.btn_close = TextButton(
            (x, y, inner_w, 46), 'Back', fonts['btn'], self.accent,
            (28, 26, 30), on_click=self._close, radius=12)
        self.widgets.append(self.btn_close)
        self.PANEL_H = y + 46 + pad
        self.panel = pygame.Rect(0, 0, self.PANEL_W, self.PANEL_H)
        self._bg = self._build_bg()

    def _pick(self, idx):
        if self._on_pick:
            self._on_pick(idx)
        self.close()

    def _close(self):
        if self._on_close:
            self._on_close()
        self.close()

    def _build_bg(self):
        surf = pygame.Surface((self.PANEL_W, self.PANEL_H), pygame.SRCALPHA)
        draw_panel(surf, (0, 0, self.PANEL_W, self.PANEL_H), self.panel_color,
                   radius=24, border_color=_brighten(self.panel_color, 26))
        cx = self.PANEL_W // 2
        draw_text_spaced(surf, 'TUTORIAL', self.fonts['h1'], self.text_color,
                         (cx, 44), spacing=4)
        draw_text(surf, 'replay any block', self.fonts['tiny'], self.muted,
                  center=(cx, 68))
        return surf

    def update(self, dt, mouse_pos):
        super().update(dt, mouse_pos)
        local = self._to_local(mouse_pos)
        for w in self.widgets:
            w.update(dt, local)

    def handle_event(self, event):
        self._route(event, self.widgets)

    def _panel_surface(self):
        surf = self._bg.copy()
        for w in self.widgets:
            w.draw(surf)
        return surf
