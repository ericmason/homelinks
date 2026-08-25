/* Re-curates on a schedule when the user has turned that on. Everything else
   happens in the page; this exists only because a new tab may never be open
   when the alarm is due. */

import { Store } from './store.js';
import { curate } from './curate.js';

const ALARM = 'recurate';

const DAY = 60 * 24;

async function schedule() {
  const s = await Store.settings();
  if (!(s.ai?.autoCurate && s.ai?.key)) return chrome.alarms.clear(ALARM);
  // Leave a live alarm alone. Settings are written on every slider nudge, and
  // recreating the alarm each time would push the next run out indefinitely.
  if (await chrome.alarms.get(ALARM)) return;
  chrome.alarms.create(ALARM, { periodInMinutes: DAY * 30, delayInMinutes: DAY * 7 });
}

chrome.runtime.onInstalled.addListener(schedule);
chrome.runtime.onStartup.addListener(schedule);
chrome.storage.onChanged.addListener((changes, area) => {
  // The toggle lands in sync, the key in local. Either can turn this on.
  if ((area === 'sync' && changes.settings) || (area === 'local' && changes.secrets)) schedule();
});

chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name !== ALARM) return;
  const s = await Store.settings();
  if (!s.ai?.autoCurate || !s.ai?.key) return;
  try {
    const existing = await Store.links();
    const { groups } = await curate({ ...s.ai, existing });
    await Store.putLinks(groups);
  } catch (e) {
    console.warn('[homepage] scheduled curation failed:', e.message);
  }
});
