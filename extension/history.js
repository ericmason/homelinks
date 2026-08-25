/* Most-visited sites for this profile, from the browser's own history.
   chrome.history is scoped to the profile the extension is installed in, so
   nothing here needs to know which browser or profile it is running in. */

// Hosts that rank high but are never somewhere you meant to go.
const NOISE = new Set([
  'accounts.google.com', 'login.microsoftonline.com', 'okta.com', 'auth0.com',
  'chrome.google.com', 'chromewebstore.google.com', 'addons.mozilla.org',
  't.co', 'bit.ly', 'lnkd.in', 'l.facebook.com', 'out.reddit.com',
  'duckduckgo.com', 'www.bing.com', 'bing.com', 'search.brave.com', 'localhost',
]);

const hostOf = (u) => { try { return new URL(u).host.replace(/^www\./, ''); } catch { return ''; } };

export function cleanTitle(title, host) {
  let t = (title || '').trim();
  for (const sep of [' :: ', ' | ', ' — ', ' - ', ' · ']) {
    if (t.includes(sep)) {
      const parts = t.split(sep).map(s => s.trim()).filter(Boolean);
      if (parts.length) t = parts[0].length < 3 ? parts.reduce((a, b) => a.length > b.length ? a : b) : parts[0];
      break;
    }
  }
  return (t.replace(/^[-|·—\s]+|[-|·—\s]+$/g, '') || host).slice(0, 60);
}

/* Aggregate history by host. pagesPerHost > 0 also returns each host's busiest
   paths, which is what lets a model pick a sensible deep link. */
export async function topSites({ limit = 40, minVisits = 3, pagesPerHost = 0, days = 180 } = {}) {
  const items = await chrome.history.search({
    text: '',
    startTime: Date.now() - days * 864e5,
    maxResults: 20000,
  });

  const agg = new Map();
  for (const it of items) {
    if (!it.url || !/^https?:/.test(it.url)) continue;
    const h = hostOf(it.url);
    if (!h || NOISE.has(h) || NOISE.has(h.split(':')[0])) continue;
    const vc = it.visitCount || 0;
    if (vc < minVisits) continue;

    let a = agg.get(h);
    if (!a) agg.set(h, a = { host: h, count: 0, typed: 0, url: `https://${h}/`, title: h, _top: 0, _pages: [] });
    a.count += vc;
    a.typed += it.typedCount || 0;
    a._pages.push({ url: it.url, visits: vc, title: cleanTitle(it.title, h) });
    if (vc > a._top) { a._top = vc; a.title = cleanTitle(it.title, h); }
  }

  const out = [...agg.values()]
    // Typing a URL is a stronger signal of intent than clicking through to it.
    .sort((a, b) => (b.count + b.typed * 3) - (a.count + a.typed * 3))
    .slice(0, limit);

  for (const a of out) {
    const pages = a._pages.sort((x, y) => y.visits - x.visits);
    delete a._top;
    if (pagesPerHost) {
      const seen = new Set(), keep = [];
      for (const p of pages) {
        let path;
        try { path = new URL(p.url).pathname.replace(/\/$/, ''); } catch { continue; }
        if (seen.has(path)) continue;
        seen.add(path);
        keep.push(p);
        if (keep.length >= pagesPerHost) break;
      }
      a.pages = keep;
    }
    delete a._pages;
  }
  return out;
}
