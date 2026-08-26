import { push } from './bookmarks.js';
/* Everything the page needs to persist, backed by the browser.
   The extension is installed per profile, so a work profile and a personal
   profile get separate links, settings, history, and backgrounds for free. */

const DEFAULT_SETTINGS = {
  name: '',
  clock: '24',
  mirrorBookmarks: false,
  bookmarkParent: [],          // titles from the root; empty means Other Bookmarks
  dateFormat: 'us',
  showFrequent: true,
  searchUrl: 'https://www.google.com/search?q=%s',
  background: { mode: 'gradient', gradient: 'harbor', photoId: '', rotate: 'pinned',
                dim: 42, blur: 0, grain: true },
  ai: { provider: 'anthropic', key: '', model: '', autoCurate: false },
};

/* ---- chrome.storage -------------------------------------------------- */
// Links live in `local`, not `sync`. chrome.storage.sync would be the obvious
// home, but Brave's extension sync has never worked, and an unpacked extension
// gets a different id on every machine anyway. The bookmarks folder carries
// links between computers instead -- see bookmarks.js. Settings stay in `sync`
// for the profile, minus the API key, which never leaves this device.
const get = (area, k, d) => chrome.storage[area].get({ [k]: d }).then(r => r[k]);
const set = (area, k, v) => chrome.storage[area].set({ [k]: v });

/* ---- IndexedDB for background images ---------------------------------- */
const DB = 'homepage', STORE = 'backgrounds';
let dbP;
function db() {
  return dbP ||= new Promise((res, rej) => {
    const r = indexedDB.open(DB, 1);
    r.onupgradeneeded = () => r.result.createObjectStore(STORE, { keyPath: 'id' });
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
}
async function idb(mode, fn) {
  const d = await db();
  return new Promise((res, rej) => {
    const tx = d.transaction(STORE, mode);
    const rq = fn(tx.objectStore(STORE));
    rq.onsuccess = () => res(rq.result);
    rq.onerror = () => rej(rq.error);
  });
}

const urls = new Map();   // id -> object URL, revoked when replaced
function objectUrl(id, blob) {
  if (urls.has(id)) URL.revokeObjectURL(urls.get(id));
  const u = URL.createObjectURL(blob);
  urls.set(id, u);
  return u;
}

/* A 160px copy of an image, small enough to keep in chrome.storage next to its
   name and big enough to be the swatch in the Appearance sheet. It also stands
   in for the photograph during the few milliseconds the real one takes to come
   out of IndexedDB and decode, so a new tab opens on the picture rather than on
   a gradient that is replaced a moment later. */
async function thumb(blob) {
  try {
    const bmp = await createImageBitmap(blob);
    const w = 160, h = Math.max(1, Math.round(w * bmp.height / bmp.width));
    const c = new OffscreenCanvas(w, h);
    c.getContext('2d').drawImage(bmp, 0, 0, w, h);
    bmp.close();
    const bytes = new Uint8Array(await (await c.convertToBlob({ type: 'image/jpeg', quality: .55 })).arrayBuffer());
    let s = '';
    for (const b of bytes) s += String.fromCharCode(b);
    return 'data:image/jpeg;base64,' + btoa(s);
  } catch { return ''; }        // a file the browser can't decode; the gradient shows instead
}

/* What the page reads: ids, names, and thumbnails. The images themselves stay
   in IndexedDB, where reading them all costs however many megabytes the user
   has added, and only the one going on screen is ever read. */
const indexRow = async (r) => ({ id: r.id, name: r.name, thumb: await thumb(r.blob) });

async function rebuildIndex() {
  const ix = await Promise.all((await idb('readonly', s => s.getAll())).map(indexRow));
  await set('local', 'photos', ix);
  return ix;
}

const settingsFrom = (synced, secrets) => {
  const s = { ...DEFAULT_SETTINGS, ...synced };
  s.background = { ...DEFAULT_SETTINGS.background, ...(synced.background || {}) };
  s.ai = { ...DEFAULT_SETTINGS.ai, ...(synced.ai || {}), key: secrets.aiKey || '' };
  return s;
};

export const Store = {
  /* Everything the first paint needs, in one round trip per storage area and
     with nothing in it that has to be computed. The two slow things -- the
     visit counts behind Frequent, and the background image -- are read from
     what the last tab left behind and refreshed once this one is on screen. */
  async boot() {
    const [l, y] = await Promise.all([
      chrome.storage.local.get({ links: [], secrets: {}, frequent: null, icons: {}, photos: null }),
      chrome.storage.sync.get({ settings: {} }),
    ]);
    return {
      links: l.links,
      settings: settingsFrom(y.settings, l.secrets),
      frequent: l.frequent,       // { at, list }, or null before the first count
      icons: l.icons,
      photos: l.photos,           // null until the index has been built
    };
  },

  async links() { return get('local', 'links', []); },
  async putLinks(v) {
    await set('local', 'links', v);
    // Keep the address-bar mirror in step no matter who wrote the links:
    // the editor, Organize, or the scheduled re-curation in the worker.
    const { mirrorBookmarks } = await get('sync', 'settings', {});
    if (mirrorBookmarks) await push(v).catch(() => {});
  },

  async settings() {
    const [synced, local] = await Promise.all([
      get('sync', 'settings', {}), get('local', 'secrets', {}),
    ]);
    return settingsFrom(synced, local);
  },
  async putSettings(v) {
    const { ai = {}, ...rest } = v;
    const { key, ...aiRest } = ai;                 // the key never leaves this device
    await Promise.all([
      set('sync', 'settings', { ...rest, ai: aiRest }),
      set('local', 'secrets', { aiKey: key || '' }),
    ]);
  },

  putFrequent(list) { return set('local', 'frequent', { at: Date.now(), list }); },
  putIcons(map) { return set('local', 'icons', map); },

  async photos() { return (await get('local', 'photos', null)) || rebuildIndex(); },
  async photo(id) {
    const r = await idb('readonly', s => s.get(id));
    return r ? { id: r.id, name: r.name, src: objectUrl(r.id, r.blob) } : null;
  },

  async addBackground(file) {
    const id = 'bg-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 7);
    const rec = { id, name: file.name, blob: file, at: Date.now() };
    await idb('readwrite', s => s.put(rec));
    // A profile that predates the index rebuilds it, which picks up this image
    // along with the rest. Appending to an index that isn't there yet would
    // hide every image added before it.
    const ix = await get('local', 'photos', null);
    if (ix) await set('local', 'photos', [...ix, await indexRow(rec)]);
    else await rebuildIndex();
    return { id, name: file.name };
  },
  async delBackground(id) {
    if (urls.has(id)) { URL.revokeObjectURL(urls.get(id)); urls.delete(id); }
    await idb('readwrite', s => s.delete(id));
    const ix = await get('local', 'photos', null);
    if (ix) await set('local', 'photos', ix.filter(p => p.id !== id));
    else await rebuildIndex();
  },
};

export { DEFAULT_SETTINGS };
