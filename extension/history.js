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

/* A name for a link the user just pasted. The browser already holds a title for
   anything this profile has opened, and it beats anything the URL could give us
   -- "Confluence" rather than equisolve.atlassian.net. The exact page first,
   then the busiest page on the same host, whose title carries the site's own
   name; both are local, so nothing about the link leaves the machine. */
export async function titleFor(url) {
  const h = hostOf(url);
  if (!h) return '';
  let hits = [];
  try { hits = await chrome.history.search({ text: h, startTime: 0, maxResults: 100 }); }
  catch { /* history permission refused */ }
  const mine = hits.filter(v => v.url && v.title && hostOf(v.url) === h);
  const bare = url.replace(/\/$/, '');
  const best = mine.find(v => v.url.replace(/\/$/, '') === bare)
    || mine.sort((a, b) => (b.visitCount || 0) - (a.visitCount || 0))[0];
  return best ? trimName(cleanTitle(best.title, h)) : domainName(h);
}

/* A tile is a few words wide. Long titles are nearly always a name followed by
   a description -- "Wikipedia, the free encyclopedia" -- so keep the name.
   Short ones are left alone, where the comma is usually part of the name. */
const trimName = (t) => (t.length > 24 && t.includes(', ') ? t.split(', ')[0] : t);

/* Nothing in history, so the tidiest thing the URL itself offers: the domain,
   without the suffix and without the subdomain, which usually names a product
   nobody calls the site by. equisolve.atlassian.net -> Atlassian. */
function domainName(h) {
  const parts = h.split(':')[0].split('.').filter(Boolean);
  const back = parts.length > 2 && /^(co|com|net|org|gov|ac|edu)$/.test(parts[parts.length - 2]) ? 3 : 2;
  const label = parts[Math.max(0, parts.length - back)] || h;
  return label.charAt(0).toUpperCase() + label.slice(1);
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
