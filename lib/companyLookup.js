'use strict';

const https = require('https');

function httpGetJSON(targetUrl, timeoutMs = 5000) {
  return new Promise((resolve) => {
    let settled = false;
    const done = (val) => { if (!settled) { settled = true; resolve(val); } };
    let req;
    try {
      req = https.get(targetUrl, {
        headers: { 'User-Agent': 'Mozilla/5.0 (compatible; PingboxBot/1.0)' },
        timeout: timeoutMs
      }, (res) => {
        let body = '';
        res.on('data', c => { body += c; });
        res.on('end', () => {
          try { done(JSON.parse(body)); } catch { done(null); }
        });
        res.on('error', () => done(null));
      });
    } catch { return done(null); }
    req.on('timeout', () => { req.destroy(); done(null); });
    req.on('error', () => done(null));
  });
}

function bareDomain(urlOrDomain) {
  if (!urlOrDomain) return null;
  let s = String(urlOrDomain).trim().toLowerCase();
  if (!s) return null;
  s = s.replace(/^https?:\/\//i, '').replace(/^www\./i, '');
  s = s.split('/')[0].split('?')[0].split('#')[0];
  return s || null;
}

// DuckDuckGo's instant-answer content is sourced from Wikipedia, so a
// domain that's itself an encyclopedia/knowledge site is never the
// company's own site — it means we matched the *article about* the
// company, not the company.
const KNOWLEDGE_SOURCE_DOMAINS = new Set(['wikipedia.org', 'wikimedia.org', 'wiktionary.org', 'dbpedia.org']);
function isKnowledgeSource(domain) {
  return !!domain && [...KNOWLEDGE_SOURCE_DOMAINS].some(d => domain === d || domain.endsWith('.' + d));
}

// Looks up a company's website via DuckDuckGo's free instant-answer API
// (feature 5). Two real-world quirks worth noting:
//  - Appending "official website" to the query (the obvious thing to try)
//    breaks DuckDuckGo's entity matching entirely — it returns nothing.
//    Querying the bare company name works far more often.
//  - `AbstractURL` is almost always a link to the Wikipedia *article about*
//    the company, not the company's own site. `Infobox.content` sometimes
//    has an actual "Website" field, which is what we want — we prefer that
//    when present and only fall back to AbstractURL if it isn't, after
//    filtering out obvious encyclopedia domains.
// None of this is guaranteed to find anything for a small/lesser-known
// business — that's expected and fine, since the caller falls back to the
// domain of the invalid email itself when this returns null.
async function findCompanyDomain(company, fallbackEmail) {
  if (company) {
    try {
      const q = encodeURIComponent(company);
      const data = await httpGetJSON(`https://api.duckduckgo.com/?q=${q}&format=json`);

      const infoboxWebsite = data && data.Infobox && Array.isArray(data.Infobox.content)
        ? data.Infobox.content.find(item => /^website$/i.test(item.label || ''))
        : null;
      const fromInfobox = bareDomain(infoboxWebsite && infoboxWebsite.value);
      if (fromInfobox) return fromInfobox;

      const fromAbstract = bareDomain(data && data.AbstractURL);
      if (fromAbstract && !isKnowledgeSource(fromAbstract)) return fromAbstract;
    } catch { /* fall through to the email-domain fallback below */ }
  }
  if (fallbackEmail && fallbackEmail.includes('@')) {
    return bareDomain(fallbackEmail.split('@')[1]);
  }
  return null;
}

module.exports = { findCompanyDomain, bareDomain };
