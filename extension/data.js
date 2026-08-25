/* Same call shape the UI already used against the local server, backed by
   chrome.storage, IndexedDB, and chrome.history instead. Keeping the interface
   meant the filtering, editing, and background code did not have to change. */

import { Store } from './store.js';
import { topSites } from './history.js';

/* How long a Frequent count is good for. Counting means reading six months of
   this profile's history, which is a tenth of a second on a full one, so it is
   never done on the way to a paint: a tab draws the last count and takes a new
   one afterwards, for the next tab to draw. Visit counts move slowly enough
   that a few hours of drift is invisible. */
const STALE = 6 * 3600e3;
export const stale = (cached) => !cached || !cached.list || Date.now() - cached.at > STALE;

export async function api(path, opts = {}) {
  const body = typeof opts.body === 'string' ? JSON.parse(opts.body) : opts.body;
  const [route, query] = path.split('?');
  const q = new URLSearchParams(query || '');

  switch (route) {
    case '/api/state':
      return Store.boot();
    case '/api/links':
      await Store.putLinks(body); return { ok: true };
    case '/api/settings':
      await Store.putSettings(body); return { ok: true };
    case '/api/icons':
      await Store.putIcons(body); return { ok: true };
    case '/api/frequent':
      return { frequent: await count() };
    case '/api/photos':
      return { photos: await Store.photos() };
    case '/api/photo':
      return { photo: await Store.photo(q.get('id')) };
    case '/api/background':
      if (opts.method === 'DELETE') { await Store.delBackground(q.get('name')); return { ok: true }; }
      if (!(body instanceof File || body instanceof Blob)) return { error: 'Pick an image file.' };
      if (body.size > 40 * 1024 * 1024) return { error: 'Image is over 40 MB. Use a smaller file.' };
      return Store.addBackground(body);
    default:
      throw new Error(`No route ${route}`);
  }
}

async function count() {
  let list;
  try { list = await topSites({ limit: 24 }); }
  catch { list = []; }      // history permission refused, or a brand new profile
  await Store.putFrequent(list);
  return list;
}
