# -*- coding: utf-8 -*-
import clr
clr.AddReference('System.Windows.Forms')
from System.Windows.Forms import (
    Form, Button, CheckBox, FormBorderStyle, MenuStrip, Label, BorderStyle, VScrollBar, FormStartPosition,
    ToolStripControlHost, ToolStripMenuItem, TextRenderer, FlatStyle, ImageList, PictureBox, ComboBox)
clr.AddReference('System.Drawing')
from System.Drawing import (
    Point, Size, ContentAlignment, Color, Pen, Graphics, RotateFlipType, ContentAlignment,
    Font, FontStyle, FontFamily, Image, Bitmap, SolidBrush)

from random import choice
import time
import os

from buttons import GameButton, RuleButton, FieldButton
from decoder import decode_symbol


class GameWindow(Form):
    def __init__(self, rules):
        self.Text = 'Einstein game'
        self.FormBorderStyle = FormBorderStyle.Fixed3D
        self.MaximizeBox = False
        self._indent_top = 70
        self._indent_bottom = 10
        self._indent_right = 10 + 145 * (len(rules) // 14 + (len(rules) % 14 != 0))
        self._indent_left = 10
        self._cell_side = 100
        self._cell_size = Size(self._cell_side, self._cell_side)
        self.Size = self._generate_window_size(6, 6)
        self._field_width = self._indent_left + self._cell_side * 6 + 25
        self.CenterToScreen()
        self.BackColor = Color.FromArgb(40, 40, 40)
        self._cells = []
        self._rules_buttons = []
        self._get_dir_path()
        self._initialize_components(rules)
    
    def _initialize_components(self, rules):
        self._create_lines()
        self._create_labels()
        self._create_cells()
        self._create_rules_buttons(rules)
        self._create_menu_buttons()
        self._defined_cells_count = 0
        self._count_good = 0

    def _create_labels(self):
        self._result = Label()
        self._result.Parent = self
        self._result.Font = Font('Arial', 14)
        self._result.ForeColor = Color.FromArgb(255, 255, 255)
        self._result.Size = Size(370, 40)
        self._result.Location = Point(170, 10)
        
        self._timer = Label()
        self._timer.Parent = self
        self._timer.Text = '00:00'
        self._timer.Font = Font('Arial', 13)
        self._timer.ForeColor = Color.FromArgb(180, 180, 180)
        self._timer.Size = TextRenderer.MeasureText(self._timer.Text, self._timer.Font)
        self._timer.Location = Point(self._field_width - 75, 15)

    def _create_lines(self):
        line_1 = PictureBox()
        line_1.Parent = self
        line_1.Size = Size(3, 700)
        line_1.Image = Image.FromFile(self._dir_path_images + 'line_700.png')
        line_1.Location = Point(self._field_width, 0)

        line_2 = PictureBox()
        line_2.Parent = self
        line_2.Size = Size(self._field_width, 3)
        im1 = Image.FromFile(self._dir_path_images + 'line_700.png')
        im1.RotateFlip(RotateFlipType.Rotate90FlipNone)
        line_2.Image = im1
        line_2.Location = Point(0, self._indent_top - 10)

        for i in range(1, 6):
            line = PictureBox()
            line.Parent = self
            line.Size = Size(1, 700)
            line.Image = Image.FromFile(self._dir_path_images + 'line_700_1.png')
            line.Location = Point(self._indent_left + i * self._cell_side + (i - 1) * 3 + 1, self._indent_top - 10)

    def _create_menu_buttons(self):
        self._restart_btn = GameButton()
        self._restart_btn.Parent = self
        self._restart_btn.Size = Size(50, 50)
        self._restart_btn.Location = Point(5, 5)
        self._restart_btn.BackgroundImage = Image.FromFile(self._dir_path_images + "menu_restart.jpg")

        self._complexity_btn = GameButton()
        self._complexity_btn.Parent = self
        self._complexity_btn.Size = Size(50, 50)
        self._complexity_btn.Location = Point(60, 5)
        self._complexity_btn.BackgroundImage = Image.FromFile(self._dir_path_images + "menu_complexity_easy.jpg")

        self._game_rules_btn = GameButton()
        self._game_rules_btn.Parent = self
        self._game_rules_btn.Size = Size(50, 50)
        self._game_rules_btn.Location = Point(115, 5)
        self._game_rules_btn.BackgroundImage = Image.FromFile(self._dir_path_images + "menu_rules.jpg")
        self._game_rules_btn.Click += self._click_on_game_rules

    def change_complexity(self, complexity):
        if complexity == 20:
            self._complexity_btn.BackgroundImage = Image.FromFile(self._dir_path_images + "menu_complexity_easy.jpg")
        elif complexity == 10:
            self._complexity_btn.BackgroundImage = Image.FromFile(self._dir_path_images + "menu_complexity_normal.jpg")
        elif complexity == 0:
            self._complexity_btn.BackgroundImage = Image.FromFile(self._dir_path_images + "menu_complexity_hard.jpg")

    def set_restart_handler(self, handler):
        self._restart_btn.Click += handler
    
    def set_complexity_change_handler(self, handler):
        self._complexity_btn.Click += handler

    def set_rules_button_handler(self, handler):
        for rule in self._rules_buttons:
            for btn in rule:
                btn.MouseDown += handler
    
    def disable_rule_buttons(self, btn, index):
        for i in range(3):
            self._rules_buttons[index][i].pressed = not self._rules_buttons[index][i].pressed
            self._rules_buttons[index][i].change_color()

    def disable_buttons(self):
        for row in self._cells:
            for cell in row:
                if type(cell) == list:
                    for btn in cell:
                        btn.Enabled = False

    def set_massage(self, state_of_game):
        if state_of_game == 'loose':
            for_loose = [
                "don't worry and try again!",
                'be careful and try again!',
                'but you still have a chance!']
            self._result.Text = 'you lose! ' + choice(for_loose)
        elif state_of_game == 'first_wrong':
            for_wrong = [
                'wrong! =(',
                'oops, not there!',
                'it is not true.',
                'it looks like the correct button?',
                'read the rules again!',
                'do you think this is a good move?',
                'how could you click here?']
            self._result.Text = choice(for_wrong) + ' 2 attempts left.'
            self._count_good = 0
        elif state_of_game == 'second_wrong':
            for_wrong = [
                'you broke the game!',
                'so, what is next?',
                'you need a break!',
                'drink some coffee, can it help?',
                'how will you get out of this situation?',
                'delete the game please!',
                'Alt+F4 please!']
            self._result.Text = choice(for_wrong) + ' 1 attempt left.'
            self._count_good = 0
        elif state_of_game == 'good':
            self._count_good += 1
            for_good = [
                'good!',
                'yep, continue!',
                "not bad, but that's not all!",
                "you're so clever, go on!",
                "wow, you're great!",
                'if you worked like that...',
                'your mind is gorgeous!',
                ]
            if self._count_good < 3:
                self._result.Text = choice(for_good)
            else:
                self._result.Text = ''
        elif state_of_game == 'win':
            for_win = [
                'good job, you win!',
                'Einstein would be proud of you!',
                'you need to be a scientist!'
            ]
            self._result.Text = choice(for_win)
        self._result.TextAlign = ContentAlignment.MiddleCenter
    
    def timer_update(self, value):
        self._timer.Text = '{}{}:{}{}'.format(value // 60 // 10, value // 60 % 10, value % 60 // 10, value % 60 % 10)
    
    def timer_font_updane(self, win):
        if win:
            self._timer.ForeColor = Color.Yellow
        else:
            self._timer.ForeColor = Color.Red
    
    def define_start_cells(self, rules): # rule - [44, 'define', 3]
        for rule in rules:
            y = rule[0] // 10 - 1
            x = rule[2]
            num = rule[0]
            btn_for_remove = []
            for btn in self._cells[y][x]:
                if btn.n != num:
                    btn_for_remove.append(btn)
            for btn in btn_for_remove:
                self.remove_button(btn)

    def _click_on_game_rules(self, sender, event_args):
        game_rules_window = Form()
        game_rules_window.Text = 'Einstein game - Rules'
        game_rules_window.FormBorderStyle = FormBorderStyle.Fixed3D
        game_rules_window.MaximizeBox = False
        game_rules_window.Size = Size(930, 900)
        game_rules_window.StartPosition = FormStartPosition.CenterScreen
        game_rules_window.AutoScroll = True
        game_rules_window.BackColor = Color.FromArgb(40, 40, 40)
        back_image = PictureBox()
        game_rules_window.Controls.Add(back_image)
        back_image.Size = Size(900, 1767)
        back_image.Image = Image.FromFile(self._dir_path_images + 'Game_rules_900_1767.jpg')
        back_image.Location = Point(0, 0)
        game_rules_window.ShowDialog()

    def _get_dir_path(self):
        self._dir_path_images = os.path.dirname(__file__) + '\\images\\'

    def _create_rules_buttons(self, rules):
        rules.sort(key=lambda i: i[1], reverse=True)
        for i, rule in enumerate(rules):
            btn_rule = GameButton()
            btn_rule.Parent = self
            mini_btn_side = (self._cell_side + 15) / 3
            btn_rule.Size = Size(mini_btn_side * 3, mini_btn_side )
            ty, tx = i % 14, i // 14
            btn_rule.Location = Point(self._field_width + 17 + tx * btn_rule.Size.Width + tx * 30, 
                                      10 + ty * btn_rule.Size.Height + ty * 9)

            btn_1 = RuleButton(i, rule[0])
            btn_1.Size = Size(mini_btn_side, mini_btn_side)
            btn_1.Location = Point(0, 0)
            btn_1.Text = decode_symbol[rule[0]]

            btn_2 = RuleButton(i, rule[1])
            btn_2.Size = Size(mini_btn_side, mini_btn_side)
            btn_2.Location = Point(mini_btn_side, 0)
            if type(rule[1]) == int:
                btn_2.Text = decode_symbol[rule[1]]
            else:
                if '^' in rule[1]:
                    btn_2.Text = '↨'
                elif '<->' in rule[1]:
                    btn_2.Text = '↔'
                elif '...' in rule[1]:
                    btn_2.Text = '…'

            btn_3 = RuleButton(i, rule[2])
            btn_3.Text = decode_symbol[rule[2]]
            btn_3.Size = Size(mini_btn_side, mini_btn_side)
            btn_3.Location = Point(mini_btn_side * 2, 0) 

            btn_rule.Controls.Add(btn_1)
            btn_rule.Controls.Add(btn_2)
            btn_rule.Controls.Add(btn_3)

            self._rules_buttons.append([btn_1, btn_2, btn_3, btn_rule])

    def _generate_window_size(self, rows, columns):
        width = self._indent_left + columns * self._cell_side + (columns - 1) * 3 + self._indent_right + 10
        height = self._indent_top + rows * self._cell_side + (rows - 1) * 3 + self._indent_bottom + 33
        return Size(width, height)

    def _create_cells(self):
        for y in range(6):
            row = []
            for x in range(6):
                row.append(self._create_buttons(y, x))
            self._cells.append(row)

    def _create_buttons(self, y, x):
        btns = []
        for dy in range(2):
            for dx in range(3):
                btn = FieldButton(y, x, (y + 1) * 10 + dy * 3 + dx + 1)
                btn.Parent = self
                btn.Size = Size(self._cell_side / 3, self._cell_side / 3)
                btn.Location = Point(self._indent_left + x * self._cell_side + x * 3 + dx * btn.Size.Width, 
                                     self._indent_top + y * self._cell_side + y * 3 + dy * btn.Size.Width + 16)
                btn.Text = btn.symbol
                btns.append(btn)
        return btns

    def set_button_handler(self, handler):
        for row in self._cells:
            for cell in row:
                for btn in cell:
                    btn.MouseDown += handler

    def remove_button(self, btn): # удаляем нажатую кнопку
        curent_number = btn.n
        current_row = btn.y
        current_column = btn.x
        self.Controls.Remove(btn)
        self._cells[current_row][current_column].remove(btn)
        if len(self._cells[current_row][current_column]) == 1: # если в ячейке осталась одна кнопка
            last_btn_in_cell = self._cells[current_row][current_column].pop() # удаляем ее
            self._create_big_button(current_row, current_column, last_btn_in_cell.n) # создаем большую
            self._remove_all_batton_in_row(current_row, last_btn_in_cell.n) # удаляем эту цифру со всей строки
            self.Controls.Remove(last_btn_in_cell) # и удаляем из окна
        self._check_last_in_row(current_row, curent_number) # проверка номера нажатой кнопки во всей строке

    def _remove_all_batton_in_row(self, row, number):
        for x, cell in enumerate(self._cells[row]):
            for b in cell:
                if b.n == number:
                    cell.remove(b)
                    self.Controls.Remove(b)
                    if len(cell) == 1:
                        other_number = cell[0].n
                        self.Controls.Remove(cell.pop())
                        self._create_big_button(row, x, other_number)
                        self._remove_all_batton_in_row(row, other_number)
    
    def _check_last_in_row(self, row, number):
        count = 0
        for cell in self._cells[row]:
            for b in cell:
                if b.n == number:
                    count += 1
                    column = b.x
                    check_cell = cell
        if count == 1:
            self._create_big_button(row, column, number)
            self._remove_all_button_in_cell(check_cell, row, column)

    def _remove_all_button_in_cell(self, cell, row, column):
        for_check = []
        for btn in cell:
            self.Controls.Remove(btn)
            for_check.append(btn)
        self._cells[row][column] = []
        for btn in for_check:
            self._check_last_in_row(row, btn.n)

    def _create_big_button(self, y, x, n):
        self._defined_cells_count += 1
        big_btn = GameButton()
        big_btn.Parent = self
        big_btn.Size = self._cell_size
        big_btn.FlatAppearance.BorderSize = 1
        big_btn.BackgroundImage = Image.FromFile(self._dir_path_images + "{0}.bmp".format(n // 10))
        big_btn.Location = Point(self._indent_left + x * self._cell_side + x * 3,
                            self._indent_top + y * self._cell_side + y * 3)
        big_btn.Text = decode_symbol[n]
        big_btn.Font = Font('Arial', 50)
        if n // 10 == 5 or n == 61:
            big_btn.TextAlign = ContentAlignment.MiddleCenter
        else:
            big_btn.TextAlign = ContentAlignment.TopCenter
    
    @property
    def defined_cells_count(self):
        return self._defined_cells_count

if __name__ == '__main__':
    f = GameWindow([[11,22,33],[44,55,66]])
    f.ShowDialog()
