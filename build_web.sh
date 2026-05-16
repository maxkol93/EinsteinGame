#!/usr/bin/env bash
# Build a self-contained pygbag bundle for itch.io / static hosting.
# Steps:
#  1. Run `pygbag --build` to produce the apk + tar.gz + default index.html.
#  2. Bundle CDN files from /tmp/pygame-cdn/ so the page does not need to
#     reach pygame-web.github.io at runtime (the user's network or itch.io's
#     COEP may block it).
#  3. Patch index.html to use relative CDN paths, drop the unused `vtx`
#     terminal feature, and set the page background to match the game theme.
#  4. Zip everything into einsteingame-itch.zip.

set -e
cd "$(dirname "$0")"

CDN_SRC=/tmp/pygame-cdn
BUILD=build/web
ZIP_OUT=einsteingame-itch.zip

if [ ! -d "$CDN_SRC/cdn/0.9.3/cpython312" ]; then
    echo "ERROR: expected pre-downloaded CDN files at $CDN_SRC/cdn/0.9.3/"
    exit 1
fi

rm -rf "$BUILD"
rm -f "$ZIP_OUT"     # so it doesn't get bundled into the apk
mkdir -p "$BUILD"

python3 -m pygbag --build main.py 2>&1 | tail -3
echo

# Bundle CDN
mkdir -p "$BUILD/cdn/0.9.3"
cp "$CDN_SRC/cdn/0.9.3/pythons.js" \
   "$CDN_SRC/cdn/0.9.3/empty.html" \
   "$CDN_SRC/cdn/0.9.3/favicon.png" \
   "$CDN_SRC/cdn/0.9.3/empty.ogg" \
   "$BUILD/cdn/0.9.3/"
cp -r "$CDN_SRC/cdn/0.9.3/cpython312" "$BUILD/cdn/0.9.3/"
cp "$CDN_SRC/cdn/vt.js" "$CDN_SRC/cdn/vtx.js" "$BUILD/cdn/"

# Patched cpythonrc.py with PYGPI=cdn/ injection
cp "$CDN_SRC/cdn/0.9.3/cpythonrc.py" "$BUILD/cdn/0.9.3/cpythonrc.py"
python3 - <<'PY'
import io, os
p = "build/web/cdn/0.9.3/cpythonrc.py"
src = io.open(p, encoding="utf-8").read()
inject = ('os.environ.setdefault("PYGPI", "cdn/")\n')
if 'PYGPI' not in src:
    # insert right after "import builtins"
    needle = "import builtins\n"
    src = src.replace(needle, needle + "\n" + inject, 1)
    io.open(p, "w", encoding="utf-8").write(src)
PY

# Index json with relative -CDN- and minimal package list
python3 - <<'PY'
import json
with open("/tmp/pygame-cdn/cdn/index-0.9.3-cp312.json") as f:
    data = json.load(f)
data["-CDN-"] = "cdn/"
with open("build/web/cdn/index-0.9.3-cp312.json", "w") as f:
    json.dump(data, f, indent=2)
PY

# Pygame wheel (bundled separately to avoid runtime CDN fetch)
mkdir -p "$BUILD/cdn/cp312"
cp /tmp/pygame-cdn/cdn/cp312/pygame_ce-2.5.7-cp312-cp312-wasm32_bi_emscripten.whl \
   "$BUILD/cdn/cp312/" 2>/dev/null || curl -sL \
   -o "$BUILD/cdn/cp312/pygame_ce-2.5.7-cp312-cp312-wasm32_bi_emscripten.whl" \
   "https://pygame-web.github.io/cdn/cp312/pygame_ce-2.5.7-cp312-cp312-wasm32_bi_emscripten.whl"

# Patch index.html: rewrite CDN URLs, drop vtx, set dark bg
sed -i \
    -e 's|https://pygame-web.github.io/cdn/0.9.3/|cdn/0.9.3/|g' \
    -e 's|data-os="vtx,snd,gui"|data-os="snd,gui"|g' \
    -e 's|platform.document.body.style.background = "#7f7f7f"|platform.document.body.style.background = "#282828"|g' \
    -e 's|background-color:powderblue;|background-color:#282828;|g' \
    "$BUILD/index.html"

# Zip
rm -f "$ZIP_OUT"
(cd "$BUILD" && zip -qr "../../$ZIP_OUT" .)
ls -la "$ZIP_OUT"
echo "Done. Upload $ZIP_OUT to itch.io."
