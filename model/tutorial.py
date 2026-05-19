# -*- coding: utf-8 -*-
"""The 6-block onboarding.

Two things live here:

* ``TutorialDirector`` — the progress state machine: which block/level the
  player is on, the global mistake count, the 6-block tracker, and what the
  win plaque should say after each level.
* the 3x3 puzzle generator — every tutorial level is a tiny 3x3 board. Block 0
  ("Entry") has no clues and no fixed answer; blocks 1-5 are real solvable
  puzzles with a controlled rule type, generated and then verified with the
  game's own ``SelfWalkthrough`` deduction engine.
"""
import random

from model.self_walkthrough import SelfWalkthrough


SIZE = 3
BLOCK_COUNT = 6
LEVELS_PER_BLOCK = 3
BLOCK_NAMES = ['Entry', 'Same column', 'Neighbors', 'Left of',
               'Three in a row', 'Mixed']

# the rule marker each single-type block teaches (block index -> marker)
_BLOCK_MARKER = {1: '^', 2: '<->', 3: '...', 4: 'tri'}
_ALL_MARKERS = ['^', '<->', '...', 'tri']


# --------------------------------------------------------------------------
# text
# --------------------------------------------------------------------------
WELCOME_TEXT = (
    "Welcome to Einstein! Every cell holds a few candidate symbols. Pop the "
    "wrong ones — when a single symbol is left, the cell solves itself. Go "
    "ahead and try it.")

GOAL_HINT = (
    "Keep popping candidates to fill the whole board with solved cells — "
    "that is the goal of the game.")

FINAL_TEXT = (
    "Tutorial complete — well done! Every mode and board size is now "
    "unlocked in the menu. In a real game mistakes cost lives, the timer "
    "runs and your score is kept. Go set some records!")

BLOCK_INTRO = {
    0: WELCOME_TEXT,
    1: "New rule — Same column: the two linked symbols share one column. "
       "Your clues live on the CLUES panel, on the right of the board.",
    2: "New rule — Neighbors: the two linked symbols sit in side-by-side "
       "columns.",
    3: "New rule — Left of: the first symbol sits somewhere to the left of "
       "the second one.",
    4: "New rule — Three in a row: the three symbols fill three columns in a "
       "row, in that order — read left-to-right or right-to-left.",
    5: "Now the clues mix every rule type together. Read each one carefully "
       "— you already know them all.",
}

# the three teaching texts: shown as a popup on the 1st/2nd/3rd mistake, then
# cycled as a gentler reminder inside the win plaque of any mistaken level.
MISTAKE_TEXTS = [
    "Actually, you never need to guess in this game — read the clues before "
    "you pop a symbol.",
    "To solve a cell, pop every wrong candidate around the right one. You "
    "never click the correct symbol itself.",
    "To move on you must clear all 3 levels of a block in a row without a "
    "single mistake.",
]


def _block_praise(block):
    name = BLOCK_NAMES[block]
    nxt = BLOCK_NAMES[block + 1] if block + 1 < BLOCK_COUNT else ''
    line = 'Nice work — the "%s" block is done!' % name
    if nxt:
        line += '  Next up: "%s".' % nxt
    return line


def _replay_praise(block):
    return 'The "%s" block — revisited and cleared. Nicely done!' % \
        BLOCK_NAMES[block]


# --------------------------------------------------------------------------
# puzzle generation
# --------------------------------------------------------------------------
class TutorialLevel(object):
    """One generated 3x3 round handed to the presenter / view."""

    def __init__(self, block, level, solution, defined_cells, clues):
        self.size = SIZE
        self.block = block
        self.level = level
        self.solution = solution            # 3x3 grid of the answer values
        self.defined_cells = defined_cells  # [[value, 'define', x], ...]
        self.clues = clues                  # displayable rule lists
        # block 0 has no fixed answer — any pop is accepted
        self.free = (block == 0)
        self.rule_name = BLOCK_NAMES[block]


def _random_solution():
    """A random valid 3x3 field — each row a permutation of its 3 values."""
    grid = []
    for y in range(SIZE):
        vals = [(y + 1) * 10 + i + 1 for i in range(SIZE)]
        random.shuffle(vals)
        grid.append(vals)
    return grid


def _define_rules(solution, cells):
    return [[solution[y][x], 'define', x] for (y, x) in cells]


def _marker_of(clue):
    return clue[1] if isinstance(clue[1], str) else 'tri'


def _true_clue(solution, marker):
    """A random clue of the given type that holds for `solution`."""
    if marker == '^':
        x = random.randrange(SIZE)
        y1, y2 = random.sample(range(SIZE), 2)
        return [solution[y1][x], '^', solution[y2][x]]
    if marker == '<->':
        x1 = random.randrange(SIZE)
        opts = [x for x in (x1 - 1, x1 + 1) if 0 <= x < SIZE]
        x2 = random.choice(opts)
        y1, y2 = random.randrange(SIZE), random.randrange(SIZE)
        return [solution[y1][x1], '<->', solution[y2][x2]]
    if marker == '...':
        x1, x2 = sorted(random.sample(range(SIZE), 2))
        y1, y2 = random.randrange(SIZE), random.randrange(SIZE)
        return [solution[y1][x1], '...', solution[y2][x2]]
    # 'tri' — three columns in a row, left to right
    ys = [random.randrange(SIZE) for _ in range(SIZE)]
    return [solution[ys[0]][0], solution[ys[1]][1], solution[ys[2]][2]]


def _solver_wins(rules):
    """True if the game's deduction engine fully solves this 3x3 rule set."""
    walk = SelfWalkthrough([list(r) for r in rules], SIZE)
    walk.try_to_win()
    return walk.is_won


def _clue_cells(solution, clue):
    """The board cells (y, x) a clue refers to. Marker strings ('^', '<->',
    '...') are skipped; a three-in-a-row clue contributes all three cells."""
    cells = []
    for value in clue:
        if isinstance(value, int):
            y = value // 10 - 1
            cells.append((y, solution[y].index(value)))
    return cells


def _clue_is_useful(solution, clue, open_cells):
    """True if the clue points at a cell the player still has to solve.

    A clue whose cells are *all* pre-revealed is already satisfied on the
    board — it teaches nothing and only clutters the clue panel — so it is
    rejected here at generation time."""
    return any(c in open_cells for c in _clue_cells(solution, clue))


# Per level (0/1/2): how many clues each level carries. The board is laid
# out (see `_open_cells_in_rows`) so the level always costs exactly
# `level + 1` clicks to solve — level 0 -> 1 click, level 1 -> 2, level 2 -> 3.
_CLUE_COUNT = {0: 1, 1: 2, 2: 3}


def _open_cells_in_rows(n_rows):
    """Pick `n_rows` distinct rows and open exactly two cells in each.

    A row with two open cells always takes exactly one click to clear — pop
    one of the two leftover candidates and the row cascades shut — and the
    board's rows resolve independently of each other. A board laid out this
    way therefore always costs exactly `n_rows` clicks to solve."""
    cells = set()
    for ry in random.sample(range(SIZE), n_rows):
        for cx in random.sample(range(SIZE), 2):
            cells.add((ry, cx))
    return cells


def _generate_entry(level):
    solution = _random_solution()
    open_cells = _open_cells_in_rows(level + 1)
    given = [(y, x) for y in range(SIZE) for x in range(SIZE)
             if (y, x) not in open_cells]
    return TutorialLevel(0, level, solution, _define_rules(solution, given),
                         [])


def _markers_for(block, count):
    if block in _BLOCK_MARKER:
        return [_BLOCK_MARKER[block]] * count
    # mixed block — at least two distinct rule types when more than one clue
    for _ in range(40):
        picks = [random.choice(_ALL_MARKERS) for _ in range(count)]
        if count < 2 or len(set(picks)) >= 2:
            return picks
    return picks


def _make_clues(solution, block, count, open_cells):
    """`count` distinct clues of the block's rule type, all true for the
    solution and each pointing at a still-unsolved cell. None if such a
    distinct set could not be drawn."""
    markers = _markers_for(block, count)
    clues = []
    for marker in markers:
        for _ in range(60):
            clue = _true_clue(solution, marker)
            if clue in clues:
                continue
            if not _clue_is_useful(solution, clue, open_cells):
                continue
            clues.append(clue)
            break
        else:
            return None
    if len(clues) != count:
        return None
    if block == 5 and count > 1 and \
            len({_marker_of(c) for c in clues}) < 2:
        return None
    return clues


def _clues_all_needed(defined, clues):
    """True if dropping any single clue leaves the puzzle unsolvable — so
    every displayed clue genuinely carries weight."""
    for i in range(len(clues)):
        if _solver_wins(defined + clues[:i] + clues[i + 1:]):
            return False
    return True


def _generate_logic(block, level):
    """A solvable 3x3 with `level+1` clues of the block's rule type laid out
    over `level+1` two-open-cell puzzle rows — so the level costs exactly
    `level+1` clicks and every shown clue points at a cell still to solve."""
    want_clues = _CLUE_COUNT[level]
    want_rows = level + 1
    fallback = None
    # spend up to STRICT tries chasing a puzzle where every clue is essential;
    # past that, fall back to the first solvable, clue-dependent puzzle found.
    strict = 800
    for attempt in range(3200):
        if attempt >= strict and fallback is not None:
            break
        solution = _random_solution()
        open_cells = _open_cells_in_rows(want_rows)
        given = [(y, x) for y in range(SIZE) for x in range(SIZE)
                 if (y, x) not in open_cells]
        defined = _define_rules(solution, given)
        # the board must not solve itself before a single clue is read
        if _solver_wins(defined):
            continue
        clues = _make_clues(solution, block, want_clues, open_cells)
        if clues is None:
            continue
        # the clues must matter and the puzzle must fully solve
        if not _solver_wins(defined + clues):
            continue
        if _clues_all_needed(defined, clues):
            return TutorialLevel(block, level, solution, defined, clues)
        if fallback is None:
            fallback = (solution, defined, clues)
    if fallback is not None:
        solution, defined, clues = fallback
        return TutorialLevel(block, level, solution, defined, clues)
    return _generate_logic(block, level)  # vanishingly rare — try afresh


def generate_level(block, level):
    """Build the round for (block, level)."""
    if block == 0:
        return _generate_entry(level)
    return _generate_logic(block, level)


# --------------------------------------------------------------------------
# progress state machine
# --------------------------------------------------------------------------
class TutorialDirector(object):
    """Drives the onboarding: current block/level, mistakes, and the result
    of finishing a level."""

    def __init__(self, blocks_done=0):
        self.blocks_done = max(0, min(BLOCK_COUNT, int(blocks_done)))
        self.replay = False              # replaying an already-cleared block
        self.block = self.blocks_done if self.blocks_done < BLOCK_COUNT else 0
        self.level = 0
        self.mistakes = 0                # global — drives the teaching popups
        self.level_had_mistake = False
        self._reminder = 0               # cycles the win-plaque reminder text
        self._intro_shown = set()        # blocks whose intro popup was seen

    # ------------------------------------------------------------------
    @property
    def all_done(self):
        return self.blocks_done >= BLOCK_COUNT

    def has_logic(self):
        """True for blocks where a wrong click counts as a mistake."""
        return self.block > 0

    def block_name(self):
        return BLOCK_NAMES[self.block]

    def current_level(self):
        return generate_level(self.block, self.level)

    def intro_text(self):
        """The block-intro popup text — shown once, on the first visit to a
        block's opening level (not after a mistake reset)."""
        if self.level != 0 or self.block in self._intro_shown:
            return None
        self._intro_shown.add(self.block)
        return BLOCK_INTRO.get(self.block)

    # ------------------------------------------------------------------
    def start_replay(self, block):
        """Jump into a chosen block to practise it again (post-tutorial)."""
        self.replay = True
        self.block = max(0, min(BLOCK_COUNT - 1, int(block)))
        self.level = 0
        self.level_had_mistake = False
        self._intro_shown.discard(self.block)

    def restart_all(self):
        """Wipe progress and run the whole onboarding from block 0."""
        self.blocks_done = 0
        self.block = 0
        self.level = 0
        self.mistakes = 0
        self.level_had_mistake = False
        self.replay = False
        self._intro_shown.clear()

    def skip_all(self):
        """Mark the whole onboarding done — unlocks every game mode."""
        self.blocks_done = BLOCK_COUNT
        self.replay = False

    # ------------------------------------------------------------------
    def record_mistake(self):
        """Register a wrong click. Returns a teaching text for the first
        three mistakes, otherwise None."""
        self.level_had_mistake = True
        self.mistakes += 1
        if self.mistakes <= len(MISTAKE_TEXTS):
            return MISTAKE_TEXTS[self.mistakes - 1]
        return None

    def _next_reminder(self):
        text = MISTAKE_TEXTS[self._reminder % len(MISTAKE_TEXTS)]
        self._reminder += 1
        return text

    def complete_level(self):
        """Advance after a solved board. Returns a dict the presenter uses to
        build the win plaque and decide what comes next.

        outcome: 'level'    — on to the next level of this block
                 'reset'    — the level had a mistake, block restarts at 0
                 'block'    — block cleared, next block begins
                 'replay'   — a replayed block is finished
                 'tutorial' — block 6 cleared, onboarding over
        """
        was_block, was_level = self.block, self.level
        mistaken = self.has_logic() and self.level_had_mistake
        self.level_had_mistake = False
        result = {'outcome': 'level', 'goal_hint': False, 'praise': None,
                  'reminder': None, 'final': None}

        if mistaken:
            result['outcome'] = 'reset'
            result['reminder'] = self._next_reminder()
            self.level = 0
            return result

        if was_block == 0 and was_level == 0:
            result['goal_hint'] = True

        self.level += 1
        if self.level < LEVELS_PER_BLOCK:
            return result

        # the block is finished
        self.level = 0
        if self.replay:
            result['outcome'] = 'replay'
            result['praise'] = _replay_praise(was_block)
            self.replay = False
            return result

        if was_block == self.blocks_done:
            self.blocks_done += 1

        if self.blocks_done >= BLOCK_COUNT:
            result['outcome'] = 'tutorial'
            result['final'] = FINAL_TEXT
            return result

        result['outcome'] = 'block'
        result['praise'] = _block_praise(was_block)
        self.block = was_block + 1
        return result

    # ------------------------------------------------------------------
    def tracker(self):
        """The 6-block progress rows for the side panel and win plaque:
        a list of (name, cleared_levels, done, is_current).

        A fully-cleared block reads as `done` (struck through, 3/3) — unless
        it is the block being played right now, first run or replay alike,
        which instead shows live progress and the current-row highlight. Once
        the whole tutorial is finished there is no current block, so every
        row settles to a struck-through 3/3."""
        playing = not (self.all_done and not self.replay)
        rows = []
        for i in range(BLOCK_COUNT):
            is_current = (i == self.block) and playing
            cleared_block = i < self.blocks_done or i < self.block
            if is_current:
                cleared, done = min(LEVELS_PER_BLOCK, self.level), False
            elif cleared_block:
                cleared, done = LEVELS_PER_BLOCK, True
            else:
                cleared, done = 0, False
            rows.append((BLOCK_NAMES[i], cleared, done, is_current))
        return rows
