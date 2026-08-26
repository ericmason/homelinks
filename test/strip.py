"""Two rows of screencast frames, one per build, sampled at the same wall-clock
times, for pasting into a pull request.

    python3 strip.py .work/frames-before .work/frames-after out.png \
        --labels Before After --times 90,130,210,430

Each panel is whatever the compositor had on screen at that moment -- the last
frame at or before the time in the column header -- so the two rows are directly
comparable even though their frames did not arrive on the same schedule.
"""
import argparse
import os
import re
from PIL import Image, ImageDraw, ImageFont

W = 620                     # panel width in the strip
PAD, GAP, TOP = 24, 14, 46


def crop(im, keep):
    """The plate, and none of the empty page below it. Screencast frames come
    back in device pixels, which is 1x or 2x depending on the display, so the
    region is a fraction of the frame rather than a pixel count."""
    return im.crop((0, 0, im.width, round(im.height * keep)))


def frames(d):
    out = []
    for f in os.listdir(d):
        m = re.match(r"\d+-(\d+)ms\.png$", f)
        if m:
            out.append((int(m.group(1)), os.path.join(d, f)))
    if not out:
        raise SystemExit(f"no frames in {d} -- run film.mjs first")
    return sorted(out)


def at(fs, t):
    """The last frame painted at or before t."""
    best = None
    for ms, p in fs:
        if ms <= t:
            best = (ms, p)
    return best or fs[0]


def font(sz):
    for p in ("/System/Library/Fonts/SFNSDisplay.ttf", "/System/Library/Fonts/Helvetica.ttc"):
        if os.path.exists(p):
            try:
                return ImageFont.truetype(p, sz)
            except OSError:
                pass
    return ImageFont.load_default(sz)


ap = argparse.ArgumentParser()
ap.add_argument("dirs", nargs=2, help="two frame directories, top row first")
ap.add_argument("out")
ap.add_argument("--labels", nargs=2, default=["Before", "After"])
ap.add_argument("--times", default="90,130,210,430")
ap.add_argument("--keep", type=float, default=0.87,
                help="fraction of the frame height to show, from the top")
a = ap.parse_args()

times = [int(t) for t in a.times.split(",")]
rows = list(zip(a.labels, a.dirs))

label_f, tick_f = font(26), font(22)
left = max(int(label_f.getlength(l)) for l, _ in rows) + 38

sample = crop(Image.open(frames(rows[0][1])[0][1]), a.keep)
H = round(W * sample.height / sample.width)

sheet = Image.new("RGB",
                  (left + len(times) * (W + GAP) - GAP + PAD, TOP + len(rows) * (H + TOP) + PAD),
                  (18, 20, 24))
d = ImageDraw.Draw(sheet)

for c, t in enumerate(times):
    d.text((left + c * (W + GAP) + W / 2, 12), f"{t} ms", font=tick_f, fill=(150, 158, 170), anchor="ma")

for r, (name, dirn) in enumerate(rows):
    fs = frames(dirn)
    y = TOP + r * (H + TOP)
    d.text((left - 18, y + H / 2), name, font=label_f, fill=(226, 232, 240), anchor="rm")
    for c, t in enumerate(times):
        im = crop(Image.open(at(fs, t)[1]).convert("RGB"), a.keep).resize((W, H), Image.LANCZOS)
        x = left + c * (W + GAP)
        sheet.paste(im, (x, y))
        d.rectangle([x, y, x + W - 1, y + H - 1], outline=(52, 58, 68))

sheet.save(a.out)
print(a.out, sheet.size)
