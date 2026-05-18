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
from view.buttons import rounded_fill, rounded_border, soft_shadow


# --------------------------------------------------------------------------
# drawing helpers
# --------------------------------------------------------------------------
def _brighten(color, amount):
    return tuple(max(0, min(255, c + amount)) for c in color[:3])


def _fmt_time(seconds):
    seconds = max(0, int(seconds))
    return '%02d:%02d' % (seconds // 60, seconds % 60)


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
    """A 3-way segmented control (used to pick difficulty)."""

    def __init__(self, rect, options, index, font, base_color, active_color,
                 text_color, on_select=None):
        self.rect = pygame.Rect(rect)
        self.options = options  # list of (label, value)
        self.index = index
        self.font = font
        self.base_color = base_color
        self.active_color = active_color
        self.text_color = text_color
        self.on_select = on_select
        self.enabled = True
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
                    self.index = i
                    if self.on_select:
                        self.on_select(self.options[i][1])
                    return True
        return False

    def draw(self, surface):
        for i, (label, _value) in enumerate(self.options):
            r = self._seg_rect(i)
            active = (i == self.index)
            if not self.enabled:
                color = lerp_color(self.base_color, (58, 58, 62), 0.55)
                if active:
                    color = lerp_color(self.active_color, (96, 96, 100), 0.6)
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
        scale = lerp(0.9, 1.0, self._entrance_curve())
        alpha = int(255 * clamp01(self.anim * 1.7))
        content = self._panel_surface()
        cw, ch = content.get_size()
        sw, sh = max(1, int(cw * scale)), max(1, int(ch * scale))
        w, h = self.screen_size
        # drop shadow (stays panel-sized; the brief scale wobble is invisible)
        shadow = panel_shadow(cw, ch, 24)
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
        w, h = self.screen_size
        ox = (w - self.panel.w) // 2
        oy = (h - self.panel.h) // 2
        return (pos[0] - ox, pos[1] - oy)

    def _route(self, event, widgets):
        if not self.interactive:
            return
        ev = event
        if hasattr(event, 'pos'):
            ev = pygame.event.Event(event.type,
                                    {**event.dict, 'pos': self._to_local(event.pos)})
        for wdg in widgets:
            wdg.handle_event(ev)


class MenuOverlay(_Overlay):
    """Main menu: continue/restart, difficulty + board size, volume,
    how-to-play, theme, tooltip + touch toggles, and progress stats."""

    PANEL_W = 436

    def __init__(self, screen_size, palette, fonts, difficulty, size, volume,
                 callbacks, stats=None, tooltips=True, touch=False):
        super().__init__(screen_size, palette)
        self._stats = stats
        self.fonts = fonts
        self._cb = callbacks
        pad = 30
        x = pad
        inner_w = self.PANEL_W - pad * 2

        y = 104
        self.btn_continue = TextButton(
            (x, y, inner_w, 50), 'Continue', fonts['btn'],
            self.accent, (28, 26, 30), on_click=callbacks.get('continue'),
            radius=14)
        y += 50 + 9
        self.btn_restart = TextButton(
            (x, y, inner_w, 42), 'Restart', fonts['btn'],
            self.btn_base, self.text_color, on_click=callbacks.get('restart'),
            radius=12)
        y += 42 + 15

        self._diff_label_y = y
        y += 20
        self.seg_diff = Segmented(
            (x, y, inner_w, 38), [('Easy', 0), ('Normal', 1), ('Hard', 2)],
            max(0, min(2, difficulty)), fonts['small'], self.btn_base,
            self.accent, self.text_color, on_select=callbacks.get('mode'))
        y += 38 + 12

        self._size_label_y = y
        y += 20
        self.seg_size = Segmented(
            (x, y, inner_w, 38), [('4 × 4', 4), ('5 × 5', 5), ('6 × 6', 6)],
            {4: 0, 5: 1, 6: 2}.get(size, 2), fonts['small'], self.btn_base,
            self.accent, self.text_color, on_select=callbacks.get('size'))
        y += 38 + 14

        self._vol_label_y = y
        y += 20
        self.slider = Slider(
            (x, y + 4, inner_w - 56, 16), volume, fonts['small'],
            _brighten(palette['panel'], 24), self.accent, self.text_color,
            on_change=callbacks.get('volume'))
        y += 16 + 16

        half = (inner_w - 12) // 2
        self.btn_howto = TextButton(
            (x, y, half, 42), 'Tutorial', fonts['btn'],
            self.accent, (28, 26, 30), on_click=callbacks.get('tutorial'),
            radius=12)
        self.btn_theme = TextButton(
            (x + half + 12, y, half, 42), 'Theme', fonts['btn'],
            self.btn_base, self.text_color, on_click=callbacks.get('theme'),
            radius=12)
        y += 42 + 12

        self.toggle_tips = Toggle(
            (x, y, inner_w, 28), 'Show tooltips', tooltips, fonts['small'],
            _brighten(palette['panel'], 26), self.accent, self.text_color,
            on_change=callbacks.get('tooltips'))
        y += 28 + 4
        self.toggle_touch = Toggle(
            (x, y, inner_w, 28), 'Tap to select  (touch)', touch,
            fonts['small'], _brighten(palette['panel'], 26), self.accent,
            self.text_color, on_change=callbacks.get('touch'))
        y += 28 + 14

        self._stats_y = y
        self.PANEL_H = y + 22 + 3 * 21 + 24 + 22
        self.panel = pygame.Rect(0, 0, self.PANEL_W, self.PANEL_H)

        self.widgets = [self.btn_continue, self.btn_restart, self.seg_diff,
                        self.seg_size, self.slider, self.btn_howto,
                        self.btn_theme, self.toggle_tips, self.toggle_touch]
        self._panel_bg = self._build_bg()

    def _build_bg(self):
        surf = pygame.Surface((self.PANEL_W, self.PANEL_H), pygame.SRCALPHA)
        draw_panel(surf, (0, 0, self.PANEL_W, self.PANEL_H), self.panel_color,
                   radius=24, border_color=_brighten(self.panel_color, 26))
        cx = self.PANEL_W // 2
        draw_text_spaced(surf, 'EINSTEIN', self.fonts['h1'], self.text_color,
                         (cx, 48), spacing=4)
        draw_text(surf, 'main menu', self.fonts['tiny'], self.muted,
                  center=(cx, 74))
        for label, ly in (('DIFFICULTY', self._diff_label_y),
                          ('BOARD SIZE', self._size_label_y),
                          ('VOLUME', self._vol_label_y)):
            draw_text(surf, label, self.fonts['tiny'], self.muted,
                      topleft=(30, ly))
        self._draw_progress(surf)
        return surf

    def _draw_progress(self, surf):
        cx = self.PANEL_W // 2
        sy = self._stats_y
        draw_text(surf, 'PROGRESS', self.fonts['tiny'], self.muted,
                  topleft=(30, sy))
        ry = sy + 22
        played = wins = total_time = 0
        for label, key in (('Easy', 'easy'), ('Normal', 'normal'),
                           ('Hard', 'hard')):
            entry = (self._stats or {}).get(key) or {}
            lv = entry.get('levels', 0)
            best = entry.get('best')
            stars = entry.get('best_stars', 0) if lv else 0
            played += lv + entry.get('losses', 0)
            wins += lv
            total_time += entry.get('total_time', 0)
            draw_text(surf, label, self.fonts['small'], self.text_color,
                      topleft=(30, ry))
            draw_text(surf, '★' * stars + '☆' * (3 - stars),
                      self.fonts['small'], STAR_GOLD, topleft=(92, ry))
            draw_text(surf, ('%d%%' % entry.get('winrate', 0)) if lv else '—',
                      self.fonts['small'], self.muted, center=(cx + 54, ry + 9))
            best_txt = _fmt_time(best) if best else '--:--'
            bw = self.fonts['small'].size(best_txt)[0]
            draw_text(surf, best_txt, self.fonts['small'], self.text_color,
                      topleft=(self.PANEL_W - 30 - bw, ry))
            ry += 21
        rate = int(round(100.0 * wins / played)) if played else 0
        summary = '%d games  ·  %d won  ·  %s total' % (
            played, rate, _fmt_time(total_time))
        if wins == 0 and played == 0:
            summary = 'no games played yet'
        draw_text(surf, summary, self.fonts['tiny'], self.muted,
                  center=(cx, ry + 12))

    def update(self, dt, mouse_pos):
        super().update(dt, mouse_pos)
        local = self._to_local(mouse_pos)
        for wdg in self.widgets:
            wdg.update(dt, local)

    def handle_event(self, event):
        self._route(event, self.widgets)

    def _panel_surface(self):
        surf = self._panel_bg.copy()
        for wdg in self.widgets:
            wdg.draw(surf)
        return surf


class ResultOverlay(_Overlay):
    """The win / lose plaque. A win also shows a 1-3 star grade and a score."""

    PANEL_W = 468

    def __init__(self, screen_size, palette, fonts, won, message, time_text,
                 callbacks, stars=0, score=0, best_score=0):
        super().__init__(screen_size, palette)
        self.fonts = fonts
        self.won = won
        self.message = message
        self.time_text = time_text
        self.stars = max(0, min(3, int(stars)))
        self.score = int(score)
        self.best_score = int(best_score)
        self.PANEL_H = 348 if won else 274
        self.panel = pygame.Rect(0, 0, self.PANEL_W, self.PANEL_H)
        if won:
            self.accent_color = STAR_GOLD
            self.title = 'YOU WIN'
        else:
            self.accent_color = (224, 86, 86)
            self.title = 'GAME OVER'
        pad = 34
        inner_w = self.PANEL_W - pad * 2
        half = (inner_w - 14) // 2
        by = self.PANEL_H - pad - 50
        self.btn_menu = TextButton(
            (pad, by, half, 50), 'Menu', fonts['btn'],
            _brighten(palette['panel'], 42), self.text_color,
            on_click=callbacks.get('menu'), radius=13)
        self.btn_restart = TextButton(
            (pad + half + 14, by, half, 50), 'Restart', fonts['btn'],
            self.accent_color, (28, 26, 30),
            on_click=callbacks.get('restart'), radius=13)
        self.widgets = [self.btn_menu, self.btn_restart]
        self._title_pulse = 0.0
        self._star_t = 0.0
        self._panel_bg = self._build_bg()

    def _entrance_curve(self):
        if self.won:
            return ease_out_back(self.anim, overshoot=2.0)
        return ease_out_cubic(min(1.0, self.anim * 1.35))  # a hard "slam"

    def _build_bg(self):
        surf = pygame.Surface((self.PANEL_W, self.PANEL_H), pygame.SRCALPHA)
        draw_panel(surf, (0, 0, self.PANEL_W, self.PANEL_H), self.panel_color,
                   radius=24, border_color=self.accent_color)
        cx = self.PANEL_W // 2
        pygame.draw.rect(surf, self.accent_color, (cx - 34, 90, 68, 4),
                         border_radius=2)
        draw_text(surf, self.message, self.fonts['btn'], self.text_color,
                  center=(cx, 122))
        draw_text(surf, 'Time   ' + self.time_text, self.fonts['small'],
                  self.muted, center=(cx, 152))
        if self.won:
            line = 'Score  %d' % self.score
            if self.best_score:
                line += '      best  %d' % self.best_score
            draw_text(surf, line, self.fonts['small'], self.text_color,
                      center=(cx, 246))
        return surf

    def update(self, dt, mouse_pos):
        super().update(dt, mouse_pos)
        self._title_pulse += dt
        if self.interactive:
            self._star_t += dt
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
                         (cx, 62), spacing=6)
        if self.won:
            # the three stars pop in one after another
            for i in range(3):
                local = clamp01((self._star_t - i * 0.2) / 0.32)
                if local <= 0.0:
                    continue
                sz = max(1, int(34 * ease_out_back(local, overshoot=2.4)))
                spr = make_star(sz, STAR_GOLD, filled=(i < self.stars))
                x = cx - 65 + i * 48 + 17
                surf.blit(spr, (x - spr.get_width() // 2,
                                202 - spr.get_height() // 2))
        for wdg in self.widgets:
            wdg.draw(surf)
        return surf


# --------------------------------------------------------------------------
# tutorial onboarding UI
# --------------------------------------------------------------------------
def draw_tutorial_progress(surface, x, y, width, tracker, fonts, palette,
                           row_h=30):
    """The 6-block onboarding tracker: one row per block, cleared blocks
    struck through with a check, the current block on a highlight pill."""
    accent = palette['accent']
    text = palette['text']
    muted = _brighten(palette['panel'], 70)
    small = fonts['small']
    tiny = fonts['tiny']
    for i, (name, cleared, done, current) in enumerate(tracker):
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
        cnt = small.render('%d/3' % cleared, True,
                           accent if current else name_col)
        surface.blit(cnt, (x + width - cnt.get_width() - 8,
                           mcy - cnt.get_height() // 2))


class TutorialPopup(_Overlay):
    """A small message panel — the welcome, a block intro, or a teaching note
    on a mistake. One button dismisses it; an optional spotlight rings a part
    of the board behind the dim."""

    PANEL_W = 560

    def __init__(self, screen_size, palette, fonts, text,
                 button_label='Got it', on_done=None, tag='TUTORIAL',
                 spotlight=None):
        super().__init__(screen_size, palette)
        self.fonts = fonts
        self._on_done = on_done
        self._spotlight = spotlight
        self._clock = 0.0
        self._tag = tag
        self._lines = wrap_text(text, fonts['small'], self.PANEL_W - 80)
        self.PANEL_H = 66 + len(self._lines) * 23 + 24 + 46 + 30
        self.panel = pygame.Rect(0, 0, self.PANEL_W, self.PANEL_H)
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
        for w in self.widgets:
            w.draw(surf)
        return surf


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
            (x, y, inner_w, 34), [('4 × 4', 4), ('5 × 5', 5), ('6 × 6', 6)],
            2, fonts['small'], self.btn_base, self.accent, self.text_color)
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
