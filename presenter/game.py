# -*- coding: utf-8 -*-
import clr
clr.AddReference('System.Windows.Forms')
from System.Windows.Forms import MouseButtons

from random import choice

from view.window import GameWindow
# Пока что не смотрел этот класс, но уже настрораживает слово And в названии класса,
# возможно будет лучше его разделить.
from model.field_and_rules import FieldAndRules
from model.timer import Timer


class Game(object):
    def __init__(self):
        self._model = None
        self._view = None
        self._is_game_over = False
        self._score = 0  # похоже прозапас поле осталось)
        self._current_index = 0
        self._timer = 0

    def start(self, complexity):
        # это поле лучше инициализировать в __init__ потому что если появится метод, который будет
        # вызываться до метода start и в нём будет изпользоваться данное поле, то код упадёт с ошибкой
        # и сразу не будет понятно почему, ведь в данном классе это поле есть и другие методы вроде
        # бы работают.
        self._count_wrong = 0
        self._is_game_over = False
        self._complexity = complexity
        self._model = FieldAndRules(self._complexity)
        self._view = GameWindow(self._model.rules[self._model.defined_start_cells_count:])
        self._view.change_complexity(self._complexity)
        self._view.define_start_cells(self._model.defined_start_cells)
        self._view.set_button_handler(self._mouse_button_dawn)
        self._view.set_rules_button_handler(self._mouse_click_on_rule)
        self._view.set_restart_handler(self._restart_game)
        self._view.set_complexity_change_handler(self._complexity_change)
        self._timer = Timer(self._view.timer_update, self._game_over)
        self._timer.start()
        self._view.ShowDialog()

    def _complexity_change(self, sender, event_args):
        self._view.Hide()
        self._view.Close()
        # как я уже писал в модуле main, числа лучше заменить на константы класса
        # Возможно стоило бы написать этот метод так чтобы пользователь выбирал сложность,
        # а потом нажимал кнопку restart?
        # def _complexity_change(self, sender, event_args):
        #     self._view.Hide()
        #     self._view.Close()
        #     if self._complexity == Game.HARD:
        #         self._complexity == Game.NORMAL
        #     if self._complexity == Game.NORMAL:
        #         self._complexity == Game.EASY
        #     if self._complexity == Game.EASY:
        #         self._complexity == Game.HARD
        # Для того чтобы данный метод только менял сложность для следующей игры
        # просто когда ты видишь метод который меняет сложность, не подразумеваешь
        # что он будет заного запускать игру.
        if self._complexity == 20:
            self.start(10)
        elif self._complexity == 10:
            self.start(0)
        elif self._complexity == 0:
            self.start(20)

    # Переименование sender в btn норм тема особенно когда вы точно знаете вызывающего.
    # Но я бы не стал жадничать символы и написал бы button полностью)
    def _mouse_button_dawn(self, btn, args):
        if args.Button == MouseButtons.Left:
            if self._model[btn.y][btn.x] == btn.n:
                self._count_wrong += 1
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
                    self._timer.stop_timer()
                    self._view.timer_font_updane(True)

    def _mouse_click_on_rule(self, btn, args):
        if args.Button == MouseButtons.Left:
            self._view.disable_rule_buttons(btn, btn.index)

    def _game_over(self):
        self._view.disable_buttons()
        self._is_game_over = True

    def _restart_game(self, sender, event_args): # sender - button
        self._view.Hide()
        self._view.Close()
        self.start(self._complexity)
