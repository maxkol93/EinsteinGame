import os
from random import choice

import pygame

from view.buttons import (
    GameButton, RuleButton, FieldButton, color_for_value, apply_palette,
)
from view.effects import Effects, Ghost
from view.palettes import get_palette
import view.buttons as buttons_mod


# Layout constants (kept close to the original WinForms version)
CELL_SIDE = 100
INDENT_LEFT = 10
INDENT_TOP = 70
INDENT_BOTTOM = 10
CELL_GAP = 3
FIELD_COLS = 6
FIELD_ROWS = 6

FIELD_WIDTH = INDENT_LEFT + CELL_SIDE * FIELD_COLS + 25
FIELD_HEIGHT = INDENT_TOP + CELL_SIDE * FIELD_ROWS + (FIELD_ROWS - 1) * CELL_GAP + INDENT_BOTTOM + 33

# Worst-case window size accommodates up to 2 columns of rule buttons
CANVAS_WIDTH = FIELD_WIDTH + 10 + 145 * 2 + 10  # ~940
CANVAS_HEIGHT = FIELD_HEIGHT  # ~728


_LOOSE_MSGS = [
    "don't worry and try again!",
    "be careful and try again!",
    "but you still have a chance!"
]
_FIRST_WRONG = [
    "wrong! =(",
    "oops, not there!",
    "it is not true.",
    "it looks like the correct button?",
    "read the rules again!",
    "do you think this is a good move?",
    "how could you click here?"
]
_SECOND_WRONG = [
    "you broke the game!",
    "so, what is next?",
    "you need a break!",
    "drink some coffee, can it help?",
    "how will you get out of this situation?",
    "delete the game please!",
    "Alt+F4 please!"
]
_GOOD_MSGS = [
    "good!",
    "yep, continue!",
    "not bad, but that's not all!",
    "you're so clever, go on!",
    "wow, you're great!",
    "if you worked like that...",
    "your mind is gorgeous!"
]
_WIN_MSGS = [
    "good job, you win!",
    "Einstein would be proud of you!",
    "you need to be a scientist!"
]


def _make_gradient_surface(size, base, top_factor=1.30, bottom_factor=0.65,
                           radius=14):
    """Vertical gradient surface used as big-cell background, palette-driven.

    Returns a rounded surface (alpha outside the rounded rect).
    """
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
    def __init__(self, rules, palette_name='mocha'):
        self._base_dir = os.path.dirname(__file__)
        self._images_dir = os.path.join(self._base_dir, 'images')
        self._fonts_dir = os.path.join(self._base_dir, 'fonts')

        self._palette_name = palette_name
        self._palette = get_palette(palette_name)
        apply_palette(self._palette)

        self.surface = pygame.display.get_surface()
        if self.surface is None:
            self.surface = pygame.display.set_mode((CANVAS_WIDTH, CANVAS_HEIGHT))
            pygame.display.set_caption('Einstein game')

        self._load_fonts()
        self._load_images()

        self._cells = []           # _cells[y][x] is either list[FieldButton] or None
        self._big_cells = {}       # {(y, x): GameButton} fast lookup for cascade
        self._rules_buttons = []   # list of [btn_1, btn_2, btn_3] for each rule
        self._big_buttons = []     # GameButtons representing solved cells (drawn separately)
        self._effects = Effects()
        self._scene = pygame.Surface((CANVAS_WIDTH, CANVAS_HEIGHT))
        self._cascade_time = 0.0   # seconds since round start, drives entrance animation
        self._cascade_duration = 0.0  # set after define_start_cells
        self._mouse_pos = (-1, -1)
        self._suppress_effects = False

        self._result_text = ''
        self._timer_text = '00:00'
        self._timer_color = (180, 180, 180)

        self._defined_cells_count = 0
        self._count_good = 0
        self._complexity_image = self._img_easy

        self._show_rules_overlay = False
        self._rules_scroll = 0

        # Handler hooks (presenter registers these)
        self.on_field_click = None       # (FieldButton) -> None
        self.on_rule_click = None        # (RuleButton) -> None
        self.on_restart = None           # () -> None
        self.on_complexity_change = None # () -> None

        self._build_field_buttons()
        self._build_rules_buttons(list(rules))
        self._build_menu_buttons()

    # --------------------------- loading -----------------------------

    def _load_fonts(self):
        font_regular = os.path.join(self._fonts_dir, 'DejaVuSans.ttf')
        font_bold = os.path.join(self._fonts_dir, 'DejaVuSans-Bold.ttf')
        self._font_msg = pygame.font.Font(font_regular, 16)
        self._font_timer = pygame.font.Font(font_regular, 16)
        self._font_field = pygame.font.Font(font_bold, 14)
        self._font_rule = pygame.font.Font(font_regular, 18)
        self._font_big = pygame.font.Font(font_bold, 48)

    def _load_images(self):
        from view.buttons import mask_to_round
        def load_round(name, radius=10):
            img = pygame.image.load(os.path.join(self._images_dir, name)).convert_alpha()
            return mask_to_round(img, radius)
        def load(name):
            return pygame.image.load(os.path.join(self._images_dir, name)).convert_alpha()
        # Procedural big-cell backgrounds (top-light gradient + subtle sheen)
        # — keeps the palette swappable and avoids the dated jpg artifacts.
        self._big_bg = [None]
        for row in range(1, 7):
            base = self._palette['rows'][row]
            self._big_bg.append(_make_gradient_surface((CELL_SIDE, CELL_SIDE), base))
        self._img_easy = load_round('menu_complexity_easy.jpg')
        self._img_normal = load_round('menu_complexity_normal.jpg')
        self._img_hard = load_round('menu_complexity_hard.jpg')
        self._img_restart = load_round('menu_restart.jpg')
        self._img_rules = load_round('menu_rules.jpg')
        self._img_rules_page = load('Game_rules_900_1767.jpg')

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
        # Python 2 allowed mixing str/int via type-name comparison; reproduce it
        # so the visual grouping (operator-rules first, then number-rules) is preserved.
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

    def _build_menu_buttons(self):
        self._restart_btn = GameButton(
            rect=(5, 5, 50, 50), bg_image=self._img_restart, border=False)
        self._restart_btn.on_click = lambda btn: self.on_restart and self.on_restart()

        self._complexity_btn = GameButton(
            rect=(60, 5, 50, 50), bg_image=self._complexity_image, border=False)
        self._complexity_btn.on_click = lambda btn: self.on_complexity_change and self.on_complexity_change()

        self._rules_btn = GameButton(
            rect=(115, 5, 50, 50), bg_image=self._img_rules, border=False)
        self._rules_btn.on_click = lambda btn: self._open_rules_overlay()

        self._palette_btn = GameButton(
            rect=(170, 5, 50, 50), bg_image=self._make_palette_icon(), border=False)
        self._palette_btn.on_click = lambda btn: self._cycle_palette()

    def _make_palette_icon(self):
        """4-swatch palette icon built from current palette colors."""
        icon = pygame.Surface((50, 50), pygame.SRCALPHA)
        icon.fill(buttons_mod.BG_COLOR)
        # 2x2 grid of swatches using rows 1, 3, 4, 6 — visually distinct slots
        swatches = [
            (self._palette['rows'][1], (4, 4)),
            (self._palette['rows'][3], (26, 4)),
            (self._palette['rows'][4], (4, 26)),
            (self._palette['rows'][6], (26, 26)),
        ]
        for color, (x, y) in swatches:
            pygame.draw.rect(icon, color, (x, y, 20, 20), border_radius=4)
        pygame.draw.rect(icon, (200, 200, 200), (2, 2, 46, 46), 1, border_radius=6)
        return icon

    # --------------------------- public API --------------------------

    def change_complexity(self, complexity):
        if complexity == 20:
            self._complexity_image = self._img_easy
        elif complexity == 10:
            self._complexity_image = self._img_normal
        else:
            self._complexity_image = self._img_hard
        self._complexity_btn.bg_image = self._complexity_image

    def set_button_handler(self, handler):
        self.on_field_click = handler

    def set_rules_button_handler(self, handler):
        self.on_rule_click = handler

    def set_restart_handler(self, handler):
        self.on_restart = handler

    def set_complexity_change_handler(self, handler):
        self.on_complexity_change = handler

    def disable_rule_buttons(self, btn, index):
        for sub in self._rules_buttons[index]:
            sub.pressed = not sub.pressed
            sub.change_color()

    def disable_buttons(self):
        for row in self._cells:
            for cell in row:
                if isinstance(cell, list):
                    for btn in cell:
                        btn.enabled = False

    def set_massage(self, state_of_game):
        if state_of_game == 'loose':
            self._result_text = 'you lose! ' + choice(_LOOSE_MSGS)
        elif state_of_game == 'first_wrong':
            self._result_text = choice(_FIRST_WRONG) + ' 2 attempts left.'
            self._count_good = 0
        elif state_of_game == 'second_wrong':
            self._result_text = choice(_SECOND_WRONG) + ' 1 attempt left.'
            self._count_good = 0
        elif state_of_game == 'good':
            self._count_good += 1
            if self._count_good < 3:
                self._result_text = choice(_GOOD_MSGS)
            else:
                self._result_text = ''
        elif state_of_game == 'win':
            self._result_text = choice(_WIN_MSGS)

    def timer_update(self, value):
        self._timer_text = '{}{}:{}{}'.format(
            value // 60 // 10, value // 60 % 10,
            value % 60 // 10, value % 60 % 10)

    def timer_font_updane(self, win):
        self._timer_color = (255, 255, 0) if win else (255, 60, 60)

    def define_start_cells(self, rules):
        # rule = [num, 'define', x]. Don't fire juicy effects for these — the
        # cascade entrance below already animates them. Suppress big-pop +
        # small-pop while seeding the board.
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

    # --------------------------- cell logic --------------------------
    # Mirrors the original window's remove_button() / _remove_all_batton_in_row()
    # / _check_last_in_row() chain so the on-board behavior is identical.

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
        # Cell already replaced with None by _create_big_button — just clear the
        # passed-in list and trigger row checks for the displaced numbers.
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
        btn.user_data = n // 10  # row index — used to re-skin on palette swap
        btn.cell_y = y
        btn.cell_x = x
        btn.n = n  # for hover-propagation matching
        self._big_buttons.append(btn)
        self._big_cells[(y, x)] = btn
        # Mark the field cell as resolved; the big button is drawn from
        # self._big_buttons, never from self._cells (otherwise removing
        # leftover small-button lists could overwrite it).
        self._cells[y][x] = None
        # Take a snapshot of the button for the pop-in animation (so we can
        # transform it without recomputing the gradient + glyph each frame).
        if not getattr(self, '_suppress_effects', False):
            snap = self._snapshot_button(btn)
            burst_color = color_for_value(n) or (220, 220, 220)
            self._effects.big_pop(btn, burst_color, snap)

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
        """Flash the cell red + shake + red particles when player picks wrong."""
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

    # --------------------------- cascade entrance --------------------

    CASCADE_PER_CELL_TIME = 0.22  # how long each cell takes to fully appear
    CASCADE_DIAGONAL_STEP = 0.045  # delay between diagonal waves

    def _cell_t_birth(self, y, x):
        return (y + x) * self.CASCADE_DIAGONAL_STEP

    def _compute_cascade_duration(self):
        max_birth = self._cell_t_birth(FIELD_ROWS - 1, FIELD_COLS - 1)
        self._cascade_duration = max_birth + self.CASCADE_PER_CELL_TIME

    def _rules_panel_alpha(self):
        # Start rules-panel fade ~halfway through the field cascade.
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
        """Return (alpha, scale) tuple in [0, 1]; (0, 0) → skip rendering."""
        t = self._cascade_time - self._cell_t_birth(y, x)
        if t <= 0:
            return 0.0, 0.0
        if t >= self.CASCADE_PER_CELL_TIME:
            return 1.0, 1.0
        k = t / self.CASCADE_PER_CELL_TIME
        # ease-out for alpha, slight overshoot for scale
        alpha = 1 - (1 - k) ** 2
        if k < 0.7:
            scale = 0.55 + 0.55 * (1 - (1 - k / 0.7) ** 2)  # 0.55 → 1.10
        else:
            scale = 1.10 - 0.10 * (k - 0.7) / 0.3            # 1.10 → 1.00
        return alpha, scale

    def _render_cell(self, y, x, surface):
        """Render the cell's static content (small list OR big button) at
        absolute scene coords on `surface`. Doesn't apply cascade transform."""
        cell = self._cells[y][x]
        if isinstance(cell, list):
            for btn in cell:
                btn.draw(surface)
        elif cell is None:
            big = self._big_cells.get((y, x))
            if big is not None and not self._effects.consumed_big_spawn_button(big):
                big.draw(surface)

    def _render_cell_cascading(self, y, x, surface, alpha, scale):
        """Render a cell into a temp surface and blit with given alpha+scale."""
        cell_origin_x = INDENT_LEFT + x * CELL_SIDE + x * CELL_GAP
        cell_origin_y = INDENT_TOP + y * CELL_SIDE + y * CELL_GAP
        temp = pygame.Surface((CELL_SIDE, CELL_SIDE), pygame.SRCALPHA)
        # Temporarily shift button rects so they draw at temp origin.
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
        cur = getattr(self, '_palette_name', 'default')
        try:
            i = self.PALETTE_CYCLE.index(cur)
        except ValueError:
            i = -1
        next_name = self.PALETTE_CYCLE[(i + 1) % len(self.PALETTE_CYCLE)]
        self.apply_palette_runtime(next_name)

    def apply_palette_runtime(self, palette_name):
        self._palette_name = palette_name
        self._palette = get_palette(palette_name)
        apply_palette(self._palette)
        buttons_mod.clear_rounded_cache()
        # Refresh procedural backgrounds
        self._big_bg = [None] + [
            _make_gradient_surface((CELL_SIDE, CELL_SIDE), self._palette['rows'][r])
            for r in range(1, 7)
        ]
        # Push new colors into existing buttons
        for row in self._cells:
            for cell in row:
                if isinstance(cell, list):
                    for b in cell:
                        b.bg_color = color_for_value(b.n)
        for big in self._big_buttons:
            row_idx = big.user_data or 0  # n // 10 stashed on creation
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
        # Update palette icon and scene fill
        self._palette_btn.bg_image = self._make_palette_icon()

    # --------------------------- events ------------------------------

    def handle_event(self, event):
        if event.type == pygame.MOUSEBUTTONDOWN:
            if self._show_rules_overlay:
                self._close_rules_overlay()
                return
            pos = event.pos
            # 1) menu buttons
            for menu_btn in (self._restart_btn, self._complexity_btn,
                             self._rules_btn, self._palette_btn):
                if menu_btn.hit_test(pos):
                    if event.button == 1 and menu_btn.on_click:
                        menu_btn.on_click(menu_btn)
                    return
            # 2) rule buttons (left click only — matches original presenter)
            if event.button == 1:
                for group in self._rules_buttons:
                    for sub in group:
                        if sub.hit_test(pos):
                            if self.on_rule_click:
                                self.on_rule_click(sub)
                            return
            # 3) field buttons (left click only)
            if event.button == 1:
                for row in self._cells:
                    for cell in row:
                        if isinstance(cell, list):
                            for btn in cell:
                                if btn.hit_test(pos):
                                    if self.on_field_click:
                                        self.on_field_click(btn)
                                    return
        elif event.type == pygame.MOUSEWHEEL:
            if self._show_rules_overlay:
                self._rules_scroll = max(
                    0, min(self._img_rules_page.get_height() - CANVAS_HEIGHT + 40,
                           self._rules_scroll - event.y * 40)
                )

    def _open_rules_overlay(self):
        self._show_rules_overlay = True
        self._rules_scroll = 0

    def _close_rules_overlay(self):
        self._show_rules_overlay = False

    # --------------------------- drawing -----------------------------

    def tick(self, dt_ms):
        dt = dt_ms / 1000.0
        self._effects.update(dt)
        self._cascade_time += dt
        # Hover detection (cheap rect-tests every frame)
        try:
            self._mouse_pos = pygame.mouse.get_pos()
        except pygame.error:
            self._mouse_pos = (-1, -1)
        self._update_hover()

    def _update_hover(self):
        pos = self._mouse_pos
        # Menu buttons
        for menu in (self._restart_btn, self._complexity_btn,
                     self._rules_btn, self._palette_btn):
            menu.hovered = menu.hit_test(pos)

        # First pass: find which small-button value(s) are under the cursor.
        # Hovering ANY button with value N propagates to every other button
        # carrying the same value (board + rules + solved big cells).
        hot_values = set()
        for row in self._cells:
            for cell in row:
                if isinstance(cell, list):
                    for btn in cell:
                        if btn.hit_test(pos):
                            hot_values.add(btn.n)
        for group in self._rules_buttons:
            for sub in group:
                if sub.hit_test(pos):
                    hot_values.add(sub.value)

        # Second pass: apply hover to everything matching.
        for row in self._cells:
            for cell in row:
                if isinstance(cell, list):
                    for btn in cell:
                        btn.hovered = btn.n in hot_values or btn.hit_test(pos)
        for group in self._rules_buttons:
            for sub in group:
                sub.hovered = sub.value in hot_values or sub.hit_test(pos)
        for big in self._big_buttons:
            big.hovered = getattr(big, 'n', None) in hot_values

    def draw(self):
        s = self._scene
        s.fill(buttons_mod.BG_COLOR)

        # Soft "ghost outlines" for every cell so the big-cell grid is readable
        # even before solutions appear (very low contrast).
        bg = buttons_mod.BG_COLOR
        outline_color = tuple(min(255, c + 14) for c in bg)
        outline_pad = buttons_mod.rounded_fill(CELL_SIDE, CELL_SIDE, outline_color, 14)
        for y in range(FIELD_ROWS):
            for x in range(FIELD_COLS):
                cx = INDENT_LEFT + x * CELL_SIDE + x * CELL_GAP
                cy = INDENT_TOP + y * CELL_SIDE + y * CELL_GAP
                s.blit(outline_pad, (cx, cy))

        # Cells with cascade transform
        for y in range(FIELD_ROWS):
            for x in range(FIELD_COLS):
                alpha, scale = self._cell_visible_state(y, x)
                if alpha <= 0:
                    continue
                if alpha >= 1.0 and scale >= 1.0:
                    self._render_cell(y, x, s)
                else:
                    self._render_cell_cascading(y, x, s, alpha, scale)

        # ghosts (popping-out small buttons)
        self._effects.draw_under(s)

        # rule buttons (cascade them in as one group after the board)
        rules_alpha = self._rules_panel_alpha()
        for group in self._rules_buttons:
            for sub in group:
                if rules_alpha >= 1.0:
                    sub.draw(s)
                else:
                    self._draw_button_with_alpha(sub, s, rules_alpha)

        # menu buttons
        self._restart_btn.draw(s)
        self._complexity_btn.draw(s)
        self._rules_btn.draw(s)
        self._palette_btn.draw(s)

        # result message
        if self._result_text:
            img = self._font_msg.render(self._result_text, True, (255, 255, 255))
            s.blit(img, (170 + (370 - img.get_width()) // 2, 22))

        # timer
        timer_img = self._font_timer.render(self._timer_text, True, self._timer_color)
        s.blit(timer_img, (FIELD_WIDTH - 75, 22))

        # Big-cell pop-in animations + particles render on top of the field
        self._effects.draw_over(s)

        if self._show_rules_overlay:
            self._draw_rules_overlay(s)

        # Commit scene to the actual display, applying camera shake offset
        dx, dy = self._effects.shake_offset()
        self.surface.fill(buttons_mod.BG_COLOR)
        self.surface.blit(self._scene, (dx, dy))

    def _draw_rules_overlay(self, surface):
        dim = pygame.Surface((CANVAS_WIDTH, CANVAS_HEIGHT))
        dim.set_alpha(220)
        dim.fill((30, 30, 30))
        surface.blit(dim, (0, 0))

        # center the rules image horizontally; scroll vertically
        img = self._img_rules_page
        x = (CANVAS_WIDTH - img.get_width()) // 2
        y = 20 - self._rules_scroll
        surface.blit(img, (x, y))

        hint = self._font_msg.render(
            'click anywhere to close • scroll to read',
            True, (255, 255, 200))
        surface.blit(hint, ((CANVAS_WIDTH - hint.get_width()) // 2,
                            CANVAS_HEIGHT - 28))
