# shared/ — cross-version source of truth

These files are the contract between the two implementations (pygame at the repo
root, Phaser in `../phaser`). See `../CLAUDE.md` for the parallel-dev rules.

## palette.json
The single definition of the Mocha colors. Mirrors `../view/palettes.py`. Both
versions read from here so the look never drifts. If you change a color, change
it here (and reflect it in `palettes.py` until the pygame build is retired).

## daily_vectors.json
Fixtures pinning the seeded Daily/Weekly/Monthly puzzles. The pygame
`model/daily.py` RNG is the **source of truth**; the Phaser port must reproduce
its output bit-for-bit, or the puzzle-of-the-day desyncs between platforms.

Workflow when porting the daily generator:
1. Write a small Python dump script (e.g. `tools/dump_daily_vectors.py`) that,
   for a range of dates/seeds, emits `{ seed, size, difficulty, solution, clues }`
   into the `vectors` array here.
2. In the Phaser tests, generate each vector's puzzle and assert it equals the
   stored fixture.

Until that port starts, `vectors` stays empty.
