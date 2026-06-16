'use strict';

const { suggestTypoCorrection } = require('./typo');
const { detectNamingPattern, buildLocalPart } = require('./patterns');
const { scrapeDomain } = require('./scraper');
const { findCompanyDomain, bareDomain } = require('./companyLookup');

const MAX_SUGGESTIONS = 3;
const DEFAULT_PATTERN = 'firstname.lastname'; // most common convention when we have no scraped signal

function confidenceFromValidation(validationResult) {
  if (!validationResult) return 'low';
  if (validationResult.status === 'valid') return 'high';
  if (validationResult.status === 'risky') return 'medium';
  return 'low';
}

// Builds up to MAX_SUGGESTIONS candidates for an invalid email, in
// priority order: typo-corrected, then constructed (name + pattern),
// then scraped public emails found on the company site. Every step is
// individually try/catch-guarded so one failing source (a dead site, a
// DuckDuckGo timeout) never breaks the others or the request as a whole.
//
// `validateEmailFn` is injected (server.js's validateEmail) to avoid a
// circular require between this module and server.js.
async function buildSuggestions(result, row, validateEmailFn) {
  const suggestions = [];
  const email = String((row && row.email) || result.email || '').trim();
  if (!email.includes('@')) return suggestions;

  // ── 1. Typo correction (domain + local part) ──────────────────────
  try {
    const corrected = suggestTypoCorrection(email);
    if (corrected) {
      const revalidated = await validateEmailFn(corrected, true);
      suggestions.push({ email: corrected, confidence: confidenceFromValidation(revalidated), source: 'typo' });
    }
  } catch { /* skip gracefully */ }

  // ── Resolve a target domain for construction + scraping (feature 5) ──
  let domain = null;
  try {
    if (row && row.website) domain = bareDomain(row.website);
    if (!domain && row && row.company) domain = await findCompanyDomain(row.company, email);
    if (!domain) domain = bareDomain(email.split('@')[1] || '');
  } catch {
    domain = bareDomain(email.split('@')[1] || '');
  }

  let scrapedEmails = [];
  if (domain) {
    try { scrapedEmails = await scrapeDomain(domain); } catch { scrapedEmails = []; }
  }

  // ── 2/3/4. Constructed personal email from name + detected pattern ──
  if (domain && row && row.firstName && row.lastName) {
    try {
      const { pattern } = detectNamingPattern(scrapedEmails);
      const chosenPattern = pattern || DEFAULT_PATTERN;
      const localPart = buildLocalPart(chosenPattern, row.firstName, row.lastName);
      if (localPart) {
        const candidate = `${localPart}@${domain}`.toLowerCase();
        if (candidate !== email.toLowerCase() && !suggestions.some(s => s.email.toLowerCase() === candidate)) {
          const revalidated = await validateEmailFn(candidate, true);
          suggestions.push({ email: candidate, confidence: confidenceFromValidation(revalidated), source: 'constructed' });
        }
      }
    } catch { /* skip gracefully */ }
  }

  // ── 9. Scraped public emails as a last-resort backup ──────────────
  for (const found of scrapedEmails) {
    if (suggestions.length >= MAX_SUGGESTIONS) break;
    const f = found.toLowerCase();
    if (f === email.toLowerCase()) continue;
    if (suggestions.some(s => s.email.toLowerCase() === f)) continue;
    suggestions.push({ email: f, confidence: 'medium', source: 'scraped' });
  }

  return suggestions.slice(0, MAX_SUGGESTIONS);
}

module.exports = { buildSuggestions, confidenceFromValidation, MAX_SUGGESTIONS };
