# -*- coding: utf-8 -*-
import clr
clr.AddReference('System.Windows.Forms')
from System.Windows.Forms import Button, FlatStyle, MouseButtons, MouseEventArgs
clr.AddReference('System.Drawing')
from System.Drawing import Color, Image, Bitmap, FontStyle, Font
from decoder import decode_symbol


class GameButton(Button):
    def __init__(self):
        self.FlatAppearance.BorderSize = 0
        self.FlatAppearance.BorderColor = Color.FromArgb(40, 40, 40)
        self.FlatStyle = FlatStyle.Flat
        self.ForeColor = Color.White

    def set_color(self, value):
        # Для цветов и других констант можно завести отдельный модуль с настройками
        # settings.py
        # LIGHT_RED = (255, 103, 76, 81)
        # а в данном модуле использовать вот так.
        # import settings
        # self.BackColor = Color.FromArgb(*settings.lIGHT_RED)
        if type(value) == int:  # вот эту проверку лучше делать вот так isinstance(value, int)
            if value // 10 == 1:
                self.BackColor = Color.FromArgb(255, 103, 76, 81)
            if value // 10 == 2:
                self.BackColor = Color.FromArgb(255, 157, 78, 63)
            if value // 10 == 3:
                self.BackColor = Color.FromArgb(255, 174, 141, 94)
            if value // 10 == 4:
                self.BackColor = Color.FromArgb(255, 97, 134, 141)
            if value // 10 == 5:
                self.BackColor = Color.FromArgb(255, 53, 88, 90)
            if value // 10 == 6:
                self.BackColor = Color.FromArgb(255, 97, 66, 51)
            if value == 77:
                self.BackColor = Color.FromArgb(255, 130, 130, 130)
        else:
            self.BackColor = Color.Transparent


class RuleButton(GameButton):
    def __init__(self, index, value):
        super(RuleButton, self).__init__()
        self._pressed = False
        self._index = index
        self._n = value  # не понятно что это за поле, сразу и не поймёшь его назначение и не понятно
        # нужно оно классу или оно может оставаться локальной переменной метода.
        self.Font = Font('Arial', 18)
        self.FlatAppearance.BorderSize = 1
        self.set_color(self._n)

    @property
    def pressed(self):
        return self._pressed
    
    @pressed.setter
    def pressed(self, val):
        self._pressed = val
    
    @property
    def index(self):
        return self._index

    def change_color(self):
        if not self._pressed:
            self.ForeColor = Color.White
            self.set_color(self._n)
        else:
            if type(self._n) == int:
                clr_1 = self.BackColor
                self.BackColor = Color.FromArgb(50, clr_1.R, clr_1.G, clr_1.B)
                # можно воспользоваться другой перегрузкой и не использовать лишнюю переменную и
                # лишние действия с классом Color.
                # self.BackColor = Color.FromArgb(50, self.BackColor)
            self.ForeColor= Color.FromArgb(65, 65, 65)


class FieldButton(GameButton):
    def __init__(self, y, x, n):
        super(FieldButton, self).__init__()
        self._y = y
        self._x = x
        self._n = n
        self.Font = Font('Arial', 15, FontStyle.Bold)
        self.FlatAppearance.BorderSize = 1
        self._symbol = self._set_symbol()
        self.set_color(self._n)

    def _set_symbol(self):
        if self._n in decode_symbol:
            return decode_symbol[self._n]

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
