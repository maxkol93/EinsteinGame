import asyncio
import os
import random

import pygame

from view.window import GameWindow, CANVAS_WIDTH, CANVAS_HEIGHT
from view.ui import LoadingScreen
from view.sounds import SoundManager
from view.palettes import get_palette
from view.clipboard import copy_to_clipboard
from model.field_and_rules import FieldAndRules
from model.timer import Timer
from model.stats import Stats, score_and_stars, par_time
from model.settings import Settings, TUTORIAL_BLOCKS
from model.tutorial import TutorialDirector, GOAL_HINT
from model import achievements
from model.daily import daily_config


# screen states
LOADING = 'loading'
MENU = 'menu'
PLAYING = 'playing'
WIN = 'win'
LOSE = 'lose'

DEFAULT_LIVES = 3

# Seconds the board ignores further taps after a wrong click — long enough to
# stop a frustrated player machine-gunning mistakes (and machine-gunning the
# 'wrong' sound with them), short enough not to feel like a lockout.
WRONG_COOLDOWN = 0.35

_DIFF_KEY = {0: 'easy', 1: 'normal', 2: 'hard'}

# Pre-defined start-cell count per (board size, difficulty index). Easy hands
# the player a big head start; Hard reveals nothing.
_COMPLEXITY = {
    3: (4, 2, 0),
    4: (9, 4, 0),
    5: (14, 7, 0),
    6: (20, 10, 0),
}

_SIZE_LABEL = {3: 'Quick 3×3', 4: '4×4', 5: '5×5', 6: '6×6'}
_DIFF_LABEL = {0: 'Easy', 1: 'Normal', 2: 'Hard'}

# titles shown on the tutorial win plaque, keyed by complete_level() outcome
_TUT_TITLE = {
    'level': 'LEVEL CLEARED',
    'reset': 'TRY AGAIN',
    'block': 'BLOCK CLEARED',
    'replay': 'BLOCK CLEARED',
    'tutorial': 'TUTORIAL COMPLETE',
}

_FONTS_DIR = os.path.join(
    os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
    'view', 'fonts')


class Game(object):
    def __init__(self, palette_name='mocha'):
        self._palette_name = palette_name
        self._model = None
        self._view = None
        self._timer = None
        self._sounds = None
        self._loading = None
        self._screen = None
        self._stats = None
        self._settings = None

        self._state = LOADING
        # 'normal' is the real game; 'tutorial' is the 6-block onboarding
        self._mode = 'normal'
        self._tutorial = None        # TutorialDirector while onboarding
        self._level = None           # the current TutorialLevel
        # selected mode (menu) vs. the mode the live board was built with
        self._difficulty = 0
        self._size = 6
        self._active_difficulty = 0
        self._active_size = 6
        try:
            self._max_lives = max(1, int(os.environ.get('EINSTEIN_LIVES',
                                                        DEFAULT_LIVES)))
        except ValueError:
            self._max_lives = DEFAULT_LIVES
        self._lives = self._max_lives
        self._mistakes = 0
        self._hints = 0
        self._wrong_cooldown = 0.0

        # board reproducibility + run flavour
        self._board_seed = None
        self._is_daily = False
        self._daily_cfg = None
        self._zen = False
        self._last_result = None     # the win/lose summary for the share line

        self._pending_round = None   # kwargs for the next _init_round, or None
        self._pending = None         # a deferred action run on the next frame
        self._running = True

    # ------------------------------------------------------------------
    async def run(self):
        self._screen = pygame.display.get_surface()
        if self._screen is None:
            self._screen = pygame.display.set_mode((CANVAS_WIDTH,
                                                    CANVAS_HEIGHT))
        pygame.display.set_caption('Einstein game')

        self._sounds = SoundManager()
        self._stats = Stats()
        self._settings = Settings()
        self._apply_settings()
        self._loading = LoadingScreen(_FONTS_DIR,
                                      get_palette(self._palette_name))

        clock = pygame.time.Clock()
        while self._running:
            dt = clock.tick(60)
            for event in pygame.event.get():
                if event.type == pygame.QUIT:
                    self._running = False
                    break
                if self._state != LOADING:
                    self._handle_event(event)
            if not self._running:
                break

            if self._state == LOADING:
                self._loading.update(dt / 1000.0)
                self._loading.draw(self._screen)
                if self._loading.finished:
                    self._enter_game()
            else:
                self._update(dt)
                self._view.draw()

            pygame.display.flip()
            await asyncio.sleep(0)

    def _apply_settings(self):
        """Pull saved preferences into the live game state."""
        s = self._settings
        if s is None:
            return
        self._palette_name = s.get('palette')
        self._difficulty = s.get('difficulty')
        self._size = s.get('size')
        self._zen = bool(s.get('zen'))
        if self._sounds is not None:
            self._sounds.set_volume(s.get('volume'))

    # ------------------------- round lifecycle ------------------------

    def _enter_game(self):
        """First entry after the loading splash: straight into the tutorial
        if it is not finished, otherwise the normal menu."""
        blocks = (self._settings.get('tutorial_blocks')
                  if self._settings is not None else TUTORIAL_BLOCKS)
        self._tutorial = TutorialDirector(blocks)
        if self._tutorial.all_done:
            self._mode = 'normal'
            self._init_round()
            self._view.open_menu(daily=self._daily_status())
            self._state = MENU
        else:
            self._mode = 'tutorial'
            self._init_tutorial_round()

    def _wire_hooks(self):
        """Point the freshly-built view's callbacks back at the presenter."""
        v = self._view
        v.on_field_click = self._on_field_click
        v.on_field_define = self._on_field_define
        v.on_rule_click = self._on_rule_click
        v.on_continue = self._on_continue
        v.on_restart = self._on_restart
        v.on_retry = self._on_retry
        v.on_daily = self._on_daily
        v.on_achievements = self._on_achievements
        v.on_share = self._on_share
        v.on_mode_select = self._on_mode_select
        v.on_size_select = self._on_size_select
        v.on_open_menu = self._on_open_menu
        v.on_volume = self._on_volume
        v.on_tooltips = self._on_tooltips
        v.on_touch = self._on_touch
        v.on_zen = self._on_zen
        v.on_theme = self._on_theme
        v.on_hint = self._on_hint
        v.on_block_replay = self._on_block_replay

    def _init_round(self, seed=None, daily=None):
        """Build a normal game board.

        `seed` reproduces an exact board (used by Retry); `daily` is a
        Daily-Puzzle config dict that fixes size, difficulty and seed."""
        self._mode = 'normal'
        self._daily_cfg = daily
        self._is_daily = daily is not None
        if daily is not None:
            self._active_difficulty = daily['difficulty']
            self._active_size = daily['size']
            seed = daily['seed']
        else:
            self._active_difficulty = self._difficulty
            self._active_size = self._size
        if seed is None:
            seed = random.randrange(1, 2 ** 31)
        self._board_seed = seed
        # the Daily Puzzle is a fixed challenge — Zen never applies to it
        self._zen = bool(self._settings.get('zen')) if (
            self._settings is not None and not self._is_daily) else False
        self._lives = self._max_lives
        self._mistakes = 0
        self._hints = 0
        complexity = _COMPLEXITY[self._active_size][self._active_difficulty]
        self._model = FieldAndRules(complexity, size=self._active_size,
                                    seed=seed)
        displayable_rules = self._model.rules[
            self._model.defined_start_cells_count:]
        self._view = GameWindow(displayable_rules,
                                palette_name=self._palette_name,
                                sounds=self._sounds,
                                difficulty=self._active_difficulty,
                                size=self._active_size, zen=self._zen)
        self._view.define_start_cells(self._model.defined_start_cells)
        self._view.set_lives(self._max_lives)
        # the menu selectors mirror the player's saved choice; the MODE
        # footer names whatever this particular board actually is
        self._view.set_difficulty(self._difficulty)
        self._view.set_sel_size(self._size)
        self._view.set_mode_label(self._mode_label())
        if self._stats is not None:
            self._view.set_stats(self._stats.summary())
        self._wire_hooks()
        if self._settings is not None:
            self._view.set_tooltips(self._settings.get('tooltips'))
            self._view.set_touch(self._settings.get('touch'))
        self._timer = Timer(self._view.timer_update, self._on_game_over)
        self._timer.start()
        self._play('start')

    def _init_tutorial_round(self):
        """Build the 3x3 board for the tutorial's current block/level."""
        self._mode = 'tutorial'
        self._model = None
        self._timer = None
        self._level = self._tutorial.current_level()
        self._active_size = self._level.size
        self._view = GameWindow(list(self._level.clues),
                                palette_name=self._palette_name,
                                sounds=self._sounds, size=self._level.size,
                                tutorial=True)
        self._view.define_start_cells(self._level.defined_cells)
        self._wire_hooks()
        self._view.set_tutorial_progress(self._tutorial.tracker(),
                                         self._tutorial.block_name())
        if self._settings is not None:
            self._view.set_tooltips(self._settings.get('tooltips'))
            self._view.set_touch(self._settings.get('touch'))
        self._state = PLAYING
        self._play('start')
        intro = self._tutorial.intro_text()
        if intro:
            spot = (self._view.clues_rect()
                    if self._tutorial.block == 1 else None)
            label = "Let's play!" if self._tutorial.block == 0 else 'Got it'
            self._view.show_popup(intro, button_label=label, tag='TUTORIAL',
                                  spotlight=spot)

    def _update(self, dt):
        if self._pending is not None:
            action = self._pending
            self._pending = None
            action()
        if self._wrong_cooldown > 0.0:
            self._wrong_cooldown = max(0.0, self._wrong_cooldown
                                       - dt / 1000.0)
        if (self._state == PLAYING and self._mode == 'normal'
                and self._timer is not None):
            self._timer.tick(dt)
        self._view.tick(dt)

        if self._pending_round is not None:
            kwargs = self._pending_round
            self._pending_round = None
            self._init_round(**kwargs)
            self._state = PLAYING

    def _queue(self, action):
        """Defer an action (a view rebuild) to the next frame, out of the
        middle of overlay event handling."""
        self._pending = action

    # ---------------------------- input -------------------------------

    def _handle_event(self, event):
        if event.type == pygame.KEYDOWN:
            if event.key == pygame.K_ESCAPE:
                self._toggle_menu()
                return
            if self._mode == 'normal' and event.key in (
                    pygame.K_l, pygame.K_PLUS, pygame.K_EQUALS,
                    pygame.K_KP_PLUS):
                self._debug_add_life()
                return
        if self._view is not None:
            self._view.handle_event(event)

    def _toggle_menu(self):
        if self._state == PLAYING:
            # a popup (intro / teaching note) is up — let it be
            if self._view is not None and self._view.overlay_active:
                return
            self._open_menu()
        elif self._state == MENU:
            # a menu opened over a finished round has no live board to
            # return to — Esc must not drop the player onto a dead board
            if self._view is not None and self._view.menu_finished:
                return
            self._view.close_overlay()
            self._state = PLAYING

    def _open_menu(self):
        was_finished = self._state in (WIN, LOSE)
        self._state = MENU
        if self._mode == 'tutorial':
            self._view.open_tutorial_menu(self._tutorial.tracker(), {
                'continue': self._tutorial_menu_continue,
                'restart': self._tutorial_restart,
                'skip': self._tutorial_skip,
                'volume': self._on_volume,
            })
        else:
            if self._stats is not None and self._view is not None:
                self._view.set_stats(self._stats.summary())
            self._view.open_menu(finished=was_finished,
                                 daily=self._daily_status())

    def _daily_status(self):
        """The Daily-Puzzle state the menu shows on its Daily button."""
        cfg = daily_config()
        daily = self._stats.daily() if self._stats is not None else {}
        return {'number': cfg['number'],
                'done': daily.get('last') == cfg['day'],
                'streak': daily.get('streak', 0)}

    def _debug_add_life(self):
        self._max_lives += 1
        self._lives += 1
        if self._view is not None:
            self._view.add_life()

    # --------------------------- callbacks ----------------------------

    def _on_field_click(self, btn):
        if self._state != PLAYING or self._wrong_cooldown > 0.0:
            return
        if self._mode == 'tutorial':
            self._tutorial_field_click(btn)
            return
        # If the model says this number IS the answer for the cell, the
        # player wrongly removed the correct candidate.
        if self._model[btn.y][btn.x] == btn.n:
            self._register_wrong(btn)
        else:
            self._view.set_massage('good')
            self._view.remove_button(btn)
            if self._view.defined_cells_count == self._active_size ** 2:
                self._finish_round(won=True)

    def _register_wrong(self, btn):
        """Shared wrong-click outcome: react and start a cooldown. A normal
        round loses a life (and may end); in Zen the run can never end."""
        self._mistakes += 1
        self._view.wrong_feedback(btn)
        self._play('wrong')
        self._wrong_cooldown = WRONG_COOLDOWN
        if self._zen:
            self._view.set_massage('wrong', None)
            return
        self._lives -= 1
        self._view.damage_life()
        if self._lives <= 0:
            self._finish_round(won=False)
        else:
            self._view.set_massage('wrong', self._lives)

    def _on_field_define(self, btn):
        """A long-press 'define': the player asserts this candidate is the
        cell's answer, so every other candidate in the cell is cleared."""
        if self._state != PLAYING or self._wrong_cooldown > 0.0:
            return
        if self._mode == 'tutorial':
            self._tutorial_field_define(btn)
            return
        if self._model[btn.y][btn.x] == btn.n:
            self._view.set_massage('good')
            self._view.define_cell(btn)
            if self._view.defined_cells_count == self._active_size ** 2:
                self._finish_round(won=True)
        else:
            # asserting the wrong candidate would wipe the real answer — it
            # counts exactly as wrong as popping the correct candidate
            self._register_wrong(btn)

    def _on_rule_click(self, btn):
        if self._state == PLAYING:
            self._view.disable_rule_buttons(btn, btn.index)

    def _on_hint(self):
        if self._state != PLAYING or self._model is None:
            return
        btn = self._view.find_hint_target(self._model)
        if btn is not None:
            self._hints += 1
            self._view.show_hint(btn)

    def _finish_round(self, won):
        self._timer.stop_timer()  # fires _on_game_over -> disables the board
        seconds = self._timer.value
        if won:
            self._state = WIN
            score, stars = score_and_stars(self._active_size,
                                           self._active_difficulty, seconds,
                                           self._mistakes, self._hints)
            best_score = score
            badges = []
            if self._stats is not None:
                self._stats.record_win(self._active_difficulty, seconds,
                                       score, stars,
                                       count_streak=not self._zen)
                if self._is_daily and self._daily_cfg is not None:
                    self._stats.record_daily(self._daily_cfg['day'])
                key = _DIFF_KEY.get(self._active_difficulty, 'easy')
                best_score = self._stats.summary().get(key, {}).get(
                    'best_score', score)
                badges = self._grant_achievements(won=True, seconds=seconds,
                                                  stars=stars)
            self._last_result = {'seconds': seconds, 'stars': stars,
                                 'score': score}
            self._view.set_timer_mood(True)
            self._view.set_stats(self._stats.summary() if self._stats else {})
            self._view.show_win(stars=stars, score=score,
                                best_score=best_score, badges=badges,
                                daily=self._daily_label())
            self._play('win')
        else:
            self._state = LOSE
            if self._stats is not None:
                self._stats.record_loss(self._active_difficulty)
            self._last_result = None
            self._view.set_timer_mood(False)
            self._view.show_lose()
            self._play('lose')

    def _grant_achievements(self, won, seconds=0, stars=0):
        """Evaluate and persist achievements; return the freshly-earned names
        for the win plaque to celebrate."""
        if self._stats is None:
            return []
        ctx = {
            'won': won,
            'total_wins': self._stats.total_wins,
            'mistakes': self._mistakes,
            'hints': self._hints,
            'stars': stars,
            'seconds': seconds,
            'par': par_time(self._active_size, self._active_difficulty),
            'size': self._active_size,
            'difficulty': self._active_difficulty,
            'zen': self._zen,
            'win_streak': self._stats.win_streak,
            'daily_streak': self._stats.daily().get('streak', 0),
            'tutorial_done': bool(self._tutorial and self._tutorial.all_done),
        }
        fresh = self._stats.unlock(achievements.evaluate(ctx))
        return [achievements.info(i)[0] for i in fresh]

    def _daily_label(self):
        if self._is_daily and self._daily_cfg is not None:
            return 'Daily #%d' % self._daily_cfg['number']
        return None

    def _mode_label(self):
        """The left-panel MODE footer for the live board."""
        sz = '%d×%d' % (self._active_size, self._active_size)
        if self._is_daily and self._daily_cfg is not None:
            return 'DAILY #%d  ·  %s' % (self._daily_cfg['number'], sz)
        if self._zen:
            return 'ZEN  ·  %s' % sz
        return '%s  ·  %s' % (
            _DIFF_LABEL.get(self._active_difficulty, '').upper(), sz)

    def _on_game_over(self):
        self._view.disable_buttons()

    def _on_continue(self):
        self._state = PLAYING

    def _on_restart(self):
        """Deal a fresh board (a new random seed; leaves Daily mode)."""
        self._pending_round = {}

    def _on_retry(self):
        """Replay the exact same board — same seed, same Daily config."""
        self._pending_round = {'seed': self._board_seed,
                               'daily': self._daily_cfg}

    def _on_daily(self):
        """Start (or replay) today's Daily Puzzle."""
        self._pending_round = {'daily': daily_config()}

    def _on_achievements(self):
        if self._view is not None and self._stats is not None:
            self._view.open_achievements(self._stats.achievements,
                                         self._stats.summary())

    def _on_zen(self, enabled):
        self._zen = bool(enabled)
        if self._settings is not None:
            self._settings.set('zen', bool(enabled))

    def _on_share(self):
        """Copy a spoiler-free result line to the clipboard."""
        if self._last_result is None:
            return
        r = self._last_result
        size = self._active_size
        board = _SIZE_LABEL.get(size, '%dx%d' % (size, size))
        tag = (self._daily_label()
               or '%s %s' % (board, _DIFF_LABEL.get(self._active_difficulty,
                                                    '')))
        mins, secs = r['seconds'] // 60, r['seconds'] % 60
        stars = '★' * r['stars'] + '☆' * (3 - r['stars'])
        text = 'Einstein — %s\n%s  %d:%02d  ·  %d pts' % (
            tag.strip(), stars, mins, secs, r['score'])
        copy_to_clipboard(text)

    def _on_mode_select(self, difficulty):
        # Only switch the selected difficulty — the new field is generated on
        # the next Restart.
        self._difficulty = difficulty
        if self._view is not None:
            self._view.set_difficulty(difficulty)
        if self._settings is not None:
            self._settings.set('difficulty', difficulty)

    def _on_size_select(self, size):
        # Likewise: the board only changes geometry on the next Restart.
        self._size = size
        if self._view is not None:
            self._view.set_sel_size(size)
        if self._settings is not None:
            self._settings.set('size', size)

    def _on_open_menu(self):
        self._open_menu()

    def _on_volume(self, value):
        if self._sounds is not None:
            self._sounds.set_volume(value)
        if self._settings is not None:
            self._settings.set('volume', float(value))

    def _on_tooltips(self, enabled):
        if self._settings is not None:
            self._settings.set('tooltips', bool(enabled))

    def _on_touch(self, enabled):
        if self._settings is not None:
            self._settings.set('touch', bool(enabled))

    def _on_theme(self, palette_name):
        self._palette_name = palette_name
        if self._settings is not None:
            self._settings.set('palette', palette_name)

    # --------------------------- tutorial -----------------------------

    def _tutorial_field_click(self, btn):
        """A board click during the onboarding — never costs a life, but in
        a logic block a wrong removal resets the block."""
        level = self._level
        if not level.free and level.solution[btn.y][btn.x] == btn.n:
            self._tutorial_mistake(btn)       # removed the correct candidate
            return
        self._view.remove_button(btn)
        if self._view.defined_cells_count == self._active_size ** 2:
            self._finish_tutorial_level()

    def _tutorial_field_define(self, btn):
        """A long-press 'define' during the onboarding."""
        level = self._level
        if not level.free and level.solution[btn.y][btn.x] != btn.n:
            self._tutorial_mistake(btn)       # asserted the wrong candidate
            return
        self._view.define_cell(btn)
        if self._view.defined_cells_count == self._active_size ** 2:
            self._finish_tutorial_level()

    def _tutorial_mistake(self, btn):
        self._view.wrong_feedback(btn)
        self._play('wrong')
        self._wrong_cooldown = WRONG_COOLDOWN
        text = self._tutorial.record_mistake()
        if text is not None:
            self._view.show_popup(text, button_label='Got it', tag='TIP')

    def _finish_tutorial_level(self):
        self._view.disable_buttons()
        result = self._tutorial.complete_level()
        if self._settings is not None:
            self._settings.set('tutorial_blocks', self._tutorial.blocks_done)
        self._state = WIN
        self._play('win')
        outcome = result['outcome']
        message = (result['final'] or result['praise']
                   or result['reminder']
                   or (GOAL_HINT if result['goal_hint'] else None))
        button = 'Menu' if outcome == 'tutorial' else 'Continue'
        self._view.show_tutorial_result(
            _TUT_TITLE[outcome], message, self._tutorial.tracker(),
            button_label=button,
            on_continue=lambda: self._queue(
                lambda: self._advance_tutorial(result)))

    def _advance_tutorial(self, result):
        if result['outcome'] in ('replay', 'tutorial'):
            if result['outcome'] == 'tutorial' and self._stats is not None:
                self._stats.unlock(['tutorial'])
            self._mode = 'normal'
            self._init_round()
            self._view.open_menu(daily=self._daily_status())
            self._state = MENU
        else:
            self._init_tutorial_round()

    def _tutorial_menu_continue(self):
        self._view.close_overlay()
        self._state = PLAYING

    def _tutorial_restart(self):
        self._tutorial.restart_all()
        if self._settings is not None:
            self._settings.set('tutorial_blocks', 0)
        self._queue(self._init_tutorial_round)

    def _tutorial_skip(self):
        self._tutorial.skip_all()
        if self._settings is not None:
            self._settings.set('tutorial_blocks', self._tutorial.blocks_done)
        self._queue(self._enter_normal_after_skip)

    def _enter_normal_after_skip(self):
        self._mode = 'normal'
        self._init_round()
        self._view.open_menu(daily=self._daily_status())
        self._state = MENU

    def _on_block_replay(self, block_index):
        """Post-tutorial: the player picked a block to practise again."""
        self._tutorial.start_replay(block_index)
        self._queue(self._init_tutorial_round)

    # ----------------------------- util -------------------------------

    def _play(self, key):
        if self._sounds is not None:
            self._sounds.play(key)
