/* A filmstrip of a new tab opening: what is on screen, frame by frame.
 *
 *   node film.mjs <label> [--photo]
 *   EXT=/path/to/old-build node film.mjs before
 *
 * Frames come from the browser's own compositor over CDP, so this is what a
 * person sees rather than what the page reports about itself. They land in
 * test/.work/frames-<label>/ named by the millisecond they were painted.
 * Pass --photo to set a background photograph first, which is the state the
 * two-pass background is about. Assemble two runs with strip.py.
 */
import fs from 'node:fs';
import { HERE, WORK, launch, homeOf, profile, seed } from './fixture.mjs';

const LABEL = process.argv[2] || 'film';
const PHOTO = process.argv.includes('--photo');
const OUT = `${WORK}/frames-${LABEL}`;

fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(OUT, { recursive: true });

const ctx = await launch(await profile(`film-${LABEL}`), { width: 1280, height: 800 });
const HOME = await homeOf(ctx);
const page = await ctx.newPage();
await page.goto(HOME);
await seed(page);

if (PHOTO) {
  await page.goto(HOME);
  await page.waitForTimeout(2500);
  await page.setInputFiles('#file', `${HERE}/fixtures/night.png`);
  await page.waitForTimeout(2500);
}

// Two warm-up loads, so whatever the build caches between tabs is cached. The
// filmstrip is about the tab you open all day, not the first one after install.
for (let i = 0; i < 2; i++) { await page.goto(HOME); await page.waitForTimeout(2500); }
await page.goto('about:blank');
await page.waitForTimeout(400);

const cdp = await ctx.newCDPSession(page);
const frames = [];
cdp.on('Page.screencastFrame', async ({ data, sessionId, metadata }) => {
  frames.push({ at: metadata.timestamp * 1000, data });
  await cdp.send('Page.screencastFrameAck', { sessionId }).catch(() => {});
});
await cdp.send('Page.startScreencast', { format: 'png', everyNthFrame: 1 });
await page.goto(HOME, { waitUntil: 'commit' });
await page.waitForTimeout(1400);
await cdp.send('Page.stopScreencast');

const base = frames.length ? frames[0].at : 0;
for (const [i, f] of frames.entries()) {
  const ms = Math.round(f.at - base);
  fs.writeFileSync(`${OUT}/${String(i).padStart(2, '0')}-${String(ms).padStart(4, '0')}ms.png`,
                   Buffer.from(f.data, 'base64'));
}
console.log(`${LABEL}: ${frames.length} frames in ${OUT}`);
console.log(frames.map(f => Math.round(f.at - base) + 'ms').join('  '));
await ctx.close();
