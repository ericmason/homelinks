/* Does the extension still work?
 *
 *   node smoke.mjs                    # test/../extension
 *   EXT=/path/to/build node smoke.mjs
 *
 * Exercises what a new tab actually depends on: the cached first paint, the
 * icon cache, backgrounds now that only one image is ever read, both sheets,
 * the inline editor, and filtering. Exits non-zero on the first failure count.
 */
import fs from 'node:fs';
import { EXT, HERE, launch, homeOf, profile, seed } from './fixture.mjs';

const IMG = `${HERE}/fixtures/small.png`;

let pass = 0, fail = 0;
const ok = (cond, what, detail = '') => {
  if (cond) { pass++; console.log(`  ok   ${what}`); }
  else { fail++; console.log(`  FAIL ${what}${detail ? ' -- ' + detail : ''}`); }
};

const ctx = await launch(await profile('smoke'));
const HOME = await homeOf(ctx);
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', e => errors.push(e.message));
page.on('console', m => m.type() === 'error' && errors.push('console: ' + m.text()));

await page.goto(HOME);
await seed(page);

const reload = async (settle = 1800) => { await page.goto(HOME); await page.waitForTimeout(settle); };
const cache = () => page.evaluate(() => chrome.storage.local.get({ icons: {}, frequent: null, photos: null }));

console.log(`\n${EXT}\n\nfirst paint`);
await reload(2500);
ok(await page.locator('#sections .tile').count() === 26, 'every link is on the page');
ok(await page.locator('#freq .chip').count() > 0, 'the Frequent row filled in');
let c = await cache();
ok(Object.keys(c.icons).length > 0, 'the icon cache was written', String(Object.keys(c.icons).length));
ok(c.frequent?.list?.length > 0, 'the Frequent count was cached');

console.log('\nthe second tab draws from the cache');
await reload(700);
ok(await page.locator('#sections .cap.has-icon').count() > 5, 'favicons are on the tiles',
   String(await page.locator('#sections .cap.has-icon').count()));
ok(await page.locator('#freq .chip').count() > 0, 'the Frequent row is there');
const early = await page.evaluate(() => document.querySelectorAll('#sections .cap.has-icon').length);
ok(early > 5, 'they were there without a probe');

console.log('\nbackgrounds');
await page.setInputFiles('#file', IMG);
await page.waitForTimeout(1500);
let bg = await page.evaluate(() => document.querySelector('#bg').style.backgroundImage);
ok(/blob:/.test(bg), 'the image it just added is on screen', bg.slice(0, 60));
c = await cache();
ok(c.photos?.length === 1, 'the index has one image');
ok((c.photos?.[0].thumb || '').startsWith('data:image/jpeg;base64,'), 'with a thumbnail beside it');
ok((c.photos?.[0].thumb || '').length < 40000, 'small enough to keep in storage',
   (c.photos?.[0].thumb || '').length + ' chars');

// Which picture is on #bg, sampled from the tab's first millisecond. A check at
// a fixed delay races the full-size image, which can win inside 30ms.
await page.addInitScript(() => {
  window.__bg = [];
  const t = setInterval(() => {
    const v = document.querySelector('#bg')?.style.backgroundImage;
    if (v && v !== window.__bg.at(-1)) window.__bg.push(v);
  }, 4);
  setTimeout(() => clearInterval(t), 3000);
});
await reload(1500);
const seq = await page.evaluate(() => window.__bg.map(v => v.slice(0, 24)));
ok(!/gradient/.test(seq[0] || ''), 'a new tab opens on the picture, not a gradient', seq[0]);
ok(/data:image\/jpeg/.test(seq[0] || ''), 'the thumbnail is what it opens on', seq.join(' -> '));
ok(/blob:/.test(seq.at(-1) || ''), 'and the full-size one takes over', seq.at(-1));

console.log('\na profile that predates the index');
await page.evaluate(() => chrome.storage.local.remove('photos'));
await reload(1800);
bg = await page.evaluate(() => document.querySelector('#bg').style.backgroundImage);
ok(/blob:/.test(bg), 'the image still shows', bg.slice(0, 40));
c = await cache();
ok(c.photos?.length === 1, 'and the index was rebuilt from IndexedDB');

console.log('\nthe Appearance sheet');
await page.keyboard.press('Meta+b');
await page.waitForTimeout(500);
ok(await page.locator('#photoSwatches .sw').count() === 1, 'the image has a swatch');
ok(await page.locator('#gradSwatches .sw').count() === 6, 'the gradients are all there');
await page.locator('#photoSwatches .sw-del').first().click({ force: true });
await page.waitForTimeout(800);
c = await cache();
ok(c.photos?.length === 0, 'deleting takes it out of the index');
bg = await page.evaluate(() => document.querySelector('#bg').style.backgroundImage);
ok(bg.includes('gradient'), 'and the gradient comes back', bg.slice(0, 30));
await page.keyboard.press('Escape');

console.log('\nediting');
await reload(1200);
await page.keyboard.press('Meta+e');
await page.waitForTimeout(300);
await page.locator('.addtile').first().click();
await page.waitForTimeout(200);
await page.keyboard.type('rust-lang.org');
// Tab moves to the name field. Blurring out of the editor entirely commits the
// link and closes it, which is correct and tests something else.
await page.keyboard.press('Tab');
await page.waitForTimeout(1200);
const named = await page.evaluate(() => document.querySelector('[data-f="name"]')?.value);
ok(!!named, 'a pasted URL gets a name out of history', String(named));
ok(await page.locator('.tile[data-host="rust-lang.org"] .cap.has-icon').count() > 0,
   'and its favicon, before it is even saved');
await page.keyboard.press('Escape');
await page.keyboard.press('Meta+e');
await page.waitForTimeout(400);

console.log('\nrecount and Organize');
await page.locator('#freqRefresh').click();
await page.waitForTimeout(2500);
ok(await page.locator('#freqRefresh').textContent() === 'recount', 'the recount button comes back');
ok(await page.locator('#freq .chip').count() > 0, 'and the row is still populated');
await page.keyboard.press('Meta+o');
await page.waitForTimeout(400);
ok(await page.locator('#curateSheet').isVisible(), 'the Organize sheet opens');
ok(await page.locator('#aiProvider option').count() >= 3, 'with its providers listed');
await page.keyboard.press('Escape');

console.log('\nfiltering');
await page.keyboard.press('Meta+k');
await page.keyboard.type('wiki');
await page.waitForTimeout(300);
ok(await page.locator('.tile.hit').count() > 0, 'typing narrows the links');
ok((await page.locator('#hint').textContent()).includes('wikipedia'), 'and the hint names the match',
   await page.locator('#hint').textContent());

ok(errors.length === 0, 'no page errors', errors.join(' | '));
console.log(`\n${pass} passed, ${fail} failed`);
await ctx.close();
process.exit(fail ? 1 : 0);
