# Changelog

Every change to what the extension does, shows, stores, or transmits gets a bullet here, in the same commit or pull request as the change itself. Documentation, tests, and build tooling stay out.

The top section is the version in `extension/manifest.json`. It reads `## <version> — unreleased` until that version goes to the Chrome Web Store, then gets stamped in place — `## 2.2.0 — submitted 2026-09-01, published 2026-09-02`, UTC dates, always *submitted* and *published*, never *approved*. After a version is submitted, open a `## Unreleased` section above it rather than appending to the record of a release that is already on people's machines. Cite the pull request, or the short commit SHA where there is no pull request.

## 2.2.0 — unreleased

- The extension is called **Homelinks**. The bookmarks folder is renamed to match, and the old `Homepage` folder is taken over in place, so your other computers see a rename rather than a folder deleted and rebuilt. ([509f3e2](https://github.com/ericmason/homelinks/commit/509f3e2))
- A folder of your own called `Homepage` is left alone. Only a folder shaped like the one the extension writes — groups at the top level, links inside them — is adopted, which matters because the next save deletes anything in the adopted folder it did not put there. ([9e3e0f7](https://github.com/ericmason/homelinks/commit/9e3e0f7))
- **Folder** in ⌘B picks which bookmarks folder holds the Homelinks folder, instead of it always being Other Bookmarks. It lists every folder in the profile, and moving it keeps the same folder, so the links inside are not deleted and made again. The choice travels between computers as folder names rather than ids, which are assigned per profile. ([579421f](https://github.com/ericmason/homelinks/commit/579421f), [71a2619](https://github.com/ericmason/homelinks/commit/71a2619))
- Adding a link starts at its URL. Leave the field and the site's own favicon appears and the name fills in from this profile's history — "Confluence" for equisolve.atlassian.net — with the domain as a fallback for a site the browser has never seen. ([d6ffb83](https://github.com/ericmason/homelinks/commit/d6ffb83))
- **Model** in the Organize sheet is a dropdown of the models your key can actually use, fetched from the provider the moment the key works. A key the provider rejects leaves the field as a text box and says why. ([12c4cea](https://github.com/ericmason/homelinks/commit/12c4cea))

## 2.1.0 and earlier

No changelog was kept. This repository begins with a snapshot of the working extension taken on 2026-08-25 ([7edc4b8](https://github.com/ericmason/homelinks/commit/7edc4b8)), which is version 2.2.0 already, so there are no earlier sections to fill in: the new tab page, history-based curation, the three providers, favicons, backgrounds, and the bookmarks folder itself all predate the first commit.
