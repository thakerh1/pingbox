'use strict';

// Best-effort extraction of contact fields from raw OCR'd text (business
// cards, screenshots, scanned sign-up sheets, etc). This is heuristic, not
// exact — there's no layout/font-size analysis here, just line-shape
// matching. The frontend shows every field as editable before validating,
// specifically because OCR + heuristics will sometimes guess wrong.

const EMAIL_RE = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/;
const URL_RE = /\b(?:https?:\/\/)?(?:www\.)?[a-zA-Z0-9-]+\.[a-zA-Z]{2,}(?:\/[^\s]*)?\b/;
const COMPANY_SUFFIX_RE = /\b(inc|llc|corp|corporation|ltd|limited|co|company|group|industries|technologies|tech|solutions|partners|associates|enterprises|robotics|systems|labs|studio|studios)\b\.?/i;
const TITLE_KEYWORDS_RE = /\b(engineer|manager|director|president|ceo|cto|cfo|coo|vp|vice president|officer|specialist|analyst|consultant|founder|co-founder|owner|lead|head of|coordinator|representative|executive|associate|assistant|intern)\b/i;
const PHONE_RE = /^[\s()+\-.\d]{7,}$/; // a line that's mostly digits/punctuation

function bareDomain(s) {
  if (!s) return null;
  return s.replace(/^https?:\/\//i, '').replace(/^www\./i, '').split('/')[0].toLowerCase();
}

function parseCardText(rawText) {
  const lines = String(rawText || '').split(/\r?\n/).map(l => l.trim()).filter(Boolean);

  // Email — first line containing a valid address.
  let email = null;
  for (const line of lines) {
    const m = line.match(EMAIL_RE);
    if (m) { email = m[0].toLowerCase(); break; }
  }
  const emailDomain = email ? email.split('@')[1] : null;

  // Website — first URL-shaped line that isn't just the email line restated.
  let website = null;
  for (const line of lines) {
    if (email && line.includes(email)) continue;
    const m = line.match(URL_RE);
    if (m) {
      const candidate = bareDomain(m[0]);
      if (candidate && (!website || candidate !== emailDomain)) { website = candidate; if (candidate !== emailDomain) break; }
    }
  }

  // Everything left over, once the email/website/phone lines are stripped,
  // is where the name and company are hiding.
  const remaining = lines.filter(line => {
    if (email && line.includes(email)) return false;
    if (website && line.toLowerCase().includes(website)) return false;
    if (PHONE_RE.test(line)) return false;
    if (URL_RE.test(line) && !COMPANY_SUFFIX_RE.test(line)) return false;
    return true;
  });

  // Name: the first remaining line that doesn't look like a company name or
  // a job title — on a card, the person's name is almost always first.
  let nameLine = null;
  for (const l of remaining) {
    if (COMPANY_SUFFIX_RE.test(l) || TITLE_KEYWORDS_RE.test(l)) continue;
    nameLine = l;
    break;
  }
  let firstName = '', lastName = '';
  if (nameLine) {
    const parts = nameLine.split(/\s+/).filter(Boolean);
    firstName = parts[0] || '';
    lastName = parts.slice(1).join(' ') || '';
  }

  // Company: prefer a line with a recognizable business-name suffix; else
  // fall back to the next leftover line that isn't the name or a title.
  let company = null;
  for (const l of remaining) {
    if (l === nameLine) continue;
    if (COMPANY_SUFFIX_RE.test(l)) { company = l; break; }
  }
  if (!company) {
    for (const l of remaining) {
      if (l === nameLine || TITLE_KEYWORDS_RE.test(l)) continue;
      company = l;
      break;
    }
  }

  return {
    firstName,
    lastName,
    email: email || '',
    company: company || '',
    website: website || ''
  };
}

module.exports = { parseCardText, bareDomain };
