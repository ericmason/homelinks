# Chrome Web Store submission

Listing copy and privacy answers for **Homelinks**. Paste from here into the [Developer Dashboard](https://chrome.google.com/webstore/devconsole) rather than rewriting, and edit this file when the answers change, so the record of what is on file stays in the repository.

**This is a new store item.** Nothing has been submitted yet, so there is no id, no published build, and no update mechanics to reason about. `CHANGELOG.md` is the source of truth for release dates: stamp the submitted and published dates in its `## 2.2.0` heading, and in § Submitting 2.2.0 below, as each happens.

## Single purpose

```text
Replace the new tab page with the user's own links, grouped from their own browsing history, and let them reach any of those links by typing a few letters of its name.
```

Everything the extension does serves that one page: naming and grouping the links, drawing each site's icon, the frequent-sites row, the optional bookmarks folder that makes the same links reachable from the address bar, and the appearance settings for the page itself.

## Short description

```text
A keyboard-first new tab that organizes itself from your own browsing history.
```

78 characters, inside the store's 132-character summary limit, and identical to `description` in `extension/manifest.json` so the listing and the extension agree.

## Detailed description

> The store's description field is **plain text**. Markdown renders literally, so this block uses `•` bullets, and each paragraph is one unwrapped line. Paste it verbatim.

```text
Homelinks turns the new tab into a page of your own links: a few named groups, a site icon on each, and a prompt at the top that jumps to any of them from a few letters.

You can type the groups in by hand. Or hand the job to a model: Organize reads the sites this browser profile visits most, asks your AI provider to sort them into groups, and shows you the result before anything is saved. You bring your own API key from Anthropic, OpenAI, or Google, and it is stored on your own machine.

• Type to jump. The prompt matches the names you gave your links, not just their URLs, so "payroll" finds the HR site whose hostname you would never remember. Enter goes there; anything the prompt doesn't match becomes a web search.
• Real icons. Each link wears the site's own favicon, taken from the browser's icon store. No image is downloaded, and no list of your links is sent anywhere to fetch them.
• Grouped from your own history. Organize sends the model a list of the sites you actually use and gets back groups with short names. Nothing is saved until you look at the preview and accept it.
• A bookmarks folder, if you want one. Turn it on and your links are mirrored to a bookmarks folder called Homelinks, so the address bar finds them by name — and because browsers sync bookmarks, the same links show up on your other computer.
• Yours to arrange. Rename, drag, and delete links in place. Add one by pasting a URL: the icon and the name fill themselves in from what your browser already knows.
• A page you can stand to look at. Gradients, solid colors, or your own photos, with dim, blur, and grain to keep text legible. 12- or 24-hour clock, four date formats, and a greeting you can turn off.

Private by default. Your links, settings, and images stay in this browser profile. There is no account, no server of ours, and no analytics. The one time anything leaves your machine is when you run Organize, and it goes straight to the AI provider you chose, with your key.

One profile, one page: a work profile and a personal profile get their own links, and neither can see the other's.

Open source: https://github.com/ericmason/homelinks
```

## Category and visibility

- **Category**: Productivity → Workflow & Planning.
- **Language**: English (United States).
- **Visibility**: Public, so the item is listed and searchable. Decided 2026-08-25.

## Privacy tab

### Purpose

```text
Homelinks replaces the new tab page with the user's own links. It reads this profile's browsing history to rank the sites they use and to name a link they add, and — only when the user asks for it — sends that list of sites to the AI provider whose key they entered, to get back a set of groups.
```

### Permission justifications

Paste one per permission. Each is the reason the extension stops working without it.

```text
storage: Keeps the user's links, groups, and page settings in this browser profile. Nothing is stored anywhere else.

unlimitedStorage: Background photos are stored as the user uploaded them, in IndexedDB. Full-resolution images are large enough to be evicted under the default quota, which would blank the page's background.

history: Two uses, both local. The new tab shows the profile's most-visited sites as a Frequent row, and Organize builds the list of sites it asks the model to group. Adding a link also reads the title the browser already holds for that site, so the link names itself.

alarms: The optional monthly refresh. The alarm exists because a new tab may never be open at the moment the refresh is due.

favicon: Draws each link's icon from the browser's own icon store, so no icon is fetched from the network and no list of the user's links leaves the machine.

bookmarks (optional): Requested only when the user turns on "Keep a bookmarks folder", and used only to write, read, and move one folder named Homelinks. It exists so the address bar can find the user's links by the names they gave them, and so browser bookmark sync carries the links to their other computers.
```

#### Host permissions

```text
https://api.anthropic.com/*, https://api.openai.com/*, https://generativelanguage.googleapis.com/*: The three AI providers the user can choose between. The extension contacts exactly one of them, with the user's own API key: once to list the models that key can use, and again when the user runs Organize. There is no other network destination, and no server belonging to the developer.
```

### Remote code

**No.** Every line the extension runs ships in the package. There is no `eval`, no `new Function`, no remotely-hosted script or stylesheet, and the fonts are in the zip.

### Data usage — what to declare

Tick these two, and nothing else:

- **Web history** — Organize sends the model a list of hosts and page titles from this profile's history. This is the only category the extension transmits anywhere.
- **Authentication information** — the user's own API key. Stored in `chrome.storage.local` on their machine, deliberately kept out of `chrome.storage.sync` so it never travels, and sent only to the provider that issued it, as that provider's authorization header.

Not personally identifiable information, not location, not personal communications, not financial or health data, not user activity: the extension records no keystrokes, clicks, or page content, and it reads no page the user visits.

### Data usage — the three certifications

All three are true, tick all three:

- Not being sold to third parties, outside of the approved use cases.
- Not being used or transferred for purposes unrelated to the item's single purpose.
- Not being used or transferred to determine creditworthiness or for lending purposes.

### Data usage — narrative, if a free-text field is offered

```text
Homelinks stores the user's links, settings, and uploaded background images in their own browser profile. It has no server and no account, and it sends no telemetry.

One feature transmits anything at all. When the user clicks "Organize my links", the extension sends a list of the sites this profile visits most — hosts, page titles, and visit counts — to the AI provider the user chose, authorized with the API key the user entered. The response is a set of group names and link names, which the user sees as a preview and can discard. The same request happens once a month if the user turns on the monthly refresh. No other data is sent, and the provider is the only destination.
```

### Privacy policy URL

```text
https://github.com/ericmason/homelinks/blob/main/docs/privacy-policy.md
```

## Reviewer notes

```text
The extension works fully without an API key: install it, open a new tab, and press Cmd/Ctrl+E to add links by hand. The Frequent row fills in from whatever history the test profile has.

To exercise the AI feature you need your own key from Anthropic, OpenAI, or Google. Press Cmd/Ctrl+O, choose a provider, paste the key, and the Model field turns into a list of the models that key can use — that list is a GET to the provider, and it is how you can tell the key was accepted. "Organize my links" then sends the history summary and shows a preview; nothing is saved until you click "Use these".

The bookmarks permission is optional and requested at the moment the user ticks "Keep a bookmarks folder" in Cmd/Ctrl+B, not at install. Everything the extension writes lives in one folder named Homelinks; it never touches a bookmark outside that folder, and turning the setting off deletes that folder and nothing else.
```

## Listing assets

Regenerate all of them with:

```sh
./scripts/build.sh
node scripts/store-assets/capture.mjs
python3 scripts/store-assets/assemble.py
```

`capture.mjs` drives a real Chromium with the built extension loaded, and browses a dozen public sites first, so the screenshots show the extension's own rendering with the browser's own favicons and a real Frequent row — not a mockup. The links in them are invented (GitHub, Wikipedia, arXiv, and the like) and the profile is deleted at the end. Two departures from a stock install, both in the interest of showing what a user actually sees:

- `bookmarks` is promoted from optional to required in the captured copy. Chrome asks for an optional permission on a click, which a headless run cannot answer, and the shot shows the state a user reaches by ticking the box.
- The Organize shot answers the model-list request from a route stub, so no API key is needed. The model ids in the dropdown are the provider's real ones.

| Store field | File | Size |
| --- | --- | --- |
| Store icon (required) | `docs/store/icon-128.png` | 128×128 |
| Screenshot 1 (required) | `docs/store/screenshot-1-home.png` | 1280×800 |
| Screenshot 2 | `docs/store/screenshot-2-jump.png` | 1280×800 |
| Screenshot 3 | `docs/store/screenshot-3-add-link.png` | 1280×800 |
| Screenshot 4 | `docs/store/screenshot-4-organize.png` | 1280×800 |
| Screenshot 5 | `docs/store/screenshot-5-bookmarks.png` | 1280×800 |
| Small promo tile | `docs/store/promo-small-440x280.png` | 440×280 |
| Marquee promo tile (optional) | `docs/store/promo-marquee-1400x560.png` | 1400×560 |

Screenshot 1 is the page itself because it is what the store shows in search results, and the page is the product. Captions:

1. Your links, grouped and named the way you say them out loud, each with the site's own icon.
2. Type a few letters and the page filters to one link. Enter goes there; anything it doesn't match becomes a web search.
3. Add a link by pasting its URL. The icon and the name fill themselves in from what the browser already knows about the site.
4. Bring your own key from Anthropic, OpenAI, or Google. Once it's accepted, the Model field lists the models that key can use.
5. Mirror the links to a bookmarks folder, in whichever folder you pick, so the address bar finds them by name and your other computer gets them through bookmark sync.

## Packaging

```sh
./scripts/build.sh
```

Upload `dist/homelinks-<version>.zip`. The zip carries the extension's own icons; the 128×128 listing icon above is uploaded separately.

## Pre-submission checklist

- [ ] `extension/manifest.json` version matches the `CHANGELOG.md` top section.
- [ ] `./scripts/build.sh` run against a clean tree, and `dist/extension/` loaded unpacked once to confirm the packaged copy works.
- [ ] Screenshots regenerated if anything visible changed, and no real personal data in any of them.
- [ ] Permissions in the manifest are all still used. `topSites` was removed at 2.2.0 for exactly this reason: the code had stopped calling it, and an unused permission is a rejection.
- [ ] Privacy answers above re-read against what the code does now, in particular whether anything new sends data anywhere.
- [ ] Privacy policy URL resolves.

## Submitting 2.2.0

Not yet submitted. Record here what went up and when, and stamp the dates in `CHANGELOG.md` at the same time.
