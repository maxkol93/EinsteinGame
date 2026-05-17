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
            if active:
                color = self.active_color
            else:
                color = _brighten(self.base_color, int(26 * self._hover[i]))
            surface.blit(rounded_fill(r.w, r.h, color, 9), r.topleft)
            tcol = (30, 30, 34) if active else self.text_color
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
    """Main menu: continue, restart, difficulty, volume, how-to-play, theme,
    tooltip + touch toggles, and per-difficulty progress."""

    PANEL_W = 436

    def __init__(self, screen_size, palette, fonts, complexity, volume,
                 callbacks, stats=None, tooltips=True, touch=False):
        super().__init__(screen_size, palette)
        self._stats = stats
        self.fonts = fonts
        self._cb = callbacks
        pad = 30
        x = pad
        inner_w = self.PANEL_W - pad * 2

        y = 110
        self.btn_continue = TextButton(
            (x, y, inner_w, 52), 'Continue', fonts['btn'],
            self.accent, (28, 26, 30), on_click=callbacks.get('continue'),
            radius=14)
        y += 52 + 10
        self.btn_restart = TextButton(
            (x, y, inner_w, 44), 'Restart', fonts['btn'],
            self.btn_base, self.text_color, on_click=callbacks.get('restart'),
            radius=12)
        y += 44 + 18

        self._mode_label_y = y
        y += 22
        opts = [('Easy', 20), ('Normal', 10), ('Hard', 0)]
        idx = {20: 0, 10: 1, 0: 2}.get(complexity, 0)
        self.segmented = Segmented(
            (x, y, inner_w, 40), opts, idx, fonts['small'],
            self.btn_base, self.accent, self.text_color,
            on_select=callbacks.get('mode'))
        y += 40 + 16

        self._vol_label_y = y
        y += 22
        self.slider = Slider(
            (x, y + 4, inner_w - 56, 16), volume, fonts['small'],
            _brighten(palette['panel'], 24), self.accent, self.text_color,
            on_change=callbacks.get('volume'))
        y += 16 + 20

        half = (inner_w - 12) // 2
        self.btn_howto = TextButton(
            (x, y, half, 44), 'How to Play', fonts['btn'],
            self.accent, (28, 26, 30), on_click=callbacks.get('tutorial'),
            radius=12)
        self.btn_theme = TextButton(
            (x + half + 12, y, half, 44), 'Theme', fonts['btn'],
            self.btn_base, self.text_color, on_click=callbacks.get('theme'),
            radius=12)
        y += 44 + 14

        self.toggle_tips = Toggle(
            (x, y, inner_w, 30), 'Show tooltips', tooltips, fonts['small'],
            _brighten(palette['panel'], 26), self.accent, self.text_color,
            on_change=callbacks.get('tooltips'))
        y += 30 + 6
        self.toggle_touch = Toggle(
            (x, y, inner_w, 30), 'Tap to select  (touch)', touch,
            fonts['small'], _brighten(palette['panel'], 26), self.accent,
            self.text_color, on_change=callbacks.get('touch'))
        y += 30 + 16

        self._stats_y = y
        self.PANEL_H = y + 24 + 3 * 22 + 22
        self.panel = pygame.Rect(0, 0, self.PANEL_W, self.PANEL_H)

        self.widgets = [self.btn_continue, self.btn_restart, self.segmented,
                        self.slider, self.btn_howto, self.btn_theme,
                        self.toggle_tips, self.toggle_touch]
        self._panel_bg = self._build_bg()

    def _build_bg(self):
        surf = pygame.Surface((self.PANEL_W, self.PANEL_H), pygame.SRCALPHA)
        draw_panel(surf, (0, 0, self.PANEL_W, self.PANEL_H), self.panel_color,
                   radius=24, border_color=_brighten(self.panel_color, 26))
        cx = self.PANEL_W // 2
        draw_text_spaced(surf, 'EINSTEIN', self.fonts['h1'], self.text_color,
                         (cx, 50), spacing=4)
        draw_text(surf, 'main menu', self.fonts['tiny'], self.muted,
                  center=(cx, 78))
        draw_text(surf, 'DIFFICULTY', self.fonts['tiny'], self.muted,
                  topleft=(30, self._mode_label_y))
        draw_text(surf, 'VOLUME', self.fonts['tiny'], self.muted,
                  topleft=(30, self._vol_label_y))
        self._draw_progress(surf)
        return surf

    def _draw_progress(self, surf):
        cx = self.PANEL_W // 2
        sy = self._stats_y
        draw_text(surf, 'PROGRESS', self.fonts['tiny'], self.muted,
                  topleft=(30, sy))
        ry = sy + 24
        for label, key in (('Easy', 'easy'), ('Normal', 'normal'),
                           ('Hard', 'hard')):
            entry = (self._stats or {}).get(key) or {}
            levels = entry.get('levels', 0)
            best = entry.get('best')
            stars = entry.get('best_stars', 0) if levels else 0
            draw_text(surf, label, self.fonts['small'], self.text_color,
                      topleft=(30, ry))
            star_txt = '★' * stars + '☆' * (3 - stars)
            draw_text(surf, star_txt, self.fonts['small'], STAR_GOLD,
                      topleft=(94, ry))
            draw_text(surf, '%d solved' % levels, self.fonts['small'],
                      self.muted, center=(cx + 42, ry + 9))
            best_txt = _fmt_time(best) if best else '--:--'
            bw = self.fonts['small'].size(best_txt)[0]
            draw_text(surf, best_txt, self.fonts['small'], self.text_color,
                      topleft=(self.PANEL_W - 30 - bw, ry))
            ry += 22

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
# tutorial
# --------------------------------------------------------------------------
class TutorialOverlay(_Overlay):
    """A short, paged how-to-play guide with simple drawn illustrations."""

    PANEL_W = 552
    PANEL_H = 478

    def __init__(self, screen_size, palette, fonts, on_done=None):
        super().__init__(screen_size, palette)
        self.fonts = fonts
        self._on_done = on_done
        self.panel = pygame.Rect(0, 0, self.PANEL_W, self.PANEL_H)
        self.page = 0
        self.pages = self._build_pages()
        self._rows = palette['rows']
        pad = 30
        inner_w = self.PANEL_W - pad * 2
        half = (inner_w - 14) // 2
        by = self.PANEL_H - pad - 46
        self.btn_back = TextButton(
            (pad, by, half, 46), 'Back', fonts['btn'],
            self.btn_base, self.text_color, on_click=self._back, radius=12)
        self.btn_next = TextButton(
            (pad + half + 14, by, half, 46), 'Next', fonts['btn'],
            self.accent, (28, 26, 30), on_click=self._next, radius=12)
        self.btn_skip = TextButton(
            (self.PANEL_W - pad - 84, 22, 84, 28), 'Skip', fonts['small'],
            _brighten(palette['panel'], 30), self.muted,
            on_click=self._finish, radius=8)
        self.widgets = [self.btn_back, self.btn_next, self.btn_skip]
        self._frame = self._build_frame()
        self._refresh()

    # ------- pages -------
    @staticmethod
    def _build_pages():
        return [
            {'title': 'The goal', 'illus': 0,
             'body': 'The board is six rows of six cells. Every cell hides '
                     'one symbol — clear away the wrong guesses until each '
                     'cell shows just one.'},
            {'title': 'Removing symbols', 'illus': 1,
             'body': 'Click a candidate you can rule out and it pops away. '
                     'When a single candidate is left, that cell is solved '
                     'for you. A wrong removal costs a life.'},
            {'title': 'Clue: same column', 'illus': 2,
             'body': 'Two symbols joined by the up-down arrow live in the '
                     'very same column of the grid.'},
            {'title': 'Clue: left of', 'illus': 3,
             'body': 'The dots mean the left symbol sits somewhere left of '
                     'the right one — not necessarily right next to it.'},
            {'title': 'Clue: neighbours', 'illus': 4,
             'body': 'The side arrow means the two symbols are in '
                     'neighbouring columns, touching each other.'},
            {'title': 'Clue: three in a row', 'illus': 5,
             'body': 'Three symbols with no marker fill three columns in a '
                     'row, in the order shown, left to right.'},
            {'title': 'Hints & winning', 'illus': 6,
             'body': 'Hover a clue (or tap it in touch mode) to light up '
                     'every cell it mentions. Three mistakes end the run; '
                     'solve all 36 cells to win.'},
        ]

    # ------- navigation -------
    def _refresh(self):
        last = self.page >= len(self.pages) - 1
        self.btn_next.label = 'Got it!' if last else 'Next'
        self.btn_back.visible = self.btn_back.enabled = self.page > 0

    def _next(self):
        if self.page >= len(self.pages) - 1:
            self._finish()
        else:
            self.page += 1
            self._refresh()

    def _back(self):
        if self.page > 0:
            self.page -= 1
            self._refresh()

    def _finish(self):
        if self._on_done:
            self._on_done()
        self.close()

    # ------- frame / draw -------
    def _build_frame(self):
        surf = pygame.Surface((self.PANEL_W, self.PANEL_H), pygame.SRCALPHA)
        draw_panel(surf, (0, 0, self.PANEL_W, self.PANEL_H), self.panel_color,
                   radius=24, border_color=_brighten(self.panel_color, 26))
        return surf

    def update(self, dt, mouse_pos):
        super().update(dt, mouse_pos)
        local = self._to_local(mouse_pos)
        for wdg in self.widgets:
            wdg.update(dt, local)

    def handle_event(self, event):
        self._route(event, self.widgets)

    def _panel_surface(self):
        surf = self._frame.copy()
        cx = self.PANEL_W // 2
        page = self.pages[self.page]
        draw_text(surf, page['title'], self.fonts['h1'], self.text_color,
                  center=(cx, 52))
        draw_text(surf, 'step %d / %d' % (self.page + 1, len(self.pages)),
                  self.fonts['tiny'], self.muted, center=(cx, 80))
        illus = pygame.Rect(44, 100, self.PANEL_W - 88, 170)
        self._draw_illustration(surf, illus, page['illus'])
        ly = 296
        for line in wrap_text(page['body'], self.fonts['small'],
                              self.PANEL_W - 96):
            draw_text(surf, line, self.fonts['small'], self.muted,
                      center=(cx, ly))
            ly += 21
        # page dots
        n = len(self.pages)
        for i in range(n):
            col = self.accent if i == self.page else \
                _brighten(self.panel_color, 42)
            pygame.draw.circle(surf, col,
                               (int(cx - (n - 1) * 8 + i * 16), 374), 4)
        for wdg in self.widgets:
            wdg.draw(surf)
        return surf

    # ------- illustrations -------
    def _cell(self, surf, rect, color, sym, font=None, crossed=False,
              ring=False, dim=False):
        rect = pygame.Rect(rect)
        c = lerp_color(color, self.panel_color, 0.55) if dim else color
        surf.blit(rounded_fill(rect.w, rect.h, c, 9), rect.topleft)
        if ring:
            surf.blit(rounded_border(rect.w, rect.h, (245, 245, 250), 9, 3),
                      rect.topleft)
        if sym:
            f = font or self.fonts['h1']
            img = f.render(sym, True, (255, 255, 255))
            surf.blit(img, img.get_rect(center=rect.center))
        if crossed:
            for a, b in (((rect.x + 9, rect.y + 9),
                          (rect.right - 9, rect.bottom - 9)),
                         ((rect.right - 9, rect.y + 9),
                          (rect.x + 9, rect.bottom - 9))):
                pygame.draw.line(surf, (236, 92, 92), a, b, 5)

    def _grid(self, surf, area, cols=6, rows=2, cell=52):
        """Faint column slots; returns a slot_rect(col, row) function."""
        gap = 8
        gw = cols * cell + (cols - 1) * gap
        gh = rows * cell + (rows - 1) * gap
        ox = area.centerx - gw // 2
        oy = area.centery - gh // 2
        slot = _brighten(self.panel_color, 16)
        for c in range(cols):
            for r in range(rows):
                rx = ox + c * (cell + gap)
                ry = oy + r * (cell + gap)
                surf.blit(rounded_fill(cell, cell, slot, 8), (rx, ry))

        def slot_rect(col, row):
            return pygame.Rect(ox + col * (cell + gap),
                               oy + row * (cell + gap), cell, cell)
        return slot_rect

    def _draw_illustration(self, surf, area, idx):
        rows = self._rows
        big = self.fonts['h1']
        if idx == 0:
            slot = self._grid(surf, area, cols=6, rows=1)
            syms = ['3', 'Ⅱ', 'C', '$', 'π', '+']
            for c in range(6):
                self._cell(surf, slot(c, 0), rows[c + 1], syms[c], big)
        elif idx == 1:
            slot = self._grid(surf, area, cols=6, rows=1)
            a = slot(1, 0)
            self._cell(surf, a, rows[2], '2', big)
            b = slot(3, 0)
            self._cell(surf, b, rows[2], '2', big, crossed=True)
            c = slot(5, 0)
            self._cell(surf, c, rows[4], 'D', big, ring=True)
            ar = self.fonts['title']
            draw_text(surf, '→', ar, self.muted,
                      center=(area.centerx, a.centery))
        elif idx == 2:                       # same column
            slot = self._grid(surf, area, cols=6, rows=2)
            for r in range(2):
                hl = slot(2, r).inflate(10, 10)
                surf.blit(rounded_border(hl.w, hl.h, self.accent, 11, 2),
                          hl.topleft)
            self._cell(surf, slot(2, 0), rows[1], '5', big)
            self._cell(surf, slot(2, 1), rows[4], 'β', big)
            draw_text(surf, '↕', self.fonts['title'], self.accent,
                      center=(slot(2, 0).right + 40, area.centery))
        elif idx == 3:                       # left of
            slot = self._grid(surf, area, cols=6, rows=1)
            a = slot(0, 0)
            b = slot(4, 0)
            self._cell(surf, a, rows[3], 'A', big)
            self._cell(surf, b, rows[6], 'φ', big)
            y = a.centery
            pygame.draw.line(surf, self.accent, (a.right + 8, y),
                             (b.x - 8, y), 3)
            pygame.draw.polygon(surf, self.accent,
                                [(b.x - 8, y), (b.x - 20, y - 7),
                                 (b.x - 20, y + 7)])
        elif idx == 4:                       # neighbours
            slot = self._grid(surf, area, cols=6, rows=1)
            for c in (2, 3):
                hl = slot(c, 0).inflate(10, 10)
                surf.blit(rounded_border(hl.w, hl.h, self.accent, 11, 2),
                          hl.topleft)
            self._cell(surf, slot(2, 0), rows[2], 'Ⅳ', big)
            self._cell(surf, slot(3, 0), rows[5], 'π', big)
        elif idx == 5:                       # three in a row
            slot = self._grid(surf, area, cols=6, rows=1)
            trio = [(2, rows[1], '1'), (3, rows[3], 'C'), (4, rows[6], '=')]
            for c, col, sym in trio:
                self._cell(surf, slot(c, 0), col, sym, big)
        else:                                # hints & winning
            cw = 96
            r = pygame.Rect(area.centerx - cw // 2,
                            area.centery - cw // 2, cw, cw)
            self._cell(surf, r, rows[4], 'D', big, ring=True)
            for i in range(3):
                spr = make_heart(24, (228, 78, 92), True)
                surf.blit(spr, (area.centerx - 38 + i * 28, area.bottom - 26))
