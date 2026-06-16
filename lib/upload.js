'use strict';

const XLSX = require('xlsx');
const { levenshtein } = require('./typo');

// ─── Multipart/form-data parsing (no multer — native Buffer slicing) ──
function parseContentTypeBoundary(contentType) {
  const match = /boundary=(?:"([^"]+)"|([^;]+))/i.exec(contentType || '');
  if (!match) return null;
  return (match[1] || match[2]).trim();
}

// Parses a raw multipart body Buffer into parts: { name, filename, contentType, data }
function parseMultipart(buffer, boundary) {
  const boundaryBuf = Buffer.from(`--${boundary}`);
  const parts = [];
  let start = buffer.indexOf(boundaryBuf);
  while (start !== -1) {
    const next = buffer.indexOf(boundaryBuf, start + boundaryBuf.length);
    if (next === -1) break;
    let chunk = buffer.slice(start + boundaryBuf.length, next);
    if (chunk.slice(0, 2).toString('latin1') === '\r\n') chunk = chunk.slice(2);
    if (chunk.slice(-2).toString('latin1') === '\r\n') chunk = chunk.slice(0, -2);

    const headerEnd = chunk.indexOf('\r\n\r\n');
    if (headerEnd !== -1) {
      const rawHeaders = chunk.slice(0, headerEnd).toString('utf8');
      const data = chunk.slice(headerEnd + 4);
      const dispMatch = /Content-Disposition:\s*form-data;\s*name="([^"]*)"(?:;\s*filename="([^"]*)")?/i.exec(rawHeaders);
      const typeMatch = /Content-Type:\s*([^\r\n]+)/i.exec(rawHeaders);
      if (dispMatch) {
        parts.push({
          name: dispMatch[1],
          filename: dispMatch[2] || null,
          contentType: typeMatch ? typeMatch[1].trim() : null,
          data
        });
      }
    }
    start = next;
  }
  return parts;
}

// ─── Native CSV parsing (handles quoted commas + escaped quotes) ──────
function parseCSV(text) {
  const lines = text.split(/\r?\n/).filter(l => l.trim().length > 0);
  return lines.map(line => {
    const cols = [];
    let cur = '';
    let inQuotes = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (ch === '"') {
        if (inQuotes && line[i + 1] === '"') { cur += '"'; i++; }
        else inQuotes = !inQuotes;
      } else if (ch === ',' && !inQuotes) {
        cols.push(cur.trim()); cur = '';
      } else {
        cur += ch;
      }
    }
    cols.push(cur.trim());
    return cols;
  });
}

// ─── Excel parsing (the one acceptable external dependency) ──────────
function parseExcel(buffer) {
  const wb = XLSX.read(buffer, { type: 'buffer' });
  const ws = wb.Sheets[wb.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json(ws, { header: 1, raw: false, defval: '' });
  return rows.map(r => r.map(c => String(c ?? '').trim())).filter(r => r.some(c => c));
}

// ─── Smart column detection (feature 7) ────────────────────────────
const FIELD_SYNONYMS = {
  email: ['email', 'emailaddress', 'email address', 'e-mail', 'mail', 'emailid'],
  firstName: ['firstname', 'first name', 'fname', 'first', 'givenname'],
  lastName: ['lastname', 'last name', 'lname', 'last', 'surname', 'familyname'],
  fullName: ['fullname', 'full name', 'name', 'contactname', 'contact name'],
  company: ['company', 'companyname', 'company name', 'organisation', 'organization', 'org', 'business', 'employer'],
  website: ['website', 'web', 'url', 'site', 'domain', 'companywebsite', 'webaddress']
};

function normalizeHeader(h) {
  return String(h || '').toLowerCase().replace(/[^a-z]/g, '');
}

// Fuzzy-matches header names to known fields regardless of casing,
// spacing, or slight variations ("Email Address" -> email, "fname" ->
// firstName, "Organisation" -> company, "Web" -> website).
function detectColumnMap(headers) {
  const map = { email: null, firstName: null, lastName: null, fullName: null, company: null, website: null };
  const usedCols = new Set();

  // Pass 1: exact normalized synonym match.
  for (const field of Object.keys(FIELD_SYNONYMS)) {
    const synonyms = new Set(FIELD_SYNONYMS[field].map(normalizeHeader));
    for (let i = 0; i < headers.length; i++) {
      if (usedCols.has(i)) continue;
      if (synonyms.has(normalizeHeader(headers[i]))) { map[field] = i; usedCols.add(i); break; }
    }
  }

  // Pass 2: fuzzy fallback (substring or close edit-distance) for anything unmapped.
  for (const field of Object.keys(FIELD_SYNONYMS)) {
    if (map[field] !== null) continue;
    const synonyms = FIELD_SYNONYMS[field].map(normalizeHeader);
    let bestIdx = -1, bestDist = Infinity;
    for (let i = 0; i < headers.length; i++) {
      if (usedCols.has(i)) continue;
      const h = normalizeHeader(headers[i]);
      if (!h) continue;
      for (const syn of synonyms) {
        if (h.includes(syn) || syn.includes(h)) { bestDist = 0; bestIdx = i; break; }
        const dist = levenshtein(h, syn);
        if (dist < bestDist && dist <= 2) { bestDist = dist; bestIdx = i; }
      }
      if (bestDist === 0) break;
    }
    if (bestIdx !== -1) { map[field] = bestIdx; usedCols.add(bestIdx); }
  }

  return map;
}

// Builds { email, firstName, lastName, company, website } objects from raw
// data rows + a column map. Splits fullName on the first space when
// firstName/lastName weren't found as their own columns.
function buildEnrichedRows(dataRows, columnMap) {
  const get = (row, idx) => (idx !== null && idx !== undefined && row[idx] !== undefined) ? String(row[idx]).trim() : '';
  return dataRows.map(row => {
    let firstName = get(row, columnMap.firstName);
    let lastName = get(row, columnMap.lastName);
    const fullName = get(row, columnMap.fullName);
    if ((!firstName || !lastName) && fullName) {
      const spaceIdx = fullName.indexOf(' ');
      if (spaceIdx === -1) {
        firstName = firstName || fullName;
      } else {
        firstName = firstName || fullName.slice(0, spaceIdx);
        lastName = lastName || fullName.slice(spaceIdx + 1);
      }
    }
    return {
      email: get(row, columnMap.email),
      firstName,
      lastName,
      company: get(row, columnMap.company),
      website: get(row, columnMap.website)
    };
  }).filter(r => r.email);
}

module.exports = {
  parseMultipart, parseContentTypeBoundary, parseCSV, parseExcel,
  detectColumnMap, buildEnrichedRows, normalizeHeader, FIELD_SYNONYMS
};
