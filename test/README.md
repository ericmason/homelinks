# Tests

Browser tests for the extension, driven by Playwright against a real Chromium with the unpacked extension loaded. Nothing here ships: the extension has no build step and no runtime dependencies.

## Setup

```
cd test
npm install
npx playwright install chromium
```

You also need `sqlite3` on the path, which macOS has already.

## Run

```
node smoke.mjs           # does it still work?
node bench.mjs           # how fast does a new tab become usable?
node film.mjs after      # frame-by-frame screencast of a tab opening
```

Every script takes the extension directory from `$EXT` and defaults to `../extension`, so comparing a change against what is on `main` is two runs:

```
git worktree add /tmp/hl-main main
EXT=/tmp/hl-main/extension node bench.mjs baseline
node bench.mjs current
```

## The profile

A new tab is only slow on a profile that has something in it, so the tests build one: 14,400 history rows across 1,200 hosts, plus a real favicon store filled by visiting the sites in `LINKS`. That takes about a minute and needs the network, so it is built once into `.work/profile-template` and copied for each run. Delete `.work` to rebuild it.

The template is shared between extension builds on purpose. An unpacked extension's id is derived from its directory path, so extension storage in a profile belongs to whichever directory wrote it — which is why every script seeds links and settings itself, at run time, on its own copy. What the template carries is the browser's own state, History and Favicons, which no extension id is attached to.

`HOSTS` and `PPH` (pages per host) are environment variables if you want a bigger or smaller profile. `RUNS` sets how many tabs `bench.mjs` opens; the first is cold on purpose and fills the caches for the rest, which is the first tab after an install.

## What the numbers mean

`bench.mjs` reports when the page became **usable**, not when the document finished loading:

- **links on screen** — the first `.tile` exists.
- **first favicon** / **all favicons settled** — `.cap.has-icon`, first and last.
- **Frequent row** — `#freqWrap` is no longer hidden.
- **first paint** / **first contentful paint** — from `PerformanceObserver`. FCP is worth watching: an entrance animation that starts at `opacity: 0` holds it back even though the content is already drawn, which is how the plate's fade was found.

Absolute numbers move with whatever else the machine is doing — the same build measured 20 ms for links on screen on an idle Mac and 76 ms at load average 22. So compare a pair of runs taken in the same session against each other, and don't read a single run as a target.

Then it measures what used to sit in front of the paint — `history.search`, opening IndexedDB, one favicon fetch — against the same profile, so a number can be traced to the call that produced it.

## Filmstrips

`film.mjs` records the compositor's own frames over CDP, so it shows what a person sees rather than what the page reports about itself. Two runs and `strip.py` make the before/after image for a pull request:

```
EXT=/tmp/hl-main/extension node film.mjs before
node film.mjs after
python3 strip.py .work/frames-before .work/frames-after /tmp/filmstrip.png
```

Add `--photo` to both runs to film with a background photograph set, which is the state the thumbnail-then-full-size background is about. `strip.py` needs Pillow.
