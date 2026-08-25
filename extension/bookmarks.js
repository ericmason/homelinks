/* The bookmarks folder does two jobs at once.

   1. Address bar autocomplete. Chrome's omnibox indexes bookmarks by title as
      well as URL and scores an early title match highly, so a bookmark named
      "Confluence" answers "conf" even though its URL says
      equisolve.atlassian.net. Nothing else gets you that: history matches on
      URL, and chrome.omnibox needs a keyword prefix.

   2. Sync between computers. Bookmarks are the one thing browsers sync
      reliably, and this folder already holds every link, so it doubles as a
      transport that costs nothing to build and needs no account of its own.
      Edit on the laptop, open a new tab on the desktop, and the change is
      there.

   Layout mirrors the page: Homepage / <group> / <link>. Nothing outside that
   folder is ever touched. */

const FOLDER = 'Homepage';

export const granted = () =>
  chrome.permissions.contains({ permissions: ['bookmarks'] });

/* A fingerprint of a link set. Order is part of it, so a drag to reorder
   travels between computers like any other edit. */
export const sig = (groups) => JSON.stringify(
  (groups || []).map(g => [g.name, (g.items || []).map(i => [i.name, i.url])]));

const clean = (groups) => (groups || [])
  .map(g => ({ name: g.name, items: (g.items || []).filter(i => i.name && i.url) }))
  .filter(g => g.items.length);

async function otherBookmarks() {
  const roots = await chrome.bookmarks.getChildren('0');
  const other = roots.find(r => /other/i.test(r.title)) || roots[roots.length - 1];
  return other?.id || '1';
}

/* Which folder the Homepage folder sits in. Bookmark ids are assigned per
   profile, so the choice cannot travel between computers as an id: it is stored
   as the folder titles on the way down from the root. An empty path means Other
   Bookmarks, where this used to be nailed. A path that doesn't exist on this
   computer falls back there too, rather than building folders nobody asked
   for. */
async function resolvePath(path) {
  let id = '0';
  for (const title of path || []) {
    const hit = (await chrome.bookmarks.getChildren(id)).find(n => !n.url && n.title === title);
    if (!hit) return null;
    id = hit.id;
  }
  return id === '0' ? null : id;
}

async function parentFolder() {
  const { settings = {} } = await chrome.storage.sync.get({ settings: {} });
  return (await resolvePath(settings.bookmarkParent)) || otherBookmarks();
}

/* The folder wherever it already is. Settings and bookmarks sync on separate
   schedules, and on Brave the settings never arrive at all, so the second
   computer can have the folder in hand while still thinking it belongs in Other
   Bookmarks. Adopting it where it stands beats building a second copy. Only the
   picker moves the folder -- see setParent -- so two computers never drag it
   back and forth. */
async function findAnywhere() {
  for (const n of await chrome.bookmarks.search({ title: FOLDER })) {
    if (n.url) continue;
    if ((await chrome.bookmarks.getChildren(n.id)).length) return n;
  }
  return null;
}

/* One folder lookup at a time. A new tab and the scheduled re-curation in the
   worker can both want the folder at once, and two creates would leave two
   folders and a split-brain link list. */
let chain = Promise.resolve();
function folderId(create = true) {
  const run = chain.then(() => resolveFolder(create), () => resolveFolder(create));
  chain = run.catch(() => {});
  return run;
}

async function resolveFolder(create) {
  const { bookmarkFolderId } = await chrome.storage.local.get('bookmarkFolderId');
  if (bookmarkFolderId) {
    // It may have been deleted out from under us.
    const [node] = await chrome.bookmarks.get(bookmarkFolderId).catch(() => []);
    if (node) return node.id;
  }
  // The second computer has the synced folder but not the id pointing at it,
  // so match by name before creating a duplicate.
  const parent = await parentFolder();
  const hits = (await chrome.bookmarks.getChildren(parent)).filter(n => !n.url && n.title === FOLDER);
  let node = hits[0] || await findAnywhere();
  if (!node) {
    if (!create) return null;
    node = await chrome.bookmarks.create({ parentId: parent, title: FOLDER });
  }
  // An older version, or a browser that synced the folder twice, can leave a
  // second empty copy. Keep the one with the links in it.
  for (const extra of hits.slice(1)) {
    if (!(await chrome.bookmarks.getChildren(extra.id)).length)
      await chrome.bookmarks.removeTree(extra.id).catch(() => {});
  }
  await chrome.storage.local.set({ bookmarkFolderId: node.id });
  return node.id;
}

/* Put children in the given order. Re-reading each round sidesteps the
   off-by-one in move(): slots below i are already correct, so the node we want
   always sits after i and lands exactly where we ask. */
async function order(parentId, ids) {
  for (let i = 0; i < ids.length; i++) {
    const kids = await chrome.bookmarks.getChildren(parentId);
    if (kids[i]?.id !== ids[i]) await chrome.bookmarks.move(ids[i], { parentId, index: i });
  }
}

const drop = (n) => (n.url ? chrome.bookmarks.remove(n.id) : chrome.bookmarks.removeTree(n.id));

/* Reconcile one level: reuse what matches, rename what is left over, delete the
   rest. Reuse keeps dateAdded intact and keeps sync traffic to the real diff. */
async function level(parentId, want, key, make, rename) {
  const spare = await chrome.bookmarks.getChildren(parentId);
  const ids = [];
  for (const w of want) {
    let k = spare.findIndex(n => key(n) === key(w));
    if (k < 0) k = spare.findIndex(n => !!n.url === !!w.url);
    if (k < 0) { ids.push((await make(w)).id); continue; }
    const node = spare.splice(k, 1)[0];
    const patch = rename(node, w);
    if (patch) await chrome.bookmarks.update(node.id, patch);
    ids.push(node.id);
  }
  for (const n of spare) await drop(n).catch(() => {});
  await order(parentId, ids);
  return ids;
}

/* Write the current links into the folder. */
export async function push(groups) {
  if (!chrome.bookmarks || !(await granted())) return null;
  const id = await folderId();
  const want = clean(groups);

  const ids = await level(id, want, n => n.title,
    g => chrome.bookmarks.create({ parentId: id, title: g.name }),
    (n, g) => (n.title === g.name ? null : { title: g.name }));

  for (const [i, g] of want.entries()) {
    await level(ids[i], g.items, n => n.url,
      it => chrome.bookmarks.create({ parentId: ids[i], title: it.name, url: it.url }),
      (n, it) => (n.title === it.name ? null : { title: it.name }));
  }

  await chrome.storage.local.set({ mirrorSig: sig(await read()) });
  return { groups: want.length, links: want.reduce((t, g) => t + g.items.length, 0) };
}

/* Read the folder back as links. */
export async function read() {
  if (!chrome.bookmarks || !(await granted())) return null;
  const id = await folderId(false);
  if (!id) return null;
  const groups = [];
  for (const k of await chrome.bookmarks.getChildren(id)) {
    if (k.url) continue;                       // a stray bookmark, not a group
    const items = (await chrome.bookmarks.getChildren(k.id))
      .filter(b => b.url).map(b => ({ name: b.title, url: b.url }));
    if (items.length) groups.push({ name: k.title, items });
  }
  return groups.length ? groups : null;
}

/* Has the folder changed since we last wrote it? If so the change arrived from
   another computer (or from the bookmark manager) and these are the links to
   adopt. Returns null when there is nothing to take. */
export async function pull(local) {
  const remote = await read();
  if (!remote) return null;
  const rs = sig(remote);
  const { mirrorSig } = await chrome.storage.local.get('mirrorSig');
  if (rs === mirrorSig) return null;           // exactly what we wrote
  if (rs === sig(clean(local))) {              // already in step, just stale
    await chrome.storage.local.set({ mirrorSig: rs });
    return null;
  }
  return remote;
}

export async function unmirror() {
  if (!chrome.bookmarks) return;
  const id = await folderId(false);
  await chrome.storage.local.remove(['bookmarkFolderId', 'mirrorSig']);
  if (id) await chrome.bookmarks.removeTree(id).catch(() => {});
}

/* ------------------------------------------------------- where it lives */

/* Every folder in the tree, flat, for the picker. The Homepage folder and
   everything under it are left out: it cannot be its own parent. */
export async function folders() {
  if (!chrome.bookmarks || !(await granted())) return [];
  const home = await folderId(false);
  const out = [];
  const walk = async (id, path) => {
    for (const n of await chrome.bookmarks.getChildren(id)) {
      if (n.url || n.id === home) continue;
      const p = [...path, n.title];
      out.push({ id: n.id, title: n.title, path: p, depth: p.length - 1 });
      await walk(n.id, p);
    }
  };
  await walk('0', []);
  return out;
}

/* Where the folder actually sits, as a title path. Reality rather than the
   setting: a drag in the bookmark manager, or a path that doesn't exist on this
   computer, leaves the two disagreeing, and the picker should show the folder
   the user can go look at. */
export async function parentOf() {
  if (!chrome.bookmarks || !(await granted())) return null;
  const id = await folderId(false);
  const [node] = id ? await chrome.bookmarks.get(id).catch(() => []) : [];
  if (!node) return null;
  const path = [];
  for (let up = node.parentId; up && up !== '0';) {
    const [p] = await chrome.bookmarks.get(up).catch(() => []);
    if (!p) break;
    path.unshift(p.title);
    up = p.parentId;
  }
  return path;
}

/* Move the folder under a new parent, keeping its id so sync sees a move rather
   than a delete and a rebuild. Nothing else moves it. */
export async function setParent(path) {
  if (!chrome.bookmarks || !(await granted())) return null;
  const parentId = (await resolvePath(path)) || await otherBookmarks();
  const id = await folderId(false);
  if (id) await chrome.bookmarks.move(id, { parentId });
  return parentId;
}
