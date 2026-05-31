# itch.io page assets — Einstein

All art is generated from the **real Phaser build** by the scripts in
`phaser/tools/promo/` (re-run any time the look changes):

```bash
cd phaser
npm run build && npm run preview        # serve on http://localhost:4173
node tools/promo/capture.mjs            # raw/  — screenshots & board crops
node tools/promo/art.mjs                # cover / banner / pattern / embed-bg / how-to-play
node tools/promo/gif.mjs                # gif-*.gif + short-cascade.gif (HEADED browser)
```

Colors come from `shared/palette.json`; text from `GAME_REVIEW.md §4`.

## What goes where on itch

Most of these are uploaded in the itch **Edit game** web UI, *not* via butler
(butler only pushes the playable `phaser/dist` zip).

| File | Where on itch | Notes |
|------|---------------|-------|
| `cover.png` (1260×1000) | **Cover image** | itch shows it at 630×500; this is 2× for crispness. |
| `screenshot-1..5-*.png` | **Screenshots** gallery | Order: gameplay → win → progress → menu → tutorial. |
| `gif-cascade.gif` | top of **Screenshots** (hero) | The one-clue-cascades loop. Put it first. |
| `gif-win.gif`, `gif-hover.gif` | Screenshots gallery | Win/combo, and clue cross-highlight. |
| `how-to-play.png` (1200×1500) | embed in the **page body** | Drop into the description as an image. |
| `pattern.png` (640×640, seamless) | **Theme → Background** → "tile" | Subtle page background. |
| `embed-bg.png` (1920×1080) | **Theme → Background** (single, no-repeat) | Use *instead of* the tile if you want the atmospheric version. |
| `banner.png` (1920×640, 3:1) | social headers / devlog | Twitter/X header, Reddit, devlog cover. |
| `short-cascade.gif` (360×707, vertical) | Shorts / Reels / TikTok | Vertical social clip. |

Editor copy (Edit game form):
- **Kind of project:** HTML → upload `phaser/dist` zip → check *"This file will
  be played in the browser"*. Viewport ~ 1295×735 (or let it fit).
- **Genre/Tags:** see below.

## Ready-to-paste page copy (EN)

**Tagline (one line):**
> Einstein's riddle — the satisfying kind. One clue, and the whole board cascades into place.

**How to play:**
> 1. Every cell hides symbols — pop the wrong ones.
> 2. Read the clues — ↕ same column · ↔ neighbours · … left-of.
> 3. The last symbol standing solves the cell — and chains into the next. 🌊

**Features:**
> - 🧩 Pure logic — every puzzle is **guaranteed solvable**, never a guess
> - 🌊 Watch one deduction cascade across the whole board
> - 🎚️ 4×4 → 6×6, three difficulties — coffee-break to brain-melt
> - ⭐ Stars, scores & best times to chase
> - 🎓 A hands-on tutorial that eases you in — no wall of text
> - 🎨 Three cosy themes · plays in your browser · mouse or touch

**Footer:**
> ◆ ─────────────── ◆
> 98% of people bounce off logic puzzles. This one is built so you actually
> finish — and feel smart doing it.
> ⭐ **If it made your brain feel good, leave a rating and a comment** — it
> genuinely pushes a tiny dev account forward. Thank you! 🙏

**Tags:** `puzzle`, `logic`, `minimalist`, `relaxing`, `sudoku`,
`brain-training`, `singleplayer`, `html5`, `deduction`, `casual`

## Social shorts ideas (GAME_REVIEW §4)
- `short-cascade.gif` — vertical cascade (ready). Caption with humour.
- TODO (future): "solve Einstein's riddle in 15s" (4×4 Quick), fail → retry → win arc.

## raw/
Source screenshots & 1230×1230 board crops the composites are built from. Not
for direct upload (except via the promoted `screenshot-*.png`), but kept so the
art can be re-composed without re-capturing.
