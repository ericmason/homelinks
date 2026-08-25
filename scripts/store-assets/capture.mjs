/* Capture the Chrome Web Store screenshots by driving the built extension.
 *
 *     ./scripts/build.sh
 *     node scripts/store-assets/capture.mjs
 *     python3 scripts/store-assets/assemble.py
 *
 * Everything here is the real extension running in a real Chromium: the tiles,
 * the favicons, and the Frequent row all come out of a profile this script
 * browses first, so the shots show what the code does rather than a mockup.
 * The links are made up (public sites, no personal data) and the profile is
 * thrown away at the end.
 *
 * Two departures from a stock install, both noted in
 * docs/chrome-web-store-submission.md:
 *   - `bookmarks` is promoted from optional to required in the captured copy.
 *     Chrome asks for it on a click, which a headless run cannot answer, and
 *     the screenshot shows the state a user reaches by ticking the box.
 *   - The Organize shot answers the provider's model list from a route stub,
 *     so no API key is needed. The ids are the provider's real ones.
 */
import { chromium } from '/opt/homebrew/lib/node_modules/playwright/index.mjs';
import fs from 'node:fs';
import path from 'node:path';

const REPO = path.resolve(import.meta.dirname, '../..');
const BUILT = `${REPO}/dist/extension`;
const EXT = `${REPO}/dist/capture-extension`;
const PROFILE = `${REPO}/dist/capture-profile`;
const OUT = `${REPO}/dist/shots`;

if (!fs.existsSync(BUILT)) throw new Error('Run ./scripts/build.sh first');
for (const dir of [EXT, PROFILE, OUT]) fs.rmSync(dir, { recursive: true, force: true });
fs.cpSync(BUILT, EXT, { recursive: true });
fs.mkdirSync(OUT, { recursive: true });

const mf = JSON.parse(fs.readFileSync(`${EXT}/manifest.json`, 'utf8'));
mf.permissions.push(...(mf.optional_permissions || []));
delete mf.optional_permissions;
fs.writeFileSync(`${EXT}/manifest.json`, JSON.stringify(mf, null, 2));

/* Fictional link set. Public sites only, nothing personal, and the groups are
   the shape the extension's own curation produces. */
const LINKS = [
  { name: 'Every day', items: [
    { name: 'GitHub', url: 'https://github.com/' },
    { name: 'Hacker News', url: 'https://news.ycombinator.com/' },
    { name: 'Figma', url: 'https://www.figma.com/' },
    { name: 'Linear', url: 'https://linear.app/' },
  ] },
  { name: 'Reference', items: [
    { name: 'MDN', url: 'https://developer.mozilla.org/' },
    { name: 'Wikipedia', url: 'https://en.wikipedia.org/' },
    { name: 'arXiv', url: 'https://arxiv.org/' },
    { name: 'Can I Use', url: 'https://caniuse.com/' },
  ] },
  { name: 'Reading', items: [
    { name: 'Ars Technica', url: 'https://arstechnica.com/' },
    { name: 'Nature', url: 'https://www.nature.com/' },
    { name: 'Project Gutenberg', url: 'https://www.gutenberg.org/' },
  ] },
];

// Visited to fill the profile's history and favicon store. The last few are not
// in LINKS, so they are what the Frequent row offers to keep.
const VISIT = [
  ...LINKS.flatMap(g => g.items.map(i => i.url)),
  'https://stackoverflow.com/', 'https://www.npmjs.com/', 'https://www.rust-lang.org/',
  'https://developer.chrome.com/docs/extensions/',
];

const shot = async (page, name) => {
  await page.screenshot({ path: `${OUT}/${name}.png` });
  console.log('  shot', name);
};

const ctx = await chromium.launchPersistentContext(PROFILE, {
  channel: 'chromium',
  headless: true,
  viewport: { width: 1280, height: 800 },
  deviceScaleFactor: 2,          // downsized to 1280x800 later, for crisp text
  args: [`--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`],
});

// The model list, so the Organize sheet can be shot without an API key.
await ctx.route('https://api.anthropic.com/v1/models*', route => route.fulfill({
  status: 200, contentType: 'application/json',
  body: JSON.stringify({ data: [
    { id: 'claude-opus-5', display_name: 'Claude Opus 5' },
    { id: 'claude-sonnet-5', display_name: 'Claude Sonnet 5' },
    { id: 'claude-haiku-4-5-20251001', display_name: 'Claude Haiku 4.5' },
  ] }),
}));

let [sw] = ctx.serviceWorkers();
if (!sw) sw = await ctx.waitForEvent('serviceworker', { timeout: 20000 });
const ID = new URL(sw.url()).host;
const HOME = `chrome-extension://${ID}/index.html`;

console.log('Browsing, to fill history and favicons');
const tab = await ctx.newPage();
for (let round = 0; round < 3; round++) {
  for (const url of VISIT) {
    try {
      await tab.goto(url, { waitUntil: 'load', timeout: 25000 });
      await tab.waitForTimeout(900);        // let the favicon request land
    } catch { console.log('  skipped', url); }
  }
}
await tab.close();

const page = await ctx.newPage();
page.on('pageerror', e => console.log('PAGEERROR', e));
await page.goto(HOME);

/* Reset to the fixture and reload. Each shot starts from the same page, so an
   edit made for one does not turn up in the background of the next. */
const settle = async () => {
  await page.evaluate(async (links) => {
    await chrome.storage.local.set({ links });
    await chrome.storage.sync.set({ settings: {
      name: 'Sam', clock: '24', dateFormat: 'us', showFrequent: true,
      background: { mode: 'gradient', gradient: 'harbor', dim: 42, blur: 0, grain: true, rotate: 'pinned' },
      ai: { provider: 'anthropic', model: 'claude-opus-5', autoCurate: false },
    } });
  }, LINKS);
  await page.reload();
  await page.waitForTimeout(1500);
};

console.log('Capturing');
await settle();
await shot(page, '1-home');

// 2. Typing filters the tiles and the hint says what Enter will do.
await page.click('#q');
await page.keyboard.type('wiki', { delay: 60 });
await page.waitForTimeout(400);
await shot(page, '2-jump');
await page.keyboard.press('Escape');

// 3. Edit mode, mid-add: the URL is in, and blur has painted the favicon and
//    filled the name from this profile's history.
await settle();
await page.keyboard.press('Meta+e');
await page.waitForTimeout(300);
await page.evaluate(() => document.querySelectorAll('.addtile')[0].click());
await page.waitForTimeout(300);
await page.keyboard.type('rust-lang.org', { delay: 40 });
await page.evaluate(() => document.querySelector('[data-f="url"]').blur());
await page.waitForTimeout(700);
await shot(page, '3-add-link');

// 4. Organize: provider, key, and the model list the key can use.
await settle();
await page.keyboard.press('Meta+o');
await page.waitForTimeout(300);
await page.fill('#aiKey', 'sk-ant-' + 'x'.repeat(24));
await page.dispatchEvent('#aiKey', 'change');
await page.waitForTimeout(900);
await shot(page, '4-organize');

// 5. Appearance, with the bookmarks folder on and the folder picker showing.
await settle();
await page.keyboard.press('Meta+b');
await page.waitForTimeout(300);
await page.check('#mirrorBm');
await page.waitForTimeout(1200);
// The sheet is taller than the window. Scroll to the gap above the Clock row,
// so the cut lands on a boundary and the bookmarks block and its note are whole.
await page.evaluate(() => { const s = document.querySelector('#sheet'); s.scrollTop = s.scrollHeight; });
await page.waitForTimeout(400);
await shot(page, '5-appearance');

/* The promo tiles. Rendered here rather than drawn in Pillow so they use the
   extension's own gradient, fonts, and tile styling: the tile in the artwork is
   the same markup the page renders. */
const tile = async (name, w, h, body) => {
  const p = await ctx.newPage();
  await p.setViewportSize({ width: w, height: h });
  await p.goto(HOME);                       // for the fonts and the stylesheet
  await p.setContent(`<!doctype html><html><head>
    <link rel="stylesheet" href="${HOME.replace('index.html', 'style.css')}"></head>
    <body style="margin:0;width:${w}px;height:${h}px;overflow:hidden">${body}</body></html>`);
  await p.waitForTimeout(600);
  await p.screenshot({ path: `${OUT}/${name}.png` });
  await p.close();
  console.log('  tile', name);
};

const GRAD = 'radial-gradient(80% 60% at 15% 10%,#1c4a63 0%,transparent 60%),radial-gradient(70% 70% at 85% 25%,#123a4d 0%,transparent 62%),radial-gradient(90% 80% at 50% 100%,#0d2233 0%,transparent 70%),linear-gradient(160deg,#0b1a26,#081016)';
/* Real tiles beside the wordmark on the wide tile, drawn with the page's own
   markup and its favicon service, so the artwork is the product rather than a
   picture of it. */
// `dark` marks the icons that are near-black, which the page stands on a light
// plate so they don't disappear -- the same call app.js makes per icon.
const TILES = [
  ['GitHub', 'github.com', 'https://github.com/', true],
  ['Wikipedia', 'en.wikipedia.org', 'https://en.wikipedia.org/', false],
  ['Figma', 'figma.com', 'https://www.figma.com/', false],
  ['arXiv', 'arxiv.org', 'https://arxiv.org/', false],
];
const tileRow = () => `
  <div style="transform:scale(1.9);transform-origin:left center;width:${100 / 1.9}%">
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">
      ${TILES.map(([name, host, url, dark]) => `
        <span class="tile" style="cursor:default">
          <span class="cap has-icon${dark ? ' icon-dark' : ''}"><img src="/_favicon/?pageUrl=${encodeURIComponent(url)}&size=32" alt=""></span>
          <span class="tile-txt"><span class="tile-name">${name}</span>
          <span class="tile-host">${host}</span></span>
        </span>`).join('')}
    </div>
  </div>`;

const card = (w, h, scale, tiles = false) => `
  <div style="width:${w}px;height:${h}px;background-image:${GRAD};display:grid;
              grid-template-columns:${tiles ? '1fr 1fr' : '1fr'};align-items:center;
              gap:${40 * scale}px;padding:0 ${34 * scale}px;box-sizing:border-box;color:#e8eef4">
    <div style="display:flex;flex-direction:column;gap:${10 * scale}px">
      <div style="font-family:Martian,monospace;font-size:${11 * scale}px;letter-spacing:.24em;
                  text-transform:uppercase;color:#7f95a6">New tab</div>
      <div style="font-family:InterTight,system-ui,sans-serif;font-size:${40 * scale}px;
                  font-weight:600;letter-spacing:-.02em;line-height:1">Homelinks</div>
      <div style="font-family:PlexMono,monospace;font-size:${13 * scale}px;color:#9fb3c2;line-height:1.5">
        Your own links, grouped by AI from<br>your history. Type to jump.</div>
    </div>
    ${tiles ? tileRow() : ''}
  </div>`;

await tile('promo-440x280', 440, 280, card(440, 280, 1));
await tile('promo-1400x560', 1400, 560, card(1400, 560, 2, true));

await ctx.close();
fs.rmSync(PROFILE, { recursive: true, force: true });
console.log(`\nCaptured to ${OUT} — now run: python3 scripts/store-assets/assemble.py`);
