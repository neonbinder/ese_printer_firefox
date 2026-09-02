#!/bin/sh
# Cut a release: bump version, lint, commit + tag, sign with Mozilla, install in Firefox.
#
# Usage: npm run release                 # patch bump (1.1.0 -> 1.1.1)
#        npm run release -- minor        # 1.1.0 -> 1.2.0
#        npm run release -- major        # 1.1.0 -> 2.0.0
#        npm run release -- 1.4.2        # explicit version
#        npm run release -- --dry-run    # show what would happen, change nothing
#
# Requires a clean git tree and MOZILLA_ISSUER / MOZILLA_SECRET in .env.
set -eu
cd "$(dirname "$0")/.."

BUMP="patch"
DRY_RUN=0
for arg in "$@"; do
  case "$arg" in
    --dry-run) DRY_RUN=1 ;;
    patch|minor|major) BUMP="$arg" ;;
    [0-9]*.[0-9]*.[0-9]*) BUMP="$arg" ;;
    *) echo "Unknown argument: $arg" >&2; exit 2 ;;
  esac
done

if [ -n "$(git status --porcelain)" ]; then
  echo "Working tree is not clean. Commit or stash your changes first." >&2
  git status --short >&2
  exit 1
fi

CURRENT=$(node -p "require('./package.json').version")
NEXT=$(node -e "
  const cur = '$CURRENT'.split('.').map(Number);
  const b = '$BUMP';
  if (/^\d+\.\d+\.\d+$/.test(b)) { console.log(b); process.exit(); }
  if (b === 'major') console.log([cur[0] + 1, 0, 0].join('.'));
  else if (b === 'minor') console.log([cur[0], cur[1] + 1, 0].join('.'));
  else console.log([cur[0], cur[1], cur[2] + 1].join('.'));
")

if git rev-parse -q --verify "refs/tags/v$NEXT" >/dev/null; then
  echo "Tag v$NEXT already exists. Pick a different version." >&2
  exit 1
fi

echo "Release: $CURRENT -> $NEXT"

echo "==> Lint"
npx web-ext lint

if [ "$DRY_RUN" -eq 1 ]; then
  echo "(dry run) Would bump manifest.json + package.json to $NEXT, commit 'Release v$NEXT', tag v$NEXT, sign, and install."
  exit 0
fi

echo "==> Bump version to $NEXT"
node -e "
  const fs = require('fs');
  for (const f of ['manifest.json', 'package.json']) {
    const j = JSON.parse(fs.readFileSync(f, 'utf8'));
    j.version = '$NEXT';
    fs.writeFileSync(f, JSON.stringify(j, null, 2) + '\n');
  }
"
# keep package-lock in sync without touching node_modules
npm install --package-lock-only --no-audit --no-fund >/dev/null

echo "==> Commit and tag"
git add manifest.json package.json package-lock.json
git commit -q -m "Release v$NEXT"
git tag "v$NEXT"

echo "==> Sign with Mozilla"
sh scripts/sign.sh

XPI=$(ls -t web-ext-artifacts/*-"$NEXT".xpi 2>/dev/null | head -1)
if [ -z "$XPI" ]; then
  echo "Signed .xpi for $NEXT not found in web-ext-artifacts/" >&2
  exit 1
fi

echo "==> Install in Firefox: $XPI"
if [ "$(uname)" = "Darwin" ]; then
  open -a Firefox "$PWD/$XPI"
else
  firefox "$PWD/$XPI" >/dev/null 2>&1 &
fi

echo
echo "Released v$NEXT. Accept the install prompt in Firefox, then push:"
echo "  git push origin main --tags"
