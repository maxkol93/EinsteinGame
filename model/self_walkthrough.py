# -*- coding: utf-8 -*-
import random


class SelfWalkthrough(object):
    '''
    Этот класс определяет - можно ли пройти игру с текущими уловиями игры.
    А так же оптимизирует количество условий игры.
    '''
    def __init__(self, rules, size):
        self._rules_for_iter = rules
        self._size = size
        self._generate_field()
        self._is_won = False
        self._iter_limit = 10

    def _generate_field(self): # поле для самопрохождения
        self._field = []
        for y in range(self._size):
            row = []
            for x in range(self._size):
                cell = []
                for i in range(self._size):
                    cell.append((y + 1) * 10 + i + 1) # значения клетки от 11 до 66
                row.append(cell)
            self._field.append(row)

    @property
    def is_won(self):
        return self._is_won

    def try_to_win(self):
        self._is_won = False
        self._generate_field()
        self._undefined_count = self._size ** 2
        self._count_iter = 0
        while not self._is_won and self._count_iter < self._iter_limit:
            self._simple_iter()
            self._count_iter += 1
            if self._undefined_count == 0:
                self._is_won = True

    def updete_rules(self, rules):
        self._rules_for_iter = rules
        self.try_to_win()
    
    def try_to_remove_rules(self, start_index):
        cur_ind = start_index
        while cur_ind < len(self._rules_for_iter) - 1:
            rule_for_remove = self._rules_for_iter.pop(cur_ind)
            self.try_to_win()
            if not self._is_won:
                self._rules_for_iter.insert(cur_ind, rule_for_remove)
                cur_ind += 1

# Если очень хочется "объединить" методы в какую-то логическую группу, то лучше воспользоваться
# region итерация по условиям игры
# some_methods
# endregion
# данные регионы можно сворачивать, удобная штука.
#---------------итерация по условиям игры------------------------------------

    def _simple_iter(self): # rule - [21, '<->', 44]
        for rule in self._rules_for_iter:
            y_0 = int(rule[0] // 10 - 1) # индекс строки для первого значения
            y_2 = int(rule[2] // 10 - 1) # индекс строки для 3-го значения
            if rule[1] == '^': # [51, '^', 25]
                self._rule_same_columns_check_all(y_0, y_2, rule[0], rule[2])
            if rule[1] == '...':
                self._rule_left_to_right(y_0, y_2, rule)
            if rule[1] == '<->':
                for x in range(self._size):
                    self._rule_neighbor_check(y_0, y_2, x, rule[0], rule[2])
                    self._rule_neighbor_check(y_2, y_0, x, rule[2], rule[0])
            if type(rule[1]) == int:
                self._rule_three_in_row_check(y_0, y_2, rule)
            if rule[1] == 'define': # rule - [44, 'define', 3]
                self._define_this_cell(rule[0] // 10 - 1, rule[2], rule[0])

    def _rule_same_columns_check_all(self, y_1, y_2, rule_1, rule_2):
        for x in range(self._size):
            self._same_column_check(y_1, y_2, x, rule_1, rule_2)
            self._same_column_check(y_2, y_1, x, rule_2, rule_1)

    def _rule_left_to_right(self, y_0, y_2, rule):
        for x, cell in enumerate(self._field[y_0]):
            self._remove_number_in_cell(y_2, x, rule[2])
            if self._num_in_cell(y_0, x, rule[0]):
                break
        ind = self._size - 1
        for cell in reversed(self._field[y_2]):
            self._remove_number_in_cell(y_0, ind, rule[0])
            if self._num_in_cell(y_2, ind, rule[2]):
                break
            ind -= 1

    def _rule_three_in_row_check(self, y_0, y_2, rule):
        y_1 = int(rule[1] // 10 - 1)
        self._remove_number_in_cell(y_1, 0, rule[1]) # убираем среднюю ячейку с краев
        self._remove_number_in_cell(y_1, self._size - 1, rule[1])
        defined_cells = {}
        # ключ словаря defined_cells - индекс из правила, значение - координата x
        for i, y in enumerate([y_0, y_1, y_2]):
            for x, cell in enumerate(self._field[y]):
                if cell == rule[i]:
                    defined_cells[i] = x
                    break

        # если 2 определены - определяем третью
        if len(defined_cells) == 2:
            self._define_other(defined_cells, rule)
        # если определена одна крайняя - определяем остальные
        if len(defined_cells) == 1 and 0 in defined_cells or 2 in defined_cells: 
            if defined_cells.values()[0] <= 1 or defined_cells.values()[0] >= (self._size - 2):
                self._define_other(defined_cells, rule)
        else:
            self._check_other(defined_cells, rule)

        for i in range(2): # проверяем пары по правилу соседних столбцов
            send_y_1 = rule[i] // 10 - 1
            send_y_2 = rule[i+1] // 10 - 1
            for x in range(self._size):
                self._rule_neighbor_check(send_y_1, send_y_2, x, rule[i], rule[i+1])
                self._rule_neighbor_check(send_y_2, send_y_1, x, rule[i+1], rule[i])

        for x in range(self._size): # проверяем клетки через 1
            self._check_through_one(y_0, y_2, x, rule[0], rule[2])
            self._check_through_one(y_2, y_0, x, rule[2], rule[0])
        
        for x in range(self._size):
            if not self._num_in_cell(y_0, x, rule[0]) and not self._num_in_cell(y_2, x, rule[2]):
                if x > 0:
                    self._remove_number_in_cell(y_1, x - 1, rule[1])
                if x < self._size - 1:
                    self._remove_number_in_cell(y_1, x + 1, rule[1])

#----------------проверки по правилам----------------------------------------------

    def _num_in_cell(self, y, x, n):
        if type(self._field[y][x]) == int:
            return n == self._field[y][x]
        elif n in self._field[y][x]:
            return n in self._field[y][x]

    def _same_column_check(self, y_1, y_2, x, num_1, num_2):
        if type(self._field[y_1][x]) == int:
            if self._field[y_1][x] == num_1:
                self._define_this_cell(y_2, x, num_2)
            else:
                self._remove_number_in_cell(y_2, x, num_2)
        else:
            if num_1 not in self._field[y_1][x]:
                self._remove_number_in_cell(y_2, x, num_2)

    def _check_neighbor_column(self, y_1, y_2, x, num_1, num_2, dx):
        if not self._num_in_cell(y_2, x + dx, num_2):
            self._remove_number_in_cell(y_1, x, num_1)

    def _rule_neighbor_check(self, y_1, y_2, x, num_1, num_2):
        if x == 0:
            self._check_neighbor_column(y_1, y_2, x, num_1, num_2, 1)
        elif x == (self._size - 1):
            self._check_neighbor_column(y_1, y_2, x, num_1, num_2, -1)
        else:
            if not self._num_in_cell(y_2, x - 1, num_2) and not self._num_in_cell(y_2, x + 1, num_2): # нет в соседних
                self._remove_number_in_cell(y_1, x, num_1)
            if x == 1 and self._field[y_2][0] == num_2 or x == self._size - 2 and self._field[y_2][self._size - 1] == num_2: # если соседний от края
                self._define_this_cell(y_1, x, num_1)
            if self._field[y_2][x] == num_2:
                inds_for_remove = range(self._size)
                inds_for_remove.remove(x - 1)
                inds_for_remove.remove(x + 1)
                for i in inds_for_remove:
                    self._remove_number_in_cell(y_1, i, num_1)

    def _check_through_one(self, y_1, y_2, x, num_1, num_2):
        if x <= 1:
            self._check_neighbor_column(y_1, y_2, x, num_1, num_2, 2)
        elif x >= (self._size - 2):
            self._check_neighbor_column(y_1, y_2, x, num_1, num_2, -2)
        else:
            if not self._num_in_cell(y_2, x - 2, num_2) and not self._num_in_cell(y_2, x + 2, num_2):
                self._remove_number_in_cell(y_1, x, num_1)

    def _define_other(self, defined_cells, rule):
        if len(defined_cells) == 1: # одна определена
            x = defined_cells.values()[0]
            ys = [i // 10 - 1 for i in rule]
            ind_1 = 1
            if 0 in defined_cells: # [defined_cell, ind_1, ind_2]
                ind_2 = 2
            else: # [ind_2, ind_1, defined_cell]
                ind_2 = 0
            if x <= 1: # слева
                dx = 1
            else: # справа
                dx = -1
            self._define_this_cell(ys[ind_1], x + dx, rule[ind_1])
            self._define_this_cell(ys[ind_2], x + dx * 2, rule[ind_2])

        elif len(defined_cells) == 2: # 2 определены
            if abs(defined_cells.values()[0] - defined_cells.values()[1]) == 2: # [defined_cell, ..., defined_cell]
                cur_x = sum(defined_cells.values()) / 2
                cur_ind = 1
            else:
                if 0 not in defined_cells: # [..., defined_cell, defined_cell]
                    cur_x = defined_cells[1] + (defined_cells[1] - defined_cells[2])
                    cur_ind = 0
                elif 2 not in defined_cells: # [defined_cell, defined_cell, ...]
                    cur_x = defined_cells[1] + (defined_cells[1] - defined_cells[0])
                    cur_ind = 2
            self._define_this_cell(int(rule[cur_ind] // 10 - 1), cur_x, rule[cur_ind])

    def _check_other(self, defined_cells, rule):
        y_0 = rule[0] // 10 - 1
        y_1 = rule[1] // 10 - 1
        y_2 = rule[2] // 10 - 1
        if 1 in defined_cells:
            inds = range(self._size)
            inds.remove(defined_cells[1] - 1)
            inds.remove(defined_cells[1] + 1)
            for x in inds:
                self._remove_number_in_cell(y_0, x, rule[0])
                self._remove_number_in_cell(y_2, x, rule[2])
        elif 0 in defined_cells:
            xs_1 = range(self._size)
            xs_1.remove(defined_cells[0] - 1)
            xs_1.remove(defined_cells[0] + 1)
            xs_2 = range(self._size)
            xs_2.remove(defined_cells[0] - 2)
            xs_2.remove(defined_cells[0] + 2)
            for x in xs_1:
                self._remove_number_in_cell(y_1, x, rule[1])
            for x in xs_2:
                self._remove_number_in_cell(y_2, x, rule[2])
        elif 2 in defined_cells:
            xs_1 = range(self._size)
            xs_1.remove(defined_cells[2] - 1)
            xs_1.remove(defined_cells[2] + 1)
            xs_0 = range(self._size)
            xs_0.remove(defined_cells[2] - 2)
            xs_0.remove(defined_cells[2] + 2)
            for x in xs_1:
                self._remove_number_in_cell(y_1, x, rule[1])
            for x in xs_0:
                self._remove_number_in_cell(y_0, x, rule[0])

#-----------------взаимодействия с полем, удаление лишних значений----------------------------------

    def _remove_all_batton_in_row(self, row, number):
        for x, cell in enumerate(self._field[row]):
            if type(cell) == list:
                for b in cell:
                    if b == number:
                        cell.remove(b)
                        if len(cell) == 1:
                            other_number = cell.pop()
                            self._define_this_cell(row, x, other_number)
                            self._remove_all_batton_in_row(row, other_number)

    def _define_this_cell(self, y, x, n):
        if type(self._field[y][x]) == list:
            self._undefined_count -= 1
            self._field[y][x] = n
        self._remove_all_batton_in_row(y, n)

    def _check_row(self, row, number):
        count = 0
        for x, cell in enumerate(self._field[row]):
            if type(cell) == list:
                for b in cell:
                    if b == number:
                        count += 1
                        column = x
                        check_cell = cell
        if count == 1:
            self._remove_all_button_in_cell(check_cell, row, column, number)

    def _remove_all_button_in_cell(self, cell, row, column, number):
        for_check = []
        for btn in cell:
            for_check.append(btn)
        self._define_this_cell(row, column, number)
        for btn in for_check:
            self._check_row(row, btn)

    def _remove_number_in_cell(self, y, x, n):
        if type(self._field[y][x]) == list:
            if n in self._field[y][x]:
                self._field[y][x].remove(n)
                if len(self._field[y][x]) == 1:
                    self._define_this_cell(y, x, self._field[y][x][0])
                self._check_row(y, n)
