'use strict';

// LUMS Pad Machines: small shared server using only Node.js built-ins.
// Configure IN_CHARGE_PASSWORD before starting. State is persisted in data.json.
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROOT = __dirname;
const HTML_FILE = path.join(ROOT, 'LUMS_Pad_Machines_fixed.html');
const DATA_FILE = path.join(ROOT, 'data.json');
const PORT = Number(process.env.PORT || 8080);
const HOST = process.env.HOST || '0.0.0.0';
const PASSWORD = process.env.IN_CHARGE_PASSWORD;
if (!PASSWORD || PASSWORD.length < 10) {
  console.error('Set IN_CHARGE_PASSWORD to a password of at least 10 characters before starting the server.');
  console.error('Windows PowerShell: $env:IN_CHARGE_PASSWORD="use-a-long-unique-password"; node server.js');
  console.error('macOS/Linux: IN_CHARGE_PASSWORD="use-a-long-unique-password" node server.js');
  process.exit(1);
}

let db = { status: {}, reports: [] };
try {
  if (fs.existsSync(DATA_FILE)) {
    const saved = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
    db.status = saved.status && typeof saved.status === 'object' ? saved.status : {};
    db.reports = Array.isArray(saved.reports) ? saved.reports : [];
  }
} catch (e) {
  console.error('Could not read data.json. Fix or back up that file before restarting.', e.message);
  process.exit(1);
}
const sessions = new Map();
const loginAttempts = new Map();
function save() {
  const temp = DATA_FILE + '.tmp';
  fs.writeFileSync(temp, JSON.stringify(db, null, 2), { mode: 0o600 });
  fs.renameSync(temp, DATA_FILE);
}
function send(res, status, body, type = 'application/json; charset=utf-8') {
  res.writeHead(status, { 'Content-Type': type, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
  res.end(type.startsWith('application/json') ? JSON.stringify(body) : body);
}
function readBody(req) {
  return new Promise((resolve, reject) => {
    let raw = '';
    req.on('data', chunk => {
      raw += chunk;
      if (raw.length > 20000) { reject(new Error('Request too large')); req.destroy(); }
    });
    req.on('end', () => {
      try { resolve(raw ? JSON.parse(raw) : {}); }
      catch (_) { reject(new Error('Invalid JSON')); }
    });
    req.on('error', reject);
  });
}
function auth(req) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : '';
  const expiry = sessions.get(token);
  if (!expiry || expiry < Date.now()) { sessions.delete(token); return false; }
  return true;
}
function validMachine(id) {
  return typeof id === 'string' && /^[a-z0-9-]{1,40}$/.test(id);
}
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  try {
    if (req.method === 'GET' && url.pathname === '/') {
      if (!fs.existsSync(HTML_FILE)) return send(res, 500, { error: 'Website HTML file is missing.' });
      return send(res, 200, fs.readFileSync(HTML_FILE, 'utf8'), 'text/html; charset=utf-8');
    }
    if (req.method === 'GET' && url.pathname === '/api/state') {
      return send(res, 200, { status: db.status, reports: db.reports });
    }
    if (req.method === 'POST' && url.pathname === '/api/login') {
      const ip = req.socket.remoteAddress || 'unknown';
      const attempts = loginAttempts.get(ip) || { count: 0, until: 0 };
      if (attempts.until > Date.now()) return send(res, 429, { error: 'Too many attempts. Wait a few minutes and try again.' });
      const body = await readBody(req);
      const provided = String(body.password || '');
      const a = Buffer.from(provided); const b = Buffer.from(PASSWORD);
      const match = a.length === b.length && crypto.timingSafeEqual(a, b);
      if (!match) {
        attempts.count += 1;
        if (attempts.count >= 6) { attempts.until = Date.now() + 5 * 60 * 1000; attempts.count = 0; }
        loginAttempts.set(ip, attempts);
        return send(res, 401, { error: 'Incorrect in-charge password.' });
      }
      loginAttempts.delete(ip);
      const token = crypto.randomBytes(32).toString('hex');
      sessions.set(token, Date.now() + 12 * 60 * 60 * 1000);
      return send(res, 200, { token, expiresIn: 12 * 60 * 60 * 1000 });
    }
    if (req.method === 'GET' && url.pathname === '/api/session') {
      return auth(req) ? send(res, 200, { ok: true }) : send(res, 401, { error: 'In-charge session expired.' });
    }
    if (req.method === 'POST' && url.pathname === '/api/reports') {
      const body = await readBody(req);
      if (!validMachine(body.machine)) return send(res, 400, { error: 'Choose a valid machine.' });
      const reporter = String(body.reporter || '').trim().slice(0, 80);
      const issue = String(body.issue || '').trim().slice(0, 80);
      const details = String(body.details || '').trim().slice(0, 500);
      if (!issue || details.length < 5) return send(res, 400, { error: 'Choose an issue and describe it in at least 5 characters.' });
      const now = Date.now();
      let ref;
      do { ref = crypto.randomBytes(4).toString('hex').toUpperCase(); }
      while (db.reports.some(r => r.ref === ref));
      const report = { ref, reporter, machine: body.machine, issue, details, createdAt: now, status: 'open' };
      db.reports.push(report);
      db.status[body.machine] = { status: 'broken', since: now, updatedAt: now };
      save();
      return send(res, 201, { report });
    }
    if (req.method === 'POST' && url.pathname === '/api/resolve') {
      if (!auth(req)) return send(res, 401, { error: 'Sign in as in-charge to resolve complaints.' });
      const body = await readBody(req);
      const report = db.reports.find(r => r.ref === String(body.ref || ''));
      if (!report) return send(res, 404, { error: 'Complaint not found.' });
      if (report.status !== 'resolved') {
        const now = Date.now();
        report.status = 'resolved'; report.resolvedAt = now;
        report.resolvedBy = 'in-charge';
        const otherOpen = db.reports.some(r => r.machine === report.machine && r.status !== 'resolved');
        if (!otherOpen) db.status[report.machine] = { status: 'working', fixedAt: now, updatedAt: now };
        save();
      }
      return send(res, 200, { ok: true, report });
    }
    return send(res, 404, { error: 'Not found.' });
  } catch (e) {
    console.error(e);
    if (!res.headersSent) send(res, 400, { error: e.message || 'Request failed.' });
  }
});
server.listen(PORT, HOST, () => {
  console.log(`LUMS Pad Machines server running at http://localhost:${PORT}`);
  console.log('For other devices on the same Wi-Fi, open http://YOUR-LAPTOP-LAN-IP:' + PORT);
  console.log('Keep this terminal and laptop running to keep the website available.');
});
