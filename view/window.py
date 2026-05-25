import math
import os
import sys
from random import choice

import pygame

from view.buttons import (
    GameButton, RuleButton, FieldButton, color_for_value, apply_palette,
    rounded_fill, rounded_border, BG_COLOR,
)
from view.effects import Effects, Ghost
from view.palettes import get_palette
from view.anim import clamp01, ease_out_back, ease_out_cubic, lerp
from view.ui import (MenuOverlay, ResultOverlay, TextButton, make_heart,
                     draw_text, draw_tutorial_progress, TutorialPopup,
                     TutorialResultOverlay, TutorialMenuOverlay,
                     BlockSelectOverlay, AchievementsOverlay, set_click_sfx,
                     set_ui_scale)
from view.decoder import rule_segments, symbol_for
from model.tutorial import BLOCK_NAMES
import view.buttons as buttons_mod


# Layout. Two orientations share the same board/cell/overlay code; only the
# placement of the three regions (info panel, board, clues) differs.
#  * Landscape (desktop): three columns — left panel | board | right clues.
#  * Portrait (phone/web): a slim info strip on top, the board maximised by
#    width below it, the clues spread across the bottom.
# The board always occupies a fixed square (BOARD_SPAN px); the cell size
# shrinks as the grid grows (4x4 .. 6x6), so the framebuffer stays fixed.
#
# Orientation is decided once, at import. Portrait is used only when the
# viewport is taller than it is wide — i.e. a phone held upright. Desktop
# browsers (and the desktop app) are wider than tall, so they get landscape.
# EINSTEIN_PORTRAIT forces it either way (handy for testing / a forced build).
_IS_WEB = sys.platform == 'emscripten'


def _detect_portrait():
    env = os.environ.get('EINSTEIN_PORTRAIT')
    if env is not None:
        try:
            return bool(int(env))
        except (ValueError, TypeError):
            return False
    if _IS_WEB:
        try:
            import platform as _pf
            return bool(_pf.window.innerHeight > _pf.window.innerWidth)
        except Exception:
            return False
    return False


PORTRAIT = _detect_portrait()

CELL_GAP = 3
DEFAULT_SIZE = 6
RULE_CELL = 38               # clue mini-button — fixed, independent of board
HOVER_PROPAGATE_DELAY = 0.2  # seconds before a hover fans out to linked cells

if PORTRAIT:
    MARGIN = 14
    CANVAS_WIDTH = 760
    BOARD_SPAN = CANVAS_WIDTH - 2 * MARGIN          # board maximised by width
    TOP_H = 168                                     # top info strip height
    CLUES_GAP = 12                                  # board -> clues gap
    # holds the worst case (6x6 ~26 clues -> 6 rows of 46 px + header) with a
    # little slack; smaller boards just leave the lower part empty
    RULES_AREA_H = 330                              # clues panel height
    CANVAS_HEIGHT = TOP_H + BOARD_SPAN + CLUES_GAP + RULES_AREA_H + MARGIN
    FIELD_W = FIELD_H = BOARD_SPAN
    INDENT_LEFT = MARGIN                            # board origin x
    INDENT_TOP = TOP_H                              # board origin y
    PANEL_W = SIDEBAR_W = RULES_PANEL_W = CANVAS_WIDTH
    RULES_PANEL_X = 0
    RULES_AREA_TOP = INDENT_TOP + BOARD_SPAN + CLUES_GAP   # clues backing top
    RULES_TOP = RULES_AREA_TOP + 32                 # first clue row (after head)
else:
    BOARD_SPAN = 615             # the board's fixed pixel extent
    FIELD_W = FIELD_H = BOARD_SPAN
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
    TOP_H = 0                               # (portrait-only fields, unused)
    CLUES_GAP = 0
    RULES_AREA_TOP = 0
    RULES_AREA_H = CANVAS_HEIGHT


def _cell_side_for(size):
    """Pixel side of one board cell so `size` of them span BOARD_SPAN."""
    return (BOARD_SPAN - (size - 1) * CELL_GAP) // size

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
                 difficulty=0, size=DEFAULT_SIZE, tutorial=False, zen=False):
        # tutorial mode swaps the left panel for a 6-block progress tracker
        # and hides the timer, lives, solved count and hint button.
        self._tutorial = tutorial
        # zen mode: mistakes never end the run, so the left panel shows a
        # calm "ZEN" badge in place of the lives hearts
        self._zen = zen
        self._tut_tracker = []
        self._tut_block_name = ''
        self._base_dir = os.path.dirname(__file__)
        self._images_dir = os.path.join(self._base_dir, 'images')
        self._fonts_dir = os.path.join(self._base_dir, 'fonts')

        self._palette_name = palette_name
        self._palette = get_palette(palette_name)
        apply_palette(self._palette)
        self._sounds = sounds
        self._difficulty = difficulty   # 0/1/2 — easy/normal/hard
        self._sel_size = size           # board size selected for next restart
        self._mode_label = ''           # left-panel MODE footer text

        # board geometry — cell size and candidate sub-grid follow the size
        self._size = size
        self._cell_side = _cell_side_for(size)
        self._cand_cols = math.ceil(math.sqrt(size))
        self._cand_rows = math.ceil(size / self._cand_cols)

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
        self._cascade_t = 0.0          # running delay as a click's cascade resolves
        self._scheduled_sfx = []       # (due_clock, key) — staggered cascade sounds
        self._slowmo_t = 0.0           # remaining slow-mo time, seconds
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

        # tooltips + touch + reduce-motion
        self._tooltips_enabled = True
        self._touch_mode = False
        self._reduce_motion = False
        self._armed = None       # touch: a tapped-once widget awaiting confirm
        self._press = None       # a held field tile: {'btn': ..., 't': secs}

        self._overlay = None       # MenuOverlay / ResultOverlay
        self._menu_finished = False  # menu opened over a won/lost board
        self._menu_daily = None      # Daily-Puzzle status for the menu
        self._confetti_timer = 0.0
        self._stats_summary = None

        # in-game hint: a candidate to pop together with the rule that
        # justifies the elimination. A HINT button offers it; the highlight
        # then stays put until the player makes a move (it is not auto-cleared
        # on a timer).
        self._hint_btn = None
        self._hint_group = None
        # idle timer + hint-button configuration. Easy/Normal reveal the HINT
        # button after a difficulty-dependent idle window; Hard never does;
        # Zen always shows it (set below / by the presenter).
        self._idle_t = 0.0
        self._idle_hint_delay = None        # None = no idle offer (Hard)
        self._hint_offered = False          # latched once idle offers the button

        # cells resolved together by one click pop in as a cascade: each is
        # collected here, then flushed with a staggered delay
        self._batch_big = []

        # The full answer grid (solution[y][x] -> value). When set, a cell
        # always resolves to its *correct* value rather than to whatever value
        # a cascade step happened to derive — this makes the cascade immune to
        # the stale/contradictory request that used to blank a cell and
        # soft-lock the board. None for the free gesture-practice block, where
        # any surviving candidate is a valid answer.
        self._solution = None
        # Block 0 (gesture practice) turns the row cascade off so each cell is
        # solved by its own gesture and the click count is exact.
        self._row_cascade = True
        # cascade depth within the current action — drives the rising pick
        # pitch (combo-pitch) and the "+N chain!" readout
        self._chain_n = 0

        # Handler hooks (presenter registers these)
        self.on_field_click = None
        self.on_field_define = None
        self.on_rule_click = None
        self.on_continue = None
        self.on_restart = None         # deal a fresh board
        self.on_retry = None           # replay the exact same board
        self.on_daily = None           # start today's Daily Puzzle
        self.on_weekly = None          # start this week's Weekly Puzzle
        self.on_monthly = None         # start this month's Monthly Puzzle
        self.on_achievements = None    # open the badges screen
        self.on_share = None           # copy the result line
        self.on_mode_select = None
        self.on_size_select = None
        self.on_open_menu = None
        self.on_volume = None
        self.on_music = None           # ambient-music volume changed
        self.on_reduce_motion = None   # reduce-motion toggled
        self.on_tooltips = None
        self.on_touch = None
        self.on_zen = None
        self.on_hint = None            # presenter notifies for stats (unused
                                       # by HINT button — see auto-hint)
        self.on_block_replay = None    # tutorial: replay a chosen block

        self._build_field_buttons()
        self._build_rules_buttons(list(rules))
        self._build_sidebar()
        self._sidebar_strip = self._make_shadow_strip(dark_on_right=False)
        self._rules_strip = self._make_shadow_strip(dark_on_right=True)

        # let every overlay widget answer a press with the UI click sound
        set_click_sfx(lambda: self._play('click'))
        # enlarge every popup on the portrait/mobile build for legibility
        set_ui_scale(1.28 if PORTRAIT else 1.0)

    # --------------------------- loading -----------------------------

    def _load_fonts(self):
        reg = os.path.join(self._fonts_dir, 'DejaVuSans.ttf')
        bold = os.path.join(self._fonts_dir, 'DejaVuSans-Bold.ttf')
        # the feedback message + clue tooltip read at arm's length on a phone,
        # so they grow in portrait
        self._font_msg = pygame.font.Font(reg, 22 if PORTRAIT else 16)
        # candidate + big-cell glyphs scale with the (size-dependent) cell
        cand_sub = self._cell_side // self._cand_cols
        self._font_field = pygame.font.Font(bold, max(11, int(cand_sub * 0.42)))
        self._font_rule = pygame.font.Font(reg, 18)
        self._font_big = pygame.font.Font(bold, max(28, int(self._cell_side * 0.46)))
        self._font_timer = pygame.font.Font(bold, 31)
        self._font_menu = pygame.font.Font(bold, 18)
        self._font_label = pygame.font.Font(bold, 12)
        # the in-board hint pill ("pop this …") — much larger on the phone
        self._font_hint = pygame.font.Font(bold, 20 if PORTRAIT else 13)
        self._ui_fonts = {
            'title': pygame.font.Font(bold, 46),
            'h1': pygame.font.Font(bold, 30),
            'btn': pygame.font.Font(reg, 21),
            'small': pygame.font.Font(reg, 14),
            'tiny': pygame.font.Font(reg, 12),
        }

    def _load_images(self):
        # Procedural big-cell backgrounds (top-light gradient + subtle sheen),
        # one per board row, sized to this board's cell.
        self._big_bg = [None]
        for row in range(1, self._size + 1):
            base = self._palette['rows'][row]
            self._big_bg.append(_make_gradient_surface(
                (self._cell_side, self._cell_side), base))

    # --------------------------- building ----------------------------

    def _cell_origin(self, y, x):
        """Top-left pixel of board cell (y, x)."""
        step = self._cell_side + CELL_GAP
        return INDENT_LEFT + x * step, INDENT_TOP + y * step

    def _build_field_buttons(self):
        for y in range(self._size):
            row = []
            for x in range(self._size):
                row.append(self._create_mini_buttons(y, x))
            self._cells.append(row)

    def _create_mini_buttons(self, y, x):
        """The `size` candidate sub-buttons of one cell, laid out in an
        adaptive grid of square tiles (2x2 for 4, 3x2 for 5 and 6)."""
        btns = []
        ox, oy = self._cell_origin(y, x)
        cols, rows = self._cand_cols, self._cand_rows
        inset = max(3, self._cell_side // 22)
        avail = self._cell_side - 2 * inset
        sub = min(avail // cols, avail // rows)      # square candidate tiles
        gx = ox + (self._cell_side - sub * cols) // 2
        gy = oy + (self._cell_side - sub * rows) // 2
        for index in range(self._size):
            dy, dx = index // cols, index % cols
            in_row = min(cols, self._size - dy * cols)   # centre a short row
            row_off = (cols - in_row) * sub // 2
            n = (y + 1) * 10 + index + 1
            rect = (gx + row_off + dx * sub, gy + dy * sub, sub, sub)
            btns.append(FieldButton(y, x, n, rect, self._font_field))
        return btns

    def _build_rules_buttons(self, rules):
        rules.sort(key=lambda r: (1, r[1]) if isinstance(r[1], str) else (0, r[1]),
                   reverse=True)
        if PORTRAIT:
            self._build_rules_buttons_portrait(rules)
            return
        mini = RULE_CELL
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

    def _build_rules_buttons_portrait(self, rules):
        """Clues fill the bottom strip in as many columns as the width allows,
        read left-to-right, top-to-bottom."""
        mini = RULE_CELL
        rule_w = mini * 3
        col_gap = 14
        row_h = mini + 8
        n_cols = max(1, (CANVAS_WIDTH - 2 * MARGIN + col_gap)
                     // (rule_w + col_gap))
        total_w = n_cols * rule_w + (n_cols - 1) * col_gap
        start_x = (CANVAS_WIDTH - total_w) // 2
        for i, rule in enumerate(rules):
            col, row = i % n_cols, i // n_cols
            gx = start_x + col * (rule_w + col_gap)
            gy = RULES_TOP + row * row_h
            b1 = RuleButton(i, rule[0], (gx, gy, mini, mini), self._font_rule)
            b2 = RuleButton(i, rule[1], (gx + mini, gy, mini, mini), self._font_rule)
            b3 = RuleButton(i, rule[2], (gx + 2 * mini, gy, mini, mini), self._font_rule)
            self._rules_buttons.append([b1, b2, b3])

    def _build_sidebar(self):
        base = buttons_mod._brighten(self._palette['panel'], 44)
        accent = buttons_mod._brighten(self._palette['panel'], 70)
        if PORTRAIT:
            # menu (left) and hint (right) live in the top info strip
            bw = 132
            self._menu_button = TextButton(
                (MARGIN, 16, bw, 48), 'MENU', self._font_menu, base,
                self._palette['text'], on_click=self._request_menu,
                radius=12, accent=accent)
            self._hint_button = TextButton(
                (CANVAS_WIDTH - MARGIN - bw, 16, bw, 48), 'HINT',
                self._font_menu, base, self._palette['text'],
                on_click=self._on_hint_pressed, radius=12, accent=accent)
            self._hint_button.visible = False
            return
        self._menu_button = TextButton(
            (24, 22, SIDEBAR_W - 48, 48), 'MENU', self._font_menu,
            base, self._palette['text'], on_click=self._request_menu,
            radius=12, accent=accent)
        # The HINT button sits at the bottom of the left panel. It is hidden
        # until offered — after an idle window on Easy/Normal, always in Zen
        # (a free hint), never on Hard or during the tutorial. Pressing it
        # rings a candidate to pop and the clue that justifies it.
        self._hint_button = TextButton(
            (24, CANVAS_HEIGHT - 94 - 14 - 46, SIDEBAR_W - 48, 46), 'HINT',
            self._font_menu, base, self._palette['text'],
            on_click=self._on_hint_pressed, radius=12, accent=accent)
        self._hint_button.visible = False

    def _make_shadow_strip(self, dark_on_right):
        """A 16px soft shadow strip cast by a panel onto the board area."""
        strip = pygame.Surface((16, CANVAS_HEIGHT), pygame.SRCALPHA)
        for i in range(16):
            f = (i / 16.0) if dark_on_right else (1.0 - i / 16.0)
            a = int(70 * f ** 2)
            pygame.draw.line(strip, (0, 0, 0, a), (i, 0), (i, CANVAS_HEIGHT))
        return strip

    # --------------------------- public API --------------------------

    def set_difficulty(self, difficulty):
        self._difficulty = difficulty

    def set_sel_size(self, size):
        self._sel_size = size

    def set_mode_label(self, text):
        """The left-panel MODE footer text — what this board actually is
        (a difficulty, a Daily, a Zen run), independent of the menu picks."""
        self._mode_label = text

    def set_stats(self, summary):
        """Per-difficulty progress, shown by the menu overlay."""
        self._stats_summary = summary

    def set_tooltips(self, enabled):
        self._tooltips_enabled = bool(enabled)

    def set_touch(self, enabled):
        self._touch_mode = bool(enabled)
        if not enabled:
            self._armed = None

    def set_reduce_motion(self, enabled):
        """Accessibility: damp screenshake, the cascade slow-mo and the heavy
        particle bursts. Forwarded to the effects layer."""
        self._reduce_motion = bool(enabled)
        self._effects.set_reduced(self._reduce_motion)

    def set_solution(self, grid):
        """Hand the view the full answer grid so every cascade step resolves a
        cell to its correct value. Must be called before ``define_start_cells``.
        Pass None to keep the legacy "resolve to the derived value" behaviour
        (the free gesture-practice block)."""
        self._solution = grid

    def set_row_cascade(self, enabled):
        """Whether resolving a cell strikes its value down the rest of the row
        and auto-solves any cell it forces. On for real puzzles; off for the
        gesture-practice block so each cell costs exactly one gesture."""
        self._row_cascade = bool(enabled)

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
        # interacting with a clue counts as "making a move" — retire the hint
        self._hint_btn = None
        self._hint_group = None
        self._idle_t = 0.0
        for sub in self._rules_buttons[index]:
            sub.pressed = not sub.pressed
            sub.change_color()
        self._play('click')

    def disable_buttons(self):
        self._armed = None
        self._press = None
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

    def open_menu(self, finished=False, daily=None, weekly=None,
                  monthly=None, size_locks=None, diff_locks=None):
        self._effects.calm()
        self._armed = None
        self._menu_finished = finished
        self._menu_daily = daily
        self._menu_weekly = weekly
        self._menu_monthly = monthly
        self._menu_size_locks = size_locks
        self._menu_diff_locks = diff_locks
        vol = self._sounds.volume if self._sounds else 0.7
        music = self._sounds.music_volume if self._sounds else 0.5
        callbacks = {
            'continue': self._menu_continue,
            'restart': lambda: self.on_restart and self.on_restart(),
            'daily': self._menu_daily_start,
            'weekly': self._menu_weekly_start,
            'monthly': self._menu_monthly_start,
            'achievements': lambda: (self.on_achievements
                                     and self.on_achievements()),
            'mode': lambda d: self.on_mode_select and self.on_mode_select(d),
            'size': lambda s: self.on_size_select and self.on_size_select(s),
            'tutorial': self.open_tutorial,
            'volume': lambda v: self.on_volume and self.on_volume(v),
            'music': self._menu_music,
            'reduce_motion': self._menu_reduce_motion,
            'tooltips': self._menu_tooltips,
            'touch': self._menu_touch,
            'zen': self._menu_zen,
        }
        self._overlay = MenuOverlay((CANVAS_WIDTH, CANVAS_HEIGHT),
                                    self._palette, self._ui_fonts,
                                    self._difficulty, self._sel_size, vol,
                                    callbacks, tooltips=self._tooltips_enabled,
                                    touch=self._touch_mode, zen=self._zen,
                                    finished=finished, daily=daily,
                                    weekly=weekly, monthly=monthly,
                                    size_locks=size_locks,
                                    diff_locks=diff_locks, music=music,
                                    reduce_motion=self._reduce_motion)

    def _menu_daily_start(self):
        self.close_overlay()
        if self.on_daily:
            self.on_daily()

    def _menu_weekly_start(self):
        self.close_overlay()
        if self.on_weekly:
            self.on_weekly()

    def _menu_monthly_start(self):
        self.close_overlay()
        if self.on_monthly:
            self.on_monthly()

    def _menu_zen(self, value):
        # only persist the choice — the live board keeps the rules it was
        # built with; Zen takes effect on the next New game
        if self.on_zen:
            self.on_zen(bool(value))

    def open_achievements(self, unlocked, summary):
        """The badges screen — opened from the menu."""
        self._armed = None
        self._overlay = AchievementsOverlay(
            (CANVAS_WIDTH, CANVAS_HEIGHT), self._palette, self._ui_fonts,
            set(unlocked or []), summary or {},
            on_close=self._reopen_menu)

    def open_tutorial(self):
        """Menu 'Tutorial' button (post-onboarding): pick a block to replay."""
        self._armed = None
        self._overlay = BlockSelectOverlay(
            (CANVAS_WIDTH, CANVAS_HEIGHT), self._palette, self._ui_fonts,
            list(BLOCK_NAMES),
            on_pick=lambda i: self.on_block_replay and self.on_block_replay(i),
            on_close=self._reopen_menu)

    def _reopen_menu(self):
        """Reopen the main menu with the same state it had before a subscreen
        (progress / replay-picker) was opened."""
        self.open_menu(finished=self._menu_finished,
                       daily=getattr(self, '_menu_daily', None),
                       weekly=getattr(self, '_menu_weekly', None),
                       monthly=getattr(self, '_menu_monthly', None),
                       size_locks=getattr(self, '_menu_size_locks', None),
                       diff_locks=getattr(self, '_menu_diff_locks', None))

    # --------------------- tutorial overlays -------------------------

    def set_tutorial_progress(self, tracker, block_name):
        """Feed the side-panel tracker its 6-block state."""
        self._tut_tracker = list(tracker)
        self._tut_block_name = block_name

    def clues_rect(self):
        """Screen rect bounding the displayed clue buttons (for a spotlight)."""
        rects = [sub.rect for grp in self._rules_buttons for sub in grp]
        if not rects:
            if PORTRAIT:
                return pygame.Rect(MARGIN, RULES_AREA_TOP,
                                   CANVAS_WIDTH - 2 * MARGIN, 90)
            return pygame.Rect(RULES_PANEL_X + 30, 40, RULES_PANEL_W - 60, 90)
        bounds = rects[0].unionall(rects[1:])
        return bounds.inflate(30, 30)

    def show_popup(self, text, button_label='Got it', on_done=None,
                   tag='TUTORIAL', spotlight=None, animation=None):
        self._armed = None
        self._overlay = TutorialPopup(
            (CANVAS_WIDTH, CANVAS_HEIGHT), self._palette, self._ui_fonts,
            text, button_label=button_label, on_done=on_done, tag=tag,
            spotlight=spotlight, animation=animation)

    def show_tutorial_result(self, title, message, tracker,
                             button_label='Continue', on_continue=None,
                             celebrate=True):
        self._armed = None
        self._overlay = TutorialResultOverlay(
            (CANVAS_WIDTH, CANVAS_HEIGHT), self._palette, self._ui_fonts,
            title, message, list(tracker), button_label=button_label,
            on_continue=on_continue)
        if celebrate:
            self._effects.celebrate()

    def open_tutorial_menu(self, tracker, callbacks):
        self._effects.calm()
        self._armed = None
        vol = self._sounds.volume if self._sounds else 0.7
        self._overlay = TutorialMenuOverlay(
            (CANVAS_WIDTH, CANVAS_HEIGHT), self._palette, self._ui_fonts,
            list(tracker), vol, callbacks)

    def _menu_music(self, value):
        if self._sounds is not None:
            self._sounds.set_music_volume(value)
            self._sounds.start_music()   # a tweak also kicks the loop alive
        if self.on_music:
            self.on_music(float(value))

    def _menu_reduce_motion(self, value):
        self.set_reduce_motion(value)
        if self.on_reduce_motion:
            self.on_reduce_motion(bool(value))

    def _menu_tooltips(self, value):
        self._tooltips_enabled = bool(value)
        if self.on_tooltips:
            self.on_tooltips(bool(value))

    def _menu_touch(self, value):
        self.set_touch(value)
        if self.on_touch:
            self.on_touch(bool(value))

    def _result_callbacks(self):
        return {
            'menu': lambda: self.on_open_menu and self.on_open_menu(),
            'retry': lambda: self.on_retry and self.on_retry(),
            'new': lambda: self.on_restart and self.on_restart(),
            'share': lambda: self.on_share and self.on_share(),
        }

    def show_win(self, best_text=None, new_record=False, badges=None,
                 daily=None):
        msg = choice(_WIN_MSGS)
        self._overlay = ResultOverlay(
            (CANVAS_WIDTH, CANVAS_HEIGHT), self._palette, self._ui_fonts,
            True, msg, self._timer_text, self._result_callbacks(),
            best_text=best_text, new_record=new_record,
            badges=list(badges or []), daily=daily)
        self._effects.celebrate()

    def show_lose(self):
        msg = choice(_LOOSE_MSGS)
        self._overlay = ResultOverlay(
            (CANVAS_WIDTH, CANVAS_HEIGHT), self._palette, self._ui_fonts,
            False, msg, self._timer_text, self._result_callbacks())
        self._effects.defeat()

    def close_overlay(self):
        if self._overlay is not None:
            self._overlay.close()

    def _request_menu(self):
        self._play('click')
        if self.on_open_menu:
            self.on_open_menu()

    def _menu_continue(self):
        # the 'click' is played by the overlay's widget routing
        self.close_overlay()
        if self.on_continue:
            self.on_continue()

    @property
    def menu_finished(self):
        """True while the menu is the one opened over a won/lost board."""
        return self._menu_finished

    # --------------------------- cell logic --------------------------

    BIG_CASCADE_STEP = 0.20   # gap between consecutive big cells popping in
    ROW_CASCADE_STEP = 0.13   # extra gap between small pops along one row

    def remove_button(self, btn):
        """Pop one candidate. Whatever that resolves — the cell itself, then
        the rest of its row — pops in as a staggered cascade."""
        self._hint_btn = None      # any board change retires a stale hint
        self._hint_group = None
        self._idle_t = 0.0         # progress counts as activity
        self._cascade_t = 0.0
        self._chain_n = 0
        cur_n, cur_y, cur_x = btn.n, btn.y, btn.x
        cell = self._cells[cur_y][cur_x]
        if not (isinstance(cell, list) and btn in cell):
            return
        cell.remove(btn)
        self._spawn_small_pop(btn, 0.0)
        if len(cell) == 1:
            self._cascade_resolve(cur_y, cur_x, list(cell), cell[0].n)
        self._check_last_in_row(cur_y, cur_n)
        self._flush_big_batch()

    def define_cell(self, keep_btn):
        """Long-press 'define': keep this candidate, clear the rest of its
        cell at once, then let the row cascade as usual."""
        y, x = keep_btn.y, keep_btn.x
        cell = self._cells[y][x]
        if not isinstance(cell, list) or keep_btn not in cell:
            return
        self._hint_btn = None
        self._hint_group = None
        self._idle_t = 0.0
        self._cascade_t = 0.0
        self._chain_n = 0
        # _cascade_resolve pops every candidate, blooms the big cell, clears
        # the row and re-checks each cleared value — the whole job
        self._cascade_resolve(y, x, list(cell), keep_btn.n)
        self._flush_big_batch()

    def _cascade_resolve(self, row, x, buttons, n):
        """Cell (row, x) flips to the solved big cell `n` as the next cascade
        step: every candidate still in it pops and the big cell blooms on the
        same staggered beat, then the value clears down the rest of the row."""
        # Resolve to the cell's *correct* value when we know it. A stale
        # cascade beat could otherwise ask to place a value already solved
        # elsewhere in the row, which used to blank this cell (no big cell, no
        # solved-count bump) and soft-lock the board.
        if self._solution is not None:
            try:
                n = self._solution[row][x]
            except (IndexError, TypeError, KeyError):
                pass
        step = self._cascade_t
        self._cascade_t += self.BIG_CASCADE_STEP
        self._chain_n += 1
        pitch = self._chain_n          # rising pick pitch down the chain
        self._cells[row][x] = None
        for b in buttons:
            self._spawn_small_pop(b, step, pitch=pitch)
        self._create_big_button(row, x, n, step)
        self._remove_all_in_row(row, n, step, pitch=pitch)
        # a candidate value cleared from this cell may now be unique elsewhere
        for b in buttons:
            if b.n != n:
                self._check_last_in_row(row, b.n)

    def _remove_all_in_row(self, row, number, delay, pitch=0):
        """Strike `number` from every still-active candidate cell in `row`.

        Each removed candidate gets its own tiny stagger on top of the base
        ``delay`` so the wave is visible — without the per-cell offset, the
        whole row of small pops fires in one frame and reads as a single
        flash rather than a cascade."""
        if not self._row_cascade:
            return
        step = 0
        for x, cell in enumerate(self._cells[row]):
            if not isinstance(cell, list):
                continue
            match = next((b for b in cell if b.n == number), None)
            if match is None:
                continue
            if len(cell) == 2:
                # losing `number` solves this cell — flip the whole cell as
                # one cascade step (every candidate pops on its own beat)
                survivor = next(b for b in cell if b is not match)
                self._cascade_resolve(row, x, list(cell), survivor.n)
            else:
                cell.remove(match)
                self._spawn_small_pop(match,
                                      delay + step * self.ROW_CASCADE_STEP,
                                      pitch=pitch, sound=False)
                step += 1

    def _check_last_in_row(self, row, number):
        if not self._row_cascade:
            return
        count, column, found = 0, -1, None
        for x, cell in enumerate(self._cells[row]):
            if not isinstance(cell, list):
                continue
            if any(b.n == number for b in cell):
                count += 1
                column, found = x, cell
        if count == 1:
            self._cascade_resolve(row, column, list(found), number)

    def _create_big_button(self, y, x, n, delay=0.0):
        from view.decoder import decode_symbol
        # In a real puzzle a value lives once per row, so a (now solution-
        # corrected) request to place one twice is dropped defensively. The
        # free gesture-practice block has no such constraint and the row
        # cascade is off there — two cells may legitimately end on the same
        # glyph, so we must NOT drop it (dropping would blank the cell and
        # soft-lock the board).
        if self._row_cascade and any(big.n == n for big in self._big_buttons):
            return None
        self._defined_cells_count += 1
        bg = self._big_bg[n // 10]
        ox, oy = self._cell_origin(y, x)
        rect = (ox, oy, self._cell_side, self._cell_side)
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
            # deferred: the batch is flushed as a staggered cascade
            self._batch_big.append((btn, delay))

    def _flush_big_batch(self):
        """Fire the pop for every big cell resolved by this action, each on
        the cascade beat it was tagged with."""
        batch = self._batch_big
        self._batch_big = []
        if not batch:
            return
        for btn, delay in batch:
            snap = self._snapshot_button(btn)
            burst_color = color_for_value(btn.n) or (220, 220, 220)
            self._effects.big_pop(btn, burst_color, snap, delay=delay)
        # one resolving chime per action; the staggered 'pick' ticks the
        # small pops schedule are what make the cascade audible as a run
        self._play('solve')
        # a chunky cascade earns a brief slow-mo and a floating "+N chain!"
        if len(batch) >= 3:
            self._slowmo_t = self.SLOWMO_DUR
            self._spawn_combo_text(len(batch), batch)

    def _spawn_combo_text(self, n, batch):
        cx = sum(b.rect.centerx for b, _ in batch) / len(batch)
        cy = sum(b.rect.centery for b, _ in batch) / len(batch)
        self._effects.combo_text(self._render_combo_label('+%d chain!' % n),
                                 cx, cy)

    def _render_combo_label(self, text):
        font = self._ui_fonts['h1']
        gold, dark, pad = (255, 214, 120), (38, 28, 20), 3
        base = font.render(text, True, gold)
        outline = font.render(text, True, dark)
        w, h = base.get_size()
        surf = pygame.Surface((w + pad * 2, h + pad * 2), pygame.SRCALPHA)
        for ox in (-2, 0, 2):
            for oy in (-2, 0, 2):
                if ox or oy:
                    surf.blit(outline, (pad + ox, pad + oy))
        surf.blit(base, (pad, pad))
        return surf

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
        ox, oy = self._cell_origin(btn.y, btn.x)
        rect = pygame.Rect(ox, oy, self._cell_side, self._cell_side)
        self._effects.wrong_click(rect)
        self._idle_t = 0.0       # a mistake counts as activity too

    def _spawn_small_pop(self, btn, delay=0.0, pitch=0, sound=True):
        if getattr(self, '_suppress_effects', False):
            return
        color = btn.bg_color or (90, 90, 90)
        descent_shift = self._font_field.get_descent() // 2 if btn.font else 0
        ghost = Ghost(btn.rect, color, btn.text, btn.font, descent_shift,
                      delay=delay)
        self._effects.small_pop(ghost, color, delay=delay)
        # Sound only on a cell *resolving* (one pick per cell in the chain, at
        # its combo pitch). The many row-strike shimmer pops stay silent — a
        # pick per struck candidate was both noisy and the main source of web
        # audio lag.
        if sound:
            key = (self._sounds.pick_for_step(pitch)
                   if self._sounds is not None else 'pick')
            self._play_at(delay, key)

    def _play_at(self, delay, key):
        """Play a sound now, or schedule it `delay` seconds ahead — so a
        staggered cascade is heard as a run, not one bunched-up trigger."""
        if delay <= 0.0:
            self._play(key)
        else:
            self._scheduled_sfx.append((self._clock + delay, key))

    # --------------------------- cascade entrance --------------------

    CASCADE_PER_CELL_TIME = 0.22
    CASCADE_DIAGONAL_STEP = 0.045

    def _cell_t_birth(self, y, x):
        return (y + x) * self.CASCADE_DIAGONAL_STEP

    def _compute_cascade_duration(self):
        max_birth = self._cell_t_birth(self._size - 1, self._size - 1)
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
        cell_origin_x, cell_origin_y = self._cell_origin(y, x)
        side = self._cell_side
        temp = pygame.Surface((side, side), pygame.SRCALPHA)
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
        sw = max(1, int(side * scale))
        sh = max(1, int(side * scale))
        if (sw, sh) != (side, side):
            temp = pygame.transform.smoothscale(temp, (sw, sh))
        temp.set_alpha(int(255 * alpha))
        cx = cell_origin_x + side // 2
        cy = cell_origin_y + side // 2
        surface.blit(temp, (cx - sw // 2, cy - sh // 2))

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
        if self._hint_button is not None and self._hint_button.visible:
            self._hint_button.handle_event(event)
        if event.type == pygame.MOUSEBUTTONDOWN and event.button == 1:
            pos = event.pos
            if self._menu_button.rect.collidepoint(pos):
                return
            if (self._hint_button is not None and self._hint_button.visible
                    and self._hint_button.rect.collidepoint(pos)):
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
                                # arm a press: a quick release pops the
                                # candidate, a held one 'defines' the cell
                                self._press = {'btn': btn, 't': 0.0}
                                return
            # a tap on bare board clears any pending touch selection
            self._armed = None
        elif event.type == pygame.MOUSEBUTTONUP and event.button == 1:
            self._end_press(event.pos)

    def _end_press(self, pos):
        """Mouse released over a field tile before the long-press filled —
        treat it as an ordinary quick pop."""
        press = self._press
        self._press = None
        if press is not None and press['btn'].hit_test(pos):
            self._activate_field(press['btn'])

    def _update_press(self, dt):
        """Grow the held-press fill; cancel it if the cursor leaves the tile;
        fire the 'define' once it is full."""
        if self._press is None:
            return
        btn = self._press['btn']
        if (self._overlay is not None
                or not btn.hit_test(self._mouse_pos)
                or not pygame.mouse.get_pressed()[0]):
            self._press = None       # moved off, released or interrupted
            return
        self._press['t'] += dt
        if self._press['t'] >= self.LONGPRESS_DUR:
            self._press = None
            if self.on_field_define:
                self.on_field_define(btn)

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

    # --------------------------- update ------------------------------

    SLOWMO_DUR = 0.5      # wall-clock length of the cascade slow-mo
    SLOWMO_MIN = 0.34     # slowest time scale, reached right as it kicks off
    LONGPRESS_DUR = 0.46  # hold time before a press becomes a 'define'

    def _time_scale(self, real_dt):
        """Advance and sample the cascade slow-mo: time crawls the instant a
        big cascade starts, then eases smoothly back to full speed. Disabled
        when reduce-motion is on."""
        if self._reduce_motion:
            self._slowmo_t = 0.0
            return 1.0
        if self._slowmo_t <= 0.0:
            return 1.0
        self._slowmo_t = max(0.0, self._slowmo_t - real_dt)
        frac = self._slowmo_t / self.SLOWMO_DUR          # 1 -> 0
        return self.SLOWMO_MIN + (1.0 - self.SLOWMO_MIN) * (1.0 - frac) ** 0.55

    def tick(self, dt_ms):
        real_dt = dt_ms / 1000.0
        scale = self._time_scale(real_dt)
        dt = real_dt * scale
        self._clock += dt
        if self._sounds is not None:
            self._sounds.tick(dt_ms * scale)
        # release cascade sounds whose staggered moment has now arrived
        if self._scheduled_sfx:
            ready = [k for (t, k) in self._scheduled_sfx if t <= self._clock]
            self._scheduled_sfx = [(t, k) for (t, k) in self._scheduled_sfx
                                   if t > self._clock]
            for k in ready:
                self._play(k)
        self._effects.update(dt)
        self._cascade_time += dt
        self._msg_anim = min(1.0, self._msg_anim + dt * 6.0)

        try:
            self._mouse_pos = pygame.mouse.get_pos()
        except pygame.error:
            self._mouse_pos = (-1, -1)

        # the long-press fill tracks real time, not the slow-mo'd clock
        self._update_press(dt_ms / 1000.0)

        self._menu_button.update(dt, self._mouse_pos)
        self._tick_idle_hint(dt)
        self._update_hint_button(dt)

        if self._overlay is not None:
            self._overlay.update(dt, self._mouse_pos)
            if self._overlay.dead:
                self._overlay = None
            else:
                won = (isinstance(self._overlay, ResultOverlay)
                       and self._overlay.won)
                if won or isinstance(self._overlay, TutorialResultOverlay):
                    self._confetti_timer -= dt
                    if self._confetti_timer <= 0.0:
                        self._confetti_timer = 0.95
                        self._effects.confetti(12)

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
        if (self._overlay is not None
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
        # a crossed-out (used) clue is inert — it lights nothing
        if (hovered_group is not None
                and self._rules_buttons[hovered_group][0].pressed):
            hovered_group = None

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
            if group[0].pressed:        # crossed-out clue — never highlights
                for sub in group:
                    sub.glow_target = sub.lift_target = 0.0
                continue
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
        outline_pad = buttons_mod.rounded_fill(self._cell_side, self._cell_side,
                                               outline_color, 14)
        for y in range(self._size):
            for x in range(self._size):
                cx, cy = self._cell_origin(y, x)
                s.blit(outline_pad, (cx, cy))

        for y in range(self._size):
            for x in range(self._size):
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
        self._draw_hint(s)
        self._draw_armed(s)
        self._draw_press_fill(s)
        self._effects.draw_vignette(s)

        dx, dy = self._effects.shake_offset()
        self.surface.fill(buttons_mod.BG_COLOR)
        self.surface.blit(self._scene, (dx, dy))

        if self._overlay is not None:
            self._overlay.draw(self.surface)

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
        # portrait floats the pill just under the top strip; landscape keeps it
        # in the left panel's mid gap
        cx = CANVAS_WIDTH // 2 if PORTRAIT else SIDEBAR_W // 2
        cy = (TOP_H + 28) if PORTRAIT else self.MSG_CENTER_Y
        surface.blit(pill, (cx - sw // 2, cy - sh // 2))

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
        size, gap = self.HEART_SIZE, self.HEART_GAP
        if PORTRAIT:
            # one horizontal row, centred in the strip's left third
            lcx = (CANVAS_WIDTH // 3) // 2
            total = self._max_lives * size + (self._max_lives - 1) * gap
            x0 = lcx - total // 2
            return x0 + i * (size + gap) + size // 2, 126
        per = self.HEARTS_PER_ROW
        total = per * size + (per - 1) * gap
        x0 = (SIDEBAR_W - total) // 2
        col, rowi = i % per, i // per
        cx = x0 + col * (size + gap) + size // 2
        cy = self.HEARTS_Y + rowi * (size + gap) + size // 2
        return cx, cy

    def _complexity_name(self):
        if self._mode_label:
            return self._mode_label
        name = ('EASY', 'NORMAL', 'HARD')[max(0, min(2, self._difficulty))]
        return '%s  ·  %d×%d' % (name, self._size, self._size)

    def _draw_rules_panel(self, surface):
        """Right-panel backing — mirrors the left panel. Drawn before the rule
        buttons so they sit on top of it."""
        panel = buttons_mod._brighten(self._palette['bg'], 13)
        muted = buttons_mod._brighten(self._palette['bg'], 64)
        if PORTRAIT:
            # bottom clues panel, full width
            pygame.draw.rect(surface, panel,
                             (0, RULES_AREA_TOP, CANVAS_WIDTH,
                              CANVAS_HEIGHT - RULES_AREA_TOP))
            pygame.draw.line(surface, buttons_mod._brighten(panel, 30),
                             (0, RULES_AREA_TOP), (CANVAS_WIDTH, RULES_AREA_TOP))
            draw_text(surface, 'C L U E S', self._font_label, muted,
                      center=(CANVAS_WIDTH // 2, RULES_AREA_TOP + 16))
            return
        pygame.draw.rect(surface, panel,
                         (RULES_PANEL_X, 0, RULES_PANEL_W, CANVAS_HEIGHT))
        pygame.draw.line(surface, buttons_mod._brighten(panel, 30),
                         (RULES_PANEL_X, 0), (RULES_PANEL_X, CANVAS_HEIGHT))
        surface.blit(self._rules_strip, (RULES_PANEL_X - 16, 0))
        cx = RULES_PANEL_X + RULES_PANEL_W // 2
        draw_text(surface, 'C L U E S', self._font_label, muted,
                  center=(cx, 30))

    def _draw_left_panel(self, surface):
        if PORTRAIT:
            self._draw_top_strip(surface)
            return
        panel = buttons_mod._brighten(self._palette['bg'], 13)
        pygame.draw.rect(surface, panel, (0, 0, SIDEBAR_W, CANVAS_HEIGHT))
        pygame.draw.line(surface, buttons_mod._brighten(panel, 30),
                         (SIDEBAR_W - 1, 0), (SIDEBAR_W - 1, CANVAS_HEIGHT))
        surface.blit(self._sidebar_strip, (SIDEBAR_W, 0))

        muted = buttons_mod._brighten(self._palette['bg'], 64)
        text = self._palette['text']
        cx = SIDEBAR_W // 2

        self._menu_button.draw(surface)

        if self._tutorial:
            self._draw_tutorial_panel(surface, panel, muted, text, cx)
            return

        # timer
        draw_text(surface, 'T I M E', self._font_label, muted,
                  center=(cx, 104))
        draw_text(surface, self._timer_text, self._font_timer,
                  self._timer_color, center=(cx, 140))

        # lives — or a calm ZEN badge when mistakes cannot end the run
        if self._zen:
            draw_text(surface, 'Z E N', self._font_label, muted,
                      center=(cx, self.HEARTS_Y - 24))
            draw_text(surface, 'no game over', self._ui_fonts['small'],
                      self._palette['accent'],
                      center=(cx, self.HEARTS_Y + 12))
        else:
            draw_text(surface, 'L I V E S', self._font_label, muted,
                      center=(cx, self.HEARTS_Y - 24))
            self._draw_hearts(surface)

        # how much of the board is solved
        self._draw_progress(surface)

        # good/wrong feedback message
        self._draw_message(surface)

        # the HINT button, once offered (idle) or in Zen (always)
        if self._hint_button is not None and self._hint_button.visible:
            self._hint_button.draw(surface)

        # footer: difficulty (the +life keyboard shortcut still works but is
        # no longer surfaced in the UI)
        pygame.draw.line(surface, buttons_mod._brighten(panel, 22),
                         (24, CANVAS_HEIGHT - 94),
                         (SIDEBAR_W - 24, CANVAS_HEIGHT - 94))
        draw_text(surface, 'MODE', self._font_label, muted,
                  center=(cx, CANVAS_HEIGHT - 72))
        draw_text(surface, self._complexity_name(), self._font_menu, text,
                  center=(cx, CANVAS_HEIGHT - 46))

    def _draw_top_strip(self, surface):
        """Portrait: a slim horizontal info strip above the board — menu,
        timer, lives/zen, solved, mode and the hint button."""
        bg = self._palette['bg']
        panel = buttons_mod._brighten(bg, 13)
        pygame.draw.rect(surface, panel, (0, 0, CANVAS_WIDTH, TOP_H))
        pygame.draw.line(surface, buttons_mod._brighten(panel, 30),
                         (0, TOP_H - 1), (CANVAS_WIDTH, TOP_H - 1))
        muted = buttons_mod._brighten(bg, 64)
        text = self._palette['text']
        cx = CANVAS_WIDTH // 2
        self._menu_button.draw(surface)
        if self._tutorial:
            self._draw_top_strip_tutorial(surface, muted, text)
            return
        # timer, centred between the menu and hint buttons
        draw_text(surface, 'T I M E', self._font_label, muted, center=(cx, 28))
        draw_text(surface, self._timer_text, self._font_timer,
                  self._timer_color, center=(cx, 58))
        third = CANVAS_WIDTH // 3
        lcx, rcx = third // 2, CANVAS_WIDTH - third // 2
        rowy = 94
        if self._zen:
            draw_text(surface, 'Z E N', self._font_label, muted,
                      center=(lcx, rowy))
            draw_text(surface, 'no game over', self._ui_fonts['small'],
                      self._palette['accent'], center=(lcx, rowy + 28))
        else:
            draw_text(surface, 'L I V E S', self._font_label, muted,
                      center=(lcx, rowy))
            self._draw_hearts(surface)
        self._draw_progress(surface)
        draw_text(surface, 'MODE', self._font_label, muted, center=(rcx, rowy))
        draw_text(surface, self._complexity_name(), self._font_menu, text,
                  center=(rcx, rowy + 26))
        if self._hint_button is not None and self._hint_button.visible:
            self._hint_button.draw(surface)
        self._draw_message(surface)

    def _draw_top_strip_tutorial(self, surface, muted, text):
        cx = CANVAS_WIDTH // 2
        draw_text(surface, 'T U T O R I A L', self._font_label, muted,
                  center=(cx, 28))
        draw_text(surface, self._tut_block_name, self._font_menu, text,
                  center=(cx, 58))
        tracker = self._tut_tracker or []
        accent = self._palette['accent']
        n = max(1, len(tracker))
        gap = 46
        x0 = cx - (n - 1) * gap // 2
        y = 108
        for i, row in enumerate(tracker):
            done = row[3] if len(row) == 5 else row[2]
            current = row[4] if len(row) == 5 else row[3]
            dx = x0 + i * gap
            if done:
                pygame.draw.circle(surface, accent, (dx, y), 9)
            elif current:
                pygame.draw.circle(surface, accent, (dx, y), 9, 2)
            else:
                pygame.draw.circle(surface, muted, (dx, y), 8, 2)

    def _draw_tutorial_panel(self, surface, panel, muted, text, cx):
        """Left panel during the tutorial — the 6-block progress tracker and
        a TUTORIAL · <block> mode footer, in place of timer/lives/hint."""
        draw_text(surface, 'T U T O R I A L', self._font_label, muted,
                  center=(cx, 104))
        draw_tutorial_progress(surface, 24, 132, SIDEBAR_W - 48,
                               self._tut_tracker, self._ui_fonts,
                               self._palette, row_h=48)
        pygame.draw.line(surface, buttons_mod._brighten(panel, 22),
                         (24, CANVAS_HEIGHT - 116),
                         (SIDEBAR_W - 24, CANVAS_HEIGHT - 116))
        draw_text(surface, 'MODE', self._font_label, muted,
                  center=(cx, CANVAS_HEIGHT - 94))
        draw_text(surface, 'TUTORIAL', self._font_menu, text,
                  center=(cx, CANVAS_HEIGHT - 68))
        draw_text(surface, self._tut_block_name, self._ui_fonts['small'],
                  muted, center=(cx, CANVAS_HEIGHT - 44))

    PROGRESS_Y = 296

    def _draw_progress(self, surface):
        """The 'solved N / 36' indicator filling the left panel's mid gap."""
        muted = buttons_mod._brighten(self._palette['bg'], 64)
        total = self._size * self._size
        if PORTRAIT:
            cx, y, bw = CANVAS_WIDTH // 2, 92, 200
            draw_text(surface, 'S O L V E D', self._font_label, muted,
                      center=(cx, y))
            draw_text(surface, '%d / %d' % (self._defined_cells_count, total),
                      self._font_menu, self._palette['text'],
                      center=(cx, y + 24))
            bx, by = cx - bw // 2, y + 42
            surface.blit(rounded_fill(bw, 6, buttons_mod._brighten(
                self._palette['bg'], 26), 3), (bx, by))
            frac = clamp01(self._defined_cells_count / float(total))
            if frac > 0:
                surface.blit(rounded_fill(max(1, int(bw * frac)), 6,
                                          self._palette['accent'], 3), (bx, by))
            return
        cx = SIDEBAR_W // 2
        y = self.PROGRESS_Y
        draw_text(surface, 'S O L V E D', self._font_label, muted,
                  center=(cx, y))
        draw_text(surface, '%d / %d' % (self._defined_cells_count, total),
                  self._font_menu, self._palette['text'], center=(cx, y + 26))
        bw = SIDEBAR_W - 80
        bx = (SIDEBAR_W - bw) // 2
        by = y + 44
        surface.blit(rounded_fill(bw, 6,
                                  buttons_mod._brighten(self._palette['bg'],
                                                        26), 3), (bx, by))
        frac = clamp01(self._defined_cells_count / float(total))
        fw = int(bw * frac)
        if fw > 0:
            surface.blit(rounded_fill(fw, 6, self._palette['accent'], 3),
                         (bx, by))

    TOOLTIP_TILE = 28

    def _tooltip_tile(self, value):
        """A small board-coloured cell tile, drawn inline in the tooltip."""
        s = self.TOOLTIP_TILE
        surf = pygame.Surface((s, s), pygame.SRCALPHA)
        col = color_for_value(value) or (120, 120, 120)
        surf.blit(rounded_fill(s, s, col, 6), (0, 0))
        surf.blit(rounded_border(s, s, BG_COLOR, 6, 1), (0, 0))
        img = self._font_rule.render(symbol_for(value), True, (255, 255, 255))
        surf.blit(img, img.get_rect(center=(s // 2, s // 2)))
        return surf

    def _draw_tooltip(self, surface):
        """A plain-language reading of the rule under the cursor — words plus
        real coloured cell tiles, so the abstract markers stay concrete."""
        if (not self._tooltips_enabled or self._hovered_group is None
                or self._overlay is not None):
            return
        group = self._rules_buttons[self._hovered_group]
        segments = rule_segments(tuple(sub.value for sub in group))
        font = self._font_msg
        tile = self.TOOLTIP_TILE
        space = font.size(' ')[0]
        line_h = max(font.get_height(), tile) + 4
        # wide enough that the one-text-segment rules ("same column",
        # "left of") keep their closing cell tile on the first line instead
        # of orphaning it onto a second row (wider in portrait — bigger font)
        max_w = 420 if PORTRAIT else 300

        # flow words and cell tiles into wrapped lines
        tokens = []
        for kind, val in segments:
            if kind == 'cell':
                tokens.append(('cell', val, tile))
            else:
                for word in str(val).split():
                    tokens.append(('word', word, font.size(word)[0]))
        lines, line_w = [[]], 0
        for tok in tokens:
            add = tok[2] + (space if line_w > 0 else 0)
            if line_w > 0 and line_w + add > max_w:
                lines.append([])
                line_w = add = tok[2]
            lines[-1].append(tok)
            line_w += add
        widths = [sum(t[2] for t in ln) + space * max(0, len(ln) - 1)
                  for ln in lines]

        pad_x, pad_y = 14, 11
        pw = max(widths) + pad_x * 2
        ph = line_h * len(lines) + pad_y * 2
        pill = pygame.Surface((pw, ph), pygame.SRCALPHA)
        pill.blit(rounded_fill(pw, ph,
                               buttons_mod._brighten(self._palette['panel'],
                                                     32), 12), (0, 0))
        pill.blit(rounded_border(pw, ph,
                                 buttons_mod._brighten(self._palette['panel'],
                                                       64), 12, 1), (0, 0))
        for li, ln in enumerate(lines):
            x = pad_x
            cy = pad_y + li * line_h + line_h // 2
            for kind, val, w in ln:
                if kind == 'cell':
                    pill.blit(self._tooltip_tile(val), (x, cy - tile // 2))
                else:
                    img = font.render(val, True, self._palette['text'])
                    pill.blit(img, (x, cy - img.get_height() // 2))
                x += w + space
        # semi-transparent so the cells it highlights stay readable beneath it
        pill.set_alpha(224)
        grect = group[0].rect.union(group[-1].rect)
        if PORTRAIT:
            # clues live at the bottom, so float the tooltip ABOVE the group
            # (over the board) instead of beside it, where it would cover the
            # neighbouring clues
            tx = max(8, min(CANVAS_WIDTH - pw - 8, grect.centerx - pw // 2))
            ty = max(8, grect.top - ph - 12)
        else:
            tx = max(8, grect.left - 14 - pw)
            ty = max(8, min(CANVAS_HEIGHT - ph - 8, grect.centery - ph // 2))
        surface.blit(pill, (tx, ty))

    def _draw_hint(self, surface):
        """A red pulsing ring on the candidate the hint points at popping,
        plus a matching frame around the clue that justifies the move. It stays
        until the player's next move clears ``_hint_btn``."""
        if self._hint_btn is None:
            return
        accent = (240, 96, 96)
        r = self._hint_btn.rect
        p = 0.5 + 0.5 * math.sin(self._clock * 7.0)
        ring = r.inflate(8 + 6 * p, 8 + 6 * p)
        surface.blit(rounded_border(ring.w, ring.h, accent,
                                    max(5, ring.h // 3), 3), ring.topleft)
        label = ('pop this one' if self._hint_group is None
                 else 'pop this — see the clue')
        img = self._font_hint.render(label, True, (28, 24, 22))
        pad_x, pad_y = (12, 8) if PORTRAIT else (7, 4)
        pw, ph = img.get_width() + pad_x * 2, img.get_height() + pad_y * 2
        pill = pygame.Surface((pw, ph), pygame.SRCALPHA)
        pill.blit(rounded_fill(pw, ph, accent, ph // 2), (0, 0))
        pill.blit(img, (pad_x, pad_y))
        px = max(4, min(CANVAS_WIDTH - pw - 4, r.centerx - pw // 2))
        py = max(4, r.top - ph - 10)
        surface.blit(pill, (px, py))
        # ring the rule group too
        if (self._hint_group is not None
                and 0 <= self._hint_group < len(self._rules_buttons)):
            group = self._rules_buttons[self._hint_group]
            gr = group[0].rect.union(group[-1].rect).inflate(10 + 4 * p,
                                                              10 + 4 * p)
            surface.blit(rounded_border(gr.w, gr.h, accent,
                                        max(6, gr.h // 3), 3), gr.topleft)

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

    def _draw_press_fill(self, surface):
        """A radial fill ring growing around a tile held for a long-press;
        completing the ring 'defines' the cell."""
        if self._press is None:
            return
        p = clamp01(self._press['t'] / self.LONGPRESS_DUR)
        if p <= 0.01:
            return
        r = self._press['btn'].rect
        accent = self._palette['accent']
        pad = 6
        width = 4
        d = max(r.w, r.h) + pad * 2
        surf = pygame.Surface((d, d), pygame.SRCALPHA)
        cx = cy = d // 2
        rad = d // 2 - width
        # faint full track, then the bright sweeping arc drawn on top
        pygame.draw.circle(surf, (*accent, 55), (cx, cy), rad, width)
        steps = max(2, int(p * 72))
        for i in range(steps + 1):
            a = -math.pi / 2 + 2.0 * math.pi * p * (i / steps)
            x = cx + rad * math.cos(a)
            y = cy + rad * math.sin(a)
            pygame.draw.circle(surf, (*accent, 240), (int(x), int(y)), width)
        surface.blit(surf, (r.centerx - cx, r.centery - cy))

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

    # ----------------------- candidate / value helpers -------------------

    def _value_at_cell(self, y, x, n):
        """Is value `n` still a possibility at board cell (y, x)?"""
        cell = self._cells[y][x]
        if cell is None:
            big = self._big_cells.get((y, x))
            return big is not None and big.n == n
        return any(b.n == n for b in cell)

    def _candidate_button(self, y, x, n):
        """The still-on-board candidate button for value `n` at (y, x), or
        None if the cell is solved or the value is no longer a candidate."""
        cell = self._cells[y][x]
        if not isinstance(cell, list):
            return None
        for btn in cell:
            if btn.n == n:
                return btn
        return None

    def _value_solved(self, n):
        return any(b.n == n for b in self._big_buttons)

    def _value_columns(self, n):
        """Columns where value `n` is still possible in its row."""
        y = n // 10 - 1
        if not (0 <= y < self._size):
            return []
        return [x for x in range(self._size)
                if self._value_at_cell(y, x, n)]

    # ----------------------- rule satisfaction --------------------------

    def _rule_satisfied(self, values):
        """A displayed clue is 'satisfied' once every value it references is
        in a solved big cell — the constraint is then concrete and the clue
        cannot teach anything more, so we auto-dim it."""
        for v in values:
            if not isinstance(v, int):
                continue
            if not self._value_solved(v):
                return False
        return True

    def auto_dim_satisfied_rules(self):
        """Press any clue whose constraint is now satisfied. Called by the
        presenter after every cell change so the clue panel reflects the
        current state without the player having to crossed-out clues by
        hand."""
        any_change = False
        for group in self._rules_buttons:
            if group[0].pressed:
                continue
            values = tuple(sub.value for sub in group)
            if self._rule_satisfied(values):
                for sub in group:
                    sub.pressed = True
                    sub.change_color()
                any_change = True
        return any_change

    # ----------------------- hint finder --------------------------------

    def _rule_eliminates(self, group_index, values):
        """For a clue, find a still-active candidate it forbids.

        Returns ``(hint_btn, group_index)`` or ``None``. The clue stays in
        the rules-panel highlight (its three sub-buttons) so the player sees
        *why* the candidate can go."""
        a, b, c = values
        # 'A is in the same column as C'
        if b == '^' and isinstance(a, int) and isinstance(c, int):
            ya, yc = a // 10 - 1, c // 10 - 1
            for x in range(self._size):
                if not self._value_at_cell(ya, x, a):
                    btn = self._candidate_button(yc, x, c)
                    if btn is not None:
                        return btn, group_index
                if not self._value_at_cell(yc, x, c):
                    btn = self._candidate_button(ya, x, a)
                    if btn is not None:
                        return btn, group_index
            return None
        # 'A and C are in neighbouring columns'
        if b == '<->' and isinstance(a, int) and isinstance(c, int):
            ya, yc = a // 10 - 1, c // 10 - 1
            for x in range(self._size):
                if self._value_at_cell(ya, x, a):
                    has_neighbour = ((x > 0 and self._value_at_cell(yc, x - 1, c))
                                     or (x < self._size - 1
                                         and self._value_at_cell(yc, x + 1, c)))
                    if not has_neighbour:
                        btn = self._candidate_button(ya, x, a)
                        if btn is not None:
                            return btn, group_index
                if self._value_at_cell(yc, x, c):
                    has_neighbour = ((x > 0 and self._value_at_cell(ya, x - 1, a))
                                     or (x < self._size - 1
                                         and self._value_at_cell(ya, x + 1, a)))
                    if not has_neighbour:
                        btn = self._candidate_button(yc, x, c)
                        if btn is not None:
                            return btn, group_index
            return None
        # 'A is left of C'
        if b == '...' and isinstance(a, int) and isinstance(c, int):
            a_cols = self._value_columns(a)
            c_cols = self._value_columns(c)
            if not a_cols or not c_cols:
                return None
            min_c = min(c_cols)
            max_a = max(a_cols)
            # any A at column >= max-C-allowed cannot satisfy A < C
            for x in a_cols:
                if x >= max(c_cols):
                    btn = self._candidate_button(a // 10 - 1, x, a)
                    if btn is not None:
                        return btn, group_index
            for x in c_cols:
                if x <= min_c and x <= min(a_cols):
                    # symmetric: C cannot be at the leftmost possible A
                    btn = self._candidate_button(c // 10 - 1, x, c)
                    if btn is not None:
                        return btn, group_index
            # at the very least: A cannot be at the rightmost column when C
            # has no column to its right; C cannot be at the leftmost when A
            # has no column to its left
            last = self._size - 1
            if last in a_cols and last in c_cols and len(c_cols) == 1:
                btn = self._candidate_button(a // 10 - 1, last, a)
                if btn is not None:
                    return btn, group_index
            if 0 in c_cols and 0 in a_cols and len(a_cols) == 1:
                btn = self._candidate_button(c // 10 - 1, 0, c)
                if btn is not None:
                    return btn, group_index
            return None
        # triple [A, B, C] — three consecutive columns, either direction.
        # The full elimination logic is fiddly, so lean on the known answer:
        # point at a still-active candidate of one of the three values that
        # the solution rules out, with this triple clue ringed as the reason.
        if (isinstance(a, int) and isinstance(b, int) and isinstance(c, int)
                and self._solution is not None):
            for v in (a, b, c):
                y = v // 10 - 1
                for x in range(self._size):
                    btn = self._candidate_button(y, x, v)
                    if btn is not None and self._solution[y][x] != v:
                        return btn, group_index
        return None

    def find_hint_target(self, _model=None):
        """Return a still-active clue and a candidate that the clue forbids
        (``(field_btn, group_index)``) or None if no rule can fire right now.

        Unlike the old hint (which spoiled the answer of a random cell), this
        one names the clue the player should be reading — they still have to
        understand the deduction, the hint just nudges them toward it.
        """
        for gi, group in enumerate(self._rules_buttons):
            if group[0].pressed:                       # already crossed out
                continue
            values = tuple(sub.value for sub in group)
            if self._rule_satisfied(values):
                continue
            result = self._rule_eliminates(gi, values)
            if result is not None:
                return result
        # No clue fired a clean elimination (e.g. only triple clues remain, or
        # the next step needs deeper reasoning). Fall back to the answer grid so
        # the button always helps: ring any candidate the solution rules out.
        # Returns (btn, None) — a clue-less "safe pop".
        return self._solution_hint()

    def _solution_hint(self):
        """A guaranteed-safe candidate to pop, derived from the known answer.
        Used when no displayed clue yields a clean elimination."""
        if self._solution is None:
            return None
        for y in range(self._size):
            for x in range(self._size):
                cell = self._cells[y][x]
                if not (isinstance(cell, list) and len(cell) > 1):
                    continue
                try:
                    correct = self._solution[y][x]
                except (IndexError, TypeError, KeyError):
                    continue
                for b in cell:
                    if b.n != correct:
                        return b, None
        return None

    def _on_hint_pressed(self):
        """The player asked for a hint. Find a deducible candidate and ring it
        together with its clue; if nothing is deducible right now, say so."""
        if self._overlay is not None:
            return
        self._play('click')
        target = self.find_hint_target()
        if target is not None:
            self.show_hint(target)
            if self.on_hint:
                self.on_hint()
        else:
            self._result_text = 'no hint right now — keep going!'
            self._bump_message()

    def show_hint(self, target):
        """Highlight a candidate to pop together with the clue that justifies
        it. `target` is a (FieldButton, rule_group_index) tuple as returned
        by ``find_hint_target``. The highlight persists until the next move."""
        if target is None:
            return
        btn, group_index = target
        self._hint_btn = btn
        self._hint_group = group_index
        self._idle_t = 0.0
        self._play('spread')

    def _update_hint_button(self, dt):
        """Show the HINT button when it is on offer (Zen always; Easy/Normal
        once the idle window has elapsed) and animate it while visible."""
        if self._hint_button is None:
            return
        self._hint_button.visible = (not self._tutorial
                                     and (self._zen or self._hint_offered))
        if self._hint_button.visible:
            self._hint_button.update(dt, self._mouse_pos)

    def set_idle_hint_delay(self, seconds):
        """The presenter calls this with 20s on Easy, 40s on Normal, or
        None on Hard (the HINT button is then never offered by idling).
        Tutorial mode passes None as well."""
        self._idle_hint_delay = seconds
        self._idle_t = 0.0

    def reset_idle(self):
        """Player just made a move — restart the idle clock."""
        self._idle_t = 0.0
        # do not clear an already-visible hint; the player may need a moment
        # to read it after the action that triggered it

    def _tick_idle_hint(self, dt):
        """Bump the idle clock; once it crosses the difficulty-set threshold,
        offer the HINT button (it then stays available for the rest of the
        round). The hint itself is no longer applied automatically — the
        player decides whether to press the button.

        While an overlay is up, the timer is parked — opening the menu must
        not count as "thinking". Zen always shows the button, so it skips the
        idle clock entirely."""
        if (self._tutorial or self._zen
                or self._idle_hint_delay is None
                or self._hint_offered
                or self._overlay is not None
                or self._cascade_time < self._cascade_duration):
            return
        self._idle_t += dt
        if self._idle_t >= self._idle_hint_delay:
            self._hint_offered = True
