import asyncio

import pygame

from view.window import GameWindow
from model.field_and_rules import FieldAndRules
from model.timer import Timer


COMPLEXITY_CYCLE = {20: 10, 10: 0, 0: 20}


class Game(object):
    def __init__(self, palette_name='mocha'):
        self._palette_name = palette_name
        self._model = None
        self._view = None
        self._timer = None
        self._is_game_over = False
        self._count_wrong = 0
        self._complexity = 20
        self._pending_complexity = None
        self._pending_restart = False
        self._running = True

    async def run(self, complexity):
        self._init_round(complexity)
        clock = pygame.time.Clock()
        while self._running:
            dt = clock.tick(60)  # cap at 60 fps; dt in ms

            for event in pygame.event.get():
                if event.type == pygame.QUIT:
                    self._running = False
                    break
                self._view.handle_event(event)

            if not self._is_game_over:
                self._timer.tick(dt)
            self._view.tick(dt)

            if self._pending_restart:
                self._pending_restart = False
                self._init_round(self._complexity)
                clock.tick()
            elif self._pending_complexity is not None:
                next_c = self._pending_complexity
                self._pending_complexity = None
                self._init_round(next_c)
                clock.tick()

            self._view.draw()
            pygame.display.flip()
            await asyncio.sleep(0)

    # --------------------------- round setup -------------------------

    def _init_round(self, complexity):
        self._count_wrong = 0
        self._is_game_over = False
        self._complexity = complexity
        self._model = FieldAndRules(complexity)
        displayable_rules = self._model.rules[self._model.defined_start_cells_count:]
        self._view = GameWindow(displayable_rules, palette_name=self._palette_name)
        self._view.change_complexity(complexity)
        self._view.define_start_cells(self._model.defined_start_cells)
        self._view.set_button_handler(self._on_field_click)
        self._view.set_rules_button_handler(self._on_rule_click)
        self._view.set_restart_handler(self._on_restart)
        self._view.set_complexity_change_handler(self._on_complexity_change)
        self._timer = Timer(self._view.timer_update, self._on_game_over)
        self._timer.start()

    # --------------------------- callbacks ---------------------------

    def _on_field_click(self, btn):
        if self._is_game_over:
            return
        # If model says this number is the answer for the cell, the click is wrong
        if self._model[btn.y][btn.x] == btn.n:
            self._count_wrong += 1
            self._view.wrong_feedback(btn)
            if self._count_wrong == 3:
                self._view.set_massage('loose')
                self._view.timer_font_updane(False)
                self._timer.stop_timer()
            elif self._count_wrong == 2:
                self._view.set_massage('second_wrong')
            elif self._count_wrong == 1:
                self._view.set_massage('first_wrong')
        else:
            self._view.set_massage('good')
            self._view.remove_button(btn)
            if self._view.defined_cells_count == 36:
                self._view.set_massage('win')
                self._view.timer_font_updane(True)
                self._timer.stop_timer()

    def _on_rule_click(self, btn):
        self._view.disable_rule_buttons(btn, btn.index)

    def _on_game_over(self):
        self._view.disable_buttons()
        self._is_game_over = True

    def _on_restart(self):
        self._pending_restart = True

    def _on_complexity_change(self):
        self._pending_complexity = COMPLEXITY_CYCLE.get(self._complexity, 20)
