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
`npm run preview`, `npm run typecheck`.

## Layout

```
phaser/
  index.html            # mounts #game, dark bg, mobile viewport
  src/
    main.ts             # Phaser.Game config + scene list
    config.ts           # palette (from ../shared/palette.json) + base resolution
    scenes/
      BootScene.ts      # asset preload will live here
      GameScene.ts      # PLACEHOLDER board (grid + candidates + pointer pop)
  vite.config.ts        # base:'./' for static hosting, fs access to ../shared
```

## What's here vs. what's next

The current `GameScene` is a **scaffold**: it renders a board grid with
candidate squares in the real Mocha palette and lets you click to "pop" them.
It exists to prove the toolchain, scaling and input work.

Still to port from the pygame `../model/` tree:

1. **Puzzle model** — board, candidates, clue types (`^`, `<->`, `...`),
   unique-solution generator (`field_and_rules.py`).
2. **Cascade resolution** — solving a cell strikes candidates across the row.
3. **Daily/Weekly/Monthly** — the seeded generator (`daily.py`). It MUST
   reproduce the Python output exactly; validate against
   `../shared/daily_vectors.json` (see `../shared/README.md`).
4. **Modes/progression, stats, achievements, tutorial, juice/sound.**

## Sharing with the pygame version

- Colors: `../shared/palette.json` (don't hardcode in TS).
- Daily seeds: `../shared/daily_vectors.json`.
- Sounds: copy from `../view/sounds/*.ogg` into `public/` when wiring audio.
