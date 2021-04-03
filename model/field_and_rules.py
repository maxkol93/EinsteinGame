# -*- coding: utf-8 -*-
from random import randint, choice
from self_walkthrough import SelfWalkthrough

# В любом случае если в классе есть слово And, значит этот класс точно надо разбивать на два.
# Но я решил посмотреть почему именно так. Если свернуть все методы и свойства, то мы увидим,
# что у класса 4 публичных свойства и один магический метод.
# 3 из которых представляют поле (field), а одно представляет правила.
# Магический метод так же относится к полю.
# Единственное место где эти два класса пересекаются - это метод _initialize_self_walkthrough.
# Мне кажется это можно смело вынести в Game, а данный класс разделить.
# Причём таким образом: Field, RuleManager, Rule
class FieldAndRules(object):
    # м, поясняющая документация, отлично
    '''
    Этот класс генерирует финальное поле и логические условия игры.
    '''
    def __init__(self, comlexity):
        self._size = 6
        self._final_field = self._generate_final_field()
        self._rules = []
        self._defined_start_cells_count = comlexity
        self._defined_start_cells = []
        # вот generate_final_field возвращает значение и передаёт его
        # в поле класса, а данный метод всё делает внутри себя, в том числе и создаёт новое поле,
        # хотя общий смысл один: создать поле класса и заполнить его значением.
        # Нужно стараться быть последовательным и принимать одинаковые решения.
        # Мой совет: всегда инициализировать поля классов только в конструкторе, но я об этом уже
        # писал в других модулях.
        self._generate_start_rules()
        self._initialize_self_walkthrough()

    @property
    def field(self):
        return self._final_field

    @property
    def rules(self):
        return self._rules
 
    @property
    # Я бы заменил на start_cells
    def defined_start_cells(self):
        return self._defined_start_cells

    @property
    # пока не понятно зачем нужно отдельное свойство для получения количества стартовых ячеек
    # если есть свойство возвращающее список этих ячеек
    def defined_start_cells_count(self):
        return self._defined_start_cells_count

    def _generate_final_field(self):
        data = []
        for y in range(self._size):
            row = []
            count = self._size
            while count:
                # для лучшего понимания данную строку нужно
                # поместить в функцию generate_unique_number() и можно даже проверку на наличие в
                # строке поместить туда же. И в таком случае while count можно будет заменить на
                # for x in range(self._size) и таким образом будет понятней что первый цикл проходит
                # по строкам, а второй по столбцам.
                n = (y + 1) * 10 + randint(1, self._size)
                if n not in row:
                    row.append(n)
                    count -= 1
            data.append(row)
        return data

    def _generate_start_rules(self):
        # данный комментарий лучше перенести в документацию метода.
        self._min_nums = [] # 30 рандомных ячеек, по 5 из каждого ряда. Необходимый минимум для логических условий
        for row in range(6):  # а тут вы почему-то не используете self._size, когда измениться поле,
            # то можно получить неожиданный результат.
            random_inds = range(6)
            random_inds.remove(randint(0, 5))
            for column in random_inds:
                self._min_nums.append((row, column))

        for i in range(self._defined_start_cells_count): # создание уловий для определенных клеток при старте игры
            index_of_num = randint(0, len(self._min_nums) - 1)
            num = self._min_nums[index_of_num]
            rule = [self._final_field[num[0]][num[1]], 'define', num[1]]
            self._rules.append(rule)
            self._defined_start_cells.append(rule)
            self._min_nums.remove(num)

        while len(self._min_nums): # создание минимальных стартовых условий - если есть потребность
            # дать имя этому циклу, то это явный признак того, что он должен уйти в функцию. 
            for num in self._min_nums:
                if len(self._min_nums) != 1: # создание правила с 2 рандомными ячейками
                    self._min_nums.remove(num)
                    rand_num = choice(self._min_nums)
                    self._min_nums.remove(rand_num)
                    self._create_start_rule(num, rand_num)
                else: # создание правила с последней ячейкой (при наличии)
                    self._min_nums.remove(num)
                    self._create_start_rule(num, (randint(0, 5), randint(0, 5)))

    def _initialize_self_walkthrough(self):
        self._walkthrough_game = SelfWalkthrough(self._rules, self._size)
        self._walkthrough_game.try_to_win()
        while not self._walkthrough_game.is_won:
            self._run_update_rules()
        self._walkthrough_game.try_to_remove_rules(self._defined_start_cells_count)

    def _run_update_rules(self):
        '''
        Добавление уловий игры, пока игра точно не будет проходима.
        '''
        while True:
            r = self._create_rule(randint(1, 4)) # 1-4 тип условия игры. Это можно перевести в тип Enum
            # не понятно что такое 1 или 4, но если это будет соответствовать значению перечисления,
            # то с этим будет проще работать. А выбирать можно было бы через рандомную функцию choice
            if (r not in self._rules) and (reversed(r) not in self._rules):
                self._rules.append(r)
                self._walkthrough_game.updete_rules(self._rules)
                break

    def _create_start_rule(self, num1, num2): # num1 и num2 - кортеж вида (row, column)
        y1 = num1[0]
        x1 = num1[1]
        y2 = num2[0]
        x2 = num2[1]
        if x1 == x2: # в одом столбце
            rule_type = 1  # Возвращаясь к теме Enum, тут было бы понятней что это.
        elif abs(x1 - x2) == 1: # либо в соседних столбцах, либо лево-право
            rule_type = choice([2, 3, 3])
        elif abs(x1 - x2) == 2: # либо 3 в ряд, либо лево-право
            rule_type = choice([2, 4, 4])
            pass
        else: # лево-право
            rule_type = 2

        if rule_type == 1: # в одном столбце
            self._rules.append([self._final_field[y1][x1], '^', self._final_field[y2][x2]])
        elif rule_type == 2: # лево-право
            if x1 < x2:
                self._rules.append([self._final_field[y1][x1], '...', self._final_field[y2][x2]])
            elif x1 > x2:
                self._rules.append([self._final_field[y2][x2], '...', self._final_field[y1][x1]])
        elif rule_type == 3: # в соседних столбцах
            self._rules.append([self._final_field[y1][x1], '<->', self._final_field[y2][x2]])
        elif rule_type == 4: # 3 в ряд
            x_mid = (x1 + x2) / 2
            y_mid = randint(0, 5)
            if (y_mid, x_mid) in self._min_nums:
                self._min_nums.remove((y_mid, x_mid))
            self._rules.append([self._final_field[y1][x1], self._final_field[y_mid][x_mid], self._final_field[y2][x2]])

    def _create_rule(self, rule_type): # создание рандомного правила
        y = randint(0, 5)
        x = randint(0, 5)
        if rule_type == 1: # в одном столбце
            y2 = y
            while y2 == y:
                y2 = randint(0, 5)
            return [self._final_field[y][x], '^', self._final_field[y2][x]]
        elif rule_type == 2: # порядок
            x1 = randint(0, 4)
            x2 = randint(x1 + 1, 5)
            y2 = randint(0, 5)
            return [self._final_field[y][x1], '...', self._final_field[y2][x2]]
        elif rule_type == 3: # рядом
            if x == 0:
                x2 = 1
            elif x == 5:
                x2 = 4
            else:
                x2 = x + choice([-1, 1])
            y2 = randint(0, 5)
            return [self._final_field[y][x], '<->', self._final_field[y2][x2]]
        elif rule_type == 4: # 3 в ряд
            if x < 2:
                dx = 1
            elif x > 3:
                dx = -1
            else:
                dx = choice([-1, 1])
            x2 = x + dx
            x3 = x2 + dx
            y2 = randint(0, 5)
            y3 = randint(0, 5)
            return [self._final_field[y][x], self._final_field[y2][x2], self._final_field[y3][x3]]

    def __getitem__(self, index):
        return self._final_field[index]
