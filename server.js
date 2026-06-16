const http = require('http');
const dns = require('dns');
const net = require('net');
const url = require('url');

const PORT = 3456;

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
    reasons: []
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
  if (result.score === 0 || result.status === 'invalid') result.status = 'invalid';
  else if (result.score < 75 || result.status === 'risky') result.status = 'risky';
  else result.status = 'valid';

  return result;
}

// ─── HTTP Server ──────────────────────────────────────────────────
const server = http.createServer(async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Content-Type', 'application/json');
  if (req.method === 'OPTIONS') { res.writeHead(200); res.end(); return; }

  const parsedUrl = url.parse(req.url, true);

  if (req.method === 'GET' && parsedUrl.pathname === '/validate') {
    const email = parsedUrl.query.email;
    if (!email) { res.writeHead(400); res.end(JSON.stringify({ error: 'Missing email' })); return; }
    try {
      const result = await validateEmail(email, true);
      res.writeHead(200); res.end(JSON.stringify(result));
    } catch (err) {
      res.writeHead(500); res.end(JSON.stringify({ error: err.message }));
    }
    return;
  }

  if (req.method === 'POST' && parsedUrl.pathname === '/validate-bulk') {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', async () => {
      try {
        const { emails } = JSON.parse(body);
        if (!Array.isArray(emails) || !emails.length) {
          res.writeHead(400); res.end(JSON.stringify({ error: 'Send { emails: [...] }' })); return;
        }
        const limited = emails.slice(0, 1000);
        const results = [];
        // Bulk: skip SMTP to be faster, MX is sufficient for lists
        for (let i = 0; i < limited.length; i += 10) {
          const batch = limited.slice(i, i + 10);
          const batchResults = await Promise.all(batch.map(e => validateEmail(e, false)));
          results.push(...batchResults);
        }
        res.writeHead(200); res.end(JSON.stringify({ results }));
      } catch (err) {
        res.writeHead(500); res.end(JSON.stringify({ error: err.message }));
      }
    });
    return;
  }

  if (parsedUrl.pathname === '/ping') {
    res.writeHead(200); res.end(JSON.stringify({ status: 'ok', smtp: true, version: '2.0' })); return;
  }

  res.writeHead(404); res.end(JSON.stringify({ error: 'Not found' }));
});

server.listen(PORT, '127.0.0.1', () => {
  console.log('\n  ====================================');
  console.log('   📡 PINGBOX v2 — Server Running');
  console.log('  ====================================');
  console.log(`  ✅ Listening on http://127.0.0.1:${PORT}`);
  console.log('  ✅ MX verification: ON');
  console.log('  ✅ SMTP handshake: ON');
  console.log('  ------------------------------------');
  console.log('  Open index.html in your browser.');
  console.log('  Keep this window open while using.');
  console.log('  Press Ctrl+C to stop.\n');
});
