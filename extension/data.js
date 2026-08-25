/* Same call shape the UI already used against the local server, backed by
   chrome.storage, IndexedDB, and chrome.history instead. Keeping the interface
   meant the filtering, editing, and background code did not have to change. */

import { Store } from './store.js';
import { topSites } from './history.js';

let freqCache = null;

export async function api(path, opts = {}) {
  const body = typeof opts.body === 'string' ? JSON.parse(opts.body) : opts.body;
  const [route, query] = path.split('?');
  const q = new URLSearchParams(query || '');

  switch (route) {
    case '/api/state': {
      const [links, settings, backgrounds, frequent] = await Promise.all([
        Store.links(), Store.settings(), Store.backgrounds(), getFrequent(),
      ]);
      return { links, settings, backgrounds, frequent };
    }
    case '/api/links':
      await Store.putLinks(body); return { ok: true };
    case '/api/settings':
      await Store.putSettings(body); return { ok: true };
    case '/api/frequent':
      return { frequent: await getFrequent(q.has('refresh')) };
    case '/api/backgrounds':
      return { backgrounds: await Store.backgrounds() };
    case '/api/background':
      if (opts.method === 'DELETE') { await Store.delBackground(q.get('name')); return { ok: true }; }
      if (!(body instanceof File || body instanceof Blob)) return { error: 'Pick an image file.' };
      if (body.size > 40 * 1024 * 1024) return { error: 'Image is over 40 MB. Use a smaller file.' };
      return Store.addBackground(body);
    default:
      throw new Error(`No route ${route}`);
  }
}

async function getFrequent(force = false) {
  if (freqCache && !force) return freqCache;
  try {
    freqCache = await topSites({ limit: 24 });
  } catch {
    freqCache = [];      // history permission refused, or a brand new profile
  }
  return freqCache;
}
