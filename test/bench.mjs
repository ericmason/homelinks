/* Time a new tab, the way a loaded profile sees it.
 *
 *   node bench.mjs [label]
 *   EXT=/path/to/old-build RUNS=9 node bench.mjs baseline
 *
 * Reports when the page became usable, not when the document finished loading:
 * links on screen, favicons on those links, the Frequent row. Then measures the
 * things that used to be in front of the paint, against the same profile, so a
 * number here can be traced to the call that produced it.
 */
import fs from 'node:fs';
import path from 'node:path';
import { EXT, WORK, LINKS, SETTINGS, launch, homeOf, profile, seed, poll } from './fixture.mjs';

const LABEL = process.argv[2] || path.basename(EXT);
const RUNS = Number(process.env.RUNS || 7);

/* Installed before the page's own scripts, so it sees the first frame. */
const watch = () => {
  window.__m = {};
  const mark = (k) => { if (window.__m[k] === undefined) window.__m[k] = performance.now(); };
  try {
    new PerformanceObserver((l) => {
      for (const e of l.getEntries()) window.__m[e.name === 'first-paint' ? 'fp' : 'fcp'] ??= e.startTime;
    }).observe({ type: 'paint', buffered: true });
  } catch {}
  const look = () => {
    if (document.querySelector('#sections .tile')) mark('tiles');
    const n = document.querySelectorAll('#sections .cap.has-icon').length;
    if (n) { mark('icon1'); window.__m.iconN = n; window.__m.iconLast = performance.now(); }
    const fw = document.querySelector('#freqWrap');
    if (fw && !fw.hidden) mark('freq');
  };
  const mo = new MutationObserver(look);
  const go = () => mo.observe(document.documentElement,
    { subtree: true, childList: true, attributes: true, attributeFilter: ['class', 'hidden'] });
  if (document.documentElement) go();
  else new MutationObserver((_, o) => { if (document.documentElement) { o.disconnect(); go(); } })
    .observe(document, { childList: true });
};

const ctx = await launch(await profile(LABEL), { width: 1440, height: 900 });
const HOME = await homeOf(ctx);
const page = await ctx.newPage();
page.on('pageerror', e => console.log('  PAGEERROR', e.message));
await page.goto(HOME);
await seed(page, LINKS, SETTINGS);
await page.addInitScript(watch);

const runs = [];
for (let i = 0; i < RUNS; i++) {
  await page.goto('about:blank');
  await page.waitForTimeout(250);
  await page.goto(HOME, { waitUntil: 'commit' });
  await poll(page, () => window.__m?.tiles !== undefined);
  await poll(page, () => window.__m.freq !== undefined && window.__m.iconLast !== undefined
    && performance.now() - window.__m.iconLast > 400);
  const m = await page.evaluate(() => ({
    ...window.__m,
    favicons: performance.getEntriesByType('resource').filter(r => r.name.includes('_favicon')).length,
  }));
  runs.push(m);
  console.log(`  run ${i + 1}: tiles ${m.tiles?.toFixed(0)}  fcp ${m.fcp?.toFixed(0) ?? '-'}  freq ${m.freq?.toFixed(0) ?? '-'}  icons ${m.iconN ?? 0}@${m.iconLast?.toFixed(0) ?? '-'}  (${m.favicons} favicon reqs)`);
}

// Run 1 is cold on purpose: nothing is cached, so it pays for the count and
// every probe and fills the cache for the runs after it. That is the first tab
// after an install, and it is not what the medians below are about.
const cached = await page.evaluate(async () => {
  const r = await chrome.storage.local.get({ icons: {}, frequent: null, photos: null });
  return { icons: Object.keys(r.icons).length, hits: Object.values(r.icons).filter(v => v.u).length,
           frequent: r.frequent?.list?.length ?? null, photos: r.photos?.length ?? null };
});
console.log('  cache after the runs:', JSON.stringify(cached));

const breakdown = await page.evaluate(async () => {
  const t = [];
  let last = performance.now();
  const lap = (k) => { const n = performance.now(); t.push([k, +(n - last).toFixed(1)]); last = n; };
  await chrome.storage.local.get({ links: [] }); lap('storage.local links');
  await chrome.storage.sync.get({ settings: {} }); lap('storage.sync settings');
  await chrome.storage.local.get({ secrets: {} }); lap('storage.local secrets');
  const items = await chrome.history.search({ text: '', startTime: Date.now() - 180 * 864e5, maxResults: 20000 });
  lap(`history.search 20000 (${items.length} rows)`);
  await new Promise(r => {
    const q = indexedDB.open('homepage', 1);
    q.onupgradeneeded = () => q.result.createObjectStore('backgrounds', { keyPath: 'id' });
    q.onsuccess = r; q.onerror = r;
  });
  lap('indexedDB open');
  const t0 = performance.now();
  await fetch(`${chrome.runtime.getURL('/_favicon/')}?pageUrl=${encodeURIComponent('https://github.com/')}&size=32`).then(r => r.blob());
  t.push(['one favicon fetch', +(performance.now() - t0).toFixed(1)]);
  return t;
});

const stat = (k) => {
  const v = runs.map(r => r[k]).filter(x => typeof x === 'number').sort((a, b) => a - b);
  return v.length ? { med: v[v.length >> 1], min: v[0], max: v[v.length - 1], n: v.length } : null;
};
const fmt = (s) => s
  ? `${s.med.toFixed(0)}ms  (min ${s.min.toFixed(0)}, max ${s.max.toFixed(0)}${s.n < runs.length ? `, ${runs.length - s.n} never` : ''})`
  : 'never';
console.log(`\n== ${LABEL} ==`);
for (const [k, l] of [['fp', 'first paint'], ['fcp', 'first contentful paint'], ['tiles', 'links on screen'],
  ['icon1', 'first favicon'], ['iconLast', 'all favicons settled'], ['freq', 'Frequent row']])
  console.log(`  ${l.padEnd(24)}: ${fmt(stat(k))}`);
console.log('  breakdown:');
for (const [k, ms] of breakdown) console.log(`    ${k.padEnd(34)} ${ms}ms`);

fs.writeFileSync(`${WORK}/result-${LABEL}.json`, JSON.stringify({ ext: EXT, runs, breakdown }, null, 2));
await ctx.close();
