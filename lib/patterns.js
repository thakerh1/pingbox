'use strict';

const PATTERNS = ['firstname', 'lastname', 'firstname.lastname', 'f.lastname', 'firstnamelastname', 'flastname'];

// Structural classification of a local-part string against each pattern.
// Shape alone can't prove which name produced an email (we don't have a
// directory of real names to cross-check against), so a given local part
// may be *consistent with* more than one pattern — detectNamingPattern
// resolves the ambiguity by majority vote across all discovered emails.
function classifyLocalPart(local) {
  const matches = [];
  if (/^[a-z]+\.[a-z]+$/i.test(local)) matches.push('firstname.lastname');
  if (/^[a-z]\.[a-z]+$/i.test(local)) matches.push('f.lastname');

  if (!local.includes('.') && !local.includes('+')) {
    if (/^[a-z][a-z]{4,}$/i.test(local)) matches.push('flastname');
    if (/^[a-z]{8,}$/i.test(local)) matches.push('firstnamelastname');
    if (/^[a-z]{2,}$/i.test(local)) matches.push('firstname', 'lastname');
  }
  return matches;
}

// Tie-break order, most to least specific. "firstname"/"lastname" match
// almost any short alphabetic local part, so on a tie they should lose to
// a more structurally distinctive pattern (e.g. "jsmith" is consistent
// with firstname, lastname, AND flastname — but flastname is the only
// one of those that's actually saying something specific about the shape).
const TIE_BREAK_ORDER = ['firstname.lastname', 'f.lastname', 'flastname', 'firstnamelastname', 'firstname', 'lastname'];

// Scores every pattern across a list of discovered emails and returns the
// winner plus its score. sampleSize lets the caller decide whether to
// trust a low-confidence result (e.g. only 1 email found).
function detectNamingPattern(emails) {
  const scores = Object.fromEntries(PATTERNS.map(p => [p, 0]));
  for (const email of emails) {
    const local = String(email).split('@')[0].toLowerCase();
    classifyLocalPart(local).forEach(p => { scores[p] += 1; });
  }
  let winner = null, winnerScore = 0;
  for (const p of TIE_BREAK_ORDER) {
    if (scores[p] > winnerScore) { winner = p; winnerScore = scores[p]; }
  }
  return { pattern: winner, score: winnerScore, scores, sampleSize: emails.length };
}

function cleanNamePart(s) {
  return String(s || '').toLowerCase().replace(/[^a-z]/g, '');
}

// Builds the candidate local part for a given pattern + first/last name.
function buildLocalPart(pattern, firstName, lastName) {
  const f = cleanNamePart(firstName);
  const l = cleanNamePart(lastName);
  switch (pattern) {
    case 'firstname': return f || null;
    case 'lastname': return l || null;
    case 'firstname.lastname': return (f && l) ? `${f}.${l}` : null;
    case 'f.lastname': return (f && l) ? `${f[0]}.${l}` : null;
    case 'firstnamelastname': return (f && l) ? `${f}${l}` : null;
    case 'flastname': return (f && l) ? `${f[0]}${l}` : null;
    default: return null;
  }
}

module.exports = { PATTERNS, classifyLocalPart, detectNamingPattern, buildLocalPart, cleanNamePart };
