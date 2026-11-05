#!/bin/sh
# Construit l'archive à soumettre au Chrome Web Store : le manifeste, les
# textes, les sources et les icônes, rien du développement ni des tests.
# Le nom porte la version du manifeste, pour retrouver ce qui a été publié.
set -eu
cd "$(dirname "$0")/.."
version=$(node -p "require('./manifest.json').version")
mkdir -p dist
rm -f "dist/bnbridge-$version.zip"
zip -qr "dist/bnbridge-$version.zip" manifest.json _locales src assets/icons -x '*.DS_Store'
echo "dist/bnbridge-$version.zip"
