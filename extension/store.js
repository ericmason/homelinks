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

export const Store = {
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
    const s = { ...DEFAULT_SETTINGS, ...synced };
    s.background = { ...DEFAULT_SETTINGS.background, ...(synced.background || {}) };
    s.ai = { ...DEFAULT_SETTINGS.ai, ...(synced.ai || {}), key: local.aiKey || '' };
    return s;
  },
  async putSettings(v) {
    const { ai = {}, ...rest } = v;
    const { key, ...aiRest } = ai;                 // the key never leaves this device
    await Promise.all([
      set('sync', 'settings', { ...rest, ai: aiRest }),
      set('local', 'secrets', { aiKey: key || '' }),
    ]);
  },

  async backgrounds() {
    const rows = await idb('readonly', s => s.getAll());
    return rows.map(r => ({ id: r.id, name: r.name, src: objectUrl(r.id, r.blob) }));
  },
  async addBackground(file) {
    const id = 'bg-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 7);
    await idb('readwrite', s => s.put({ id, name: file.name, blob: file, at: Date.now() }));
    return { id, name: file.name, src: objectUrl(id, file) };
  },
  async delBackground(id) {
    if (urls.has(id)) { URL.revokeObjectURL(urls.get(id)); urls.delete(id); }
    return idb('readwrite', s => s.delete(id));
  },
};

export { DEFAULT_SETTINGS };
