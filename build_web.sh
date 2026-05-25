#!/usr/bin/env bash
# Build a self-contained pygbag bundle for itch.io / static hosting.
# Steps:
#  1. Run `pygbag --build` to produce the apk + tar.gz + default index.html.
#  2. Bundle CDN files from a local mirror (~/.cache) so the page does not
#     need to reach pygame-web.github.io at runtime (the user's network or
#     itch.io's COEP may block it). The mirror is fetched once and reused.
#  3. Patch index.html to use relative CDN paths, drop the unused `vtx`
#     terminal feature, and set the page background to match the game theme.
#  4. Zip everything into einsteingame-itch.zip.

set -e
cd "$(dirname "$0")"

# Mirror lives under ~/.cache — persistent across sessions, and outside the
# project tree so pygbag never bundles its 22 MB into the game apk.
CDN_SRC="$HOME/.cache/einstein-pygame-cdn"
CDN_BASE=https://pygame-web.github.io/cdn
BUILD=build/web
ZIP_OUT=einsteingame-itch.zip

# The pygbag 0.9.3 runtime files never change — mirror them locally once, then
# every later build is fully offline and fast. A missing file is re-fetched
# on demand, so a wiped cache self-heals instead of failing the build.
CDN_FILES=(
    0.9.3/cpython312/main.data
    0.9.3/cpython312/main.js
    0.9.3/cpython312/main.wasm
    0.9.3/cpythonrc.py
    0.9.3/empty.html
    0.9.3/empty.ogg
    0.9.3/favicon.png
    0.9.3/pythons.js
    cp312/pygame_ce-2.5.7-cp312-cp312-wasm32_bi_emscripten.whl
    index-0.9.3-cp312.json
    vt.js
    vtx.js
)
fetched=0
for f in "${CDN_FILES[@]}"; do
    dest="$CDN_SRC/cdn/$f"
    if [ ! -s "$dest" ]; then
        echo "  fetching CDN file: $f"
        mkdir -p "$(dirname "$dest")"
        curl -fsSL --retry 3 -o "$dest" "$CDN_BASE/$f"
        fetched=1
    fi
done
[ "$fetched" = 1 ] && echo "CDN mirror updated ($CDN_SRC/)" \
                   || echo "CDN mirror ready, no download needed ($CDN_SRC/)"

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
CDN_SRC="$CDN_SRC" python3 - <<'PY'
import json, os
with open(os.path.join(os.environ["CDN_SRC"],
                       "cdn/index-0.9.3-cp312.json")) as f:
    data = json.load(f)
data["-CDN-"] = "cdn/"
with open("build/web/cdn/index-0.9.3-cp312.json", "w") as f:
    json.dump(data, f, indent=2)
PY

# Pygame wheel (bundled separately to avoid runtime CDN fetch)
mkdir -p "$BUILD/cdn/cp312"
cp "$CDN_SRC/cdn/cp312/pygame_ce-2.5.7-cp312-cp312-wasm32_bi_emscripten.whl" \
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

# Match the web framebuffer to the real game canvas and skin the pygbag
# loader so it looks like the in-game loading screen — a mismatched fb_ar is
# what makes the fullscreen view blurry, and the default loader shows raw
# green/blue boxes before the game's own loading screen.
# The fb here is the LANDSCAPE (desktop) default — that is what the build
# machine reports. At runtime the game picks portrait on a phone (taller-than-
# wide viewport); a small JS observer (below) then keeps the canvas CSS aspect
# in sync with whatever framebuffer the game actually creates, so either
# orientation fits without blur.
DIMS=$(PYGAME_HIDE_SUPPORT_PROMPT=hide python3 -c \
    "import view.window as w; print(w.CANVAS_WIDTH, w.CANVAS_HEIGHT)" \
    2>/dev/null | tail -1)
CW=$(echo "$DIMS" | cut -d' ' -f1)
CH=$(echo "$DIMS" | cut -d' ' -f2)
case "$CW" in ''|*[!0-9]*) CW=1295; CH=735;; esac
case "$CH" in ''|*[!0-9]*) CW=1295; CH=735;; esac
echo "Game canvas: ${CW}x${CH}"

EINSTEIN_CW="$CW" EINSTEIN_CH="$CH" python3 - <<'PY'
import os, re

cw = os.environ['EINSTEIN_CW']
ch = os.environ['EINSTEIN_CH']
ar = round(int(cw) / int(ch), 4)

p = "build/web/index.html"
src = open(p, encoding="utf-8").read()

# framebuffer size — a mismatched fb_ar/fb_width blurs the fullscreen view
src = re.sub(r'fb_width\s*:\s*"\d+"',  'fb_width : "%s"' % cw, src)
src = re.sub(r'fb_height\s*:\s*"\d+"', 'fb_height : "%s"' % ch, src)
src = re.sub(r'fb_ar\s*:\s*[\d.]+',    'fb_ar   :  %s' % ar, src)
src = re.sub(r'Screen\s*:\s*\d+x\d+',  'Screen  : %sx%s' % (cw, ch), src)

# skin the loader to match the in-game loading screen (idempotent).
# z-index:4 keeps these elements below the (initially transparent) game
# canvas, so they vanish the instant the game draws its first frame.
if 'einstein-skin' not in src:
    # The canvas always letterboxes to the viewport while preserving the
    # game's aspect ratio. Two CSS variables (--ar, --ari) drive the
    # `min()`-based width/height — taking the smaller of "fill width
    # horizontally, derive height" and "fill height vertically, derive
    # width" gives a proper contain-fit that works inside an iframe as
    # well as in fullscreen on a much larger display.
    skin = ('''<style id="einstein-skin">
  :root { --ar: AR; --ari: AR_INV; }
  html, body { background:#1c1819 !important;
               margin:0 !important; padding:0 !important;
               overflow:hidden !important;
               width:100%% !important; height:100%% !important; }
  #status { display:block; text-align:center; margin:0;
            color:#8f8a8d; font:600 14px Arial,sans-serif; }
  #transfer { position:fixed; left:0; right:0; top:calc(50%% + 14px);
              z-index:4; pointer-events:none; }
  #progress { -webkit-appearance:none; appearance:none; width:240px;
              height:6px; border:0; background:#322c30; border-radius:3px;
              margin-top:12px; }
  #progress::-webkit-progress-bar { background:#322c30; border-radius:3px; }
  #progress::-webkit-progress-value { background:#cdc3be; border-radius:3px; }
  #progress::-moz-progress-bar { background:#cdc3be; border-radius:3px; }
  #infobox { background:#211d20 !important; color:#f5f0ec !important;
             border:1px solid #3b353b; border-radius:12px;
             font:600 14px Arial,sans-serif !important;
             padding:13px 26px !important; }
  #einstein-dots { position:fixed; left:0; right:0; top:calc(50%% - 78px);
                   text-align:center; z-index:4; pointer-events:none;
                   font-size:0; }
  #einstein-dots i { display:inline-block; width:11px; height:11px;
                     border-radius:50%%; margin:0 6px; }
  #einstein-brand { position:fixed; left:0; right:0; top:calc(50%% - 56px);
                    text-align:center; z-index:4; pointer-events:none;
                    color:#f5f0ec; font:700 42px Arial,sans-serif;
                    letter-spacing:13px; padding-left:13px; }
  /* pygbag's own `canvas.emscripten` stretches to 100%%/100%% with
     top/bottom/left/right:0 — and has a higher specificity (0,1,1) than a
     bare `canvas` rule, so we match the same class to override it.
     IMPORTANT: only target the 2D canvas (#canvas). The page also ships a
     hidden 3D canvas (#canvas3d, `hidden` attribute) — if our rules
     applied to it, `display:block !important` would override the `hidden`
     attribute and the empty 3D canvas would float on top of the 2D one,
     silently eating every click. The `[hidden]{display:none!important}`
     safety net at the end keeps that from biting if pygbag ever adds
     another hidden canvas. */
  canvas.emscripten#canvas, body canvas#canvas {
    display:block !important;
    position:absolute !important;
    inset:0 !important;
    transform:none !important;
    width:  min(100vw, calc(100vh * var(--ar)))  !important;
    height: min(100vh, calc(100vw * var(--ari))) !important;
    max-width:none !important; max-height:none !important;
    object-fit:contain !important;
    margin:auto !important; padding:0 !important; }
  canvas[hidden] { display:none !important; }
</style>
''' % ()).replace('AR_INV', '%.4f' % (1.0 / ar)).replace('AR', '%.4f' % ar)
    src = src.replace('</head>', skin + '</head>', 1)

    # mobile-friendly viewport + iOS "add to home screen" fullscreen
    vp = ('<meta name="viewport" content="width=device-width,'
          'initial-scale=1,user-scalable=no,viewport-fit=cover">'
          '<meta name="apple-mobile-web-app-capable" content="yes">'
          '<meta name="mobile-web-app-capable" content="yes">')
    if re.search(r'<meta[^>]*name=["\']viewport["\'][^>]*>', src):
        src = re.sub(r'<meta[^>]*name=["\']viewport["\'][^>]*>', vp, src,
                     count=1)
    else:
        src = src.replace('<head>', '<head>' + vp, 1)

    # unlock audio on mobile: browsers start the audio context suspended and
    # only resume it after a user gesture. Wrap AudioContext so every context
    # the runtime creates gets resumed on the first touch/click/key.
    fixjs = (
        '<script id="einstein-fix">'
        '(function(){'
        'function R(c){try{if(c&&c.state==="suspended")c.resume();}'
        'catch(e){}}'
        'function sweep(){try{var m=window.Module;if(m){'
        '["SDL2","SDL3"].forEach(function(k){if(m[k])R(m[k].audioContext);});'
        'R(m.audioContext);}R(window.einsteinAC);}catch(e){}}'
        '["touchend","touchstart","pointerdown","mousedown","click",'
        '"keydown"].forEach(function(ev){'
        'window.addEventListener(ev,sweep,true);});'
        'var n=0,iv=setInterval(function(){sweep();'
        'if(++n>80)clearInterval(iv);},400);'
        'try{var AC=window.AudioContext||window.webkitAudioContext;'
        'if(AC&&!AC.__ei){var W=function(){var c=new AC();'
        'window.einsteinAC=c;["touchend","pointerdown","keydown"].'
        'forEach(function(ev){window.addEventListener(ev,function(){R(c);},'
        'true);});return c;};W.prototype=AC.prototype;W.__ei=true;'
        'window.AudioContext=W;window.webkitAudioContext=W;}}catch(e){}'
        '})();</script>\n')

    # keep the CSS aspect (--ar / --ari) locked to the live canvas backing, so
    # whichever orientation the game picks at runtime (landscape on desktop,
    # portrait on a phone) the canvas contain-fits without stretching.
    arjs = (
        '<script id="einstein-ar">'
        '(function(){function u(){var c=document.getElementById("canvas");'
        'if(c&&c.width>1&&c.height>1){var a=c.width/c.height;'
        'var s=document.documentElement.style;'
        's.setProperty("--ar",a.toFixed(4));'
        's.setProperty("--ari",(1/a).toFixed(4));}}'
        'setInterval(u,400);'
        'window.addEventListener("resize",u);'
        'window.addEventListener("orientationchange",u);})();</script>\n')

    brand = (fixjs + arjs
             + '<div id="einstein-dots">'
             '<i style="background:#a87377"></i>'
             '<i style="background:#a5674c"></i>'
             '<i style="background:#a58949"></i>'
             '<i style="background:#788966"></i>'
             '<i style="background:#5c7476"></i>'
             '<i style="background:#6c5161"></i></div>\n'
             '<div id="einstein-brand">EINSTEIN</div>\n')
    src = src.replace('<body>', '<body>\n' + brand, 1)

open(p, "w", encoding="utf-8").write(src)
print("index.html: fb=%sx%s ar=%s, loader skinned" % (cw, ch, ar))
PY

# Zip
rm -f "$ZIP_OUT"
(cd "$BUILD" && zip -qr "../../$ZIP_OUT" .)
ls -la "$ZIP_OUT"
echo "Done. Upload $ZIP_OUT to itch.io."
