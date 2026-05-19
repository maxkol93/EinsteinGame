# Session notes

Quick context for resuming work. Latest session: **2026-05-19**.

## Done — 2026-05-19

Two commits on branch `claude/work`.

### Commit `354fa00` — bug fixes + cascade/feel rework
A 12-item list:
- Tutorial levels now cost exactly **1 / 2 / 3 clicks** per level
  (`_open_cells_in_rows` lays out N two-open-cell rows).
- A clue whose cells are all pre-revealed can no longer appear (it was
  "already satisfied"); every clue points at an unsolved cell.
- Completed tutorial showed the last block `0/3` → `tracker()` rewritten;
  a replayed block is un-struck and shows live progress, the rest stay `3/3`.
- Won/lost menu drops "Continue", "Restart" → "Play".
- Sound: every effect throttled + `snd.stop()` before replay — kills the
  overlapping/comb-filter "the sound played 3×" mush.
- 0.35 s cooldown after a wrong click (no spam).
- Click sound on every menu widget.
- Tooltip semi-transparent + wider (no orphaned cell tile).
- Resolved rows pop in as a real **staggered cascade** (visual + sound).
- **Long-press a candidate** to "define" its cell, with a radial fill ring.
- Brief **slow-mo** when a 3+-cell cascade starts.

### Commit `527618e` — GAME_REVIEW §5 retention/reach plan
- **#1 Daily Puzzle** — `model/daily.py`, one date-seeded board a day,
  identical for everyone; `FieldAndRules(seed=)` makes any board
  reproducible. Menu shows "Daily #N" (+ ✓ when solved).
- **#2 Achievements + streaks** — `model/achievements.py` (10 badges).
  `Stats` restructured: win streak, Daily streak, badge set (legacy flat
  saves still load). New **Progress** screen = streaks + per-mode stats +
  badge grid; freshly-earned badges shown on the win plaque.
- **#3 Retry same board** — win/lose plaque offers Retry (same seed) / New.
- **#4 Zen mode** — menu toggle; mistakes count for score but never end the
  run; left panel shows a ZEN badge instead of lives.
- **#6 Result sharing** — `view/clipboard.py`, "Copy result" on a win.
- **#7 Quick 3×3** — a fourth board size.
- Menu reworked: Daily button, Zen toggle, 4-way size, Progress button
  (per-mode stats moved off the menu onto the Progress screen).

## Still open — GAME_REVIEW.md §5

- **#5** ambient music — needs a CC0 audio file (not invented). Cascade
  combo-pitch — pygame has no pitch-shift; would need resampled variants.
- **#8** itch.io page + 3 shorts — not code; page copy is ready in
  `GAME_REVIEW.md §4`.
- **#9** weekly hard challenge — deferred until a live-player test.

## Verified
All work tested headless (`SDL_VIDEODRIVER=dummy SDL_AUDIODRIVER=dummy`):
tutorial 1-2-3 clicks + solvability, tracker, full 18-level run, seeded
board + Retry reproducibility, Daily, Zen no-game-over, 3×3, cascade,
slow-mo, long-press, every overlay renders on-screen, menu flow, win/lose
flow, real `run()` loop.

## Build
`bash build_web.sh` → `einsteingame-itch.zip` (~13.8 MB, gitignored).
CDN mirror persists under `~/.cache/einstein-pygame-cdn/`.

## Earlier work
The 6-block tutorial rework + web-build optimization landed in an earlier
session (see git history before `354fa00`).
