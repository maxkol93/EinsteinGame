import math
import os
from random import choice

import pygame

from view.buttons import (
    GameButton, RuleButton, FieldButton, color_for_value, apply_palette,
    rounded_fill, BG_COLOR,
)
from view.effects import Effects, Ghost
from view.palettes import get_palette
from view.anim import clamp01, ease_out_back, ease_out_cubic, lerp
from view.ui import (MenuOverlay, ResultOverlay, TextButton, make_heart,
                     draw_text)
import view.buttons as buttons_mod


# Layout constants. A fixed sidebar sits left of the board; because every
# field/rule coordinate is derived from INDENT_LEFT (directly or via
# FIELD_WIDTH), widening the left indent shifts the whole board + rules right
# and frees x in [0, SIDEBAR_W] for the sidebar.
CELL_SIDE = 100
SIDEBAR_W = 120
INDENT_LEFT = SIDEBAR_W + 10
INDENT_TOP = 70
INDENT_BOTTOM = 10
CELL_GAP = 3
FIELD_COLS = 6
FIELD_ROWS = 6

FIELD_WIDTH = INDENT_LEFT + CELL_SIDE * FIELD_COLS + 25
FIELD_HEIGHT = INDENT_TOP + CELL_SIDE * FIELD_ROWS + (FIELD_ROWS - 1) * CELL_GAP + INDENT_BOTTOM + 33

# Worst-case window size accommodates up to 2 columns of rule buttons
CANVAS_WIDTH = FIELD_WIDTH + 10 + 145 * 2 + 10
CANVAS_HEIGHT = FIELD_HEIGHT

HOVER_PROPAGATE_DELAY = 0.5  # seconds before a hover fans out to twins

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


def _make_gradient_surface(size, base, top_factor=1.30, bottom_factor=0.65,
                           radius=14):
    """Vertical gradient surface used as big-cell background, palette-driven."""
    from view.buttons import mask_to_round
    w, h = size
    raw = pygame.Surface((w, h))
    for y in range(h):
        t = y / max(1, h - 1)
        f = top_factor + (bottom_factor - top_factor) * t
        c = tuple(max(0, min(255, int(ch * f))) for ch in base)
        pygame.draw.line(raw, c, (0, y), (w, y))
    sheen = tuple(min(255, ch + 28) for ch in base)
    pygame.draw.line(raw, sheen, (0, int(h * 0.22)), (w, int(h * 0.22)))
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
        self._hover_values = frozenset()
        self._hover_timer = 0.0
        self._propagated = False
        self._lifted_widget = None

        self._show_rules_overlay = False
        self._rules_scroll = 0
        self._overlay = None       # MenuOverlay / ResultOverlay
        self._confetti_timer = 0.0

        # Handler hooks (presenter registers these)
        self.on_field_click = None
        self.on_rule_click = None
        self.on_continue = None
        self.on_restart = None
        self.on_mode_select = None
        self.on_open_menu = None
        self.on_volume = None

        self._build_field_buttons()
        self._build_rules_buttons(list(rules))
        self._build_sidebar()
        self._sidebar_strip = self._make_sidebar_shadow()

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
        for i, rule in enumerate(rules):
            ty, tx = i % 14, i // 14
            group_x = FIELD_WIDTH + 17 + tx * (mini * 3 + 30)
            group_y = 10 + ty * (mini + 9)
            b1 = RuleButton(i, rule[0], (group_x, group_y, mini, mini), self._font_rule)
            b2 = RuleButton(i, rule[1], (group_x + mini, group_y, mini, mini), self._font_rule)
            b3 = RuleButton(i, rule[2], (group_x + 2 * mini, group_y, mini, mini), self._font_rule)
            self._rules_buttons.append([b1, b2, b3])

    def _build_sidebar(self):
        base = buttons_mod._brighten(self._palette['panel'], 44)
        self._menu_button = TextButton(
            (16, 20, SIDEBAR_W - 32, 46), 'MENU', self._font_menu,
            base, self._palette['text'], on_click=self._request_menu,
            radius=12, accent=buttons_mod._brighten(self._palette['panel'], 70))

    def _make_sidebar_shadow(self):
        strip = pygame.Surface((16, CANVAS_HEIGHT), pygame.SRCALPHA)
        for i in range(16):
            a = int(70 * (1 - i / 16) ** 2)
            pygame.draw.line(strip, (0, 0, 0, a), (i, 0), (i, CANVAS_HEIGHT))
        return strip

    # --------------------------- public API --------------------------

    def change_complexity(self, complexity):
        self._complexity = complexity

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
        vol = self._sounds.volume if self._sounds else 0.7
        callbacks = {
            'continue': self._menu_continue,
            'restart': lambda: self.on_restart and self.on_restart(),
            'mode': lambda c: self.on_mode_select and self.on_mode_select(c),
            'rules': self._open_rules_overlay,
            'volume': lambda v: self.on_volume and self.on_volume(v),
            'theme': self._menu_theme,
        }
        self._overlay = MenuOverlay((CANVAS_WIDTH, CANVAS_HEIGHT),
                                    self._palette, self._ui_fonts,
                                    self._complexity, vol, callbacks)

    def show_win(self):
        msg = choice(_WIN_MSGS)
        self._overlay = ResultOverlay(
            (CANVAS_WIDTH, CANVAS_HEIGHT), self._palette, self._ui_fonts,
            True, msg, self._timer_text,
            {'menu': lambda: self.on_open_menu and self.on_open_menu(),
             'restart': lambda: self.on_restart and self.on_restart()})
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
            snap = self._snapshot_button(btn)
            burst_color = color_for_value(n) or (220, 220, 220)
            self._effects.big_pop(btn, burst_color, snap)
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
        if self._show_rules_overlay:
            if event.type == pygame.MOUSEBUTTONDOWN:
                self._close_rules_overlay()
            elif event.type == pygame.MOUSEWHEEL:
                self._rules_scroll = max(
                    0, min(self._img_rules_page.get_height() - CANVAS_HEIGHT + 40,
                           self._rules_scroll - event.y * 40))
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
                        if self.on_rule_click:
                            self.on_rule_click(sub)
                        return
            for row in self._cells:
                for cell in row:
                    if isinstance(cell, list):
                        for btn in cell:
                            if btn.hit_test(pos):
                                if self.on_field_click:
                                    self.on_field_click(btn)
                                return

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
                self._overlay = None
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
            self._hover_values = frozenset()
            self._hover_timer = 0.0
            self._propagated = False
            self._lifted_widget = None
            return

        pos = self._mouse_pos
        direct = set()
        lifted = None
        for btn in self._iter_field_buttons():
            if btn.hit_test(pos):
                direct.add(btn.n)
                lifted = btn
        for sub in self._iter_rule_buttons():
            if sub.hit_test(pos):
                direct.add(sub.value)
                lifted = sub
        for big in self._big_buttons:
            if big.hit_test(pos):
                direct.add(big.n)

        cur = frozenset(direct)
        if cur and cur == self._hover_values:
            self._hover_timer += dt
        elif cur:
            self._hover_values = cur
            self._hover_timer = 0.0
            self._propagated = False
            self._play('hover')
        else:
            self._hover_values = frozenset()
            self._hover_timer = 0.0
            self._propagated = False

        propagate = self._hover_timer >= HOVER_PROPAGATE_DELAY
        if propagate and not self._propagated:
            self._propagated = True
            self._play('spread')

        for btn in self._iter_field_buttons():
            is_direct = btn.hit_test(pos)
            is_prop = propagate and btn.n in direct
            btn.glow_target = 1.0 if (is_direct or is_prop) else 0.0
            btn.lift_target = 1.0 if is_direct else 0.0
        for sub in self._iter_rule_buttons():
            is_direct = sub.hit_test(pos)
            is_prop = propagate and sub.value in direct
            sub.glow_target = 1.0 if (is_direct or is_prop) else 0.0
            sub.lift_target = 1.0 if is_direct else 0.0
        for big in self._big_buttons:
            is_direct = big.hit_test(pos)
            is_prop = propagate and getattr(big, 'n', None) in direct
            big.glow_target = 1.0 if (is_direct or is_prop) else 0.0

        self._lifted_widget = lifted

    def _play(self, key):
        if self._sounds is not None:
            self._sounds.play(key)

    # --------------------------- drawing -----------------------------

    def draw(self):
        s = self._scene
        s.fill(buttons_mod.BG_COLOR)

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

        self._draw_message(s)
        self._effects.draw_over(s)
        self._draw_sidebar(s)
        self._effects.draw_vignette(s)

        dx, dy = self._effects.shake_offset()
        self.surface.fill(buttons_mod.BG_COLOR)
        self.surface.blit(self._scene, (dx, dy))

        if self._overlay is not None:
            self._overlay.draw(self.surface)
        if self._show_rules_overlay:
            self._draw_rules_overlay(self.surface)

    def _draw_message(self, surface):
        if not self._result_text:
            return
        a = clamp01(self._msg_anim)
        img = self._font_msg.render(self._result_text, True,
                                    self._palette['text'])
        pw, ph = img.get_width() + 38, img.get_height() + 16
        pill = pygame.Surface((pw, ph), pygame.SRCALPHA)
        pill.blit(rounded_fill(pw, ph, buttons_mod._brighten(BG_COLOR, 17),
                               ph // 2), (0, 0))
        pill.blit(img, ((pw - img.get_width()) // 2,
                        (ph - img.get_height()) // 2))
        scale = lerp(0.72, 1.0, ease_out_back(a))
        sw, sh = max(1, int(pw * scale)), max(1, int(ph * scale))
        pill = pygame.transform.smoothscale(pill, (sw, sh))
        pill.set_alpha(int(255 * a))
        cx = INDENT_LEFT + (CELL_SIDE * FIELD_COLS + (FIELD_COLS - 1) * CELL_GAP) // 2
        surface.blit(pill, (cx - sw // 2, 36 - sh // 2))

    # --------------------------- sidebar -----------------------------

    HEART_SIZE = 26
    HEART_GAP = 8
    HEARTS_PER_ROW = 3
    HEARTS_Y = 196

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

    def _draw_sidebar(self, surface):
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
                  center=(cx, 92))
        draw_text(surface, self._timer_text, self._font_timer,
                  self._timer_color, center=(cx, 122))

        # lives
        draw_text(surface, 'L I V E S', self._font_label, muted,
                  center=(cx, self.HEARTS_Y - 28))
        self._draw_hearts(surface)

        # footer: difficulty + debug hint
        pygame.draw.line(surface, buttons_mod._brighten(panel, 22),
                         (18, CANVAS_HEIGHT - 92),
                         (SIDEBAR_W - 18, CANVAS_HEIGHT - 92))
        draw_text(surface, 'MODE', self._font_label, muted,
                  center=(cx, CANVAS_HEIGHT - 72))
        draw_text(surface, self._complexity_name(), self._font_menu, text,
                  center=(cx, CANVAS_HEIGHT - 52))
        draw_text(surface, 'L = +life', self._ui_fonts['tiny'],
                  buttons_mod._brighten(self._palette['bg'], 40),
                  center=(cx, CANVAS_HEIGHT - 22))

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
