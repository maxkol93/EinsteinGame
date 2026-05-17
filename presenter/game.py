import asyncio
import os

import pygame

from view.window import GameWindow, CANVAS_WIDTH, CANVAS_HEIGHT
from view.ui import LoadingScreen
from view.sounds import SoundManager
from view.palettes import get_palette
from model.field_and_rules import FieldAndRules
from model.timer import Timer


# screen states
LOADING = 'loading'
MENU = 'menu'
PLAYING = 'playing'
WIN = 'win'
LOSE = 'lose'

DEFAULT_LIVES = 3
FIELD_CELLS = 36

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

        self._state = LOADING
        self._complexity = 20
        try:
            self._max_lives = max(1, int(os.environ.get('EINSTEIN_LIVES',
                                                        DEFAULT_LIVES)))
        except ValueError:
            self._max_lives = DEFAULT_LIVES
        self._lives = self._max_lives

        self._pending_restart = False
        self._pending_complexity = None
        self._running = True

    # ------------------------------------------------------------------
    async def run(self, complexity=20):
        self._complexity = complexity
        self._screen = pygame.display.get_surface()
        if self._screen is None:
            self._screen = pygame.display.set_mode((CANVAS_WIDTH,
                                                    CANVAS_HEIGHT))
        pygame.display.set_caption('Einstein game')

        self._sounds = SoundManager()
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

    # ------------------------- round lifecycle ------------------------

    def _enter_game(self):
        self._init_round(self._complexity)
        self._view.open_menu()
        self._state = MENU

    def _init_round(self, complexity):
        self._complexity = complexity
        self._lives = self._max_lives
        self._model = FieldAndRules(complexity)
        displayable_rules = self._model.rules[
            self._model.defined_start_cells_count:]
        self._view = GameWindow(displayable_rules,
                                palette_name=self._palette_name,
                                sounds=self._sounds, complexity=complexity)
        self._view.change_complexity(complexity)
        self._view.define_start_cells(self._model.defined_start_cells)
        self._view.set_lives(self._max_lives)
        self._view.on_field_click = self._on_field_click
        self._view.on_rule_click = self._on_rule_click
        self._view.on_continue = self._on_continue
        self._view.on_restart = self._on_restart
        self._view.on_mode_select = self._on_mode_select
        self._view.on_open_menu = self._on_open_menu
        self._view.on_volume = self._on_volume
        self._timer = Timer(self._view.timer_update, self._on_game_over)
        self._timer.start()
        self._play('start')

    def _update(self, dt):
        if self._state == PLAYING:
            self._timer.tick(dt)
        self._view.tick(dt)

        if self._pending_restart:
            self._pending_restart = False
            self._init_round(self._complexity)
            self._state = PLAYING
        elif self._pending_complexity is not None:
            nxt = self._pending_complexity
            self._pending_complexity = None
            self._init_round(nxt)
            self._state = PLAYING

    # ---------------------------- input -------------------------------

    def _handle_event(self, event):
        if event.type == pygame.KEYDOWN:
            if event.key == pygame.K_ESCAPE:
                self._toggle_menu()
                return
            if event.key in (pygame.K_l, pygame.K_PLUS, pygame.K_EQUALS,
                              pygame.K_KP_PLUS):
                self._debug_add_life()
                return
        if self._view is not None:
            self._view.handle_event(event)

    def _toggle_menu(self):
        if self._state == PLAYING:
            self._open_menu()
        elif self._state == MENU:
            self._view.close_overlay()
            self._state = PLAYING

    def _open_menu(self):
        self._state = MENU
        self._view.open_menu()

    def _debug_add_life(self):
        self._max_lives += 1
        self._lives += 1
        if self._view is not None:
            self._view.add_life()

    # --------------------------- callbacks ----------------------------

    def _on_field_click(self, btn):
        if self._state != PLAYING:
            return
        # If the model says this number IS the answer for the cell, the
        # player wrongly removed the correct candidate.
        if self._model[btn.y][btn.x] == btn.n:
            self._lives -= 1
            self._view.wrong_feedback(btn)
            self._view.damage_life()
            self._play('wrong')
            if self._lives <= 0:
                self._finish_round(won=False)
            else:
                self._view.set_massage('wrong', self._lives)
        else:
            self._view.set_massage('good')
            self._view.remove_button(btn)
            if self._view.defined_cells_count == FIELD_CELLS:
                self._finish_round(won=True)

    def _on_rule_click(self, btn):
        if self._state == PLAYING:
            self._view.disable_rule_buttons(btn, btn.index)

    def _finish_round(self, won):
        self._timer.stop_timer()  # fires _on_game_over -> disables the board
        if won:
            self._state = WIN
            self._view.set_timer_mood(True)
            self._view.show_win()
            self._play('win')
        else:
            self._state = LOSE
            self._view.set_timer_mood(False)
            self._view.show_lose()
            self._play('lose')

    def _on_game_over(self):
        self._view.disable_buttons()

    def _on_continue(self):
        self._state = PLAYING

    def _on_restart(self):
        self._pending_restart = True

    def _on_mode_select(self, complexity):
        self._complexity = complexity
        self._pending_complexity = complexity

    def _on_open_menu(self):
        self._open_menu()

    def _on_volume(self, value):
        if self._sounds is not None:
            self._sounds.set_volume(value)

    # ----------------------------- util -------------------------------

    def _play(self, key):
        if self._sounds is not None:
            self._sounds.play(key)
