# Homelinks

A new tab page that organizes itself from your own browsing history.

Type to narrow your links, press Enter to go. Anything that isn't a link becomes a search. It replaces the new tab in whichever Chromium browser you install it in: Brave, Chrome, Edge, Arc, Vivaldi.

## Install

1. Open `brave://extensions` (or `chrome://extensions`).
2. Turn on **Developer mode**.
3. Click **Load unpacked** and pick the `extension/` directory.
4. Open a new tab.

There is nothing to run and no server. Everything lives in the extension.

## Organize

Press `⌘O` and paste an API key from Anthropic, OpenAI, or Google. Leaving the key field asks the provider which models the key can use, so **Model** becomes a list rather than a name you have to remember and spell. A key the provider rejects leaves the field as a text box and says why. The extension reads this profile's history, sends the model a ranked list of hosts and page titles, and shows you the groups it proposes. Nothing is applied until you press **Use these**.

Two things the extension refuses to do with the model's answer:

- A link whose host wasn't in your history is dropped, so a model can't invent a plausible-looking URL onto your page.
- Sign-in pages, redirects, search results, and one-off record URLs are excluded from the candidate list before the model ever sees them.

Turn on **Refresh monthly** and it re-runs on its own, keeping the links you've kept.

Your API key is written to `chrome.storage.local` and never to `chrome.storage.sync`, so it stays on this device even when the rest of your settings follow you between machines. Your history is read locally and only the ranked host list leaves the machine, in that one request to the provider you picked.

## One homepage per profile

Extensions install per browser profile, so a work profile and a personal profile each get their own links, history, backgrounds, and API key. Install it in both and they never see each other.

## Keys

| Key | Does |
| --- | --- |
| any letter | jump to the prompt |
| `↑` `↓` `Tab` | move through matches |
| `Enter` | open the top match |
| `⇧Enter` `⌘Enter` | open in a new tab |
| `⌘K` | focus the prompt |
| `⌘E` | edit links |
| `⌘O` | organize |
| `⌘B` | appearance |
| `Esc` | clear, or close a sheet |

## Edit

`⌘E` turns on editing. Click a name or host to rename it, drag a link to another slot or another group, click a group name to rename it, `+ link` and `+ section` to add. Changes save as you make them.

## Icons

Each link wears the site's own favicon, read out of the browser's icon store through the extension's `favicon` permission. Nothing is downloaded, and no list of your links leaves the machine.

Chrome files an icon against the exact page it saw it on and offers no way to ask it for a host, so the extension asks three times, narrow to wide: the link's own URL, then the site root, then the busiest page on that host in your history. The first covers Docs, Sheets, and Slides, which carry different icons on one origin. The second covers a deep link into a site you normally enter at the top. The third covers the reverse — a site you read every day and never at its root, like Wikipedia.

A site the browser has never seen keeps its colored letter cap, which is the better mark anyway for a link you typed in by hand or synced from another computer. Chrome answers that case with a generic grey globe rather than an error, so `onerror` never fires; the extension fingerprints the globe once against a host that cannot exist and treats any match as no icon.

Dark monochrome marks — GitHub's, Vercel's — would vanish against a dark cap, so each icon's own pixels are weighed and the dark ones stand on a light plate.

## Appearance

`⌘B` opens gradients, solids, and your own photos. Drop an image anywhere on the page to use it. Uploads go to IndexedDB in this profile. Dim, blur, and grain keep text legible over a busy photo; **Rotate daily** picks a different one each day.

The same sheet sets the clock to 12- or 24-hour, the date to `Fri, Aug 21` / `Fri 21 Aug` / `Fri, 8/21` / `Fri 21/08`, and the name in the greeting. Leave the name blank and the greeting is just "Good afternoon".

## Address bar

Turn on **Keep a bookmarks folder** and the extension writes your links to a folder called `Homelinks`, laid out the way the page is: `Homelinks / <group> / <link>`. Chrome's omnibox indexes bookmarks by title as well as URL, so typing `confluence` finds `equisolve.atlassian.net` — something history alone never does, because history only matches the URL.

The **Folder** picker under the setting says where that folder lives. It lists every folder in this profile, defaults to Other Bookmarks, and moving it keeps the same folder, so the links inside are not deleted and made again. Drag the folder somewhere else in the bookmark manager and the picker follows it there.

It asks for bookmark access at that moment, not at install. Renaming, reordering, or deleting a link updates the folder. Turning the setting off deletes the folder and nothing else; your links stay in the app.

The folder was called `Homepage` before the project took its own name. Because it is found by title, a rename alone would walk past the one already synced to your other computers and build an empty second copy beside it, so the extension takes the old folder over in place: same folder, same links, new name.

## Syncing between computers

The same folder carries your links between machines. Sign both browsers into the same sync chain, turn the setting on in each, and an edit on one shows up on the other the next time you open a tab there. There is no server, no account, and nothing to configure: bookmarks are the one thing browsers sync reliably, and the folder is already there for the address bar.

Each computer keeps its own answer to where the folder sits, because bookmark ids are handed out per profile: the picker stores the folder names on the way down, and a path the other computer doesn't have falls back to Other Bookmarks rather than building folders you didn't ask for. A computer that finds the synced `Homelinks` folder somewhere else adopts it where it stands, so the two never drag it back and forth.

Every local edit writes the folder and records what it wrote. When a new tab finds the folder no longer matching that record, the change came from somewhere else, so the page adopts it and says so. Edits made by hand in the bookmark manager come across the same way. Last edit wins, which is the right answer when one person is using both computers.

What does not travel: the API key, deliberately, because it stays in local storage; background images, which are too large for any sync; and the appearance settings, which ride `chrome.storage.sync` and so depend on the browser actually syncing extension data. Brave's [extension sync has never worked](https://github.com/brave/brave-browser/issues/19164), so on Brave expect to pick the clock format and background once per machine.

The extension is loaded unpacked, so install it separately on each computer. Its id is derived from the install path and will differ between them, which is fine: the folder is found by name, not by id.

## Focus

Chrome and Brave give a new tab's keyboard focus to the address bar, and [the extension docs say not to fight it](https://developer.chrome.com/docs/extensions/develop/ui/override-chrome-pages): "Remember that new tabs give keyboard focus to the address bar first." No extension API moves focus into the page. On macOS the only shortcuts that shift focus between browser panes are `⌘⌥↓` and `⌘⌥↑`; there is no "skip to web contents" binding, so otherwise it takes a click. Once the page has focus, any letter jumps to the prompt.

## Files

| File | Holds |
| --- | --- |
| `manifest.json` | permissions, new tab override |
| `index.html` `style.css` | the page |
| `app.js` | rendering, filtering, editing, icons, backgrounds |
| `data.js` | one `api()` call shape over storage and history |
| `store.js` | `chrome.storage` and IndexedDB |
| `history.js` | `chrome.history` aggregated by host |
| `curate.js` | the three providers, the prompt, and validation |
| `bookmarks.js` | the `Homelinks` folder: address-bar names, and sync between computers |
| `sw.js` | the monthly re-curation alarm |

Fonts and their licenses are in `extension/fonts/`.
