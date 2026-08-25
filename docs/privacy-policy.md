# Homelinks privacy policy

Last updated 2026-08-25.

Homelinks is a browser extension that replaces the new tab page. It has no server, no account, and no analytics. Almost everything it does happens inside your own browser profile, and this page describes the one thing that doesn't.

## What is stored, and where

All of it stays in the browser profile the extension is installed in:

- **Your links and groups**, in the extension's local storage.
- **Your settings** — clock and date format, greeting name, background choice, which bookmarks folder to use — in the browser's synced extension storage, so they follow your browser account to your other computers.
- **Background images you upload**, in IndexedDB, at the resolution you gave them.
- **Your AI provider's API key**, in local storage only. It is deliberately kept out of synced storage, so it never leaves the machine you typed it on.

Nothing is stored anywhere else. Two profiles on the same computer each keep their own, and neither can read the other's.

## What is read

The extension reads this profile's **browsing history** to rank the sites you visit most, to fill the Frequent row, and to name a link you add from its URL. It reads the browser's **favicon store** to draw each link's icon, which is why no icon is fetched from the network.

With your permission it also reads and writes **one bookmarks folder**, named Homelinks. That permission is requested when you turn on **Keep a bookmarks folder**, not at install, and the extension never reads, changes, or deletes a bookmark outside that folder. Turning the setting off deletes that folder and nothing else.

## What is sent, and to whom

One feature sends anything at all.

When you click **Organize my links**, the extension sends a summary of your browsing history — hostnames, page titles, and visit counts for the sites this profile visits most — to the AI provider you chose, using the API key you entered. The provider returns group names and link names, which you see as a preview and can discard. If you turn on the monthly refresh, the same request runs once a month.

The provider is the only destination, and which one it is depends on your choice: [Anthropic](https://www.anthropic.com/legal/privacy), [OpenAI](https://openai.com/policies/privacy-policy/), or [Google](https://policies.google.com/privacy). What they do with the request is governed by their own policy and by the terms of the account your key belongs to. The extension sends nothing to the developer, because there is nowhere to send it: no server, no endpoint, no telemetry.

Your key is sent only to the provider that issued it, as that provider's authorization header.

## What is never collected

No page content, no keystrokes, no clicks, no form data, no location, no personal or financial information. The extension does not run on the pages you visit at all — it runs on the new tab page and nowhere else.

## Deleting your data

Removing the extension deletes its storage, including the API key and the background images. Turning off **Keep a bookmarks folder** deletes the bookmarks folder it made. History belongs to the browser, not to the extension; delete it in the browser's own settings.

## Changes

Material changes to this policy will be committed to [the repository](https://github.com/ericmason/homelinks), so the history of it is public and dated.

## Contact

Open an issue at [github.com/ericmason/homelinks/issues](https://github.com/ericmason/homelinks/issues).
