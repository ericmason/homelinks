#!/usr/bin/env bash
# Produce a clean, load-unpackable extension folder and a Chrome Web Store zip.
# Modelled on equisolve/freshdesk-extension: extension/ is the source of truth,
# and everything the store gets is copied into dist/extension/ -- no README, no
# scripts, no scratch files. dist/ is gitignored; the artifact is regenerated
# from source, never committed.
#
# Nothing here compiles or bundles. The extension is ES modules the browser
# loads as they are, which is why `load unpacked` on extension/ is the whole dev
# loop and this script exists only to package a release.
set -euo pipefail
cd "$(dirname "$0")/.."

SRC="extension"
VERSION=$(node -p "require('./$SRC/manifest.json').version")
OUT="dist"
STAGE="$OUT/extension"
ZIP="$OUT/homelinks-${VERSION}.zip"

rm -rf "$OUT"
mkdir -p "$STAGE"
cp -R "$SRC"/. "$STAGE"/

# Drop macOS Finder metadata. `cp -R extension/.` takes hidden files too, so a
# stray .DS_Store rides into the zip and gets published to every user: a few KB
# of local Finder state per directory, carrying the names of files that once sat
# there. It is untracked, so it only ever appears on a macOS build machine and
# never in a diff. Deleting it here is what keeps the package the same on both.
find "$STAGE" -name '.DS_Store' -delete

# Catch a broken package here rather than at the upload, which rejects the whole
# zip and tells you little. Every path the manifest names has to be in the copy,
# and the fonts need their licenses beside them: all three faces are OFL, which
# requires the license travel with the font.
python3 - "$STAGE" <<'PY'
import json, sys, pathlib
stage = pathlib.Path(sys.argv[1])
m = json.loads((stage / 'manifest.json').read_text())
want = [m['background']['service_worker'], *m['chrome_url_overrides'].values(), *m['icons'].values()]
missing = [p for p in want if not (stage / p).exists()]
fonts = list((stage / 'fonts').glob('*.woff2'))
if fonts and not list((stage / 'fonts' / 'licenses').glob('*.txt')):
    missing.append('fonts/licenses/*.txt')
if missing:
    sys.exit('Missing from the package: ' + ', '.join(missing))
print(f"Packaging {m['name']} {m['version']}: {len(list(stage.rglob('*')))} files")
PY

( cd "$STAGE" && zip -r -q "../$(basename "$ZIP")" . )

echo "Built:"
echo "  $ZIP   ($(du -h "$ZIP" | cut -f1), upload to the Chrome Web Store)"
echo "  $STAGE/   (same files; load unpacked to check the package itself)"
