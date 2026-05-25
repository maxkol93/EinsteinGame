# EinsteinGame — Phaser port

TypeScript + Phaser 3 + Vite rewrite of the game, replacing the pygame/pygbag
web build (paused — see `../CLAUDE.md` for why and for the parallel-dev rules).

## Quick start

```bash
cd phaser
npm install
npm run dev      # Vite dev server with HMR
```

Other scripts: `npm run build` (typecheck + static bundle → `dist/`),
`npm run preview`, `npm run typecheck`, `npm run smoke` (model self-test),
`npm run verify` (headless playthrough — needs a preview/dev server running).

## Layout

```
phaser/
  index.html            # mounts #game, dark bg, mobile viewport
  src/
    main.ts             # Phaser.Game config + scene list
    config.ts           # palette (from ../shared/palette.json) + base resolution
    model/              # pure puzzle logic, no Phaser deps (testable)
      rng.ts            #   seeded PRNG (Python-randint-style helpers)
      fieldAndRules.ts  #   board + clue generator (port of field_and_rules.py)
      selfWalkthrough.ts#   deductive solver — guarantees no-guess solvability
      board.ts          #   player board: pop/define + the row cascade
      decoder.ts        #   value → glyph + clue text (port of decoder.py)
    scenes/
      BootScene.ts      # asset preload will live here
      MenuScene.ts      # size / difficulty select → start a game
      GameScene.ts      # the playable board: cascade, lives, timer, clues, win
    ui/button.ts        # shared button widget
  tools/
    smoke.ts            # generates 270 boards, checks solvable + cascade-correct
    verify.mjs          # Playwright: loads the build, plays a full game
  vite.config.ts        # base:'./' for static hosting, fs access to ../shared
```

## Status — playable

The core game works: seeded generation with a no-guess guarantee, all four clue
types (`^`, `...`, `<->`, three-in-a-row), the row cascade, lives, timer, clue
panel, and win/lose. Sizes 4×4 / 5×5 / 6×6 and Easy / Normal / Hard. Verified
by `npm run smoke` (270 boards) and `npm run verify` (headless playthrough).

Controls: **tap** a tile to remove a wrong value; **right-click / long-press**
to lock a value in as the answer.

Still to port from the pygame tree (later):

1. **Daily/Weekly/Monthly** — the seeded generator (`daily.py`). It MUST
   reproduce the Python output exactly; validate against
   `../shared/daily_vectors.json` (see `../shared/README.md`). The current RNG
   is mulberry32, NOT CPython's Mersenne Twister — fine for random/retry games,
   but the daily port may need a true MT.
2. **Meta** — stats, achievements, modes/progression, Zen, the tutorial.
3. **Juice + sound** — particle bursts, combo pitch, the ambient loop
   (assets in `../view/sounds`).

## Sharing with the pygame version

- Colors: `../shared/palette.json` (don't hardcode in TS).
- Daily seeds: `../shared/daily_vectors.json`.
- Sounds: copy from `../view/sounds/*.ogg` into `public/` when wiring audio.
