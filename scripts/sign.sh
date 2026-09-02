#!/bin/sh
# Sign the extension with Mozilla using credentials from .env
#   MOZILLA_KEY    = JWT issuer from https://addons.mozilla.org/developers/addon/api/key/
#   MOZILLA_SECRET = JWT secret from the same page
# Usage: npm run sign            (unlisted, for personal installs)
#        npm run sign -- --channel=listed   (public listing submission)
set -eu
cd "$(dirname "$0")/.."

if [ -f .env ]; then
  set -a
  . ./.env
  set +a
fi

: "${MOZILLA_KEY:?Set MOZILLA_KEY in .env (see scripts/sign.sh)}"
: "${MOZILLA_SECRET:?Set MOZILLA_SECRET in .env (see scripts/sign.sh)}"

CHANNEL_ARG="--channel=unlisted"
for arg in "$@"; do
  case "$arg" in --channel=*) CHANNEL_ARG="" ;; esac
done

exec npx web-ext sign $CHANNEL_ARG --api-key="$MOZILLA_KEY" --api-secret="$MOZILLA_SECRET" "$@"
