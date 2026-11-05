#!/bin/sh
# Génère les visuels de la fiche du Chrome Web Store dans store/screenshots :
# cinq captures 1280 × 800, la vignette 440 × 280, le bandeau 1400 × 560 et
# l'image de partage GitHub 1280 × 640,
# en français et en anglais, à partir de dev/store.html rendu par Chrome
# headless. Nécessite Google Chrome et python3.
set -eu
cd "$(dirname "$0")/.."
chrome=${CHROME:-"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"}
[ -x "$chrome" ] || chrome=$(command -v google-chrome || command -v chromium || command -v chrome)
port=8766
python3 -m http.server "$port" --bind 127.0.0.1 >/dev/null 2>&1 &
server=$!
trap 'kill $server 2>/dev/null' EXIT INT TERM
sleep 1
shoot() { # fichier largeur hauteur url
    mkdir -p "$(dirname "$1")"
    "$chrome" --headless=new --disable-gpu --hide-scrollbars --force-device-scale-factor=1 \
        --window-size="$2,$3" --virtual-time-budget=9000 --screenshot="$PWD/$1" \
        "http://127.0.0.1:$port/dev/store.html?$4" >/dev/null 2>&1
    echo "$1"
}
for lang in fr en; do
    i=1
    for shot in read plan select apply prefs; do
        shoot "store/screenshots/$lang/$i-$shot.png" 1280 800 "shot=$shot&lang=$lang"
        i=$((i + 1))
    done
    shoot "store/screenshots/$lang/tile-440x280.png" 440 280 "tile=small&lang=$lang"
    shoot "store/screenshots/$lang/marquee-1400x560.png" 1400 560 "tile=marquee&lang=$lang"
    shoot "store/screenshots/$lang/social-1280x640.png" 1280 640 "tile=social&lang=$lang"
done
