'use strict';

// LUMS Pad Machines server. Complaint and machine data are stored in Supabase.
// Keep SUPABASE_SERVICE_ROLE_KEY (or a compatible Supabase secret key) private in Render.
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROOT = __dirname;
const HTML_FILE = path.join(ROOT, 'index.html');
const STATIC_FILES = {
  '/logo.jpg': { file: path.join(ROOT, 'logo.jpg'), type: 'image/jpeg' },
  '/logo.jpeg': { file: path.join(ROOT, 'logo.jpeg'), type: 'image/jpeg' },
  '/logo.png': { file: path.join(ROOT, 'logo.png'), type: 'image/png' },
  '/favicon.ico': { file: path.join(ROOT, 'favicon.ico'), type: 'image/x-icon' }
};
const PORT = Number(process.env.PORT || 8080);
const HOST = process.env.HOST || '0.0.0.0';
const PASSWORD = process.env.IN_CHARGE_PASSWORD;
const SUPABASE_URL = String(process.env.SUPABASE_URL || '').replace(/\/$/, '');
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SECRET_KEY || '';

if (!PASSWORD || PASSWORD.length < 10) {
  console.error('Set IN_CHARGE_PASSWORD to a password of at least 10 characters in Render.');
  process.exit(1);
}
if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY (or SUPABASE_SECRET_KEY) in Render Environment.');
  process.exit(1);
}

const sessions = new Map();
const loginAttempts = new Map();

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

async function supabaseRequest(table, options = {}) {
  const { method = 'GET', query = '', body, prefer } = options;
  const headers = {
    apikey: SUPABASE_KEY,
    Authorization: `Bearer ${SUPABASE_KEY}`,
    Accept: 'application/json'
  };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (prefer) headers.Prefer = prefer;
  const response = await fetch(`${SUPABASE_URL}/rest/v1/${table}${query ? `?${query}` : ''}`, {
    method, headers, body: body === undefined ? undefined : JSON.stringify(body)
  });
  const text = await response.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch (_) { data = text; }
  if (!response.ok) {
    console.error(`Supabase ${method} ${table} failed (${response.status}):`, data);
    const error = new Error(`Database request failed (${response.status}). Check the Supabase table names, columns, and Render environment variables.`);
    error.statusCode = 503;
    throw error;
  }
  return data;
}

function fromReportRow(row) {
  return {
    ref: row.ref,
    reporter: row.reporter || '',
    machine: row.machine,
    issue: row.issue,
    details: row.details,
    createdAt: Number(row.created_at),
    status: row.status,
    ...(row.resolved_at == null ? {} : { resolvedAt: Number(row.resolved_at) }),
    ...(row.resolved_by == null ? {} : { resolvedBy: row.resolved_by })
  };
}

function toReportRow(report) {
  return {
    ref: report.ref,
    reporter: report.reporter || '',
    machine: report.machine,
    issue: report.issue,
    details: report.details,
    created_at: report.createdAt,
    status: report.status,
    resolved_at: report.resolvedAt == null ? null : report.resolvedAt,
    resolved_by: report.resolvedBy || null
  };
}

function fromMachineRow(row) {
  return {
    status: row.status,
    ...(row.since == null ? {} : { since: Number(row.since) }),
    ...(row.updated_at == null ? {} : { updatedAt: Number(row.updated_at) }),
    ...(row.fixed_at == null ? {} : { fixedAt: Number(row.fixed_at) })
  };
}

async function getState() {
  const [reportRows, machineRows] = await Promise.all([
    supabaseRequest('reports', { query: 'select=*&order=created_at.desc' }),
    supabaseRequest('machine_status', { query: 'select=*' })
  ]);
  const status = {};
  for (const row of (machineRows || [])) status[row.machine] = fromMachineRow(row);
  return { status, reports: (reportRows || []).map(fromReportRow) };
}

async function upsertMachine(machine, state) {
  const row = {
    machine,
    status: state.status,
    since: state.since == null ? null : state.since,
    updated_at: state.updatedAt == null ? Date.now() : state.updatedAt,
    fixed_at: state.fixedAt == null ? null : state.fixedAt
  };
  await supabaseRequest('machine_status', {
    method: 'POST', query: 'on_conflict=machine', body: row,
    prefer: 'resolution=merge-duplicates,return=minimal'
  });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  try {
    if (req.method === 'GET' && (url.pathname === '/' || url.pathname === '/index.html')) {
      if (!fs.existsSync(HTML_FILE)) return send(res, 500, { error: 'Website HTML file is missing. Make sure index.html is in the repository root.' });
      return send(res, 200, fs.readFileSync(HTML_FILE, 'utf8'), 'text/html; charset=utf-8');
    }

    if (req.method === 'GET' && STATIC_FILES[url.pathname]) {
      const asset = STATIC_FILES[url.pathname];
      if (!fs.existsSync(asset.file)) return send(res, 404, { error: `Image file missing: ${path.basename(asset.file)}` });
      res.writeHead(200, { 'Content-Type': asset.type, 'Cache-Control': 'public, max-age=3600', 'X-Content-Type-Options': 'nosniff' });
      return fs.createReadStream(asset.file).pipe(res);
    }

    if (req.method === 'GET' && url.pathname === '/api/state') {
      const state = await getState();
      return send(res, 200, state);
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

      const state = await getState();
      const now = Date.now();
      let ref;
      do { ref = crypto.randomBytes(4).toString('hex').toUpperCase(); }
      while (state.reports.some(r => r.ref === ref));
      const report = { ref, reporter, machine: body.machine, issue, details, createdAt: now, status: 'open' };
      await supabaseRequest('reports', {
        method: 'POST', body: toReportRow(report), prefer: 'return=minimal'
      });
      await upsertMachine(body.machine, { status: 'broken', since: now, updatedAt: now });
      return send(res, 201, { report });
    }

    if (req.method === 'POST' && url.pathname === '/api/resolve') {
      if (!auth(req)) return send(res, 401, { error: 'Sign in as in-charge to resolve complaints.' });
      const body = await readBody(req);
      const ref = String(body.ref || '');
      const rows = await supabaseRequest('reports', { query: `select=*&ref=eq.${encodeURIComponent(ref)}&limit=1` });
      if (!rows || !rows.length) return send(res, 404, { error: 'Complaint not found.' });
      const report = fromReportRow(rows[0]);
      if (report.status !== 'resolved') {
        const now = Date.now();
        report.status = 'resolved';
        report.resolvedAt = now;
        report.resolvedBy = 'in-charge';
        await supabaseRequest('reports', {
          method: 'PATCH', query: `ref=eq.${encodeURIComponent(ref)}`,
          body: { status: 'resolved', resolved_at: now, resolved_by: 'in-charge' },
          prefer: 'return=minimal'
        });
        const state = await getState();
        const otherOpen = state.reports.some(r => r.machine === report.machine && r.ref !== ref && r.status !== 'resolved');
        if (!otherOpen) await upsertMachine(report.machine, { status: 'working', fixedAt: now, updatedAt: now });
      }
      return send(res, 200, { ok: true, report });
    }

    return send(res, 404, { error: 'Not found.' });
  } catch (e) {
    console.error(e);
    if (!res.headersSent) send(res, e.statusCode || 400, { error: e.message || 'Request failed.' });
  }
});

server.listen(PORT, HOST, () => {
  console.log(`LUMS Pad Machines server running on port ${PORT}`);
  console.log('Complaint and machine-status data will be read from and written to Supabase.');
});
