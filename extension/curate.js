/* Turn this profile's browsing history into organized links, using the API key
   the user supplied. The key stays in chrome.storage.local on this device and
   is sent only to the provider they picked. */

import { topSites } from './history.js';

export const PROVIDERS = {
  anthropic: {
    label: 'Anthropic',
    defaultModel: 'claude-sonnet-5',
    keyHint: 'sk-ant-…',
    keyUrl: 'https://console.anthropic.com/settings/keys',
    request(key, model, prompt) {
      return ['https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-api-key': key,
          'anthropic-version': '2023-06-01',
          // Anthropic gates browser-origin calls behind this header, and names
          // bring-your-own-key as the case it is meant for.
          'anthropic-dangerous-direct-browser-access': 'true',
        },
        body: JSON.stringify({ model, max_tokens: 4096,
          messages: [{ role: 'user', content: prompt }] }),
      }];
    },
    text: (j) => (j.content || []).filter(c => c.type === 'text').map(c => c.text).join(''),
    // Newest first, which is the order the endpoint already returns.
    models: (key) => ['https://api.anthropic.com/v1/models?limit=1000', {
      headers: {
        'x-api-key': key,
        'anthropic-version': '2023-06-01',
        'anthropic-dangerous-direct-browser-access': 'true',
      },
    }],
    list: (j) => (j.data || []).map(m => ({ id: m.id, label: m.display_name || m.id })),
  },

  openai: {
    label: 'OpenAI',
    defaultModel: 'gpt-4o',
    keyHint: 'sk-…',
    keyUrl: 'https://platform.openai.com/api-keys',
    request(key, model, prompt) {
      return ['https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${key}` },
        body: JSON.stringify({ model, messages: [{ role: 'user', content: prompt }] }),
      }];
    },
    text: (j) => j.choices?.[0]?.message?.content || '',
    models: (key) => ['https://api.openai.com/v1/models', { headers: { authorization: `Bearer ${key}` } }],
    // The list is every model on the account, most of which cannot hold a
    // conversation: embeddings, speech, images, moderation. Keep the chat
    // families and drop the rest, newest first.
    list: (j) => (j.data || [])
      .filter(m => /^(gpt|o\d|chatgpt)/.test(m.id))
      .filter(m => !/embed|audio|realtime|transcribe|tts|image|moderation|search|instruct/.test(m.id))
      .sort((a, b) => (b.created || 0) - (a.created || 0))
      .map(m => ({ id: m.id, label: m.id })),
  },

  google: {
    label: 'Google',
    defaultModel: 'gemini-2.0-flash',
    keyHint: 'AIza…',
    keyUrl: 'https://aistudio.google.com/apikey',
    request(key, model, prompt) {
      return [`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(key)}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] }),
      }];
    },
    text: (j) => j.candidates?.[0]?.content?.parts?.map(p => p.text).join('') || '',
    models: (key) => [`https://generativelanguage.googleapis.com/v1beta/models?pageSize=1000&key=${encodeURIComponent(key)}`, {}],
    // Google lists embedding and image models beside the chat ones, and says
    // outright which can answer a prompt.
    list: (j) => (j.models || [])
      .filter(m => (m.supportedGenerationMethods || []).some(x => /generatecontent/i.test(x)))
      .map(m => ({ id: String(m.name).replace(/^models\//, ''), label: m.displayName || m.name })),
  },
};

const PROMPT = (candidates, target, existing) =>
`You are organizing the new-tab page for one person, using their own browsing history.

Below are the sites they visit most, ranked, each with the specific pages they land on.

Return a JSON array of groups. Nothing else: no prose, no explanation, no markdown fences.

Schema:
[{"name": "Group name", "items": [{"name": "Site name", "url": "https://..."}]}]

Rules:

1. Only use hosts that appear in the candidate list. You may add a path to link somewhere more useful than the bare domain (https://mail.google.com/mail/u/0/ rather than https://mail.google.com/), and you should when there is an obvious landing page. Never invent a host.
2. Name each link the way this person would say it out loud. "Client Area", not "Companies :: Acme Client Area". "Gmail", not "Inbox (15)". Aim for under 18 characters. The titles below are raw page titles and are often junk: treat them as a hint about what the site is, not as the name.
3. Leave out anything that is not a destination: sign-in and OAuth pages, redirects, link shorteners, search result pages, one-off lookups, IP checkers, clock sites, and any URL that looks like a session id, a ticket number, or a single record.
4. Group by what the person is doing, not by who makes the software. 3 to 5 groups, 4 to 10 links each. One-word group names where you can.
5. Order groups by how central they are to the person's day, and links within a group by how often they would be opened.
6. Include roughly ${target} links total. Prefer leaving out a marginal site over padding a group.
${existing}
Candidate sites, most visited first:

${candidates}`;

const EXISTING = (json) =>
`7. These links are already on their homepage. Keep the ones that still earn a spot, regroup them if that reads better, and do not duplicate them:

${json}
`;

function candidateBlock(sites) {
  const out = [];
  sites.forEach((s, i) => {
    out.push(`${i + 1}. ${s.host}  (${s.count} visits, ${s.typed} typed)  — ${s.title}`);
    for (const p of (s.pages || []).slice(0, 3)) {
      let path = '/';
      try { path = new URL(p.url).pathname; } catch {}
      if (path !== '/') out.push(`     ${path}  (${p.visits}) ${p.title}`);
    }
  });
  return out.join('\n');
}

export function extractJson(text) {
  const fence = text.match(/```(?:json)?\s*([\s\S]+?)```/);
  if (fence) text = fence[1];
  const a = text.indexOf('['), b = text.lastIndexOf(']');
  if (a < 0 || b < a) return null;
  try { return JSON.parse(text.slice(a, b + 1)); } catch { return null; }
}

/* Keep only well-formed links whose host was actually offered. A model that
   invents a plausible-looking URL should not get it onto the page. */
export function validate(groups, allowedHosts) {
  const clean = [], rejected = [], seen = new Set();
  if (!Array.isArray(groups)) return { clean, rejected: [['(root)', 'not a JSON array']] };
  for (const g of groups) {
    if (!g || typeof g !== 'object' || !Array.isArray(g.items)) {
      rejected.push([String(g?.name ?? g).slice(0, 50), 'not a group']); continue;
    }
    const items = [];
    for (const it of g.items) {
      const name = String(it?.name ?? '').trim();
      let url = String(it?.url ?? '').trim();
      if (!name || !url) { rejected.push([name || '(blank)', 'missing name or url']); continue; }
      if (!/^https?:\/\//i.test(url)) url = 'https://' + url.replace(/^\/+/, '');
      let host;
      try { host = new URL(url).host.replace(/^www\./, ''); } catch { rejected.push([name, 'unparseable url']); continue; }
      if (!allowedHosts.has(host)) { rejected.push([`${name} → ${host}`, 'host not offered']); continue; }
      const k = url.replace(/\/$/, '');
      if (seen.has(k)) { rejected.push([name, 'duplicate']); continue; }
      seen.add(k);
      items.push({ name: name.slice(0, 40), url });
    }
    if (items.length) clean.push({ name: String(g.name || 'Links').trim().slice(0, 24) || 'Links', items });
  }
  return { clean, rejected };
}

/* Returns { groups, rejected, candidates }. Throws with a readable message. */
/* One message for a failed call, whichever provider and whichever endpoint. */
async function fail(cfg, res) {
  const body = await res.text().catch(() => '');
  let msg = `${cfg.label} returned ${res.status}`;
  if (res.status === 401 || res.status === 403) msg = `${cfg.label} rejected the API key.`;
  else if (res.status === 429) msg = `${cfg.label} is rate limiting. Wait a moment and retry.`;
  else { try { msg = JSON.parse(body).error?.message || msg; } catch {} }
  return new Error(msg);
}

/* The models this key can actually use. There is no offline list worth
   shipping -- providers add and retire models constantly, and an account only
   sees the ones it is entitled to -- so ask, and let the answer double as the
   check on the key: it comes back, or it doesn't. */
export async function listModels(provider, key) {
  const cfg = PROVIDERS[provider];
  if (!cfg?.models) throw new Error(`Unknown provider: ${provider}`);
  if (!key) throw new Error('Add an API key first.');
  const [url, init] = cfg.models(key);
  const res = await fetch(url, init);
  if (!res.ok) throw await fail(cfg, res);
  const list = cfg.list(await res.json());
  if (!list.length) throw new Error(`${cfg.label} listed no models this key can use.`);
  return list;
}

export async function curate({ provider, key, model, target = 24, existing = [], limit = 45 }) {
  const cfg = PROVIDERS[provider];
  if (!cfg) throw new Error(`Unknown provider: ${provider}`);
  if (!key) throw new Error('Add an API key first.');

  const sites = await topSites({ limit, pagesPerHost: 3 });
  if (!sites.length) throw new Error('No browsing history in this profile yet. Use it for a few days, then try again.');

  const allowed = new Set(sites.map(s => s.host));
  for (const g of existing) for (const it of g.items || []) {
    try { allowed.add(new URL(it.url).host.replace(/^www\./, '')); } catch {}
  }

  const prompt = PROMPT(candidateBlock(sites), target,
    existing.length ? EXISTING(JSON.stringify(existing)) : '');

  const [url, init] = cfg.request(key, model || cfg.defaultModel, prompt);
  const res = await fetch(url, init);
  if (!res.ok) throw await fail(cfg, res);
  const text = cfg.text(await res.json());
  const parsed = extractJson(text);
  if (!parsed) throw new Error(`${cfg.label} did not return JSON.`);

  const { clean, rejected } = validate(parsed, allowed);
  if (!clean.length) throw new Error('Nothing in the response was usable. Try a stronger model.');
  return { groups: clean, rejected, candidates: sites.length };
}
