# Session notes

Quick context for resuming work. Latest session: **2026-05-25**.

## 2026-05-25 — pygame paused, Phaser port started

**Decision:** stop investing in the pygame/pygbag web build and port the game to
**Phaser 3 + TypeScript + Vite**. Reasons: poor browser performance, web-audio
(pygame mixer) stutter/lag, and the heavy ~13.8 MB bundle. pygame is *paused, not
deleted* — it stays buildable as the reference implementation.

- Committed & pushed all remaining pygame work (the 2026-05-20 reshape → 2026-05-24
  mobile pass) as `d1cf7a6`.
- Added **`CLAUDE.md`** at repo root — the authoritative, session-loaded guide:
  version states, repo layout, and the parallel-dev rules (one repo, no fork/no
  long-lived branch since the trees share no code; `shared/` source of truth;
  Daily must stay identical across versions; CI split by path).
- Scaffolded **`phaser/`**: Phaser 3 + TS + Vite, `BootScene` + a placeholder
  `GameScene` (grid + candidate squares + pointer "pop") in the real Mocha
  palette. `npm run build` is green; bundle ~340 KB gzipped.
- Added **`shared/`** (`palette.json` mirroring `view/palettes.py`,
  `daily_vectors.json` stub + contract README) and
  `.github/workflows/phaser.yml` (path-scoped CI: typecheck + build).

**Next:** port the puzzle model (`field_and_rules.py`), cascade, then the seeded
daily generator (validate against `shared/daily_vectors.json`).

## 2026-05-25 — Phaser is playable (full puzzle logic)

Ported the whole puzzle model to TS and built a playable game on top of it.

- **Model (`phaser/src/model/`, no Phaser deps):** `rng.ts` (seeded PRNG,
  Python-`randint` semantics — mulberry32, NOT CPython MT yet), `decoder.ts`
  (glyph + clue text), `selfWalkthrough.ts` (faithful port of the deductive
  solver), `fieldAndRules.ts` (board + clue generator; grows clues until the
  solver certifies no-guess solvable, then trims), `board.ts` (player board:
  pop/define + the row cascade, answer-grid-guarded like the pygame view).
- **Game (`phaser/src/scenes/`):** `MenuScene` (size 4/5/6 × Easy/Normal/Hard)
  and `GameScene` (board with candidate sub-grids per cell, row colour =
  category, tap-to-pop, right-click/long-press-to-define, staggered cascade
  animation, lives/timer, clickable clue panel, win/lose overlay with New/Retry/
  Menu). Shared `ui/button.ts`.
- **Verified:** `npm run smoke` generates 270 boards across every size/difficulty
  — all logically solvable, cascade-correct and deterministic (~6 s). `npm run
  verify` (Playwright headless) loads the build and plays menu → game → pointer
  pop+cascade → auto-solve → win with **zero console/page errors**; 6×6 Hard
  (22 clues) lays out cleanly. `npm run build` green, ~348 KB gz.

**Not yet ported (later):** exact Daily/Weekly/Monthly (needs CPython-MT-matching
RNG validated against `shared/daily_vectors.json`), stats/achievements/Zen/
tutorial, and the juice + sound pass.

## Done — 2026-05-24 (mobile tweaks)

- **Portrait only on actual phones.** `view/window.py` now picks orientation by
  viewport (`platform.window.innerHeight > innerWidth`) — desktop browsers and
  the desktop app stay landscape; only a taller-than-wide phone goes portrait.
  `build_web.sh` reports the landscape fb (build machine) and injects a small JS
  observer that keeps `--ar`/`--ari` synced to the live `#canvas` backing, so
  whichever framebuffer the game creates contain-fits without blur.
- **Entry-tutorial cascade restored.** Block 0 runs the normal row cascade
  again (the earlier no-cascade tuning is gone); `_BLOCK0_CELLS`/`_generate_entry`
  reverted, presenter sets `set_row_cascade(True)`. Verified 360 plays solve
  fully with no blank cell.
- **Portrait hints/tooltips legibility.** Hint pill uses a 20 px font; the clue
  tooltip is bigger (22 px) and floats **above** the clue group (over the board)
  instead of beside it, so it never covers neighbouring clues.
- **Web audio lag mitigation** (pygame mixer stutters on emscripten): dropped
  the per-`hover` tick, cut channels 16→8, removed the per-trigger `snd.stop()`,
  and the cascade now plays **one pick per resolved cell** (row-strike shimmer
  pops are silent) instead of a pick per struck candidate. Music/SFX otherwise
  unchanged. (If still laggy, next step is moving the loop to an HTML5 `<audio>`
  element off the mixer.)

## Done — 2026-05-24 (portrait / mobile layout)

The game now lays out in **two orientations**, chosen at import in `view/window.py`:
`PORTRAIT` defaults true on the web build (`sys.platform=='emscripten'`),
false on desktop, overridable by `EINSTEIN_PORTRAIT`. `build_web.sh` reads the
dims with `EINSTEIN_PORTRAIT=1`, so the **web bundle ships portrait** (canvas
760×1256); desktop runs landscape unchanged.

- **Portrait stack:** a slim info strip on top (MENU · TIME · HINT, then
  LIVES/ZEN · SOLVED · MODE), the board **maximised by width** below it
  (`BOARD_SPAN = W − 2·14`, so 4×4–6×6 cells are much larger than landscape),
  and the clues spread across the bottom in as many columns as fit
  (`_build_rules_buttons_portrait`). The board/cell/candidate code is shared —
  only the region placement branches on `PORTRAIT`.
- New portrait draw paths: `_draw_top_strip` (+ tutorial variant with a
  6-dot progress row), `_draw_rules_panel`/`_draw_progress`/`_heart_pos`/
  `_draw_message` all branch; shadow strips are landscape-only.
- **Bigger popups on mobile.** Every overlay is rendered at natural size then
  drawn *and hit-tested* through a uniform `ui_scale` (1.28 in portrait) on the
  `_Overlay` base — no per-panel font/layout retuning, no overflow. `window`
  calls `set_ui_scale()`. Also: the win plaque drops its flavour line when a
  NEW RECORD banner is shown (they used to collide).

## Done — 2026-05-24 (GAME_REVIEW §2/§5 follow-up)

New sound assets pulled from `origin/main`: `ambient_loop.ogg` + `pick_2/3/4`.

- **Solver audit.** Fixed an operator-precedence bug in the three-in-a-row
  branch of `SelfWalkthrough` (`and` bound tighter than `or`). Cross-checked
  with an independent exact CSP solver: **212 generated boards across every
  size/difficulty all have a unique solution** → the "never a guess" promise
  holds. Generation stress unchanged (270 boards ~24 s, no failures).
- **HINT always useful.** `find_hint_target` now covers triple clues (via the
  known answer grid) and falls back to a solution-derived "safe pop" when no
  clue yields a clean elimination, so the button never says "no hint" on a
  solvable board. Clue-less hints read "pop this one".
- **Ambient music.** `SoundManager` loops `ambient_loop` on reserved channel 0
  with its own volume; a **MUSIC** slider joins the renamed **SOUND** slider in
  the menu. `settings.music` persists. The loop self-re-asserts (web needs a
  user gesture to start audio).
- **Cascade juice.** Combo-pitch: cascade depth plays `pick → pick_2 → pick_3
  → pick_4`. A floating **"+N chain!"** appears when one click resolves ≥3
  cells, plus a wide slow "wave" ripple ring per resolved cell.
- **Reduce-motion** toggle (`settings.reduce_motion`): gates screenshake, the
  cascade slow-mo, particle bursts, confetti and the vignette pulse; localized
  flashes/rings/cell-pops stay so feedback is still clear.

## Done — 2026-05-24

A fix-list pass on the 2026-05-20 reshape (uncommitted on `claude/work`).

### Cascade
- **Empty-cell softlock fixed.** `GameWindow.set_solution(grid)` is now called
  (presenter passes `model.field` / a logic level's `solution`) and
  `_cascade_resolve` resolves each cell to its *correct* value. A stale cascade
  beat can no longer place a value already in the row, which is what used to
  blank a cell (no big cell, solved-count short) and lock the board.
  `_create_big_button`'s duplicate drop now only fires for real puzzles
  (`_row_cascade`), so the free practice block can't be blanked by it either.
- Cascade steps slowed so the stagger is visible: `BIG_CASCADE_STEP` 0.10→0.20,
  `ROW_CASCADE_STEP` 0.05→0.13.

### Tutorial (block 0)
- **Exactly 4-6-8-4-6-8 gestures.** Row cascade is turned off in block 0
  (`set_row_cascade(False)`), so each cell costs one gesture: tap cells keep all
  three candidates (two taps each, 2/3/4 cells), hold cells are one hold each
  (4/6/8 cells). `_BLOCK0_CELLS` is now `[2,3,4,4,6,8]`.
- The wrong gesture (a hold on the tap half, a tap on the hold half) is now
  silently ignored — a small nudge, no teaching popup.
- The welcome / pre-level-4 popup animations are redrawn as real board cells:
  true row colour (A/B/C), the candidate sub-grid, the board backdrop, the
  cursor popping candidates and the radial hold-fill ring → big-cell bloom.

### Hints
- The HINT button is back (bottom of the left panel). It is offered after the
  idle window on Easy/Normal, is **always** present in Zen (free), and never on
  Hard or in the tutorial. Pressing it rings a candidate + its clue; the
  highlight now stays until the player's next move (no 5 s auto-clear).

### Clipboard
- "Copy result" no longer throws an unhandled Promise rejection on itch: the
  synchronous `execCommand` path is tried first and `writeText`'s promise gets a
  `.catch`.

### Progress screen
- The five milestone-star columns are spread out (`_STAR_GAP` 4→12) and badges
  render in three columns with a dot marker.

## Done — 2026-05-20

A large reshape of features + bug-fix list (uncommitted on `claude/work`).

### Modes / progression
- 3×3 removed as a selectable size; sizes are now 4×4 / 5×5 / 6×6.
- Mode progression: only **Easy 4×4** is open at first; clear 3 wins to
  unlock the next size, and 3 wins in every size of a difficulty to unlock
  the next difficulty. Locked options render with a padlock + tooltip.
- Debug: pressing **`U`** flips `settings.unlock_all` and unlocks everything
  (not surfaced in the UI).

### Seeded puzzles
- **Daily / Weekly / Monthly** puzzles now all live in `model/daily.py`. The
  main menu shows three buttons. Inactive in Zen mode (a notice pops up).
- Stats keep separate `daily` / `weekly` / `monthly` blocks: count, streak,
  best streak, best time.

### Zen / Retry don't record
- `_finish_round` only records wins (and grants achievements / counters the
  win streak) when `records_count = not (zen or is_retry)`. Loss recording
  is similarly gated.

### Stats screen rebuilt
- Per-(difficulty × size) rows, plus three seeded-puzzle rows on top.
- Each row: name, best time, total wins, and **5 milestone stars** earned
  at 5 / 10 / 20 / 50 / 100 wins (grey until earned).
- Win-rate column removed. Legacy 1-3 best-stars removed.
- Achievements badges still shown as a compact list under the table.

### Hint rework
- The HINT button is gone. Hints **auto-show after idle**: 20 s on Easy,
  40 s on Normal, never on Hard / tutorial.
- A hint no longer reveals the answer of a random cell. It picks an
  **unsatisfied clue** that still eliminates a candidate, then rings both
  the clue and the candidate to pop (`pop this — see the clue`). Logic for
  `^`, `<->` and `...`; triple clues fall through to the next rule.

### Auto-dim clues
- `GameWindow.auto_dim_satisfied_rules()` runs after every cell change.
  A clue whose values are all in solved big cells gets pressed (the same
  dim state a manual click on a clue produces).

### Win plaque
- Stars row + score line gone. The plaque shows the run time large with
  `best XX:XX` underneath and, if the run beat the previous best, a
  pulsing **NEW RECORD!** banner above the time block.

### Cascade
- Small candidates being struck from a row by a `_remove_all_in_row` step
  now stagger by `ROW_CASCADE_STEP=0.05 s` per cell. `BIG_CASCADE_STEP`
  dropped from 0.12 → 0.10.

### Tutorial
- **Block 0 ("Entry") expanded to 6 levels** (4-6-8-4-6-8 unsolved cells).
  Levels 0-2 are tap-only (`level.hold_ok = False`); 3-5 are hold-only
  (`level.tap_ok = False`). Using the wrong gesture shows a TIP popup.
- A "switch to hold" popup pops once before level 4 (`gesture_intro()`).
- TutorialPopup can render a **looped cursor animation** in-panel:
  - `animation='pop_to_solve'` — welcome popup, cursor taps two candidates,
    the third remains.
  - `animation='hold_to_define'` — pre-level-4 popup, cursor holds a
    candidate with a growing radial-fill ring; cell snaps to that glyph.
- Tracker tuple now `(name, cleared, total, done, is_current)`. The old
  4-tuple form is still tolerated for legacy saves.

### UI cleanup
- Theme switcher gone. `mocha` is the only palette; `view/palettes.py` is
  reduced to a single `PALETTE` constant.
- Lives-increase debug footer (`L = +life`) removed from the UI. The L /
  +/= keyboard shortcuts still call `add_life()` for debugging.

### Bug fixes
- **Save lock / load hang**: `FieldAndRules._initialize_self_walkthrough`
  used to spin forever on pathological seeds. Added a 600-add /
  400-attempt cap that raises `RuntimeError`; the presenter catches it and
  re-rolls (or, for seeded puzzles, mutates the seed locally so the user's
  session at least starts).
- **Clipboard blocked on itch**: `view/clipboard.py` now falls back to an
  off-screen `<textarea>` + `execCommand('copy')` when
  `navigator.clipboard.writeText` is blocked by the iframe's
  Permissions-Policy.
- **Duplicate value in top row**: `_create_big_button` refuses to create a
  second big cell with a value that's already solved elsewhere in
  `_big_buttons` — silently dropping a stale cascade request instead of
  rendering two identical cells in one row.
- **Itch iframe extra rows**: build_web.sh canvas CSS replaced — the old
  `object-fit:contain` doesn't apply to `<canvas>`, so the canvas would
  paint at natural size inside a small iframe. Now the canvas is absolutely
  positioned and `max-width:100% / max-height:100%`, with `html, body`
  pinned to viewport size and `overflow:hidden`.

## Verified
All work tested headless (`SDL_VIDEODRIVER=dummy SDL_AUDIODRIVER=dummy`):
- enter_game flow → menu → playing → win plaque (with the new layout).
- Tutorial walks through the expanded 6-level entry block.
- Locks: only `[False, True, True]` for sizes when at Easy with no wins.
- `unlock_all` debug flag unlocks everything.
- `auto_dim_satisfied_rules()` flips clues to pressed once their values are
  all solved.
- Stress test: 270 (size × difficulty × seed) board generations in ~20 s,
  no hang.

## Build
`bash build_web.sh` → `einsteingame-itch.zip` (~13.8 MB, gitignored).
CDN mirror persists under `~/.cache/einstein-pygame-cdn/`.

## Earlier work
See git history before this session (b2d0e0a / 527618e / 354fa00).
