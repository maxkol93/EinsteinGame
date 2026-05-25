# EinsteinGame — project guide for Claude

This repo holds **two implementations of the same game** living side by side.
Read this file first every session, then `SESSION_NOTES.md` for the latest
detail.

> Einstein — a logic-grid deduction puzzle (Einstein's-riddle style). The
> player pops wrong candidates; clues constrain columns; solving cascades across
> the board. Goal: launch free on itch.io, grow the dev account, hook both
> casual players (juice, achievements, meta-progression) and hardcore puzzlers.

## Two versions, two states

| Version | Where | Stack | Status |
|---------|-------|-------|--------|
| **pygame** (original) | repo root: `main.py`, `model/`, `view/`, `presenter/` | Python + pygame, shipped to web via **pygbag** (`build_web.sh`) | ⏸️ **PAUSED** (2026-05-25) |
| **Phaser** (port) | `phaser/` | TypeScript + Phaser 3 + Vite | 🚧 **ACTIVE — current focus** |

### Why pygame is paused (2026-05-25)
Decided to port to Phaser instead of investing more in the pygame/pygbag build,
because of three problems that are inherent to the pygbag path:
- **Poor performance** — emscripten/pygbag is heavy and janky in the browser.
- **Audio bugs** — the pygame mixer stutters/lags on web; repeated hacks in
  `build_web.sh` and `view/sounds.py` only mitigate it.
- **Large build** — the bundle is ~13.8 MB (Python runtime + wheels).

pygame is **not abandoned** — it stays buildable and is the reference for game
logic/feel. Only touch it for a real bug fix the user asks for; **default new
work to Phaser.**

## How the user refers to the two versions

- "for Phaser…", "in the Phaser version…", "вносим изменения в фазер версию",
  "для фазер делаем то-то" → work in **`phaser/`** (TypeScript).
- "for pygame…", "in the Python version…", "для пайгейма…" → work in the **repo
  root** Python tree. Remember it's PAUSED — confirm it's intentional.
- If unspecified, assume **Phaser** (the active project).

## Repo layout

```
EinsteinGame/
  main.py, model/, view/, presenter/   # pygame (PAUSED) — reference impl
  build_web.sh                          # pygbag → einsteingame-itch.zip
  phaser/                               # Phaser port (ACTIVE)
    src/  index.html  package.json  vite.config.ts  tsconfig.json
  shared/                               # cross-version source of truth
    palette.json                        # the Mocha colors (mirror of palettes.py)
    daily_vectors.json                  # seed → puzzle fixtures (see below)
  GAME_REVIEW.md  SESSION_NOTES.md  README.md
```

## Parallel-development rules (one GitHub repo)

1. **The two trees never share code**, only assets and game design. So they
   can't cause merge conflicts — there is no long-lived `phaser` branch and no
   fork. Both versions live on `main`/`claude/work`.
2. **Feature branches + PRs as usual.** Phaser work in `phaser/<feature>`
   branches; pygame fixes in their own. A change to one tree cannot break the
   other (different files).
3. **CI is split by path** (`.github/workflows/`): the pygame build runs only on
   changes under the Python tree; the Phaser build runs only on `phaser/**` /
   `shared/**`.
4. **Daily must stay identical across versions.** The Python `model/daily.py`
   RNG is the source of truth. Before/while porting Daily, dump
   `seed → solved grid + clues` fixtures from Python into
   `shared/daily_vectors.json` and make the TS generator pass them as tests.
   Otherwise the "puzzle of the day" desyncs between platforms.
5. **Palette is single-sourced** in `shared/palette.json` (mirror of
   `view/palettes.py` → the Mocha colors). Don't hand-redefine colors in TS.

## Build / run

- **Phaser (active):** `cd phaser && npm install && npm run dev` (Vite dev
  server); `npm run build` → static bundle in `phaser/dist/`.
- **pygame (paused):** `bash build_web.sh` → `einsteingame-itch.zip` (~13.8 MB,
  gitignored). CDN mirror persists under `~/.cache/einstein-pygame-cdn/`.

## Working agreement
Make optimal decisions; don't ask questions unless a genuine game-logic blocker;
report at the end.
