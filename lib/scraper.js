'use strict';

const https = require('https');
const http = require('http');

const SCRAPE_PATHS = ['/', '/contact', '/about', '/team'];
const SCRAPE_TIMEOUT_MS = 5000;
const CACHE_TTL_MS = 60000;
const MAX_CONCURRENT_SCRAPES = 3;
const MAX_RESPONSE_BYTES = 2_000_000; // don't read unbounded pages into memory

// ─── Per-domain cache (feature 10) ─────────────────────────────────
const cache = new Map(); // domain -> { expires, emails }

// ─── Tiny concurrency-limited queue (feature 10) ───────────────────
let activeScrapes = 0;
const queue = [];

function runNext() {
  if (activeScrapes >= MAX_CONCURRENT_SCRAPES || queue.length === 0) return;
  activeScrapes++;
  const { task, resolve } = queue.shift();
  task()
    .then(resolve)
    .catch(() => resolve([])) // a scrape task should never reject, but be safe
    .finally(() => { activeScrapes--; runNext(); });
}

function withConcurrencyLimit(task) {
  return new Promise(resolve => {
    queue.push({ task, resolve });
    runNext();
  });
}

// ─── Single page fetch — never rejects, always resolves (possibly '') ──
function fetchOnce(targetUrl, redirectsLeft = 2) {
  return new Promise(resolve => {
    let settled = false;
    const done = (val) => { if (!settled) { settled = true; resolve(val); } };

    let parsed;
    try { parsed = new URL(targetUrl); } catch { return done(''); }
    const mod = parsed.protocol === 'http:' ? http : https;

    let req;
    try {
      req = mod.get({
        hostname: parsed.hostname,
        path: parsed.pathname + (parsed.search || ''),
        port: parsed.port || undefined,
        headers: { 'User-Agent': 'Mozilla/5.0 (compatible; PingboxBot/1.0; +local-validation-tool)' },
        timeout: SCRAPE_TIMEOUT_MS
      }, (res) => {
        if ([301, 302, 303, 307, 308].includes(res.statusCode) && res.headers.location && redirectsLeft > 0) {
          res.resume();
          try {
            const next = new URL(res.headers.location, parsed).toString();
            fetchOnce(next, redirectsLeft - 1).then(done);
          } catch { done(''); }
          return;
        }
        let body = '';
        let size = 0;
        res.on('data', chunk => {
          size += chunk.length;
          if (size > MAX_RESPONSE_BYTES) { req.destroy(); return; }
          body += chunk.toString('utf8');
        });
        res.on('end', () => done(body));
        res.on('error', () => done(''));
      });
    } catch { return done(''); }

    req.on('timeout', () => { req.destroy(); done(''); });
    req.on('error', () => done(''));
  });
}

const EMAIL_RE = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;

function extractEmails(html) {
  return [...new Set((html.match(EMAIL_RE) || []).map(e => e.toLowerCase()))];
}

async function scrapeDomainUncached(domain) {
  const base = `https://${domain}`;
  const pages = await Promise.all(SCRAPE_PATHS.map(p => fetchOnce(base + p)));
  const found = new Set();
  pages.forEach(html => extractEmails(html).forEach(e => found.add(e)));
  return [...found];
}

// Public entry point: cached (60s/domain) + concurrency-limited (max 3) +
// never throws — any failure (blocked, timed out, errored) just resolves
// to an empty array so a bulk run never crashes because of one bad site.
async function scrapeDomain(domain) {
  if (!domain) return [];
  const cached = cache.get(domain);
  if (cached && cached.expires > Date.now()) return cached.emails;

  try {
    const emails = await withConcurrencyLimit(() => scrapeDomainUncached(domain));
    cache.set(domain, { expires: Date.now() + CACHE_TTL_MS, emails });
    return emails;
  } catch {
    return [];
  }
}

module.exports = { scrapeDomain, extractEmails, SCRAPE_PATHS, CACHE_TTL_MS, MAX_CONCURRENT_SCRAPES };
