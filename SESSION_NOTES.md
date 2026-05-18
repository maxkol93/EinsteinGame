# Session notes

Quick context for resuming work.

## Done this session

**1. Full tutorial rework — 6-block onboarding**
Replaced the old separate-window `InteractiveTutorial` with a seamless
onboarding played on the real board (3×3). 6 blocks × 3 levels:
Entry · Same column · Neighbors · Left of · Three in a row · Mixed.
- `model/tutorial.py` (new) — `TutorialDirector` (progress/mistakes/tracker)
  + 3×3 puzzle generator verified by `SelfWalkthrough`.
- `model/settings.py` — `tutorial_seen` (bool) → `tutorial_blocks` (0-6),
  backward-compatible.
- `model/self_walkthrough.py` — bounds guards in field accessors (the engine
  went out of range on 3×3 three-in-row; 4/5/6 behaviour unchanged).
- `view/ui.py` — `TutorialPopup`, `TutorialResultOverlay`,
  `TutorialMenuOverlay`, `BlockSelectOverlay`, `draw_tutorial_progress`;
  `Segmented.enabled` flag.
- `view/window.py` — tutorial mode: side-panel 6-block tracker, no
  timer/lives/hint, popup plumbing, clue spotlight.
- `presenter/game.py` — tutorial orchestration (round lifecycle, click
  handling, win flow, block progression, replay, skip).
- `view/tutorial.py` — deleted.
Behaviour: instant playable board + one welcome popup; block intros for
blocks 1-5; 1st/2nd/3rd mistake → teaching popups, then win-plaque reminders;
a mistake resets the block; tutorial win plaques show the tracker; after
block 6 everything unlocks; menu offers block replay; progress saved per
block (web localStorage).

**2. Build optimization**
- CDN mirror moved to `~/.cache/einstein-pygame-cdn/` — persistent across
  sessions, outside the project (so pygbag never bundles its 22 MB).
- `build_web.sh` self-heals: missing CDN files are re-fetched via curl.
- Build time ~6 s (was a multi-minute manual recovery when `/tmp` cleared).
- `einsteingame-itch.zip` rebuilt (13.7 MB).

**3. `GAME_REVIEW.md`** — design / art-UX / marketing review + itch page.

## Verified (headless)
18-level perfect run, mistake→reset, block replay, normal 4×4 game, real
async `run()` loop, settings persistence. All pass.

## Not mine — left untouched
Pre-existing uncommitted edits in `field_and_rules.py`, `stats.py`,
`decoder.py`, `effects.py`, `sounds.py`, `*.ogg`, `main.py` were already in
the working tree before this session.

## Next steps (priority — see GAME_REVIEW.md §5)
1. Daily Puzzle (RNG seeded by date) — retention.
2. Achievements/badges + win-streak counter.
3. "Retry this exact board" on loss; Zen/casual mode.
4. Ambient music + cascade combo-pitch + ripple VFX.
5. Set up the itch.io page (copy ready in GAME_REVIEW.md), capture GIFs/shorts.
