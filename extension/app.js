/* Homelinks. Keyboard first: type to narrow, Enter to go.

   Runs entirely inside the extension. Links and settings live in
   chrome.storage, background images in IndexedDB, and the Frequent row comes
   from chrome.history. Because an extension is installed per profile, a work
   profile and a personal profile each get their own everything. */

import { api } from './data.js';
import { titleFor } from './history.js';
import { PROVIDERS, curate, listModels } from './curate.js';
import { push, pull, unmirror, granted, folders, parentOf, setParent } from './bookmarks.js';

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];

const GRADIENTS = {
  harbor: 'radial-gradient(80% 60% at 15% 10%,#1c4a63 0%,transparent 60%),radial-gradient(70% 70% at 85% 25%,#123a4d 0%,transparent 62%),radial-gradient(90% 80% at 50% 100%,#0d2233 0%,transparent 70%),linear-gradient(160deg,#0b1a26,#081016)',
  ember:  'radial-gradient(75% 60% at 20% 15%,#6b2b1f 0%,transparent 60%),radial-gradient(65% 65% at 82% 30%,#4a1b34 0%,transparent 62%),radial-gradient(90% 70% at 45% 100%,#2a1018 0%,transparent 70%),linear-gradient(155deg,#1d0e0c,#120a09)',
  moss:   'radial-gradient(78% 60% at 18% 12%,#245239 0%,transparent 60%),radial-gradient(66% 66% at 84% 28%,#1a4436 0%,transparent 62%),radial-gradient(88% 74% at 48% 100%,#0f2a20 0%,transparent 70%),linear-gradient(160deg,#0c1a14,#080f0c)',
  dusk:   'radial-gradient(76% 60% at 22% 12%,#3b2a6b 0%,transparent 60%),radial-gradient(64% 64% at 80% 28%,#2b2455 0%,transparent 62%),radial-gradient(88% 76% at 50% 100%,#171540 0%,transparent 70%),linear-gradient(158deg,#12102a,#0a0916)',
  slate:  'radial-gradient(80% 60% at 16% 12%,#39414d 0%,transparent 60%),radial-gradient(68% 66% at 84% 26%,#2b323c 0%,transparent 62%),radial-gradient(90% 78% at 50% 100%,#1b2027 0%,transparent 70%),linear-gradient(160deg,#161a20,#0c0f13)',
  ink:    'radial-gradient(85% 70% at 50% 0%,#1a1d24 0%,transparent 62%),linear-gradient(180deg,#0e1116,#07090c)',
};
const SOLIDS = { obsidian:'#0b0d10', graphite:'#16191e', navy:'#0d1622', bottle:'#0c1712', wine:'#180d12', bone:'#1b1a17' };

let S = { links: [], settings: {}, frequent: [], backgrounds: [] };
let editing = false;
let matches = [];
let selIdx = 0;

/* ---------------------------------------------------------------- utils */
const host = (u) => { try { return new URL(u).host.replace(/^www\./, ''); } catch { return u.replace(/^https?:\/\//, '').split('/')[0]; } };
const initial = (s) => (s.match(/[a-z0-9]/i) || ['?'])[0].toUpperCase();

function hue(str) { let h = 0; for (const c of str) h = (h * 31 + c.charCodeAt(0)) % 360; return h; }
function capStyle(key) {
  const h = hue(key);
  return `--cap-bg:hsl(${h} 42% 24%);--cap-fg:hsl(${h} 78% 72%)`;
}

/* ---------------------------------------------------------------- favicons

   Chrome already has an icon for every site you've been to, and the `favicon`
   permission serves it from inside the extension, so a tile costs no network
   request and nothing about your links leaves the machine.

   For a host Chrome has never seen it still answers 200, with a generic grey
   globe, so `onerror` never fires and a missing icon can't be caught the usual
   way. Fingerprint that globe once against a host that cannot exist, compare
   every icon to it, and let anything matching stay a letter cap -- which is the
   better mark anyway for a link you typed in by hand or synced from another
   computer. */

const ICON_PX = 32;
const iconSrc = (pageUrl) =>
  `${chrome.runtime.getURL('/_favicon/')}?pageUrl=${encodeURIComponent(pageUrl)}&size=${ICON_PX}`;

const sameBytes = (a, b) => a.length === b.length && a.every((v, i) => v === b[i]);
const fetchIcon = async (src) => {
  const blob = await (await fetch(src)).blob();
  return { blob, bytes: new Uint8Array(await blob.arrayBuffer()) };
};

const blankIcon = fetchIcon(iconSrc('https://never.invalid/')).then(r => r.bytes).catch(() => null);
const iconSeen = new Map();

// A monochrome dark mark -- GitHub's, npm's, Vercel's -- disappears against a
// dark cap, so weigh the icon's own pixels and stand the dark ones on a light
// plate instead. Alpha is the weight: most favicons are a mark on nothing, and
// counting the transparent field would call every one of them dark.
async function tooDark(blob) {
  try {
    const bmp = await createImageBitmap(blob);
    const g = new OffscreenCanvas(ICON_PX, ICON_PX).getContext('2d', { willReadFrequently: true });
    g.drawImage(bmp, 0, 0, ICON_PX, ICON_PX);
    const { data } = g.getImageData(0, 0, ICON_PX, ICON_PX);
    let lum = 0, seen = 0;
    for (let i = 0; i < data.length; i += 4) {
      const a = data[i + 3] / 255;
      if (a < 0.25) continue;
      lum += a * (0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2]) / 255;
      seen += a;
    }
    return seen > 0 && lum / seen < 0.42;
  } catch { return false; }
}

const rootOf = (u) => { try { return new URL(u).origin + '/'; } catch { return null; } };

async function probe(url) {
  const [icon, blank] = await Promise.all([fetchIcon(iconSrc(url)).catch(() => null), blankIcon]);
  if (!icon?.bytes.length || (blank && sameBytes(icon.bytes, blank))) return null;
  return { src: iconSrc(url), dark: await tooDark(icon.blob) };
}

// The busiest page this profile has actually opened on a host. Cached per host,
// so ten links into the same site cost one history search between them.
const visited = new Map();
function visitedOn(h) {
  if (!visited.has(h)) visited.set(h, (async () => {
    try {
      const hits = await chrome.history.search({ text: h, startTime: 0, maxResults: 50 });
      return hits.filter(v => v.url && host(v.url) === h)
                 .sort((a, b) => (b.visitCount || 0) - (a.visitCount || 0))[0]?.url || null;
    } catch { return null; }   // history permission refused
  })());
  return visited.get(h);
}

/* Chrome files an icon against the exact page it saw it on, and there is no way
   to ask it for a host. So ask three times, narrow to wide:

   the link's own URL -- Docs, Sheets, and Slides carry different icons on one
   origin, and that difference is worth keeping;
   the site root -- covers a deep link into a site you normally enter at the top;
   any page on the host you have actually opened -- covers the reverse, a site
   you read every day and never at its root, like Wikipedia or a Jira board. */
function iconFor(pageUrl) {
  if (!iconSeen.has(pageUrl)) iconSeen.set(pageUrl, (async () => {
    const tried = new Set();
    for (const guess of [() => pageUrl, () => rootOf(pageUrl), () => visitedOn(host(pageUrl))]) {
      const url = await guess();
      if (!url || tried.has(url)) continue;
      tried.add(url);
      const found = await probe(url);
      if (found) return found;
    }
    return null;
  })());
  return iconSeen.get(pageUrl);
}

// Swaps the letter for the site's own icon, once we know there is one. The
// bytes are already in the cache by then, so the image paints in the same frame.
async function paintIcon(el, pageUrl) {
  if (!pageUrl) return;
  const cap = $('.cap', el);
  const found = cap && await iconFor(pageUrl);
  if (!found) return;
  const img = new Image();
  img.src = found.src;
  img.alt = '';
  cap.replaceChildren(img);
  cap.classList.add('has-icon');
  cap.classList.toggle('icon-dark', found.dark);
}

let toastT;
function toast(msg) {
  const t = $('#toast');
  t.textContent = msg; t.hidden = false;
  clearTimeout(toastT); toastT = setTimeout(() => (t.hidden = true), 2200);
}


// Debounced, but still awaitable -- Organize applies links and re-renders, and
// that has to happen after the write, not alongside it.
function debounced(path, get) {
  let t, pending;
  return () => {
    clearTimeout(t);
    pending ||= { promise: null, resolve: null };
    pending.promise ||= new Promise(r => (pending.resolve = r));
    const p = pending;
    t = setTimeout(async () => {
      pending = null;
      p.resolve(await api(path, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(get()),
      }));
    }, 250);
    return p.promise;
  };
}
const saveLinks = debounced('/api/links', () => S.links);
const saveSettings = debounced('/api/settings', () => S.settings);

/* ---------------------------------------------------------------- clock */
const DATE_FMT = {
  us: { weekday: 'short', month: 'short', day: 'numeric' },
  euro: { weekday: 'short', day: 'numeric', month: 'short' },
  'numeric-us': { weekday: 'short', month: 'numeric', day: 'numeric' },
  'numeric-euro': { weekday: 'short', day: 'numeric', month: 'numeric' },
};

function tick() {
  const d = new Date();
  const h12 = S.settings.clock === '12';
  // en-GB puts the day before the month; en-US puts it after. Same option bag,
  // so the format table only has to say which fields to show.
  const locale = String(S.settings.dateFormat || 'us').endsWith('euro') ? 'en-GB' : 'en-US';
  // AM/PM gets its own element, so strip the one toLocaleTimeString appends.
  $('#hm').textContent = d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: h12 })
    .replace(/\s*[AP]M$/i, '');
  $('#sec').textContent = String(d.getSeconds()).padStart(2, '0');
  $('#mer').hidden = !h12;
  $('#mer').textContent = d.getHours() < 12 ? 'AM' : 'PM';
  $('#date').textContent = d.toLocaleDateString(locale, DATE_FMT[S.settings.dateFormat] || DATE_FMT.us);
  const h = d.getHours();
  const part = h < 5 ? 'Late night' : h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : h < 22 ? 'Good evening' : 'Late night';
  // No name set yet: "Good afternoon" reads better than greeting a stranger.
  $('#greet').textContent = S.settings.name ? `${part}, ${S.settings.name}` : part;
}

/* ---------------------------------------------------------------- render */
function render() {
  const wrap = $('#sections');
  wrap.innerHTML = '';
  S.links.forEach((sec, si) => {
    const el = document.createElement('section');
    el.className = 'section';
    el.innerHTML = `<div class="eyebrow">
        <span class="eyebrow-t" data-sec="${si}">${sec.name}</span>
        <span class="rule"></span>
      </div><div class="grid"></div>`;
    const grid = $('.grid', el);
    sec.items.forEach((it, ii) => grid.appendChild(tile(it, si, ii)));
    if (editing) {
      const add = document.createElement('button');
      add.className = 'addtile'; add.textContent = '+ link';
      add.onclick = () => { sec.items.push({ name: '', url: '' }); saveLinks(); render(); startEdit(si, sec.items.length - 1); };
      grid.appendChild(add);
    }
    wrap.appendChild(el);
  });

  const bare = !S.links.some(s => s.items.length);
  $('#empty').hidden = !bare || editing;

  if (editing) {
    const b = document.createElement('button');
    b.className = 'addtile'; b.style.width = '160px'; b.textContent = '+ section';
    b.onclick = () => { S.links.push({ name: 'New group', items: [] }); saveLinks(); render(); };
    wrap.appendChild(b);
  }
  applyFilter();
}

function tile(it, si, ii) {
  const a = document.createElement('a');
  a.className = 'tile';
  a.href = it.url || '#';
  a.dataset.si = si; a.dataset.ii = ii;
  a.dataset.name = it.name || ''; a.dataset.host = host(it.url || '');
  a.style.cssText = capStyle(host(it.url || it.name || '?'));
  a.innerHTML = `<span class="cap">${initial(it.name || host(it.url || '?'))}</span>
    <span class="tile-txt">
      <span class="tile-name">${esc(it.name || 'Untitled')}</span>
      <span class="tile-host">${esc(host(it.url || ''))}</span>
    </span>`;
  paintIcon(a, it.url);

  if (editing) {
    a.draggable = true;
    a.addEventListener('click', (e) => { e.preventDefault(); startEdit(si, ii); });
    const del = document.createElement('button');
    del.className = 'tile-del'; del.textContent = '×'; del.title = 'Remove';
    del.onclick = (e) => { e.preventDefault(); e.stopPropagation(); S.links[si].items.splice(ii, 1); saveLinks(); render(); };
    a.appendChild(del);
    a.addEventListener('dragstart', (e) => { drag = { si, ii }; a.classList.add('drag'); e.dataTransfer.effectAllowed = 'move'; });
    a.addEventListener('dragend', () => { a.classList.remove('drag'); $$('.tile.over').forEach(t => t.classList.remove('over')); });
    a.addEventListener('dragover', (e) => { e.preventDefault(); a.classList.add('over'); });
    a.addEventListener('dragleave', () => a.classList.remove('over'));
    a.addEventListener('drop', (e) => { e.preventDefault(); a.classList.remove('over'); drop(si, ii); });
  }
  return a;
}

const esc = (s) => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

/* ---------------------------------------------------------------- edit */
let drag = null;
function drop(si, ii) {
  if (!drag) return;
  // The dragged link takes the slot it was dropped on, in either direction.
  // Compensating for the splice shift here instead made a forward drag land one
  // short, and dragging onto the next tile over did nothing at all.
  const [item] = S.links[drag.si].items.splice(drag.ii, 1);
  S.links[si].items.splice(ii, 0, item);
  drag = null; saveLinks(); render();
}

const full = (v) => {
  const t = v.trim();
  return t && !/^[a-z]+:\/\//i.test(t) ? 'https://' + t : t;
};

function startEdit(si, ii) {
  const a = $(`.tile[data-si="${si}"][data-ii="${ii}"]`);
  if (!a) return;
  const it = S.links[si].items[ii];
  const txt = $('.tile-txt', a);
  // A new link starts at its URL, because that is the only part you actually
  // have to type: leaving the field fills in the name and the icon from what
  // the browser already knows about the site. An existing link still opens on
  // its name, which is what clicking a tile is nearly always for.
  const fresh = !it.url && !it.name;
  const nameFld = `<input class="editfield" data-f="name" value="${esc(it.name)}" placeholder="Name">`;
  const urlFld = `<input class="editfield host" data-f="url" value="${esc(it.url)}" placeholder="https://">`;
  txt.innerHTML = fresh ? urlFld + nameFld : nameFld + urlFld;
  const n = $('[data-f="name"]', txt), u = $('[data-f="url"]', txt);
  const first = fresh ? u : n;
  first.focus(); first.select();

  // Leaving the URL is the first moment we know the site.
  u.addEventListener('blur', async () => {
    const url = full(u.value);
    if (!url) return;
    paintIcon(a, url);
    if (!n.value.trim()) n.value = await titleFor(url);
  });

  const commit = async () => {
    it.url = full(u.value);
    it.name = n.value.trim() || (it.url ? await titleFor(it.url) : '');
    if (!it.name && !it.url) S.links[si].items.splice(ii, 1);
    saveLinks(); render();
  };
  let done = false;
  const once = (fn) => () => { if (!done) { done = true; fn(); } };
  const fin = once(commit);
  [n, u].forEach(el => {
    el.onblur = () => setTimeout(() => { if (!txt.contains(document.activeElement)) fin(); }, 0);
    el.onkeydown = (e) => {
      e.stopPropagation();
      if (e.key === 'Enter') { e.preventDefault(); fin(); }
      if (e.key === 'Escape') { e.preventDefault(); done = true; render(); }
      if (e.key === 'Tab' && el === first) {
        e.preventDefault();
        const other = el === n ? u : n;
        other.focus(); other.select();
      }
    };
  });
}

function editSectionName(si) {
  const el = $(`.eyebrow-t[data-sec="${si}"]`);
  if (!el) return;
  const inp = document.createElement('input');
  inp.className = 'editfield'; inp.value = S.links[si].name; inp.style.width = '150px';
  el.replaceWith(inp); inp.focus(); inp.select();
  const commit = () => {
    const v = inp.value.trim();
    if (!v && !S.links[si].items.length) S.links.splice(si, 1);
    else if (v) S.links[si].name = v;
    saveLinks(); render();
  };
  inp.onblur = commit;
  inp.onkeydown = (e) => { e.stopPropagation(); if (e.key === 'Enter') commit(); if (e.key === 'Escape') render(); };
}

function setEditing(on) {
  editing = on;
  document.body.dataset.edit = on ? '1' : '0';
  $('#editBtn').innerHTML = on ? '<kbd>⌘E</kbd> done' : '<kbd>⌘E</kbd> edit';
  $('#q').disabled = on;
  render();
  if (on) toast('Click a link to rename it. Drag to reorder. × removes it.');
  else $('#q').focus();
}

/* ---------------------------------------------------------------- filter */
function subseq(q, s) { let i = 0; for (const c of s) { if (c === q[i]) i++; if (i === q.length) return true; } return q.length === 0; }

function score(q, name, h) {
  name = name.toLowerCase(); h = h.toLowerCase();
  if (name.startsWith(q)) return 1000 - name.length;
  if (h.startsWith(q)) return 900 - h.length;
  let i = name.indexOf(q); if (i > 0) return 800 - i;
  i = h.indexOf(q); if (i > 0) return 700 - i;
  if (subseq(q, name)) return 600;
  if (subseq(q, h)) return 500;
  return -1;
}

function applyFilter() {
  const q = $('#q').value.trim().toLowerCase();
  const tiles = $$('.tile, .chip');
  $('#promptRow').classList.toggle('typed', q.length > 0);
  matches = [];

  if (!q) {
    tiles.forEach(t => t.classList.remove('miss', 'hit', 'sel'));
    hint('');
    return;
  }
  const scored = [];
  tiles.forEach(t => {
    const name = t.dataset.name || '';
    const h = t.dataset.host || '';
    const s = score(q, name, h);
    if (s < 0) { t.classList.add('miss'); t.classList.remove('hit', 'sel'); }
    else { t.classList.remove('miss'); t.classList.add('hit'); scored.push([s, t]); }
  });
  scored.sort((a, b) => b[0] - a[0]);
  matches = scored.map(x => x[1]);
  selIdx = Math.min(selIdx, Math.max(0, matches.length - 1));
  paintSel();

  if (matches.length) {
    const n = matches[selIdx].dataset.name;
    hint(`<b>↵</b> ${esc(n)}${matches.length > 1 ? ` &nbsp;·&nbsp; ${matches.length} matches` : ''}`);
  } else {
    hint(looksLikeUrl(q) ? '<b>↵</b> open URL' : '<b>↵</b> search the web');
  }
}

function paintSel() {
  $$('.tile.sel, .chip.sel').forEach(t => t.classList.remove('sel'));
  const t = matches[selIdx];
  if (t) { t.classList.add('sel'); t.scrollIntoView({ block: 'nearest' }); }
}

const hint = (html) => { $('#hint').innerHTML = html; };
const looksLikeUrl = (q) => /^[a-z]+:\/\//i.test(q) || (/^[\w.-]+\.[a-z]{2,}(\/|$)/i.test(q) && !q.includes(' '));

function go(newTab) {
  const q = $('#q').value.trim();
  let url;
  if (matches.length) url = matches[selIdx].href;
  else if (!q) return;
  else if (looksLikeUrl(q)) url = /^[a-z]+:\/\//i.test(q) ? q : 'https://' + q;
  else url = (S.settings.searchUrl || 'https://www.google.com/search?q=%s').replace('%s', encodeURIComponent(q));
  if (newTab) window.open(url, '_blank');
  else location.href = url;
}

/* ---------------------------------------------------------------- frequent */
function renderFrequent() {
  const wrap = $('#freqWrap'), row = $('#freq');
  const known = new Set(S.links.flatMap(s => s.items.map(i => host(i.url))));
  const items = (S.frequent || []).filter(f => !known.has(f.host)).slice(0, 10);
  if (!S.settings.showFrequent || !items.length) { wrap.hidden = true; return; }
  wrap.hidden = false;
  row.innerHTML = '';
  items.forEach(f => {
    const a = document.createElement('a');
    a.className = 'chip'; a.href = f.url;
    a.dataset.name = f.title || f.host; a.dataset.host = f.host;
    a.style.cssText = capStyle(f.host);
    a.innerHTML = `<span class="cap">${initial(f.host)}</span>
      <span>${esc(f.host)}</span><span class="n">${f.count}</span>`;
    paintIcon(a, f.url);
    const add = document.createElement('button');
    add.className = 'chip-add'; add.textContent = '+'; add.title = `Keep ${f.host}`;
    add.onclick = (e) => {
      e.preventDefault(); e.stopPropagation();
      (S.links[0] ||= { name: 'Links', items: [] }).items.push({ name: f.title || f.host, url: f.url });
      saveLinks(); render(); renderFrequent(); toast(`Kept ${f.host}`);
    };
    a.appendChild(add);
    row.appendChild(a);
  });
  applyFilter();
}

/* ---------------------------------------------------------------- background */
function dayIndex(n) { return n ? Math.floor(Date.now() / 864e5) % n : 0; }

function applyBackground() {
  const b = S.settings.background || {};
  const el = $('#bg');
  document.documentElement.style.setProperty('--dim', (b.dim ?? 42) / 100);
  el.style.filter = b.blur ? `blur(${b.blur}px)` : '';
  document.body.dataset.grain = b.grain ? 'on' : 'off';

  if (b.mode === 'photo') {
    const list = S.backgrounds || [];
    if (!list.length) { el.style.backgroundImage = GRADIENTS[b.gradient] || GRADIENTS.harbor; return; }
    let pick;
    if (b.rotate === 'load') pick = list[Math.floor(Math.random() * list.length)];
    else if (b.rotate === 'day') pick = list[dayIndex(list.length)];
    else pick = list.find(x => x.id === b.photoId) || list[0];
    el.style.backgroundImage = `url("${pick.src}")`;
    el.dataset.current = pick.id;
  } else if (b.mode === 'solid') {
    el.style.backgroundImage = 'none';
    el.style.backgroundColor = SOLIDS[b.solid] || SOLIDS.obsidian;
  } else {
    el.style.backgroundImage = GRADIENTS[b.gradient] || GRADIENTS.harbor;
  }
}

function renderSheet() {
  const b = S.settings.background ||= {};
  b.mode ||= 'gradient';
  $$('#bgTabs .tab').forEach(t => t.classList.toggle('on', t.dataset.mode === b.mode));
  ['gradient', 'photo', 'solid'].forEach(m =>
    $('#pane' + m[0].toUpperCase() + m.slice(1)).classList.toggle('on', b.mode === m));

  $('#gradSwatches').innerHTML = '';
  Object.entries(GRADIENTS).forEach(([k, v]) => {
    const s = document.createElement('button');
    s.className = 'sw' + (b.gradient === k && b.mode === 'gradient' ? ' on' : '');
    s.style.backgroundImage = v;
    s.innerHTML = `<span class="lbl">${k}</span>`;
    s.onclick = () => { b.mode = 'gradient'; b.gradient = k; commitBg(); };
    $('#gradSwatches').appendChild(s);
  });

  $('#solidSwatches').innerHTML = '';
  Object.entries(SOLIDS).forEach(([k, v]) => {
    const s = document.createElement('button');
    s.className = 'sw' + (b.solid === k && b.mode === 'solid' ? ' on' : '');
    s.style.background = v;
    s.innerHTML = `<span class="lbl">${k}</span>`;
    s.onclick = () => { b.mode = 'solid'; b.solid = k; commitBg(); };
    $('#solidSwatches').appendChild(s);
  });

  const ps = $('#photoSwatches');
  ps.innerHTML = '';
  (S.backgrounds || []).forEach(p => {
    const s = document.createElement('button');
    s.className = 'sw' + (b.photoId === p.id && b.mode === 'photo' ? ' on' : '');
    s.style.backgroundImage = `url("${p.src}")`;
    s.innerHTML = `<span class="lbl">${esc(p.name)}</span>`;
    s.onclick = () => { b.mode = 'photo'; b.photoId = p.id; b.rotate = 'pinned'; $('#rotate').value = 'pinned'; commitBg(); };
    if (true) {
      const d = document.createElement('button');
      d.className = 'sw-del'; d.textContent = '×'; d.title = 'Delete image';
      d.onclick = async (e) => {
        e.stopPropagation();
        await api('/api/background?name=' + encodeURIComponent(p.id), { method: 'DELETE' });
        S.backgrounds = (await api('/api/backgrounds')).backgrounds;
        if (b.photoId === p.id) b.photoId = S.backgrounds[0]?.id || '';
        commitBg();
      };
      s.appendChild(d);
    }
    ps.appendChild(s);
  });
  if (!(S.backgrounds || []).length) {
    ps.innerHTML = '<p class="note">No images yet. Add one above, or drop an image anywhere on the page.</p>';
  }
  $('#rotate').value = b.rotate || 'pinned';
  $('#dim').value = b.dim ?? 42; $('#dimV').textContent = (b.dim ?? 42) + '%';
  $('#blur').value = b.blur ?? 0; $('#blurV').textContent = (b.blur ?? 0) + 'px';
  $('#grain').checked = !!b.grain;
}

function commitBg() { applyBackground(); renderSheet(); saveSettings(); }

async function renderDisplay() {
  $('#clockFmt').value = S.settings.clock || '24';
  $('#dateFmt').value = S.settings.dateFormat || 'us';
  $('#nameFld').value = S.settings.name || '';
  $('#mirrorBm').checked = !!S.settings.mirrorBookmarks && await granted();
  await renderBmParent();
}

/* The picker lists this profile's folders and selects the one the Homelinks
   folder is actually in, which is not always the one in settings: the setting
   is a title path, because bookmark ids differ between computers, and a path
   that doesn't resolve here -- or a folder dragged elsewhere in the bookmark
   manager -- leaves the two disagreeing. Show the folder the user can go look
   at. */
async function renderBmParent() {
  const row = $('#bmParentRow');
  const on = $('#mirrorBm').checked;
  row.style.display = on ? '' : 'none';
  if (!on) return;
  const [list, here] = await Promise.all([folders(), parentOf()]);
  const sel = $('#bmParent');
  sel.innerHTML = '';
  for (const f of list) {
    const o = document.createElement('option');
    o.value = JSON.stringify(f.path);
    o.textContent = f.path.join(' / ');
    sel.appendChild(o);
  }
  const want = JSON.stringify(here || S.settings.bookmarkParent || []);
  sel.value = list.some(f => JSON.stringify(f.path) === want) ? want : (sel.options[0]?.value || '');
}

const sheetOpen = () => { curateClose(); $('#sheet').hidden = false; $('#veil').hidden = false; renderSheet(); renderDisplay(); };
const sheetClose = () => { $('#sheet').hidden = true; $('#veil').hidden = true; $('#q').focus(); };

/* ---------------------------------------------------------------- events */
/* ------------------------------------------------------------- organize

   The whole AI path lives behind the user's own key. Nothing is sent
   anywhere until they press the button, and what's sent is a list of hosts
   and page titles from this profile's history -- never the full history,
   never anything else on the page. */

let proposal = null;

function curateOpen() {
  const ai = S.settings.ai || (S.settings.ai = {});
  const sel = $('#aiProvider');
  sel.innerHTML = Object.entries(PROVIDERS)
    .map(([k, p]) => `<option value="${k}"${k === ai.provider ? ' selected' : ''}>${p.label}</option>`).join('');
  $('#aiKey').value = ai.key || '';
  $('#aiKey').placeholder = PROVIDERS[ai.provider]?.keyHint || '';
  typedModel(ai.model || '');
  $('#keyLink').href = PROVIDERS[ai.provider]?.keyUrl || '#';
  $('#autoCurate').checked = !!ai.autoCurate;
  $('#sheet').hidden = true;
  $('#curateSheet').hidden = false; $('#veil').hidden = false;
  (ai.key ? $('#runCurate') : $('#aiKey')).focus();
  loadModels();
}

/* ----------------------------------------------------------------- models

   Which models exist is the provider's answer, not ours: they add and retire
   them constantly, and an account only sees what it is entitled to. So the
   field is a text box until a key proves itself, and a list of that key's own
   models afterwards -- and it stays a text box if the account can't list them,
   because typing a model name is better than being stuck. */

let modelRun = 0;

// Back to a typed field, holding whatever the setting says.
function typedModel(v) {
  $('#aiModel').hidden = true;
  $('#aiModel').innerHTML = '';                  // last provider's models
  $('#aiModelText').hidden = false;
  $('#aiModelText').value = v || '';
  $('#aiModelText').placeholder = PROVIDERS[S.settings.ai?.provider]?.defaultModel || '';
}

const modelNote = (msg) => {
  const el = $('#modelNote');
  el.textContent = msg || '';
  el.hidden = !msg;
};

async function loadModels() {
  const ai = S.settings.ai || {};
  const run = ++modelRun;
  if (!ai.key) { typedModel(ai.model); return modelNote(''); }
  modelNote('Checking the key…');
  try {
    const list = await listModels(ai.provider, ai.key);
    if (run !== modelRun) return;                  // a newer key or provider won
    const sel = $('#aiModel');
    sel.innerHTML = list.map(m =>
      `<option value="${esc(m.id)}">${esc(m.label)}</option>`).join('');
    const want = ai.model || PROVIDERS[ai.provider].defaultModel;
    sel.value = list.some(m => m.id === want) ? want : list[0].id;
    sel.hidden = false; $('#aiModelText').hidden = true;
    ai.model = sel.value;
    saveSettings();
    modelNote(`${list.length} model${list.length > 1 ? 's' : ''} on this key`);
  } catch (e) {
    if (run !== modelRun) return;
    typedModel(ai.model);
    modelNote(String(e.message || e).slice(0, 140));
  }
}
const curateClose = () => {
  $('#curateSheet').hidden = true; $('#veil').hidden = true;
  showProposal(null); $('#q').focus();
};

function readAi() {
  const ai = S.settings.ai;
  ai.provider = $('#aiProvider').value;
  ai.key = $('#aiKey').value.trim();
  ai.model = ($('#aiModel').hidden ? $('#aiModelText').value : $('#aiModel').value).trim();
  ai.autoCurate = $('#autoCurate').checked;
  return ai;
}

function showProposal(res) {
  proposal = res;
  $('#curateResult').hidden = !res;
  $('#curateSetup').hidden = !!res;
  if (!res) return;
  $('#curatePreview').innerHTML = res.groups.map(g => `
    <div class="pv-group">
      <div class="pv-name">${esc(g.name)}</div>
      <ul>${g.items.map(i => `<li><b>${esc(i.name)}</b><span>${esc(host(i.url))}</span></li>`).join('')}</ul>
    </div>`).join('');
  const n = res.rejected.length;
  $('#curateDropped').textContent = n
    ? `${n} suggestion${n > 1 ? 's' : ''} discarded: ${res.rejected.slice(0, 3).map(([w, why]) => `${w} (${why})`).join(', ')}${n > 3 ? '…' : ''}`
    : `Built from ${res.candidates} sites in this profile's history.`;
}

async function runCurate() {
  const ai = readAi();
  if (!ai.key) { $('#aiKey').focus(); return toast('Paste an API key first'); }
  const btn = $('#runCurate');
  btn.disabled = true; btn.textContent = 'Reading history…';
  try {
    await saveSettings();
    btn.textContent = 'Asking ' + PROVIDERS[ai.provider].label + '…';
    const res = await curate({ ...ai, existing: S.links });
    if (!res.groups.length) return toast('Nothing usable came back. Try again.');
    showProposal(res);
  } catch (e) {
    toast(String(e.message || e).slice(0, 160));
  } finally {
    btn.disabled = false; btn.textContent = 'Organize my links';
  }
}

function wire() {
  $('#q').addEventListener('input', () => { selIdx = 0; applyFilter(); });
  $('#q').addEventListener('focus', () => $('#promptRow').classList.add('on'));
  $('#q').addEventListener('blur', () => $('#promptRow').classList.remove('on'));

  $('#q').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); go(e.shiftKey || e.metaKey); }
    else if (e.key === 'Escape') { $('#q').value = ''; selIdx = 0; applyFilter(); }
    else if (e.key === 'ArrowDown' || (e.key === 'Tab' && !e.shiftKey && matches.length)) {
      e.preventDefault(); selIdx = (selIdx + 1) % matches.length; paintSel(); applyHint();
    } else if (e.key === 'ArrowUp' || (e.key === 'Tab' && e.shiftKey && matches.length)) {
      e.preventDefault(); selIdx = (selIdx - 1 + matches.length) % matches.length; paintSel(); applyHint();
    }
  });
  const applyHint = () => {
    if (matches.length) hint(`<b>↵</b> ${esc(matches[selIdx].dataset.name)}${matches.length > 1 ? ` &nbsp;·&nbsp; ${matches.length} matches` : ''}`);
  };

  document.addEventListener('keydown', (e) => {
    const mod = e.metaKey || e.ctrlKey;
    if (mod && e.key.toLowerCase() === 'e') { e.preventDefault(); setEditing(!editing); return; }
    if (mod && e.key.toLowerCase() === 'b') { e.preventDefault(); $('#sheet').hidden ? sheetOpen() : sheetClose(); return; }
    if (mod && e.key.toLowerCase() === 'o') { e.preventDefault(); $('#curateSheet').hidden ? curateOpen() : curateClose(); return; }
    if (mod && e.key.toLowerCase() === 'k') { e.preventDefault(); $('#q').focus(); return; }
    if (e.key === 'Escape' && !$('#sheet').hidden) { sheetClose(); return; }
    if (e.key === 'Escape' && !$('#curateSheet').hidden) { curateClose(); return; }
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT' || mod || e.altKey) return;
    if (e.key.length === 1 && !editing) { $('#q').focus(); }
  });

  $('#editBtn').onclick = () => setEditing(!editing);
  $('#bgBtn').onclick = sheetOpen;
  $('#curateBtn').onclick = curateOpen;
  $('#emptyCurate').onclick = curateOpen;
  $('#curateClose').onclick = curateClose;
  $('#runCurate').onclick = runCurate;
  $('#discardCurate').onclick = () => showProposal(null);
  $('#applyCurate').onclick = async () => {
    // Read the counts first: closing the sheet clears the proposal.
    const groups = proposal.groups;
    const n = groups.reduce((t, g) => t + g.items.length, 0);
    S.links = groups;
    await saveLinks();
    curateClose(); render(); renderFrequent();
    toast(`${n} link${n > 1 ? 's' : ''} in ${groups.length} group${groups.length > 1 ? 's' : ''}`);
  };
  $('#aiModel').onchange = () => { readAi(); saveSettings(); };
  // Only when the field is left or Enter is pressed: a request per keystroke
  // would be a lot of rejected keys and a lot of traffic.
  $('#aiKey').onchange = () => { readAi(); saveSettings(); loadModels(); };

  $('#aiProvider').onchange = () => {
    const p = PROVIDERS[$('#aiProvider').value];
    // Set the provider before the field is redrawn: the last provider's models
    // mean nothing here, and its placeholder even less.
    S.settings.ai.provider = $('#aiProvider').value;
    S.settings.ai.model = '';
    typedModel('');
    $('#aiKey').placeholder = p.keyHint; $('#keyLink').href = p.keyUrl;
    saveSettings();
    loadModels();
  };
  $('#autoCurate').onchange = () => { readAi(); saveSettings(); };
  $('#sheetClose').onclick = sheetClose;
  $('#veil').onclick = () => { sheetClose(); curateClose(); };

  $('#sections').addEventListener('click', (e) => {
    const eb = e.target.closest('.eyebrow-t');
    if (eb && editing) editSectionName(+eb.dataset.sec);
  });

  $$('#bgTabs .tab').forEach(t => t.onclick = () => {
    S.settings.background.mode = t.dataset.mode; commitBg();
  });
  $('#rotate').onchange = () => { S.settings.background.rotate = $('#rotate').value; commitBg(); };
  $('#dim').oninput = () => { S.settings.background.dim = +$('#dim').value; $('#dimV').textContent = $('#dim').value + '%'; applyBackground(); saveSettings(); };
  $('#blur').oninput = () => { S.settings.background.blur = +$('#blur').value; $('#blurV').textContent = $('#blur').value + 'px'; applyBackground(); saveSettings(); };
  $('#grain').onchange = () => { S.settings.background.grain = $('#grain').checked; applyBackground(); saveSettings(); };

  $('#clockFmt').onchange = () => { S.settings.clock = $('#clockFmt').value; tick(); saveSettings(); };
  $('#dateFmt').onchange = () => { S.settings.dateFormat = $('#dateFmt').value; tick(); saveSettings(); };
  $('#nameFld').oninput = () => { S.settings.name = $('#nameFld').value.trim(); tick(); saveSettings(); };

  $('#mirrorBm').onchange = async (e) => {
    const on = e.target.checked;
    // Asking only when the toggle goes on keeps bookmark access out of the
    // install prompt for people who never turn this on.
    if (on && !await chrome.permissions.request({ permissions: ['bookmarks'] })) {
      e.target.checked = false;
      return toast('Bookmark access declined, so nothing changed');
    }
    S.settings.mirrorBookmarks = on;
    await saveSettings();
    if (!on) { await unmirror(); await renderBmParent(); return toast('Bookmarks removed'); }

    // On a second computer the synced folder is already the newer copy, so take
    // what it has before writing anything over it.
    const remote = await pull(S.links).catch(() => null);
    if (remote) {
      S.links = remote; render();
      await saveLinks();                       // persists, and restamps the folder
      await renderBmParent();
      const n = remote.reduce((t, g) => t + g.items.length, 0);
      return toast(`${n} links picked up from your other computer`);
    }
    const r = await push(S.links);
    await renderBmParent();
    if (!r) return toast('Nothing to bookmark yet');
    toast(`${r.links} link${r.links > 1 ? 's' : ''} bookmarked in ${r.groups} folder${r.groups > 1 ? 's' : ''}`);
  };

  // Moving keeps the folder's id, so the other computer sees a move rather than
  // every link deleted and made again.
  $('#bmParent').onchange = async (e) => {
    const path = JSON.parse(e.target.value || '[]');
    try {
      await setParent(path);
    } catch {
      await renderBmParent();
      return toast('That folder cannot be written to');
    }
    S.settings.bookmarkParent = path;
    await saveSettings();
    await push(S.links).catch(() => {});       // creates it there if it was never made
    toast('Bookmarks folder moved to ' + path.join(' / '));
  };

  $('#file').onchange = async (e) => {
    for (const f of e.target.files) {
      const j = await api('/api/background?name=' + encodeURIComponent(f.name), { method: 'POST', body: f });
      if (j.error) { toast(j.error); continue; }
      S.settings.background.mode = 'photo';
      S.settings.background.photoId = j.id;
      S.settings.background.rotate = 'pinned';
    }
    S.backgrounds = (await api('/api/backgrounds')).backgrounds;
    e.target.value = '';
    commitBg();
  };

  $('#freqRefresh').onclick = async () => {
    $('#freqRefresh').textContent = 'counting…';
    S.frequent = (await api('/api/frequent?refresh=1')).frequent;
    $('#freqRefresh').textContent = 'recount';
    renderFrequent();
  };

  // Drop an image anywhere to set it as the background.
  document.addEventListener('dragover', e => { if (e.dataTransfer?.types.includes('Files')) e.preventDefault(); });
  document.addEventListener('drop', async (e) => {
    const f = [...(e.dataTransfer?.files || [])].find(f => f.type.startsWith('image/'));
    if (!f) return;
    e.preventDefault();
    const j = await api('/api/background?name=' + encodeURIComponent(f.name), { method: 'POST', body: f });
    if (j.error) return toast(j.error);
    S.backgrounds = (await api('/api/backgrounds')).backgrounds;
    Object.assign(S.settings.background, { mode: 'photo', photoId: j.id, rotate: 'pinned' });
    commitBg(); toast(`Background set to ${f.name}`);
  });
}

/* ---------------------------------------------------------------- boot */
(async function init() {
  S = await api('/api/state');
  S.settings.background ||= {};
  applyBackground();
  tick(); setInterval(tick, 1000);
  render();
  renderFrequent();
  wire();
  $('#q').focus();
  adopt();
})();

/* Links may have changed on another computer since this tab last opened. The
   bookmarks folder syncs on its own, so a folder that no longer matches what we
   last wrote is a change to take. */
async function adopt() {
  if (!S.settings.mirrorBookmarks) return;
  const remote = await pull(S.links).catch(() => null);
  if (!remote) return;
  S.links = remote;
  await saveLinks();
  render();
  toast('Links updated from another computer');
}
