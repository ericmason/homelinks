#!/usr/bin/env python3
"""Turn the 2x captures into the exact sizes the Chrome Web Store accepts.

    ./scripts/build.sh
    node scripts/store-assets/capture.mjs
    python3 scripts/store-assets/assemble.py

Captures are taken at deviceScaleFactor 2 and downsampled here, which is what
keeps the type crisp: the store scales a 1280x800 upload itself, and its
scaler is worse than this one. Outputs land in docs/store/ and are committed,
because a listing asset has to be reviewable in a diff.
"""
import shutil
from pathlib import Path

from PIL import Image

REPO = Path(__file__).resolve().parents[2]
SHOTS = REPO / "dist/shots"
OUT = REPO / "docs/store"

# Order is the order they appear in the listing; the first is what the store
# shows in search results.
SCREENSHOTS = [
    ("1-home", "screenshot-1-home", (1280, 800)),
    ("2-jump", "screenshot-2-jump", (1280, 800)),
    ("3-add-link", "screenshot-3-add-link", (1280, 800)),
    ("4-organize", "screenshot-4-organize", (1280, 800)),
    ("5-appearance", "screenshot-5-bookmarks", (1280, 800)),
    ("promo-440x280", "promo-small-440x280", (440, 280)),
    ("promo-1400x560", "promo-marquee-1400x560", (1400, 560)),
]

if not SHOTS.exists():
    raise SystemExit("No captures. Run: node scripts/store-assets/capture.mjs")

OUT.mkdir(parents=True, exist_ok=True)
for src, dest, size in SCREENSHOTS:
    img = Image.open(SHOTS / f"{src}.png").convert("RGB")
    if img.size != size:
        img = img.resize(size, Image.LANCZOS)
    path = OUT / f"{dest}.png"
    img.save(path, optimize=True)
    print(f"  {path.relative_to(REPO)}  {size[0]}x{size[1]}")

# The store's listing icon is uploaded separately from the one inside the zip,
# at the same 128x128.
icon = OUT / "icon-128.png"
shutil.copyfile(REPO / "extension/icons/128.png", icon)
print(f"  {icon.relative_to(REPO)}  128x128")
