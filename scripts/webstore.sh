#!/bin/sh
# Téléverse une archive sur le Chrome Web Store et, si demandé, la publie.
# Usage : scripts/webstore.sh dist/bnbridge-0.2.0.zip [publish]
# Attend WEBSTORE_CLIENT_ID, WEBSTORE_CLIENT_SECRET, WEBSTORE_REFRESH_TOKEN
# et WEBSTORE_EXTENSION_ID dans l'environnement (voir docs/PUBLISHING.md).
set -eu
archive=$1
action=${2:-upload}
for v in WEBSTORE_CLIENT_ID WEBSTORE_CLIENT_SECRET WEBSTORE_REFRESH_TOKEN WEBSTORE_EXTENSION_ID; do
    eval "[ -n \"\${$v:-}\" ]" || { echo "$v manquant" >&2; exit 1; }
done
token=$(curl -sS -X POST https://oauth2.googleapis.com/token \
    -d client_id="$WEBSTORE_CLIENT_ID" -d client_secret="$WEBSTORE_CLIENT_SECRET" \
    -d refresh_token="$WEBSTORE_REFRESH_TOKEN" -d grant_type=refresh_token \
    | node -p "JSON.parse(require('fs').readFileSync(0,'utf8')).access_token")
echo "Téléversement de $archive…"
curl -sS -X PUT "https://www.googleapis.com/upload/chromewebstore/v1.1/items/$WEBSTORE_EXTENSION_ID" \
    -H "Authorization: Bearer $token" -H "x-goog-api-version: 2" -T "$archive" \
    | tee /dev/stderr | grep -q '"uploadState": *"SUCCESS"'
if [ "$action" = publish ]; then
    echo "Publication…"
    curl -sS -X POST "https://www.googleapis.com/chromewebstore/v1.1/items/$WEBSTORE_EXTENSION_ID/publish" \
        -H "Authorization: Bearer $token" -H "x-goog-api-version: 2" -H "Content-Length: 0" \
        | tee /dev/stderr | grep -q '"status"'
fi
