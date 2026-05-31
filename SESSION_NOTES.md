# Session notes

Quick context for resuming work. Latest session: **2026-05-31**.

## 2026-05-31 — Phaser: new music/SFX (menu loop + random game loop)

The user replaced the audio (commit "sound v3" in `view/sounds/`): added
`game_loop_1/2/3` (game_loop_3 = the old ambient_loop renamed), a `menu_loop`,
and new `lose/pick/pick_2/win/wrong` SFX. Wired the Phaser build to it:

- Copied the new/replaced oggs into `phaser/public/sounds/` (removed
  `ambient_loop.ogg`). The replaced SFX keep their keys → no code change.
- `audio/sound.ts`: split music into a per-context bed. `playMusic('menu')`
  loops `menu_loop`; `playMusic('game')` picks a **random** game loop per game
  session (user's choice). Switching context stops the previous bed; only one
  loop plays at a time. `startMusic()` kept as a menu shim; `setMusicEnabled`
  replays the current context.
- Scenes: MenuScene → `playMusic('menu')` (but NOT when it's the pause overlay
  over a still-paused game — keeps that game's loop so Continue is seamless);
  GameScene + TutorialScene → `playMusic('game')`.
- `verify.mjs` audio assertion updated to the new loop keys.
- **Verified:** typecheck/build clean, `verify` green; a music probe confirmed
  the menu plays `menu_loop` and the game a single random `game_loop_*`.

## 2026-05-31 — Phaser: tutorial polish + menu continue/restart + block select

Seven player-reported items:
1. **Win particles now loop** — `fx.celebrate` keeps a continuous confetti rain
   emitter + a periodic gold pop on a timer, on top of the one-shot burst;
   `stopCelebrate()` tears it down (scene shutdown also clears it).
2. **Tutorial hover/highlight/tooltips** — ported the game's cross-highlight +
   tooltip system into `TutorialScene` (chip/big/clue `Glowable`s, spread glow,
   `ruleSegments` tooltip at 0.7 alpha). Verified: hovering a clue lights the
   linked chips/cells + shows the floating "… same column as …" tooltip.
3. **Hold-level tap reminder** — on a block-0 hold-only level, the 6th stray tap
   pops the `hold_to_define` reminder popup (counter resets per level).
4. **Entry cell counts** 4-6-8-4-6-8 → **6-7-8-6-7-8** (`BLOCK0_CELLS`).
5. **Three-in-a-row direction** — `trueClue` 'tri' takes a `triDir`; block 4
   forces level 0 left-to-right and level 1 right-to-left so both are taught.
6. **Menu continue/restart** (pygame's `finished` flag): the in-game MENU now
   PAUSES the board and launches the menu over it (`bringToTop` — scenes render
   in config order); the menu then shows **CONTINUE** + **New game** when a game
   is paused, else a single **Play**. Continue resumes; New game stops+starts.
   A finished board shuts down → menu shows only Play.
7. **Tutorial block select** — the menu's TUTORIAL button opens a
   BlockSelectOverlay (the 6 blocks + Back); picking one `startReplay`s it.

Verified: `typecheck` clean, `tut-smoke` 420 + `smoke` 270 still 0 fails,
`verify` green; screenshots confirm the continue menu, block select, and the
tutorial hover+tooltip. (Headless full-win-rain shot timed out under throttled
rAF — the loop is code-verified + celebrate runs error-free in verify.)

## 2026-05-31 — Phaser: full tutorial (6-block onboarding)

Ported the entire onboarding from `model/tutorial.py` + the presenter/view
tutorial paths — blocks, rules, progress, popups, texts and animations.

- **`model/tutorial.ts`** — full port of `TutorialDirector` + the 3x3 generator:
  block 0 "Entry" (free gesture practice, 6 levels 4-6-8-4-6-8 cells, tap-only
  0-2 / hold-only 3-5) and blocks 1..5 (one rule type each, then Mixed),
  generated and verified with `SelfWalkthrough` so every level is solvable in
  exactly `level+1` clicks with every clue essential. All texts, the tracker,
  mistake/praise/reminder logic, intro/gesture popups. Unseeded (Math.random).
- **`ui/tutorialPopup.ts`** — the message panel over a dimmed board with an
  optional pulsing **spotlight** and the two **looped gesture demos** drawn live
  on a Graphics: `pop_to_solve` (cursor taps two candidates, the third blooms)
  and `hold_to_define` (cursor holds, a fill-ring completes, the cell snaps).
- **`scenes/TutorialScene.ts`** — 3x3 board reusing the game's chips/big-cell/
  cascade/hold-ring/fx machinery; left panel = the 6-block tracker; right =
  clues (blocks 1+); enforces block-0's tap/hold split (wrong gesture = silent
  nudge) and scores logic-block mistakes (wrong removal → block resets, teaching
  popup); the result overlay (LEVEL/BLOCK/TUTORIAL CLEAR + tracker + Continue).
  Director persists across per-level `scene.restart` via the registry.
- **Entry:** `model/board.ts` gained a `free` mode (cell keeps the player's
  remaining candidate, no solution-correction) for block 0. `settings.ts` stores
  `tutorial_blocks` (0..6). `BootScene` sends a brand-new player straight into
  the tutorial; the menu has a ▶/↺ TUTORIAL button (resume / replay). Finishing
  unlocks the `tutorial` achievement.
- **Verified:** `typecheck` clean; `npm run tut-smoke` 420 levels (all solvable,
  director reaches 'tutorial'); `npm run smoke` 270 normal boards still 0 fails
  (free flag safe); standard `verify` green. Screenshots confirm the welcome
  popup + live A/B/C demo, block-1 intro with clues + spotlight, and the result
  overlay with the progress tracker. (Full 21-level headless drive is too slow
  under throttled rAF, so it's verified per-stage, not end-to-end.)

## 2026-05-31 — Phaser: polish pass #3 (juice/feel)

1. **Chip hung in the air after a WRONG tap** — doAction's `hoverEnd()` starts a
   lift-return tween that `registerWrong` then killed mid-flight. `registerWrong`
   now normalises the chip to rest (depth/scale/tint/pos, outline α0) before the
   jitter. (Verified: depth 5, outline α 0, dy 0, scale 1 after a wrong tap.)
2. **Screen shake too strong** — `bigBurst` 4→1.6 (130 ms), wrong 9→2.4 (170 ms).
   Calm taps, not jolts.
3. **Multi-tone square particles** — replaced with one soft round
   `softDotTex` (radial-gradient), MONOCHROME (single `tint`, no white sparks /
   no per-particle colour), softer gravity (240) + longer lifespans + size/alpha
   ease-out so the spray drifts, settles and lingers. Cleaner, more tactile.
4. **Tooltip alpha** 0.6 → 0.7.
5. **Lift shadow was a fuzzy oval** — `shadowTex` is now a tight (blur 2.5),
   pure-black, rounded-rect that nearly fills its texture, so displaySize maps
   1:1 and the shape matches the element. Drawn just bigger than the face and
   offset down+aside (buttons (3,8) ×1.0; chips (cx+3,cy+7) ×1.08) → reads as
   "raised a little" with a defined dark edge below.

Verified: `typecheck` clean, `verify` green, screenshots confirm the
button-shaped shadow + monochrome round particles.

## 2026-05-31 — Phaser: polish pass #2 (11 more fixes)

Second player-reported list. Files: `config.ts`, `main.ts`, `fx/fx.ts`,
`ui/button.ts`, `ui/textures.ts`, `scenes/{Game,Menu}Scene.ts`.

1. **Clues unsorted** — `buildClues` now ranks by type: `^` → `<->` → `...` →
   triple (was just "operator-first").
2. **Outline hung in the air** — a lifted candidate popped by a cascade left its
   lift/outline/drop-shadow up (no `pointerout`). `destroyChip`/`renderBig` now
   `hoverEnd()` if the lifted chip is the one being torn down, and `hoverEnd`
   force-hides the shared `liftShadow`.
3. **Shake too strong on solve** — `bigBurst` shake 7→4 (dur 240→200).
4. **Pops too brief** — `smallBurst`/`bigBurst` ring+particle lifetimes and the
   big-cell grow tween lengthened so the solve/pop reads.
5. **Whole game blurry fullscreen** — supersample: render buffer is
   `RENDER_SCALE`(=2)× the logical size and each scene's camera zooms back +
   re-centres (`applyRenderScale`), so text AND textures draw at 2× density.
   (Hit-testing verified intact.)
6. **No hold progress** — `startHoldProgress` draws a radial fill ring during a
   long-press; completes → define fires. (Verified visually.)
7. **Lift shadow too fuzzy** — `shadowTex` blur 8→4 px, darker; crisper lift.
8. **Hover outline on menu buttons** — removed; hover is now lift+shadow+brighten
   only (outline reserved for the selected state).
9. **Combo from 3** → from **2** resolved cells.
10. **Outline stuck after auto-dim** — the mini outline was inside `objs` so the
    0.32 dim left it visible; pulled it out and `dimGroup` now clears it.
11. **Tooltip too opaque** — alpha 0.82→0.6.

Verified: `typecheck` clean, `verify` green (clicks fine under supersample),
screenshots confirm clue sort, the hold ring, crisp text/art, lift+shadow.
NB: headless rAF throttles when fully idle (entrance `busy` only clears once
frames render) — not a bug; real browsers render at 60fps.

## 2026-05-31 — Phaser: polish pass (10 visual/behaviour fixes vs pygame)

Fixed a player-reported list of port divergences (visuals + feel). Files:
`scenes/GameScene.ts`, `fx/fx.ts`, `ui/button.ts`, `ui/textures.ts`, `main.ts`.

1. **Big cells darkened after hover** — the colour is baked into the big-cell
   texture, so `glow` tinting it by the row colour multiplied → darkening.
   `Glowable` now carries `tintBase`/`tintHi`; big cells stay `0xffffff` and
   glow via outline+scale only. (Verified: tint stays `ffffff` after hover.)
2. **Clue minis had no outline on highlight** — added a stroked-rounded outline
   image per clue mini; `clueGlow` lights it like a board chip.
3. **No radial shockwave rings** — `fx.ring` now draws ADDITIVE
   (`BlendModes.ADD`, like pygame's `BLEND_RGBA_ADD`), wider, with a faint inner
   echo, so the wave reads on resolve and on small pops.
4. **Clue minis hopped on hover** — `Glowable.canHop` gates the hop; board chips
   hop, clue minis only glow.
5. **Blurry text fullscreen** — under `Scale.FIT` the 1295×735 buffer is
   stretched. Patched the Text factory to render every label at higher internal
   resolution (`devicePixelRatio*1.5`, capped 4) + `render.roundPixels`.
6. **Menu buttons didn't lift** — `makeButton` now has a soft drop shadow; on
   hover the face lifts and the shadow deepens (was a flat brighten).
7. **Hint reworked** — full port of `find_hint_target`/`_rule_eliminates`: rings
   a candidate an *unsatisfied clue* logically forbids AND lights that clue;
   falls back to a solution-safe pop. The highlight **persists until the next
   move** (`clearHint` on any action) instead of auto-fading.
8. **No board entrance** — `playEntrance` births cells diagonally
   ((y+x)·45 ms) with fade+scale overshoot (pygame `_cell_t_birth`); input held
   until the wave finishes.
9. **Clues didn't auto-deactivate** — ported `auto_dim_satisfied_rules`: after
   every change, a clue whose every value is now solved dims. (Verified: 2/2
   clues dim on solve.)
10. **Opaque tooltips** — dropped the tooltip bg to alpha 0.82 so the board
    shows through.

Verified: `typecheck` clean, `verify` green (zero console errors), screenshots
confirm the lift/shadow, crisp text, persistent hint, semi-transparent tooltip.
Model untouched, so the generator/solver audit + smoke still hold.

## 2026-05-31 — Phaser: port-faithfulness audit & fixes

Audited the pygame→TS port (cascade, solver, generator, decoder, RNG, stats/
progression/zen) for incorrect translations. Most of it is faithful; fixed the
two real divergences found.

- **Fixed (med) — starter-clue pairing desync** (`fieldAndRules.ts`
  `generateStartRules`). The pygame loop `while len: for num in min_nums:`
  mutates the list *during* iteration, so CPython's index-based iterator skips
  the element shifted into the current slot; the TS port used `shift()` (always
  index 0, no skip) and `randint` instead of `choice`. Different pairs + a
  different RNG-consumption order. Harmless for random play (the solver still
  grows every board to solvable — smoke stays 270/270), but it would desync the
  future Daily/Weekly/Monthly, where CLAUDE.md requires the versions to match.
  Now replicates CPython's mutate-during-iterate exactly (index walked over the
  live list, `choice` not `randint`). See `field_and_rules.py:82-92`.
- **Fixed (low) — `defineOther` two-defined branch** (`selfWalkthrough.ts`). A
  trailing `else` also caught the `{0,2}` key case (middle unplaced), where
  `defined.get(1)` is `undefined` → `curX = NaN` fed into `defineThisCell`.
  Python only acts in its `0 not in` / `2 not in` branches (the `{0,2}` case
  leaves it unbound). Now mirrors that with an explicit `else if (!has(2))` and
  a no-op fallback. Pathological mid-deduction state (unreachable in normal
  play), but it was a genuine branch-translation error.
- **Verified faithful (no change):** the cascade/board state machine (order of
  strike → big-cell → row-clear → re-check all match; the duplicate guard is if
  anything *safer* than pygame's blank-the-cell bug), the solver's operator
  clues incl. the known `and`/`or` precedence fix, the generator caps/trim, the
  36-glyph decoder table (codepoint-for-codepoint), `randint` inclusivity, and
  the COMPLEXITY "cells given" table.
- **Intentional, not a bug:** clue-tooltip wording was shortened for the
  compact Phaser tooltip ("same column as" vs "is in the same column as", etc.)
  — structurally the same segments; left as-is.
- **Checked:** `npm run typecheck` clean, `npm run smoke` 270/270 (avg 9.7
  clues, unchanged), `npm run verify` green with zero console errors.

## 2026-05-31 — Phaser: Zen mode

Ported Zen — a calm, no-lives solve. Faithful to presenter.py's `_zen` flag.

- **Settings:** added the persisted `zen` flag to `model/settings.ts`.
- **Menu:** a top-left **☯ ZEN ON/OFF** toggle (mirrors the audio toggles);
  when on, PLAY launches the board in Zen and a note reads "no lives, just
  solve". The flag persists across sessions.
- **GameScene:** in Zen a wrong move gives the full feedback (red flash, shake,
  jitter, `wrong` sfx) but **never costs a life and never ends the run**
  (`registerWrong` returns early). The left panel shows **ZEN + ∞** instead of
  hearts, and the mode line reads `ZEN · N×N`. `recordResult` records **no**
  win/loss/streak/progression in Zen — only the "Inner Peace" badge on a win
  (via `evaluate({won:true, zen:true})`); the end panel shows "Zen — not
  recorded". New board / Retry carry the Zen flag through `scene.restart`.
- **Verified:** `npm run build` green (~355 KB gz). A throwaway Playwright
  check confirmed: 3 wrong moves in Zen kept all lives + no game-over, a win
  granted the `zen` badge while leaving `easy_4` wins=0 and streak=0; the
  standard (non-Zen) `npm run verify` still passes with zero console errors.

**Next (still not ported):** exact Daily/Weekly/Monthly (needs the CPython-MT
RNG validated against `shared/daily_vectors.json`), the tutorial, and a fuller
per-mode milestone-star stats screen.

## 2026-05-31 — Phaser: stats, progression unlocks & achievements

Ported the meta-progression layer (the casual-player hook) — stats, mode
unlocks and badges. All localStorage-backed, faithful to the pygame models.

- **Models (no Phaser deps):** `model/stats.ts` (port of `stats.py` — per
  (difficulty×size) wins/losses/best-time, win streak, badge set; saved under
  the **same key** the pygame web build used, `einsteingame_stats`, so a
  browser save carries across versions; defensive field-by-field load).
  `model/achievements.ts` (the 10 badges + `evaluate(ctx)`),
  `model/progression.ts` (the unlock rules: 4×4/Easy always open; 3 wins in a
  size open the next size; 3 wins in every size of a difficulty open the next),
  `model/settings.ts` (the `unlock_all` debug flag). `stats` is a shared
  singleton written through to storage.
- **Menu:** size/difficulty buttons now render **locked** (dimmed + 🔒, a
  notice on click) per progression; selecting a difficulty re-evaluates the
  size locks. A progress strip (`Wins · Best streak · Badges n/10`) and a row
  of 10 achievement stars (gold = earned, hover = name+desc). **U** toggles the
  debug unlock-all (mirrors the pygame key).
- **GameScene end:** `recordResult()` mirrors `presenter._finish_round` —
  records the win/loss, advances the streak and grants achievements, **except
  on a Retry** (the Retry button now passes `retry:true`, so a replay never
  counts). The end panel grew a pulsing **NEW RECORD!** banner, a `best mm:ss`
  line and a **NEW BADGE** list of freshly-earned badges; the panel auto-sizes
  to its content so badges never collide with the buttons.
- **Verified:** `npm run build` green (~355 KB gz), `npm run smoke` 270/270,
  `npm run verify` plays through and now also asserts the win **persisted** to
  localStorage (`easy_4` win + `first_win` badge). Screenshots confirm the
  locked menu, progress strip + star track, and the NEW RECORD / NEW BADGE
  end panel. (Also fixed `verify.mjs` to write screenshots next to itself, not
  the CWD.)

**Next (still not ported):** exact Daily/Weekly/Monthly (needs the CPython-MT
RNG validated against `shared/daily_vectors.json`), Zen mode, the tutorial, and
a fuller stats screen (the pygame per-mode milestone-star table).

## 2026-05-31 — Phaser: sound pass (WebAudio)

Ported the audio layer — the Phaser build had **no sound** until now, and web
audio (pygame-mixer stutter on pygbag) was one of the three reasons we left
pygame. Built on Phaser's native **WebAudio** backend, so the unlock/mixing
hacks from `view/sounds.py` + `build_web.sh` are gone.

- **Assets:** copied the SFX/music bank `view/sounds/*.ogg` →
  `phaser/public/sounds/` (12 files; `hover.ogg` deliberately dropped — a
  per-hover tick is the densest, least-valuable voice, same call we cut on the
  pygame web build). ~370 KB, loaded once in `BootScene.preload`.
- **`src/audio/sound.ts`** — a module singleton `audio` bound to the game's
  global sound manager. Faithful port of `sounds.py`: per-key gain trim
  (`_SOUND_GAIN`), per-key repeat throttle in ms (`_SOUND_THROTTLE`, via
  `performance.now()`), the `pick → pick_2/3/4` combo-pitch ladder by cascade
  depth, and a looping ambient bed with its own volume. Degrades to no-ops if
  WebAudio/the cache is unavailable — never throws. Settings (SFX/music on/off,
  volumes) persist to `localStorage`.
- **Wiring** mirrors `window.py`/`game.py` call sites: `start` on board build,
  `wrong` on a mistake, `win`/`lose` on finish, `click` on every button
  (`ui/button.ts`), `spread` when hover twins light up. Cascade audio: each
  **resolving** cell ticks a `pick` at its combo pitch + one `solve` per action;
  the row-strike shimmer pops stay **silent** (matching the pygame anti-noise
  decision); a plain pop that resolves nothing still answers with one `pick`.
- **Menu:** two persisted toggles top-right (`♪ SFX` / `♫ MUSIC`); music starts
  on the menu and game scenes (idempotent, WebAudio auto-unlocks on first click).
- **Verified:** `npm run build` green (~352 KB gz), `npm run smoke` 270/270,
  `npm run verify` plays menu→game→cascade→win with **zero console/page errors**
  and asserts all 12 sounds loaded into the audio cache.

**Next (still not ported):** exact Daily/Weekly/Monthly (needs CPython-MT RNG
validated against `shared/daily_vectors.json`), stats/achievements/progression
unlocks, Zen mode, tutorial.

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

## 2026-05-25 — Phaser: collider fix + pygame-faithful visuals & juice

- **Critical bug fixed: hit areas were offset ~½ a button's width.** Cause was
  `container.setInteractive(Geom.Rectangle(...))` — Phaser frames a container's
  custom hit-area differently from a GameObject's, so colliders sat left of the
  visuals (clicking the right half of a button hit its neighbour). Fix: the
  interactive element is now the background **Image** (origin-0.5 rounded-rect
  texture), never the container. Proved with a hit-test sweep (`tools/probe.mjs`):
  hit regions now align with visuals.
- **Visuals rebuilt to match pygame** (`view/window.py`/`buttons.py`/`effects.py`):
  canvas 1295×735, left panel (MENU/TIME/hearts/MODE/HINT), 615px board, right
  clue panel. Rounded tiles (white tinted textures), **white DejaVu Sans glyphs**
  (font bundled in `public/fonts`), candidate sub-grids (2×2 / 3×2), big gradient-
  ish solved cells, clue groups of three mini-tiles with `↕ ↔ …` operators, and
  hover **tooltips** (`A same column as B` etc.).
- **Juice** (`src/fx/fx.ts`): candidate pop = squash-and-pop (Back.easeIn) + spark
  burst + ring; resolved cell = overshoot bloom + 20-particle burst + colour/white
  rings + a wide "wave" ring + white flash + screenshake; wrong = red flash + shake
  + heart-break burst; win = gold shockwave + Mocha confetti; staggered cascade,
  `+N chain!` combo text, hover lift/glow.
- New: `src/ui/textures.ts` (rounded/stroked/particle textures), `src/ui/button.ts`
  (Image-based), `src/fx/fx.ts`. HINT does a safe-pop pulse (no solver port yet).
- **Verified:** `npm run build` green (~351 KB gz), `npm run smoke` 270/270,
  `npm run verify` plays menu→tooltip→cascade→win with zero console errors; 4×4
  and 6×6 Hard screenshots match the pygame look.

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
