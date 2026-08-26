/* The profile every test runs against, and the pieces they all need.
 *
 * A new tab is only slow on a profile that has something in it, so the tests
 * build one: a few thousand history rows across a thousand hosts, and a real
 * favicon store filled by visiting the sites in LINKS. That takes a minute and
 * needs the network, so it is built once into test/.work/profile-template and
 * copied for each run.
 *
 * The template is shared between extension builds on purpose. An unpacked
 * extension's id is derived from its directory path, so a profile's extension
 * storage belongs to whichever directory wrote it -- which is why every test
 * seeds links and settings itself, at run time, on its own copy. What the
 * template carries is the browser's own state: History and Favicons.
 */
import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

export const HERE = path.resolve(import.meta.dirname);
export const WORK = `${HERE}/.work`;
export const EXT = path.resolve(process.env.EXT || `${HERE}/../extension`);

const HOSTS = Number(process.env.HOSTS || 1200);
const PPH = Number(process.env.PPH || 12);

export const LINKS = [
  { name: 'Every day', items: [
    'https://github.com/', 'https://news.ycombinator.com/', 'https://www.figma.com/',
    'https://linear.app/', 'https://developer.mozilla.org/', 'https://www.cloudflare.com/',
    'https://www.npmjs.com/', 'https://stackoverflow.com/',
  ] },
  { name: 'Reference', items: [
    'https://en.wikipedia.org/', 'https://arxiv.org/', 'https://caniuse.com/',
    'https://www.rust-lang.org/', 'https://go.dev/', 'https://python.org/',
  ] },
  { name: 'Reading', items: [
    'https://arstechnica.com/', 'https://www.nature.com/', 'https://www.gutenberg.org/',
    'https://text.npr.org/', 'https://lobste.rs/', 'https://www.theverge.com/',
  ] },
  { name: 'Work', items: [
    'https://grafana.com/', 'https://sentry.io/', 'https://vercel.com/',
    'https://www.docker.com/', 'https://kubernetes.io/', 'https://www.postgresql.org/',
  ] },
].map(g => ({ name: g.name, items: g.items.map(u => ({ name: new URL(u).host.replace(/^www\./, ''), url: u })) }));

export const SETTINGS = {
  name: 'Sam', clock: '24', dateFormat: 'us', showFrequent: true,
  background: { mode: 'gradient', gradient: 'harbor', dim: 42, blur: 0, grain: true, rotate: 'pinned' },
  ai: { provider: 'anthropic', key: '', model: '', autoCurate: false },
};

/* Chrome writes the schema; we only add rows. An empty-text history.search
   walks the visits table, so a url row on its own is invisible to it -- that
   caught us once, with a seeded profile the extension could not see. Times are
   Chrome's epoch: microseconds since 1601-01-01. Transition 0x30000001 is a
   typed visit that both starts and ends its redirect chain, which is what the
   query counts as a visible visit. */
function seedHistory(dbPath) {
  const EPOCH = 11644473600n * 1000000n;
  const now = BigInt(Date.now()) * 1000n + EPOCH;
  const url = [], visit = [];
  let id = 1000, vid = 100000;
  for (let h = 0; h < HOSTS; h++) {
    const host = `site${h}.example${h % 7 === 0 ? '.co.uk' : '.com'}`;
    for (let p = 0; p < PPH; p++) {
      const u = `https://${host}/${['docs', 'blog', 'app', 'r'][p % 4]}/page-${p}`;
      const visits = 1 + ((h * 7 + p * 13) % 40);
      const typed = p === 0 ? (h % 5) : 0;
      const last = now - BigInt((h * 97 + p * 31) % 170) * 86400000000n;
      id++;
      url.push(`(${id},'${u}','Page ${p} on Site ${h} | site${h}',${visits},${typed},${last},0)`);
      visit.push(`(${++vid},${id},${last},0x30000001,0)`);
    }
  }
  const chunk = (rows, stmt) => {
    const out = [];
    for (let i = 0; i < rows.length; i += 500) out.push(`${stmt} VALUES ${rows.slice(i, i + 500).join(',')};`);
    return out;
  };
  execFileSync('sqlite3', [dbPath], { input: [
    'PRAGMA journal_mode=truncate;', 'BEGIN;',
    ...chunk(url, 'INSERT INTO urls(id,url,title,visit_count,typed_count,last_visit_time,hidden)'),
    ...chunk(visit, 'INSERT INTO visits(id,url,visit_time,transition,segment_id)'),
    'COMMIT;',
  ].join('\n') });
  return url.length;
}

export const launch = (dir, { ext = EXT, width = 1280, height = 900 } = {}) =>
  chromium.launchPersistentContext(dir, {
    channel: 'chromium', headless: true, viewport: { width, height },
    args: [`--disable-extensions-except=${ext}`, `--load-extension=${ext}`],
  });

export async function homeOf(ctx) {
  let [sw] = ctx.serviceWorkers();
  if (!sw) sw = await ctx.waitForEvent('serviceworker', { timeout: 20000 });
  return `chrome-extension://${new URL(sw.url()).host}/index.html`;
}

/* Built once, then copied. Delete test/.work to rebuild it. */
export async function template() {
  const dir = `${WORK}/profile-template`;
  if (fs.existsSync(dir)) return dir;
  fs.mkdirSync(WORK, { recursive: true });
  console.log('Building the template profile (once, and it needs the network)');
  const ctx = await launch(dir);
  const tab = await ctx.newPage();
  console.log('  browsing for favicons');
  for (const u of LINKS.flatMap(g => g.items.map(i => i.url))) {
    try { await tab.goto(u, { waitUntil: 'domcontentloaded', timeout: 15000 }); await tab.waitForTimeout(700); }
    catch { console.log('    skipped', u); }
  }
  await tab.close();
  await ctx.close();
  console.log(`  seeded ${seedHistory(`${dir}/Default/History`)} history rows across ${HOSTS} hosts`);
  return dir;
}

/* A throwaway copy of the template, under a name you can find afterwards. */
export async function profile(label) {
  const src = await template();
  const dir = `${WORK}/profile-${label}`;
  fs.rmSync(dir, { recursive: true, force: true });
  fs.cpSync(src, dir, { recursive: true });
  return dir;
}

/* Links and settings belong to the extension id, which belongs to the
   extension's directory, so they go in on the copy rather than the template. */
export const seed = (page, links = LINKS, settings = SETTINGS) =>
  page.evaluate(async ([l, s]) => {
    await chrome.storage.local.set({ links: l });
    await chrome.storage.sync.set({ settings: s });
  }, [links, settings]);

/* The extension page's CSP forbids eval, so page.waitForFunction -- which
   compiles a string inside the page -- throws there. Poll from outside. */
export async function poll(page, fn, ms = 30000) {
  const until = Date.now() + ms;
  while (Date.now() < until) {
    if (await page.evaluate(fn).catch(() => false)) return true;
    await new Promise(r => setTimeout(r, 15));
  }
  return false;
}
