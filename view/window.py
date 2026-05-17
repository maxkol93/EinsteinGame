import math
import os
from random import choice

import pygame

from view.buttons import (
    GameButton, RuleButton, FieldButton, color_for_value, apply_palette,
    rounded_fill, rounded_border, BG_COLOR,
)
from view.effects import Effects, Ghost
from view.palettes import get_palette
from view.anim import clamp01, ease_out_back, ease_out_cubic, lerp
from view.ui import (MenuOverlay, ResultOverlay, TutorialOverlay, TextButton,
                     make_heart, draw_text)
from view.decoder import describe_rule
import view.buttons as buttons_mod


# Layout constants. The window is three columns: a left panel (timer + lives),
# the 6x6 board, and a right panel (rules). Both side panels share one width
# and the board is framed by an identical margin on every side.
CELL_SIDE = 100
CELL_GAP = 3
FIELD_COLS = 6
FIELD_ROWS = 6
FIELD_CELLS = FIELD_ROWS * FIELD_COLS

# the board itself, gaps included
FIELD_W = CELL_SIDE * FIELD_COLS + CELL_GAP * (FIELD_COLS - 1)
FIELD_H = CELL_SIDE * FIELD_ROWS + CELL_GAP * (FIELD_ROWS - 1)

PANEL_W = 280          # the left and the right panel share one width
MARGIN = 60            # uniform gap framing the board on every side
SIDEBAR_W = PANEL_W    # left-panel width (name kept for the sidebar code)

INDENT_LEFT = PANEL_W + MARGIN          # board origin x
INDENT_TOP = MARGIN                     # board origin y

RULES_PANEL_W = PANEL_W
RULES_PANEL_X = INDENT_LEFT + FIELD_W + MARGIN   # right panel origin x
RULES_TOP = 54                          # first rule row, y inside the panel

CANVAS_WIDTH = PANEL_W + MARGIN + FIELD_W + MARGIN + PANEL_W
CANVAS_HEIGHT = MARGIN + FIELD_H + MARGIN

HOVER_PROPAGATE_DELAY = 0.2  # seconds before a hover fans out to linked cells

_LOOSE_MSGS = [
    "don't worry and try again!",
    "be careful and try again!",
    "but you still have a chance!",
]
_FIRST_WRONG = [
    "wrong! =(",
    "oops, not there!",
    "it is not true.",
    "read the rules again!",
    "do you think this is a good move?",
    "how could you click here?",
]
_SECOND_WRONG = [
    "you broke the game!",
    "so, what is next?",
    "you need a break!",
    "drink some coffee, can it help?",
    "how will you get out of this situation?",
]
_GOOD_MSGS = [
    "good!",
    "yep, continue!",
    "not bad, but that's not all!",
    "you're so clever, go on!",
    "wow, you're great!",
    "your mind is gorgeous!",
]
_WIN_MSGS = [
    "good job, you win!",
    "Einstein would be proud of you!",
    "you need to be a scientist!",
]


# 4x4 ordered-dither matrix. The big-cell gradient spans only ~65 shade
# steps across 100 px, which plain truncation renders as visible horizontal
# bands; dithering scatters the rounding so the gradient reads as smooth.
_BAYER4 = ((0, 8, 2, 10), (12, 4, 14, 6), (3, 11, 1, 9), (15, 7, 13, 5))


def _make_gradient_surface(size, base, top_factor=1.30, bottom_factor=0.65,
                           radius=14):
    """Vertical gradient used as a big-cell background. Ordered dithering
    keeps the shallow gradient band-free; a soft highlight near the top fakes
    a light source without the hard 1 px stripe a plain line would leave."""
    from view.buttons import mask_to_round
    w, h = size
    raw = pygame.Surface((w, h))
    sheen_y = h * 0.22
    sheen_spread = max(1.0, h * 0.11)
    # one dithered colour per (row, x-phase); 4 phases span the Bayer width
    variants = []
    for y in range(h):
        t = y / max(1, h - 1)
        f = top_factor + (bottom_factor - top_factor) * t
        s = max(0.0, 1.0 - abs(y - sheen_y) / sheen_spread)
        s = s * s * 24.0                       # soft highlight band
        fc = [ch * f + s for ch in base]
        brow = _BAYER4[y & 3]
        variants.append([
            tuple(max(0, min(255, int(ch + (brow[p] + 0.5) / 16.0 - 0.5)))
                  for ch in fc)
            for p in range(4)
        ])
    pa = pygame.PixelArray(raw)
    for x in range(w):
        phase = x & 3
        column = pa[x]
        for y in range(h):
            column[y] = variants[y][phase]
        del column          # release the sub-view so the surface unlocks
    del pa
    return mask_to_round(raw, radius)


class GameWindow(object):
    def __init__(self, rules, palette_name='mocha', sounds=None,
                 complexity=20):
        self._base_dir = os.path.dirname(__file__)
        self._images_dir = os.path.join(self._base_dir, 'images')
        self._fonts_dir = os.path.join(self._base_dir, 'fonts')

        self._palette_name = palette_name
        self._palette = get_palette(palette_name)
        apply_palette(self._palette)
        self._sounds = sounds
        self._complexity = complexity

        self.surface = pygame.display.get_surface()
        if self.surface is None:
            self.surface = pygame.display.set_mode((CANVAS_WIDTH, CANVAS_HEIGHT))
            pygame.display.set_caption('Einstein game')

        self._load_fonts()
        self._load_images()

        self._cells = []           # _cells[y][x] is either list[FieldButton] or None
        self._big_cells = {}       # {(y, x): GameButton}
        self._rules_buttons = []   # list of [btn_1, btn_2, btn_3]
        self._big_buttons = []     # GameButtons representing solved cells
        self._effects = Effects(bounds=(CANVAS_WIDTH, CANVAS_HEIGHT))
        self._effects.set_theme_colors(list(self._palette['rows'].values()))
        self._scene = pygame.Surface((CANVAS_WIDTH, CANVAS_HEIGHT))
        self._cascade_time = 0.0
        self._cascade_duration = 0.0
        self._mouse_pos = (-1, -1)
        self._suppress_effects = False
        self._clock = 0.0

        self._result_text = ''
        self._msg_anim = 1.0
        self._timer_text = '00:00'
        self._timer_color = self._palette['text']

        self._defined_cells_count = 0
        self._count_good = 0

        # lives display
        self._max_lives = 3
        self._lives = 3
        self._heart_breaks = []
        self._hearts_react = 0.0

        # hover-propagation state
        self._hover_sig = None
        self._hover_timer = 0.0
        self._propagated = False
        self._lifted_widget = None
        self._hovered_group = None

        # tooltips + touch
        self._tooltips_enabled = True
        self._touch_mode = False
        self._armed = None       # touch: a tapped-once widget awaiting confirm

        self._show_rules_overlay = False
        self._rules_scroll = 0
        self._overlay = None       # MenuOverlay / ResultOverlay
        self._confetti_timer = 0.0
        self._stats_summary = None

        # cells resolved together by one click pop in as a cascade: each is
        # collected here, then flushed with a staggered delay
        self._batch_big = []

        # Handler hooks (presenter registers these)
        self.on_field_click = None
        self.on_rule_click = None
        self.on_continue = None
        self.on_restart = None
        self.on_mode_select = None
        self.on_open_menu = None
        self.on_volume = None
        self.on_tooltips = None
        self.on_touch = None
        self.on_theme = None
        self.on_tutorial_done = None

        self._build_field_buttons()
        self._build_rules_buttons(list(rules))
        self._build_sidebar()
        self._sidebar_strip = self._make_shadow_strip(dark_on_right=False)
        self._rules_strip = self._make_shadow_strip(dark_on_right=True)

    # --------------------------- loading -----------------------------

    def _load_fonts(self):
        reg = os.path.join(self._fonts_dir, 'DejaVuSans.ttf')
        bold = os.path.join(self._fonts_dir, 'DejaVuSans-Bold.ttf')
        self._font_msg = pygame.font.Font(reg, 16)
        self._font_field = pygame.font.Font(bold, 14)
        self._font_rule = pygame.font.Font(reg, 18)
        self._font_big = pygame.font.Font(bold, 48)
        self._font_timer = pygame.font.Font(bold, 31)
        self._font_menu = pygame.font.Font(bold, 18)
        self._font_label = pygame.font.Font(bold, 12)
        self._ui_fonts = {
            'title': pygame.font.Font(bold, 46),
            'h1': pygame.font.Font(bold, 30),
            'btn': pygame.font.Font(reg, 21),
            'small': pygame.font.Font(reg, 14),
            'tiny': pygame.font.Font(reg, 12),
        }

    def _load_images(self):
        # Procedural big-cell backgrounds (top-light gradient + subtle sheen).
        self._big_bg = [None]
        for row in range(1, 7):
            base = self._palette['rows'][row]
            self._big_bg.append(_make_gradient_surface((CELL_SIDE, CELL_SIDE), base))
        self._img_rules_page = pygame.image.load(
            os.path.join(self._images_dir, 'Game_rules_900_1767.jpg')
        ).convert_alpha()

    # --------------------------- building ----------------------------

    def _build_field_buttons(self):
        for y in range(FIELD_ROWS):
            row = []
            for x in range(FIELD_COLS):
                row.append(self._create_mini_buttons(y, x))
            self._cells.append(row)

    def _create_mini_buttons(self, y, x):
        btns = []
        cell_x = INDENT_LEFT + x * CELL_SIDE + x * CELL_GAP
        cell_y = INDENT_TOP + y * CELL_SIDE + y * CELL_GAP + 16
        sub_w = CELL_SIDE // 3
        sub_h = CELL_SIDE // 3
        for dy in range(2):
            for dx in range(3):
                n = (y + 1) * 10 + dy * 3 + dx + 1
                rect = (cell_x + dx * sub_w, cell_y + dy * sub_h, sub_w, sub_h)
                btn = FieldButton(y, x, n, rect, self._font_field)
                btns.append(btn)
        return btns

    def _build_rules_buttons(self, rules):
        rules.sort(key=lambda r: (1, r[1]) if isinstance(r[1], str) else (0, r[1]),
                   reverse=True)
        mini = (CELL_SIDE + 15) // 3
        rule_w = mini * 3
        col_gap = 16
        pad_x = (RULES_PANEL_W - 2 * rule_w - col_gap) // 2
        row_h = mini + 9
        for i, rule in enumerate(rules):
            ty, tx = i % 14, i // 14
            group_x = RULES_PANEL_X + pad_x + tx * (rule_w + col_gap)
            group_y = RULES_TOP + ty * row_h
            b1 = RuleButton(i, rule[0], (group_x, group_y, mini, mini), self._font_rule)
            b2 = RuleButton(i, rule[1], (group_x + mini, group_y, mini, mini), self._font_rule)
            b3 = RuleButton(i, rule[2], (group_x + 2 * mini, group_y, mini, mini), self._font_rule)
            self._rules_buttons.append([b1, b2, b3])

    def _build_sidebar(self):
        base = buttons_mod._brighten(self._palette['panel'], 44)
        self._menu_button = TextButton(
            (24, 22, SIDEBAR_W - 48, 48), 'MENU', self._font_menu,
            base, self._palette['text'], on_click=self._request_menu,
            radius=12, accent=buttons_mod._brighten(self._palette['panel'], 70))

    def _make_shadow_strip(self, dark_on_right):
        """A 16px soft shadow strip cast by a panel onto the board area."""
        strip = pygame.Surface((16, CANVAS_HEIGHT), pygame.SRCALPHA)
        for i in range(16):
            f = (i / 16.0) if dark_on_right else (1.0 - i / 16.0)
            a = int(70 * f ** 2)
            pygame.draw.line(strip, (0, 0, 0, a), (i, 0), (i, CANVAS_HEIGHT))
        return strip

    # --------------------------- public API --------------------------

    def change_complexity(self, complexity):
        self._complexity = complexity

    def set_stats(self, summary):
        """Per-difficulty progress, shown by the menu overlay."""
        self._stats_summary = summary

    def set_tooltips(self, enabled):
        self._tooltips_enabled = bool(enabled)

    def set_touch(self, enabled):
        self._touch_mode = bool(enabled)
        if not enabled:
            self._armed = None

    def set_lives(self, max_lives):
        self._max_lives = max_lives
        self._lives = max_lives
        self._heart_breaks = []

    def damage_life(self):
        if self._lives <= 0:
            return
        self._lives -= 1
        slot = self._lives
        self._heart_breaks.append({'slot': slot, 't': 0.0})
        cx, cy = self._heart_pos(slot)
        self._effects.heart_break(cx, cy)
        self._hearts_react = 0.5

    def add_life(self):
        """Debug helper: grant one extra heart."""
        self._max_lives += 1
        self._lives += 1
        cx, cy = self._heart_pos(self._lives - 1)
        self._effects.burst(cx, cy, (228, 90, 104), count=9, speed=170,
                            life_range=(0.3, 0.55), size=3)

    def disable_rule_buttons(self, btn, index):
        for sub in self._rules_buttons[index]:
            sub.pressed = not sub.pressed
            sub.change_color()
        self._play('click')

    def disable_buttons(self):
        self._armed = None
        for row in self._cells:
            for cell in row:
                if isinstance(cell, list):
                    for btn in cell:
                        btn.enabled = False

    def set_massage(self, state_of_game, lives_left=None):
        if state_of_game == 'good':
            self._count_good += 1
            self._result_text = '' if self._count_good >= 3 else choice(_GOOD_MSGS)
            if self._result_text:
                self._bump_message()
        elif state_of_game == 'wrong':
            self._count_good = 0
            pool = _FIRST_WRONG if (lives_left or 0) > 1 else _SECOND_WRONG
            if lives_left == 1:
                tail = ' last life!'
            elif lives_left and lives_left > 0:
                tail = ' %d lives left.' % lives_left
            else:
                tail = ''
            self._result_text = choice(pool) + tail
            self._bump_message()

    def _bump_message(self):
        self._msg_anim = 0.0

    def timer_update(self, value):
        self._timer_text = '{}{}:{}{}'.format(
            value // 60 // 10, value // 60 % 10,
            value % 60 // 10, value % 60 % 10)

    def set_timer_mood(self, win):
        self._timer_color = (255, 222, 90) if win else (236, 96, 96)

    def define_start_cells(self, rules):
        self._suppress_effects = True
        for rule in rules:
            y = rule[0] // 10 - 1
            x = rule[2]
            num = rule[0]
            cell = self._cells[y][x]
            if not isinstance(cell, list):
                continue
            for btn in list(cell):
                if btn.n != num:
                    self.remove_button(btn)
        self._suppress_effects = False
        self._compute_cascade_duration()

    @property
    def defined_cells_count(self):
        return self._defined_cells_count

    @property
    def overlay_active(self):
        return self._overlay is not None and not self._overlay.dead

    @property
    def timer_text(self):
        return self._timer_text

    # --------------------------- overlays ----------------------------

    def open_menu(self):
        self._effects.calm()
        self._armed = None
        vol = self._sounds.volume if self._sounds else 0.7
        callbacks = {
            'continue': self._menu_continue,
            'restart': lambda: self.on_restart and self.on_restart(),
            'mode': lambda c: self.on_mode_select and self.on_mode_select(c),
            'tutorial': self.open_tutorial,
            'volume': lambda v: self.on_volume and self.on_volume(v),
            'theme': self._menu_theme,
            'tooltips': self._menu_tooltips,
            'touch': self._menu_touch,
        }
        self._overlay = MenuOverlay((CANVAS_WIDTH, CANVAS_HEIGHT),
                                    self._palette, self._ui_fonts,
                                    self._complexity, vol, callbacks,
                                    stats=self._stats_summary,
                                    tooltips=self._tooltips_enabled,
                                    touch=self._touch_mode)

    def open_tutorial(self):
        """Open the paged how-to-play guide (returns to the menu on close)."""
        self._play('click')
        self._armed = None
        self._overlay = TutorialOverlay(
            (CANVAS_WIDTH, CANVAS_HEIGHT), self._palette, self._ui_fonts,
            on_done=lambda: self.on_tutorial_done and self.on_tutorial_done())

    def _menu_tooltips(self, value):
        self._tooltips_enabled = bool(value)
        if self.on_tooltips:
            self.on_tooltips(bool(value))

    def _menu_touch(self, value):
        self.set_touch(value)
        if self.on_touch:
            self.on_touch(bool(value))

    def show_win(self, stars=0, score=0, best_score=0):
        msg = choice(_WIN_MSGS)
        self._overlay = ResultOverlay(
            (CANVAS_WIDTH, CANVAS_HEIGHT), self._palette, self._ui_fonts,
            True, msg, self._timer_text,
            {'menu': lambda: self.on_open_menu and self.on_open_menu(),
             'restart': lambda: self.on_restart and self.on_restart()},
            stars=stars, score=score, best_score=best_score)
        self._effects.celebrate()

    def show_lose(self):
        msg = choice(_LOOSE_MSGS)
        self._overlay = ResultOverlay(
            (CANVAS_WIDTH, CANVAS_HEIGHT), self._palette, self._ui_fonts,
            False, msg, self._timer_text,
            {'menu': lambda: self.on_open_menu and self.on_open_menu(),
             'restart': lambda: self.on_restart and self.on_restart()})
        self._effects.defeat()

    def close_overlay(self):
        if self._overlay is not None:
            self._overlay.close()

    def _request_menu(self):
        self._play('click')
        if self.on_open_menu:
            self.on_open_menu()

    def _menu_continue(self):
        self._play('click')
        self.close_overlay()
        if self.on_continue:
            self.on_continue()

    def _menu_theme(self):
        self._play('click')
        self._cycle_palette()
        if self.on_theme:
            self.on_theme(self._palette_name)
        if isinstance(self._overlay, MenuOverlay):
            self.open_menu()  # rebuild with the new palette

    # --------------------------- cell logic --------------------------

    def remove_button(self, btn):
        cur_n = btn.n
        cur_y = btn.y
        cur_x = btn.x
        cell = self._cells[cur_y][cur_x]
        if isinstance(cell, list) and btn in cell:
            cell.remove(btn)
            self._spawn_small_pop(btn)
        if isinstance(cell, list) and len(cell) == 1:
            last = cell.pop()
            self._cells[cur_y][cur_x] = None
            self._create_big_button(cur_y, cur_x, last.n)
            self._remove_all_in_row(cur_y, last.n)
        self._check_last_in_row(cur_y, cur_n)
        # one click can resolve several cells at once — pop them in as a
        # cascade rather than all in the same frame
        self._flush_big_batch()

    def _remove_all_in_row(self, row, number):
        for x, cell in enumerate(self._cells[row]):
            if not isinstance(cell, list):
                continue
            for b in list(cell):
                if b.n == number:
                    cell.remove(b)
                    self._spawn_small_pop(b)
                    if len(cell) == 1:
                        other = cell.pop()
                        self._cells[row][x] = None
                        self._create_big_button(row, x, other.n)
                        self._remove_all_in_row(row, other.n)

    def _check_last_in_row(self, row, number):
        count = 0
        column = -1
        check_cell = None
        for x, cell in enumerate(self._cells[row]):
            if not isinstance(cell, list):
                continue
            for b in cell:
                if b.n == number:
                    count += 1
                    column = x
                    check_cell = cell
        if count == 1:
            self._create_big_button(row, column, number)
            self._remove_all_button_in_cell(check_cell, row, column)

    def _remove_all_button_in_cell(self, cell, row, column):
        for_check = list(cell)
        for b in for_check:
            self._spawn_small_pop(b)
        for b in for_check:
            self._check_last_in_row(row, b.n)

    def _create_big_button(self, y, x, n):
        from view.decoder import decode_symbol
        self._defined_cells_count += 1
        bg = self._big_bg[n // 10]
        rect = (
            INDENT_LEFT + x * CELL_SIDE + x * CELL_GAP,
            INDENT_TOP + y * CELL_SIDE + y * CELL_GAP,
            CELL_SIDE, CELL_SIDE,
        )
        btn = GameButton(rect=rect, bg_image=bg,
                         text=decode_symbol.get(n, ''),
                         font=self._font_big, border=True)
        btn.text_align = 'center'
        btn.user_data = n // 10
        btn.cell_y = y
        btn.cell_x = x
        btn.n = n
        self._big_buttons.append(btn)
        self._big_cells[(y, x)] = btn
        self._cells[y][x] = None
        if not getattr(self, '_suppress_effects', False):
            # deferred: remove_button flushes the whole batch as a cascade
            self._batch_big.append(btn)

    BIG_CASCADE_STEP = 0.11   # gap between consecutive big-cell pops

    def _flush_big_batch(self):
        """Fire the pop for every big cell created during this click, each
        offset a little later than the last so they cascade in."""
        batch = self._batch_big
        self._batch_big = []
        if not batch:
            return
        step = self.BIG_CASCADE_STEP if len(batch) > 1 else 0.0
        for i, btn in enumerate(batch):
            snap = self._snapshot_button(btn)
            burst_color = color_for_value(btn.n) or (220, 220, 220)
            self._effects.big_pop(btn, burst_color, snap, delay=i * step)
        # one solve sound per click: overlapping copies of the long solve
        # sample would just stack into mush (and clip the mix)
        self._play('solve')

    def _snapshot_button(self, button):
        snap = pygame.Surface(button.rect.size, pygame.SRCALPHA)
        original_rect = button.rect
        button.rect = pygame.Rect(0, 0, original_rect.w, original_rect.h)
        try:
            button.draw(snap)
        finally:
            button.rect = original_rect
        return snap

    def wrong_feedback(self, btn):
        cell_x = INDENT_LEFT + btn.x * CELL_SIDE + btn.x * CELL_GAP
        cell_y = INDENT_TOP + btn.y * CELL_SIDE + btn.y * CELL_GAP
        rect = pygame.Rect(cell_x, cell_y, CELL_SIDE, CELL_SIDE)
        self._effects.wrong_click(rect)

    def _spawn_small_pop(self, btn):
        if getattr(self, '_suppress_effects', False):
            return
        color = btn.bg_color or (90, 90, 90)
        descent_shift = self._font_field.get_descent() // 2 if btn.font else 0
        ghost = Ghost(btn.rect, color, btn.text, btn.font, descent_shift)
        self._effects.small_pop(ghost, color)
        self._play('pick')

    # --------------------------- cascade entrance --------------------

    CASCADE_PER_CELL_TIME = 0.22
    CASCADE_DIAGONAL_STEP = 0.045

    def _cell_t_birth(self, y, x):
        return (y + x) * self.CASCADE_DIAGONAL_STEP

    def _compute_cascade_duration(self):
        max_birth = self._cell_t_birth(FIELD_ROWS - 1, FIELD_COLS - 1)
        self._cascade_duration = max_birth + self.CASCADE_PER_CELL_TIME

    def _rules_panel_alpha(self):
        start = self._cascade_duration * 0.5
        if self._cascade_time <= start:
            return 0.0
        return min(1.0, (self._cascade_time - start) / 0.35)

    def _draw_button_with_alpha(self, btn, surface, alpha):
        if alpha <= 0 or not btn.visible:
            return
        temp = pygame.Surface(btn.rect.size, pygame.SRCALPHA)
        saved = btn.rect.topleft
        btn.rect.topleft = (0, 0)
        try:
            btn.draw(temp)
        finally:
            btn.rect.topleft = saved
        temp.set_alpha(int(255 * alpha))
        surface.blit(temp, saved)

    def _cell_visible_state(self, y, x):
        t = self._cascade_time - self._cell_t_birth(y, x)
        if t <= 0:
            return 0.0, 0.0
        if t >= self.CASCADE_PER_CELL_TIME:
            return 1.0, 1.0
        k = t / self.CASCADE_PER_CELL_TIME
        alpha = 1 - (1 - k) ** 2
        if k < 0.7:
            scale = 0.55 + 0.55 * (1 - (1 - k / 0.7) ** 2)
        else:
            scale = 1.10 - 0.10 * (k - 0.7) / 0.3
        return alpha, scale

    def _render_cell(self, y, x, surface):
        cell = self._cells[y][x]
        if isinstance(cell, list):
            for btn in cell:
                btn.draw(surface)
        elif cell is None:
            big = self._big_cells.get((y, x))
            if big is not None and not self._effects.consumed_big_spawn_button(big):
                big.draw(surface)

    def _render_cell_cascading(self, y, x, surface, alpha, scale):
        cell_origin_x = INDENT_LEFT + x * CELL_SIDE + x * CELL_GAP
        cell_origin_y = INDENT_TOP + y * CELL_SIDE + y * CELL_GAP
        temp = pygame.Surface((CELL_SIDE, CELL_SIDE), pygame.SRCALPHA)
        targets = []
        cell = self._cells[y][x]
        if isinstance(cell, list):
            targets.extend(cell)
        elif cell is None:
            big = self._big_cells.get((y, x))
            if big is not None and not self._effects.consumed_big_spawn_button(big):
                targets.append(big)
        if not targets:
            return
        for btn in targets:
            saved = btn.rect.topleft
            btn.rect.x -= cell_origin_x
            btn.rect.y -= cell_origin_y
            try:
                btn.draw(temp)
            finally:
                btn.rect.topleft = saved
        sw = max(1, int(CELL_SIDE * scale))
        sh = max(1, int(CELL_SIDE * scale))
        if (sw, sh) != (CELL_SIDE, CELL_SIDE):
            temp = pygame.transform.smoothscale(temp, (sw, sh))
        temp.set_alpha(int(255 * alpha))
        cx = cell_origin_x + CELL_SIDE // 2
        cy = cell_origin_y + CELL_SIDE // 2
        surface.blit(temp, (cx - sw // 2, cy - sh // 2))

    # --------------------------- palette switching -------------------

    PALETTE_CYCLE = ['mocha', 'nord', 'sunset']

    def _cycle_palette(self):
        cur = getattr(self, '_palette_name', 'mocha')
        try:
            i = self.PALETTE_CYCLE.index(cur)
        except ValueError:
            i = -1
        self.apply_palette_runtime(self.PALETTE_CYCLE[(i + 1) % len(self.PALETTE_CYCLE)])

    def apply_palette_runtime(self, palette_name):
        self._palette_name = palette_name
        self._palette = get_palette(palette_name)
        apply_palette(self._palette)
        buttons_mod.clear_rounded_cache()
        self._effects.set_theme_colors(list(self._palette['rows'].values()))
        self._big_bg = [None] + [
            _make_gradient_surface((CELL_SIDE, CELL_SIDE), self._palette['rows'][r])
            for r in range(1, 7)
        ]
        for row in self._cells:
            for cell in row:
                if isinstance(cell, list):
                    for b in cell:
                        b.bg_color = color_for_value(b.n)
        for big in self._big_buttons:
            row_idx = big.user_data or 0
            if 1 <= row_idx <= 6:
                big.bg_image = self._big_bg[row_idx]
        for group in self._rules_buttons:
            for sub in group:
                new_color = color_for_value(sub.value)
                sub._base_color = new_color
                if not sub.pressed:
                    sub.bg_color = new_color
                else:
                    sub.change_color()
        self._timer_color = self._palette['text']
        self._build_sidebar()

    # --------------------------- events ------------------------------

    def handle_event(self, event):
        # A finger event only flips on touch mode — the actual interaction
        # rides the synthesised mouse events, so taps are never handled twice.
        if event.type == getattr(pygame, 'FINGERDOWN', -1):
            self._note_touch()
            return
        if event.type in (getattr(pygame, 'FINGERMOTION', -2),
                           getattr(pygame, 'FINGERUP', -3)):
            return

        if self._overlay is not None and not self._overlay.dead:
            self._overlay.handle_event(event)
            return

        self._menu_button.handle_event(event)
        if event.type == pygame.MOUSEBUTTONDOWN and event.button == 1:
            pos = event.pos
            if self._menu_button.rect.collidepoint(pos):
                return
            for group in self._rules_buttons:
                for sub in group:
                    if sub.hit_test(pos):
                        self._activate_rule(sub)
                        return
            for row in self._cells:
                for cell in row:
                    if isinstance(cell, list):
                        for btn in cell:
                            if btn.hit_test(pos):
                                self._activate_field(btn)
                                return
            # a tap on bare board clears any pending touch selection
            self._armed = None

    def _note_touch(self):
        """First finger event seen — switch to touch mode and let the
        presenter persist that choice."""
        if not self._touch_mode:
            self._touch_mode = True
            if self.on_touch:
                self.on_touch(True)

    def _activate_field(self, btn):
        # touch mode: the first tap only arms the cell (and shows its
        # highlight); a second tap on the same cell commits the removal.
        if self._touch_mode and self._armed is not btn:
            self._armed = btn
            return
        self._armed = None
        if self.on_field_click:
            self.on_field_click(btn)

    def _activate_rule(self, sub):
        if self._touch_mode:
            same = (isinstance(self._armed, RuleButton)
                    and self._armed.index == sub.index)
            if not same:
                self._armed = sub
                return
        self._armed = None
        if self.on_rule_click:
            self.on_rule_click(sub)

    def _open_rules_overlay(self):
        self._show_rules_overlay = True
        self._rules_scroll = 0
        self._play('click')

    def _close_rules_overlay(self):
        self._show_rules_overlay = False
        self._play('click')

    # --------------------------- update ------------------------------

    def tick(self, dt_ms):
        dt = dt_ms / 1000.0
        self._clock += dt
        if self._sounds is not None:
            self._sounds.tick(dt_ms)
        self._effects.update(dt)
        self._cascade_time += dt
        self._msg_anim = min(1.0, self._msg_anim + dt * 6.0)

        try:
            self._mouse_pos = pygame.mouse.get_pos()
        except pygame.error:
            self._mouse_pos = (-1, -1)

        self._menu_button.update(dt, self._mouse_pos)

        if self._overlay is not None:
            self._overlay.update(dt, self._mouse_pos)
            if self._overlay.dead:
                # closing the tutorial drops the player back to the menu
                was_tutorial = isinstance(self._overlay, TutorialOverlay)
                self._overlay = None
                if was_tutorial:
                    self.open_menu()
            elif isinstance(self._overlay, ResultOverlay) and self._overlay.won:
                self._confetti_timer -= dt
                if self._confetti_timer <= 0.0:
                    self._confetti_timer = 0.85
                    self._effects.confetti(20)

        self._update_hover(dt)

        for btn in self._iter_field_buttons():
            btn.animate(dt)
        for sub in self._iter_rule_buttons():
            sub.animate(dt)
        for big in self._big_buttons:
            big.animate(dt)

        # hearts
        for hb in self._heart_breaks:
            hb['t'] += dt
        self._heart_breaks = [hb for hb in self._heart_breaks if hb['t'] < 0.5]
        if self._hearts_react > 0.0:
            self._hearts_react = max(0.0, self._hearts_react - dt)

    def _iter_field_buttons(self):
        for row in self._cells:
            for cell in row:
                if isinstance(cell, list):
                    for btn in cell:
                        yield btn

    def _iter_rule_buttons(self):
        for group in self._rules_buttons:
            for sub in group:
                yield sub

    def _update_hover(self, dt):
        # No hover during the entrance cascade or while an overlay is up.
        if (self._overlay is not None or self._show_rules_overlay
                or self._cascade_time < self._cascade_duration):
            for btn in self._iter_field_buttons():
                btn.glow_target = btn.lift_target = 0.0
            for sub in self._iter_rule_buttons():
                sub.glow_target = sub.lift_target = 0.0
            for big in self._big_buttons:
                big.glow_target = 0.0
            self._hover_sig = None
            self._hover_timer = 0.0
            self._propagated = False
            self._lifted_widget = None
            self._hovered_group = None
            return

        pos = self._mouse_pos

        # what is directly under the cursor
        hovered_field = None
        hovered_big = None
        hovered_group = None
        for btn in self._iter_field_buttons():
            if btn.hit_test(pos):
                hovered_field = btn
        for big in self._big_buttons:
            if big.hit_test(pos):
                hovered_big = big
        for gi, group in enumerate(self._rules_buttons):
            if any(sub.hit_test(pos) for sub in group):
                hovered_group = gi
                break

        # the field values a hovered rule block points at. Markers ("^",
        # "<->", "...") are strings — they describe layout, not a cell, so
        # they never light up the board.
        rule_values = set()
        if hovered_group is not None:
            for sub in self._rules_buttons[hovered_group]:
                if isinstance(sub.value, int):
                    rule_values.add(sub.value)

        direct_values = set()
        if hovered_field is not None:
            direct_values.add(hovered_field.n)
        if hovered_big is not None:
            direct_values.add(hovered_big.n)

        sig = (frozenset(direct_values), frozenset(rule_values), hovered_group)
        active = bool(direct_values) or hovered_group is not None
        if active and sig == self._hover_sig:
            self._hover_timer += dt
        elif active:
            self._hover_sig = sig
            self._hover_timer = 0.0
            self._propagated = False
            self._play('hover')
        else:
            self._hover_sig = None
            self._hover_timer = 0.0
            self._propagated = False

        propagate = active and self._hover_timer >= HOVER_PROPAGATE_DELAY
        if propagate and not self._propagated:
            self._propagated = True
            self._play('spread')

        # values that light up across the board once propagation kicks in:
        # twins of the hovered cell, and every cell named by the hovered rule
        spread = set()
        if propagate:
            spread |= direct_values
            spread |= rule_values

        for btn in self._iter_field_buttons():
            is_direct = btn is hovered_field
            glow_on = is_direct or btn.n in spread
            # a one-shot jump when a cell lights up without being hovered
            if glow_on and not is_direct and btn.glow_target < 0.5:
                btn.trigger_hop()
            btn.glow_target = 1.0 if glow_on else 0.0
            btn.lift_target = 1.0 if is_direct else 0.0

        for big in self._big_buttons:
            is_direct = big is hovered_big
            glow_on = is_direct or big.n in spread
            if glow_on and not is_direct and big.glow_target < 0.5:
                big.trigger_hop()
            big.glow_target = 1.0 if glow_on else 0.0

        # the hovered rule block lights at once; once propagation kicks in
        # every value in the spread set lights too — field cells and the
        # matching cells of *other* rules alike. Rule cells never lift.
        for gi, group in enumerate(self._rules_buttons):
            block_lit = gi == hovered_group
            for sub in group:
                lit = block_lit or (isinstance(sub.value, int)
                                     and sub.value in spread)
                sub.glow_target = 1.0 if lit else 0.0
                sub.lift_target = 0.0

        self._lifted_widget = hovered_field
        self._hovered_group = hovered_group

    def _play(self, key):
        if self._sounds is not None:
            self._sounds.play(key)

    # --------------------------- drawing -----------------------------

    def draw(self):
        s = self._scene
        s.fill(buttons_mod.BG_COLOR)
        self._draw_rules_panel(s)   # right-panel backing, beneath the rules

        # Soft ghost outlines so the big-cell grid stays readable.
        bg = buttons_mod.BG_COLOR
        outline_color = tuple(min(255, c + 14) for c in bg)
        outline_pad = buttons_mod.rounded_fill(CELL_SIDE, CELL_SIDE, outline_color, 14)
        for y in range(FIELD_ROWS):
            for x in range(FIELD_COLS):
                cx = INDENT_LEFT + x * CELL_SIDE + x * CELL_GAP
                cy = INDENT_TOP + y * CELL_SIDE + y * CELL_GAP
                s.blit(outline_pad, (cx, cy))

        for y in range(FIELD_ROWS):
            for x in range(FIELD_COLS):
                alpha, scale = self._cell_visible_state(y, x)
                if alpha <= 0:
                    continue
                if alpha >= 1.0 and scale >= 1.0:
                    self._render_cell(y, x, s)
                else:
                    self._render_cell_cascading(y, x, s, alpha, scale)

        self._effects.draw_under(s)

        rules_alpha = self._rules_panel_alpha()
        for group in self._rules_buttons:
            for sub in group:
                if rules_alpha >= 1.0:
                    sub.draw(s)
                else:
                    self._draw_button_with_alpha(sub, s, rules_alpha)

        # the focused (lifted) tile is redrawn last so it sits above neighbours
        if self._lifted_widget is not None:
            self._lifted_widget.draw(s)

        self._effects.draw_over(s)
        self._draw_left_panel(s)
        self._draw_tooltip(s)
        self._draw_armed(s)
        self._effects.draw_vignette(s)

        dx, dy = self._effects.shake_offset()
        self.surface.fill(buttons_mod.BG_COLOR)
        self.surface.blit(self._scene, (dx, dy))

        if self._overlay is not None:
            self._overlay.draw(self.surface)
        if self._show_rules_overlay:
            self._draw_rules_overlay(self.surface)

    def _draw_message(self, surface):
        """The good/wrong feedback pill, shown inside the left panel."""
        if not self._result_text:
            return
        a = clamp01(self._msg_anim)
        lines = self._wrap_text(self._result_text, self._font_msg,
                                SIDEBAR_W - 96)
        imgs = [self._font_msg.render(ln, True, self._palette['text'])
                for ln in lines]
        line_h = self._font_msg.get_height()
        tw = max(im.get_width() for im in imgs)
        pw, ph = tw + 34, line_h * len(imgs) + 22
        pill = pygame.Surface((pw, ph), pygame.SRCALPHA)
        pill.blit(rounded_fill(pw, ph,
                               buttons_mod._brighten(self._palette['bg'], 30),
                               14), (0, 0))
        for i, im in enumerate(imgs):
            pill.blit(im, ((pw - im.get_width()) // 2, 11 + i * line_h))
        scale = lerp(0.74, 1.0, ease_out_back(a))
        sw, sh = max(1, int(pw * scale)), max(1, int(ph * scale))
        pill = pygame.transform.smoothscale(pill, (sw, sh))
        pill.set_alpha(int(255 * a))
        cx = SIDEBAR_W // 2
        surface.blit(pill, (cx - sw // 2, self.MSG_CENTER_Y - sh // 2))

    @staticmethod
    def _wrap_text(text, font, max_w):
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

    # --------------------------- panels ------------------------------

    HEART_SIZE = 26
    HEART_GAP = 8
    HEARTS_PER_ROW = 3
    HEARTS_Y = 220
    MSG_CENTER_Y = 372

    def _heart_pos(self, i):
        per = self.HEARTS_PER_ROW
        size, gap = self.HEART_SIZE, self.HEART_GAP
        total = per * size + (per - 1) * gap
        x0 = (SIDEBAR_W - total) // 2
        col, rowi = i % per, i // per
        cx = x0 + col * (size + gap) + size // 2
        cy = self.HEARTS_Y + rowi * (size + gap) + size // 2
        return cx, cy

    def _complexity_name(self):
        return {20: 'EASY', 10: 'NORMAL', 0: 'HARD'}.get(self._complexity, '—')

    def _draw_rules_panel(self, surface):
        """Right-panel backing — mirrors the left panel. Drawn before the rule
        buttons so they sit on top of it."""
        panel = buttons_mod._brighten(self._palette['bg'], 13)
        pygame.draw.rect(surface, panel,
                         (RULES_PANEL_X, 0, RULES_PANEL_W, CANVAS_HEIGHT))
        pygame.draw.line(surface, buttons_mod._brighten(panel, 30),
                         (RULES_PANEL_X, 0), (RULES_PANEL_X, CANVAS_HEIGHT))
        surface.blit(self._rules_strip, (RULES_PANEL_X - 16, 0))
        muted = buttons_mod._brighten(self._palette['bg'], 64)
        cx = RULES_PANEL_X + RULES_PANEL_W // 2
        draw_text(surface, 'C L U E S', self._font_label, muted,
                  center=(cx, 30))

    def _draw_left_panel(self, surface):
        panel = buttons_mod._brighten(self._palette['bg'], 13)
        pygame.draw.rect(surface, panel, (0, 0, SIDEBAR_W, CANVAS_HEIGHT))
        pygame.draw.line(surface, buttons_mod._brighten(panel, 30),
                         (SIDEBAR_W - 1, 0), (SIDEBAR_W - 1, CANVAS_HEIGHT))
        surface.blit(self._sidebar_strip, (SIDEBAR_W, 0))

        muted = buttons_mod._brighten(self._palette['bg'], 64)
        text = self._palette['text']
        cx = SIDEBAR_W // 2

        self._menu_button.draw(surface)

        # timer
        draw_text(surface, 'T I M E', self._font_label, muted,
                  center=(cx, 104))
        draw_text(surface, self._timer_text, self._font_timer,
                  self._timer_color, center=(cx, 140))

        # lives
        draw_text(surface, 'L I V E S', self._font_label, muted,
                  center=(cx, self.HEARTS_Y - 24))
        self._draw_hearts(surface)

        # how much of the board is solved
        self._draw_progress(surface)

        # good/wrong feedback message
        self._draw_message(surface)

        # footer: difficulty + debug hint
        pygame.draw.line(surface, buttons_mod._brighten(panel, 22),
                         (24, CANVAS_HEIGHT - 104),
                         (SIDEBAR_W - 24, CANVAS_HEIGHT - 104))
        draw_text(surface, 'MODE', self._font_label, muted,
                  center=(cx, CANVAS_HEIGHT - 82))
        draw_text(surface, self._complexity_name(), self._font_menu, text,
                  center=(cx, CANVAS_HEIGHT - 58))
        draw_text(surface, 'L = +life', self._ui_fonts['tiny'],
                  buttons_mod._brighten(self._palette['bg'], 40),
                  center=(cx, CANVAS_HEIGHT - 28))

    PROGRESS_Y = 296

    def _draw_progress(self, surface):
        """The 'solved N / 36' indicator filling the left panel's mid gap."""
        muted = buttons_mod._brighten(self._palette['bg'], 64)
        cx = SIDEBAR_W // 2
        y = self.PROGRESS_Y
        draw_text(surface, 'S O L V E D', self._font_label, muted,
                  center=(cx, y))
        draw_text(surface, '%d / %d' % (self._defined_cells_count,
                                        FIELD_CELLS),
                  self._font_menu, self._palette['text'], center=(cx, y + 26))
        bw = SIDEBAR_W - 80
        bx = (SIDEBAR_W - bw) // 2
        by = y + 44
        surface.blit(rounded_fill(bw, 6,
                                  buttons_mod._brighten(self._palette['bg'],
                                                        26), 3), (bx, by))
        frac = clamp01(self._defined_cells_count / float(FIELD_CELLS))
        fw = int(bw * frac)
        if fw > 0:
            surface.blit(rounded_fill(fw, 6, self._palette['accent'], 3),
                         (bx, by))

    def _draw_tooltip(self, surface):
        """A small plain-language reading of the rule under the cursor."""
        if (not self._tooltips_enabled or self._hovered_group is None
                or self._overlay is not None):
            return
        group = self._rules_buttons[self._hovered_group]
        text = describe_rule(tuple(sub.value for sub in group))
        lines = self._wrap_text(text, self._font_msg, 232)
        line_h = self._font_msg.get_height()
        pad_x, pad_y = 14, 9
        tw = max(self._font_msg.size(ln)[0] for ln in lines)
        pw, ph = tw + pad_x * 2, line_h * len(lines) + pad_y * 2
        grect = group[0].rect.union(group[-1].rect)
        tx = max(8, grect.left - 14 - pw)
        ty = max(8, min(CANVAS_HEIGHT - ph - 8, grect.centery - ph // 2))
        pill = pygame.Surface((pw, ph), pygame.SRCALPHA)
        pill.blit(rounded_fill(pw, ph,
                               buttons_mod._brighten(self._palette['panel'],
                                                     32), 12), (0, 0))
        pill.blit(rounded_border(pw, ph,
                                 buttons_mod._brighten(self._palette['panel'],
                                                       64), 12, 1), (0, 0))
        for i, ln in enumerate(lines):
            img = self._font_msg.render(ln, True, self._palette['text'])
            pill.blit(img, (pad_x, pad_y + i * line_h))
        surface.blit(pill, (tx, ty))

    def _draw_armed(self, surface):
        """Touch mode: ring the tapped-once widget and prompt to confirm."""
        if not self._touch_mode or self._armed is None:
            return
        r = self._armed.rect
        p = 0.5 + 0.5 * math.sin(self._clock * 6.0)
        ring = r.inflate(10 + 5 * p, 10 + 5 * p)
        surface.blit(rounded_border(ring.w, ring.h, self._palette['accent'],
                                    max(6, ring.h // 4), 3), ring.topleft)
        img = self._font_label.render('tap again to confirm', True,
                                      self._palette['text'])
        pw, ph = img.get_width() + 16, img.get_height() + 8
        pill = pygame.Surface((pw, ph), pygame.SRCALPHA)
        pill.blit(rounded_fill(pw, ph,
                               buttons_mod._brighten(self._palette['panel'],
                                                     36), ph // 2), (0, 0))
        pill.blit(img, (8, 4))
        px = max(4, min(CANVAS_WIDTH - pw - 4, r.centerx - pw // 2))
        py = max(4, r.top - ph - 10)
        surface.blit(pill, (px, py))

    def _draw_hearts(self, surface):
        react = self._hearts_react / 0.5
        for i in range(self._max_lives):
            cx, cy = self._heart_pos(i)
            brk = next((h for h in self._heart_breaks if h['slot'] == i), None)
            if i < self._lives:
                # alive — gentle idle breathing + a punch when a sibling dies
                breathe = 1.0 + 0.04 * math.sin(self._clock * 2.4 + i * 0.7)
                punch = 1.0 + 0.14 * react * math.sin(react * 9.0)
                size = int(self.HEART_SIZE * breathe * punch)
                spr = make_heart(self.HEART_SIZE, (228, 78, 92), True)
                if size != self.HEART_SIZE:
                    spr = pygame.transform.smoothscale(spr, (size, size))
                surface.blit(spr, (cx - size // 2, cy - size // 2))
            elif brk is not None:
                # breaking — flare up then fade out
                t = brk['t'] / 0.5
                size = int(self.HEART_SIZE * (1.0 + 0.55 * ease_out_cubic(t)))
                spr = make_heart(self.HEART_SIZE, (236, 96, 110), True)
                spr = pygame.transform.smoothscale(spr, (size, size))
                spr = spr.copy()
                spr.set_alpha(int(255 * (1.0 - t)))
                surface.blit(spr, (cx - size // 2, cy - size // 2))
            else:
                spr = make_heart(self.HEART_SIZE,
                                 buttons_mod._brighten(self._palette['bg'], 46),
                                 False)
                surface.blit(spr, (cx - self.HEART_SIZE // 2,
                                   cy - self.HEART_SIZE // 2))

    def _draw_rules_overlay(self, surface):
        dim = pygame.Surface((CANVAS_WIDTH, CANVAS_HEIGHT))
        dim.set_alpha(228)
        dim.fill((20, 18, 22))
        surface.blit(dim, (0, 0))
        img = self._img_rules_page
        x = (CANVAS_WIDTH - img.get_width()) // 2
        y = 20 - self._rules_scroll
        surface.blit(img, (x, y))
        hint = self._font_msg.render(
            'click anywhere to close • scroll to read', True, (255, 255, 200))
        surface.blit(hint, ((CANVAS_WIDTH - hint.get_width()) // 2,
                            CANVAS_HEIGHT - 28))
