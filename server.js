const http = require('http');
const dns = require('dns');
const net = require('net');
const url = require('url');

const { buildSuggestions } = require('./lib/suggestions');
const { parseContentTypeBoundary, parseMultipart, parseCSV, parseExcel, detectColumnMap } = require('./lib/upload');
const { extractTextFromImage } = require('./lib/ocr');
const { parseCardText } = require('./lib/cardParser');

const PORT = 3456;
const MAX_UPLOAD_BYTES = 25 * 1024 * 1024; // 25MB guard against runaway uploads
const MAX_IMAGES_PER_SCAN = 10; // OCR is comparatively slow — cap a single request

// ─── Disposable domains ───────────────────────────────────────────
const DISPOSABLE_DOMAINS = new Set([
  'mailinator.com','guerrillamail.com','tempmail.com','10minutemail.com',
  'throwam.com','yopmail.com','trashmail.com','fakeinbox.com','sharklasers.com',
  'guerrillamailblock.com','grr.la','spam4.me','dispostable.com','maildrop.cc',
  'spamgourmet.com','tempr.email','discard.email','mailnull.com','trashmail.me',
  'throwaway.email','getairmail.com','filzmail.com','spamfree24.org',
  'mailexpire.com','trashmail.at','trashmail.io','binkmail.com','bobmail.info',
  'tempemail.biz','tempemail.com','tempemail.net','tempinbox.co.uk','tempinbox.com',
  'temporary-email.com','temporaryemail.net','temporaryinbox.com','tempthe.net',
  'trashdevil.com','trashemail.de','trashmail.net','trashmail.org','trashmailer.com',
  'trashymail.com','mt2009.com','meltmail.com','objectmail.com','pookmail.com',
  'spambox.us','spamcannon.com','spamday.com','spamex.com','spamhole.com',
  'spamspot.com','yopmail.fr','zehnminuten.de','zehnminutenmail.de',
  'wegwerf-email.de','wegwerfmail.de','wegwerfmail.net','wegwerfmail.org'
]);

const ROLE_PREFIXES = [
  'info','support','admin','help','contact','sales','no-reply','noreply',
  'webmaster','postmaster','abuse','hello','office','team','hr','feedback',
  'marketing','billing','security','legal','privacy','newsletter','career',
  'jobs','press','media','events','news','service','services','enquiry','enquiries'
];

const FREE_PROVIDERS = new Set([
  'gmail.com','yahoo.com','hotmail.com','outlook.com','icloud.com','aol.com',
  'mail.com','protonmail.com','zoho.com','live.com','msn.com','ymail.com',
  'yahoo.co.uk','yahoo.co.in','yahoo.ca','googlemail.com','me.com','mac.com'
]);

// ─── DNS MX lookup ────────────────────────────────────────────────
function checkMX(domain) {
  return new Promise((resolve) => {
    dns.resolveMx(domain, (err, addresses) => {
      if (err || !addresses || addresses.length === 0) {
        resolve({ hasMX: false, mxRecords: [] });
      } else {
        const sorted = addresses.sort((a, b) => a.priority - b.priority);
        resolve({ hasMX: true, mxRecords: sorted.map(r => r.exchange) });
      }
    });
  });
}

// ─── Domain A record ─────────────────────────────────────────────
function checkDomain(domain) {
  return new Promise((resolve) => {
    dns.resolve(domain, (err, addresses) => {
      resolve(!err && addresses && addresses.length > 0);
    });
  });
}

// ─── SMTP handshake ──────────────────────────────────────────────
// Connects to the MX server and does HELO + MAIL FROM + RCPT TO
// without sending any actual email. Many servers block this (greylisting,
// STARTTLS required, catch-all) so we return 'unknown' when inconclusive.
function smtpHandshake(mxHost, email) {
  return new Promise((resolve) => {
    const timeout = setTimeout(() => {
      socket.destroy();
      resolve({ smtpResult: 'unknown', smtpDetail: 'Connection timed out' });
    }, 8000);

    let stage = 'connect';
    let buffer = '';
    let resolved = false;

    function done(result, detail) {
      if (resolved) return;
      resolved = true;
      clearTimeout(timeout);
      try { socket.destroy(); } catch {}
      resolve({ smtpResult: result, smtpDetail: detail });
    }

    const socket = net.createConnection(25, mxHost);

    socket.on('error', (err) => {
      done('unknown', 'SMTP connection refused: ' + err.code);
    });

    socket.on('data', (data) => {
      buffer += data.toString();
      const lines = buffer.split('\r\n');
      buffer = lines.pop(); // keep incomplete line

      for (const line of lines) {
        if (!line) continue;
        const code = parseInt(line.substring(0, 3));

        if (stage === 'connect' && code === 220) {
          stage = 'helo';
          socket.write('HELO pingbox.local\r\n');
        } else if (stage === 'helo' && code === 250) {
          stage = 'mailfrom';
          socket.write('MAIL FROM:<verify@pingbox.local>\r\n');
        } else if (stage === 'mailfrom' && code === 250) {
          stage = 'rcptto';
          socket.write(`RCPT TO:<${email}>\r\n`);
        } else if (stage === 'rcptto') {
          socket.write('QUIT\r\n');
          if (code === 250 || code === 251) {
            done('valid', 'Mailbox accepted by server');
          } else if (code === 550 || code === 551 || code === 553) {
            done('invalid', 'Mailbox does not exist (SMTP ' + code + ')');
          } else if (code === 421 || code === 450 || code === 451 || code === 452) {
            done('unknown', 'Server temporarily unavailable (greylisting?)');
          } else if (code === 550) {
            done('invalid', 'Mailbox rejected');
          } else {
            done('unknown', 'Inconclusive SMTP response: ' + code);
          }
        } else if (code >= 400 && code < 600 && stage !== 'rcptto') {
          done('unknown', 'SMTP error at stage ' + stage + ': ' + code);
        }
      }
    });

    socket.on('close', () => {
      if (!resolved) done('unknown', 'Connection closed unexpectedly');
    });
  });
}

// ─── Full validation pipeline ─────────────────────────────────────
async function validateEmail(email, doSMTP = true) {
  const result = {
    email,
    status: 'valid',
    score: 100,
    checks: {},
    mxRecords: [],
    smtpResult: null,
    smtpDetail: null,
    reasons: [],
    suggestions: []
  };

  const trimmed = email.trim().toLowerCase();
  const syntaxRe = /^[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}$/;

  if (!syntaxRe.test(trimmed) || trimmed.includes('..')) {
    return { ...result, status: 'invalid', score: 0,
      checks: { syntax: false },
      reasons: [{ label: 'Invalid syntax', type: 'red' }] };
  }

  result.checks.syntax = true;
  result.reasons.push({ label: 'Syntax valid', type: 'green' });

  const [local, domain] = trimmed.split('@');

  // Disposable
  if (DISPOSABLE_DOMAINS.has(domain)) {
    result.status = 'invalid'; result.score -= 70;
    result.checks.disposable = false;
    result.reasons.push({ label: 'Disposable inbox', type: 'red' });
  } else {
    result.checks.disposable = true;
    result.reasons.push({ label: 'Not disposable', type: 'green' });
  }

  // Role-based
  const isRole = ROLE_PREFIXES.some(r => local === r || local.startsWith(r + '.') || local.startsWith(r + '+'));
  if (isRole) {
    if (result.status !== 'invalid') result.status = 'risky';
    result.score -= 20; result.checks.roleBased = true;
    result.reasons.push({ label: 'Role-based address', type: 'yellow' });
  } else {
    result.checks.roleBased = false;
    result.reasons.push({ label: 'Personal address', type: 'green' });
  }

  // Free provider
  result.checks.freeProvider = FREE_PROVIDERS.has(domain);
  if (result.checks.freeProvider) {
    result.score -= 5;
    result.reasons.push({ label: 'Free provider', type: 'yellow' });
  } else {
    result.reasons.push({ label: 'Business domain', type: 'green' });
  }

  // Domain exists
  const domainExists = await checkDomain(domain);
  result.checks.domainExists = domainExists;
  if (!domainExists) {
    result.status = 'invalid'; result.score -= 40;
    result.reasons.push({ label: 'Domain does not exist', type: 'red' });
  } else {
    result.reasons.push({ label: 'Domain exists', type: 'green' });
  }

  // MX records
  const { hasMX, mxRecords } = await checkMX(domain);
  result.checks.hasMX = hasMX;
  result.mxRecords = mxRecords;
  if (!hasMX) {
    result.status = 'invalid'; result.score -= 30;
    result.reasons.push({ label: 'No MX records', type: 'red' });
  } else {
    result.reasons.push({ label: `MX verified (${mxRecords[0]})`, type: 'green' });
  }

  // SMTP handshake (only if domain/MX checks passed)
  if (doSMTP && hasMX && domainExists && mxRecords.length > 0) {
    const { smtpResult, smtpDetail } = await smtpHandshake(mxRecords[0], trimmed);
    result.smtpResult = smtpResult;
    result.smtpDetail = smtpDetail;
    result.checks.smtp = smtpResult;

    if (smtpResult === 'valid') {
      result.score += 10;
      result.reasons.push({ label: 'Mailbox confirmed via SMTP', type: 'green' });
    } else if (smtpResult === 'invalid') {
      result.status = 'invalid'; result.score -= 50;
      result.reasons.push({ label: 'Mailbox rejected by server', type: 'red' });
    } else {
      result.reasons.push({ label: 'SMTP inconclusive (server protected)', type: 'yellow' });
    }
  }

  result.score = Math.max(0, Math.min(100, result.score));
  // Once an email is confirmed invalid (disposable, no domain, no MX, SMTP
  // rejection...) nothing should be able to walk that back to "risky" —
  // only escalate severity from here, never de-escalate it.
  if (result.status !== 'invalid') {
    if (result.score === 0) result.status = 'invalid';
    else if (result.score < 75 || result.status === 'risky') result.status = 'risky';
    else result.status = 'valid';
  }

  return result;
}

// ─── Row normalization (feature 8) ─────────────────────────────────
// Accepts either a plain string ("a@b.com") or an enriched object and
// always returns { email, firstName, lastName, company, website }.
function normalizeRow(item) {
  if (typeof item === 'string') return { email: item, firstName: '', lastName: '', company: '', website: '' };
  return {
    email: item.email || '',
    firstName: item.firstName || '',
    lastName: item.lastName || '',
    company: item.company || '',
    website: item.website || ''
  };
}

async function validateRow(row, doSMTP) {
  const result = await validateEmail(row.email, doSMTP);
  if (result.status === 'invalid') {
    try {
      result.suggestions = await buildSuggestions(result, row, validateEmail);
    } catch {
      result.suggestions = []; // a suggestion-pipeline failure must never fail validation itself
    }
  }
  return result;
}

// ─── HTTP body collection helpers ──────────────────────────────────
function collectBody(req, maxBytes = 5 * 1024 * 1024) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', chunk => {
      size += chunk.length;
      if (size > maxBytes) { req.destroy(); reject(new Error('Payload too large')); return; }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

// ─── HTTP Server ──────────────────────────────────────────────────
const server = http.createServer(async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') { res.writeHead(200); res.end(); return; }

  const parsedUrl = url.parse(req.url, true);

  // ── GET /validate — single email, optional enrichment via query params ──
  if (req.method === 'GET' && parsedUrl.pathname === '/validate') {
    res.setHeader('Content-Type', 'application/json');
    const email = parsedUrl.query.email;
    if (!email) { res.writeHead(400); res.end(JSON.stringify({ error: 'Missing email' })); return; }
    try {
      const row = {
        email,
        firstName: parsedUrl.query.firstName || '',
        lastName: parsedUrl.query.lastName || '',
        company: parsedUrl.query.company || '',
        website: parsedUrl.query.website || ''
      };
      const result = await validateRow(row, true);
      res.writeHead(200); res.end(JSON.stringify(result));
    } catch (err) {
      res.writeHead(500); res.end(JSON.stringify({ error: err.message }));
    }
    return;
  }

  // ── POST /validate-bulk — accepts legacy { emails } or enriched { rows } ──
  if (req.method === 'POST' && parsedUrl.pathname === '/validate-bulk') {
    res.setHeader('Content-Type', 'application/json');
    try {
      const body = await collectBody(req);
      const parsed = JSON.parse(body.toString('utf8'));
      const items = Array.isArray(parsed.rows) ? parsed.rows
                  : Array.isArray(parsed.emails) ? parsed.emails
                  : null;
      if (!items || !items.length) {
        res.writeHead(400); res.end(JSON.stringify({ error: 'Send { emails: [...] } or { rows: [{ email, firstName, lastName, company, website }, ...] }' }));
        return;
      }
      // 500 is the free-tier cap per run (planned: $0.25 per additional 500
      // once billing exists — not implemented here, this file has no payment
      // logic). Keep in sync with BULK_LIMIT in index.html.
      const limited = items.slice(0, 500).map(normalizeRow);
      const results = [];
      // Bulk: skip SMTP on the base check to stay fast — MX is sufficient
      // for lists. Suggestion-building (for invalid rows) still runs full
      // SMTP on the handful of candidate corrections it generates.
      for (let i = 0; i < limited.length; i += 10) {
        const batch = limited.slice(i, i + 10);
        const batchResults = await Promise.all(batch.map(row => validateRow(row, false)));
        results.push(...batchResults);
      }
      res.writeHead(200); res.end(JSON.stringify({ results }));
    } catch (err) {
      res.writeHead(err.message === 'Payload too large' ? 413 : 500);
      res.end(JSON.stringify({ error: err.message }));
    }
    return;
  }

  // ── POST /upload — CSV or Excel file, returns rows + detected column map ──
  if (req.method === 'POST' && parsedUrl.pathname === '/upload') {
    res.setHeader('Content-Type', 'application/json');
    try {
      const boundary = parseContentTypeBoundary(req.headers['content-type']);
      if (!boundary) {
        res.writeHead(400); res.end(JSON.stringify({ error: 'Expected multipart/form-data with a boundary' }));
        return;
      }
      const body = await collectBody(req, MAX_UPLOAD_BYTES);
      const parts = parseMultipart(body, boundary);
      const filePart = parts.find(p => p.filename);
      if (!filePart) {
        res.writeHead(400); res.end(JSON.stringify({ error: 'No file found in upload' }));
        return;
      }

      const isExcel = /\.xlsx?$/i.test(filePart.filename);
      let rows;
      try {
        rows = isExcel ? parseExcel(filePart.data) : parseCSV(filePart.data.toString('utf8'));
      } catch {
        res.writeHead(400); res.end(JSON.stringify({ error: 'Could not parse this file. Make sure it is a valid CSV or Excel file.' }));
        return;
      }

      if (!rows.length) {
        res.writeHead(400); res.end(JSON.stringify({ error: 'File appears empty' }));
        return;
      }

      const headers = rows[0];
      const dataRows = rows.slice(1);
      const columnMap = detectColumnMap(headers);

      res.writeHead(200);
      res.end(JSON.stringify({ filename: filePart.filename, headers, columnMap, rows: dataRows }));
    } catch (err) {
      res.writeHead(err.message === 'Payload too large' ? 413 : 500);
      res.end(JSON.stringify({ error: err.message }));
    }
    return;
  }

  // ── POST /scan-image — one or more business-card/contact images, OCR'd
  // and heuristically parsed into { firstName, lastName, email, company,
  // website } per image. Always returns one entry per uploaded image, even
  // on OCR failure (with empty fields) — a bad photo should never break
  // the rest of the batch.
  if (req.method === 'POST' && parsedUrl.pathname === '/scan-image') {
    res.setHeader('Content-Type', 'application/json');
    try {
      const boundary = parseContentTypeBoundary(req.headers['content-type']);
      if (!boundary) {
        res.writeHead(400); res.end(JSON.stringify({ error: 'Expected multipart/form-data with a boundary' }));
        return;
      }
      const body = await collectBody(req, MAX_UPLOAD_BYTES);
      const parts = parseMultipart(body, boundary);
      const imageParts = parts.filter(p => p.filename).slice(0, MAX_IMAGES_PER_SCAN);
      if (!imageParts.length) {
        res.writeHead(400); res.end(JSON.stringify({ error: 'No image files found in upload' }));
        return;
      }

      // OCR is CPU-bound and the worker is shared/serialized internally, so
      // run these one at a time rather than firing MAX_IMAGES_PER_SCAN
      // Tesseract jobs at once.
      const results = [];
      for (const part of imageParts) {
        let rawText = '';
        try { rawText = await extractTextFromImage(part.data); } catch { rawText = ''; }
        const fields = parseCardText(rawText);
        results.push({ filename: part.filename, rawText, ...fields });
      }

      res.writeHead(200);
      res.end(JSON.stringify({ results }));
    } catch (err) {
      res.writeHead(err.message === 'Payload too large' ? 413 : 500);
      res.end(JSON.stringify({ error: err.message }));
    }
    return;
  }

  if (parsedUrl.pathname === '/ping') {
    res.setHeader('Content-Type', 'application/json');
    res.writeHead(200); res.end(JSON.stringify({ status: 'ok', smtp: true, version: '2.2', features: ['suggestions', 'upload', 'enrichment', 'scan-image'] })); return;
  }

  res.setHeader('Content-Type', 'application/json');
  res.writeHead(404); res.end(JSON.stringify({ error: 'Not found' }));
});

server.listen(PORT, '127.0.0.1', () => {
  console.log('\n  ====================================');
  console.log('   📡 PINGBOX v2.2 — Server Running');
  console.log('  ====================================');
  console.log(`  ✅ Listening on http://127.0.0.1:${PORT}`);
  console.log('  ✅ MX verification: ON');
  console.log('  ✅ SMTP handshake: ON');
  console.log('  ✅ Suggestions (typo / constructed / scraped): ON');
  console.log('  ✅ Upload endpoint (CSV + Excel): ON');
  console.log('  ✅ Image scan endpoint (OCR business cards): ON');
  console.log('  ------------------------------------');
  console.log('  Open index.html in your browser.');
  console.log('  Keep this window open while using.');
  console.log('  Press Ctrl+C to stop.\n');
});
