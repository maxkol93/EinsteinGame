import os
import pygame

from view.decoder import decode_symbol


BG_COLOR = (40, 40, 40)
WHITE = (255, 255, 255)
DARK_GREY = (65, 65, 65)
TRANSPARENT_GREY = (130, 130, 130)

_ROW_COLORS = {
    1: (103, 76, 81),
    2: (157, 78, 63),
    3: (174, 141, 94),
    4: (97, 134, 141),
    5: (53, 88, 90),
    6: (97, 66, 51),
}


def apply_palette(palette):
    """Swap the module-level row colors + bg used by Button.draw / color_for_value."""
    global BG_COLOR
    BG_COLOR = palette['bg']
    _ROW_COLORS.clear()
    _ROW_COLORS.update(palette['rows'])


def color_for_value(value):
    if isinstance(value, int):
        if value == 77:
            return TRANSPARENT_GREY
        row = value // 10
        return _ROW_COLORS.get(row, BG_COLOR)
    return None


def _blend_with_bg(color, alpha):
    """Approximate Color.FromArgb(alpha, R, G, B) painted on BG_COLOR."""
    k = alpha / 255.0
    return tuple(int(BG_COLOR[i] * (1 - k) + color[i] * k) for i in range(3))


def _brighten(color, amount):
    return tuple(max(0, min(255, c + amount)) for c in color[:3])


# Cached anti-aliased rounded-rect fills. pygame.draw.rect's border_radius is
# alias-pixel; here we render at SSAA scale and downsample with smoothscale to
# get clean smooth edges. The cache prevents re-rendering each frame.
_ROUNDED_FILL_CACHE = {}
_ROUNDED_BORDER_CACHE = {}
SSAA = 4


def _key(w, h, color, radius):
    return (int(w), int(h), tuple(int(c) for c in color[:3]), int(radius))


def rounded_fill(w, h, color, radius):
    k = _key(w, h, color, radius)
    cached = _ROUNDED_FILL_CACHE.get(k)
    if cached is not None:
        return cached
    sw, sh, sr = w * SSAA, h * SSAA, radius * SSAA
    big = pygame.Surface((sw, sh), pygame.SRCALPHA)
    pygame.draw.rect(big, (*color[:3], 255), (0, 0, sw, sh), border_radius=sr)
    pad = pygame.transform.smoothscale(big, (w, h))
    _ROUNDED_FILL_CACHE[k] = pad
    return pad


_ROUNDED_TINT_CACHE = {}


def rounded_tint(w, h, color, alpha, radius):
    k = (_key(w, h, color, radius), int(alpha))
    cached = _ROUNDED_TINT_CACHE.get(k)
    if cached is not None:
        return cached
    sw, sh, sr = w * SSAA, h * SSAA, radius * SSAA
    big = pygame.Surface((sw, sh), pygame.SRCALPHA)
    pygame.draw.rect(big, (*color[:3], int(alpha)), (0, 0, sw, sh), border_radius=sr)
    pad = pygame.transform.smoothscale(big, (w, h))
    _ROUNDED_TINT_CACHE[k] = pad
    return pad


def rounded_border(w, h, color, radius, width=1):
    k = (_key(w, h, color, radius), int(width))
    cached = _ROUNDED_BORDER_CACHE.get(k)
    if cached is not None:
        return cached
    sw, sh, sr, sb = w * SSAA, h * SSAA, radius * SSAA, max(1, width * SSAA)
    big = pygame.Surface((sw, sh), pygame.SRCALPHA)
    pygame.draw.rect(big, (*color[:3], 255), (0, 0, sw, sh), sb, border_radius=sr)
    pad = pygame.transform.smoothscale(big, (w, h))
    _ROUNDED_BORDER_CACHE[k] = pad
    return pad


def mask_to_round(surface, radius):
    """Return a copy of `surface` clipped to a rounded-rect alpha mask.
    Uses SSAA so the corners come out smooth, not staircased."""
    w, h = surface.get_size()
    sw, sh, sr = w * SSAA, h * SSAA, radius * SSAA
    big_mask = pygame.Surface((sw, sh), pygame.SRCALPHA)
    pygame.draw.rect(big_mask, (255, 255, 255, 255), (0, 0, sw, sh),
                     border_radius=sr)
    mask = pygame.transform.smoothscale(big_mask, (w, h))
    out = pygame.Surface((w, h), pygame.SRCALPHA)
    out.blit(surface, (0, 0))
    out.blit(mask, (0, 0), special_flags=pygame.BLEND_RGBA_MIN)
    return out


def clear_rounded_cache():
    _ROUNDED_FILL_CACHE.clear()
    _ROUNDED_BORDER_CACHE.clear()


class GameButton(object):
    """Base button: rectangle (rounded), optional bg image, text, color, click cb."""

    DEFAULT_RADIUS_BIG = 12
    DEFAULT_RADIUS_SMALL = 6

    def __init__(self, rect=(0, 0, 50, 50), text='', font=None,
                 bg_image=None, bg_color=None, fg_color=WHITE,
                 text_align='center', border=True, radius=None):
        self.rect = pygame.Rect(rect)
        self.text = text
        self.font = font
        self.bg_image = bg_image
        self.bg_color = bg_color
        self.fg_color = fg_color
        self.text_align = text_align
        self.border = border
        self.radius = radius if radius is not None else (
            self.DEFAULT_RADIUS_BIG if self.rect.w >= 60
            else self.DEFAULT_RADIUS_SMALL
        )
        self.enabled = True
        self.visible = True
        self.hovered = False
        self.on_click = None
        self.on_mouse_down = None
        self.user_data = None

    def hit_test(self, pos):
        return self.visible and self.enabled and self.rect.collidepoint(pos)

    def draw(self, surface):
        if not self.visible:
            return
        r = self.radius
        w, h = self.rect.w, self.rect.h
        if self.bg_color is not None:
            color = self.bg_color
            if self.hovered and self.enabled:
                color = _brighten(color, 55)
            surface.blit(rounded_fill(w, h, color, r), self.rect.topleft)
        if self.bg_image is not None:
            surface.blit(self.bg_image, self.rect.topleft)
            if self.hovered and self.enabled:
                surface.blit(rounded_tint(w, h, (255, 255, 255), 48, r),
                             self.rect.topleft)
        if self.border:
            border_color = _brighten(BG_COLOR, 40) if self.hovered else BG_COLOR
            surface.blit(rounded_border(w, h, border_color, r, 1), self.rect.topleft)
        if self.text and self.font is not None:
            self._draw_text(surface)

    def _draw_text(self, surface):
        img = self.font.render(self.text, True, self.fg_color)
        tw, th = img.get_size()
        # pygame.font.Font.render returns a surface with height = ascent+descent,
        # but our glyphs (digits, currency, romans, latin caps, greek) have no
        # descenders. Geometric centering ends up biased downward; shift by half
        # the descent to put the visual glyph bbox in the cell's center.
        descent_shift = self.font.get_descent() // 2  # get_descent() is negative
        if self.text_align == 'top':
            x = self.rect.x + (self.rect.w - tw) // 2
            y = self.rect.y + 2
        else:  # center
            x = self.rect.x + (self.rect.w - tw) // 2
            y = self.rect.y + (self.rect.h - th) // 2 + descent_shift
        surface.blit(img, (x, y))


class RuleButton(GameButton):
    def __init__(self, index, value, rect, font):
        text = ''
        bg_color = None
        if isinstance(value, int):
            text = decode_symbol.get(value, '')
            bg_color = color_for_value(value)
        else:
            if '^' in value:
                text = '↕'
            elif '<->' in value:
                text = '↔'
            elif '...' in value:
                text = '…'
            bg_color = None  # transparent on parent
        super().__init__(rect=rect, text=text, font=font,
                         bg_color=bg_color, fg_color=WHITE)
        self._index = index
        self._n = value
        self._pressed = False
        self._base_color = bg_color

    @property
    def index(self):
        return self._index

    @property
    def value(self):
        return self._n

    @property
    def pressed(self):
        return self._pressed

    @pressed.setter
    def pressed(self, val):
        self._pressed = val

    def change_color(self):
        if not self._pressed:
            self.fg_color = WHITE
            self.bg_color = self._base_color
        else:
            if self._base_color is not None:
                self.bg_color = _blend_with_bg(self._base_color, 50)
            self.fg_color = DARK_GREY


class FieldButton(GameButton):
    def __init__(self, y, x, n, rect, font):
        symbol = decode_symbol.get(n, '')
        super().__init__(rect=rect, text=symbol, font=font,
                         bg_color=color_for_value(n), fg_color=WHITE)
        self._y = y
        self._x = x
        self._n = n
        self._symbol = symbol

    @property
    def y(self):
        return self._y

    @property
    def x(self):
        return self._x

    @property
    def n(self):
        return self._n

    @property
    def symbol(self):
        return self._symbol
