/**
 * PREVIEW ONLY. A tiny Node mock of the PHP backend so the exact same front-end
 * (templates/app.html + assets/*) can be viewed in environments without PHP.
 * Your real deployment uses index.php / api.php / stream.php / export.php.
 *
 *   node dev/preview.mjs        -> http://localhost:3000
 */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = Number(process.env.PORT || 3000);
const HOST = '0.0.0.0';

const VERSION = '1.0.0';
const config = {
  appName: 'IPAware Console', version: VERSION, mode: 'demo', demo: true,
  server: 'https://$server', serverConfigured: false, serverOverridden: false,
  runtimeServerOverrideAllowed: true, keySource: 'none', hasApiKey: false,
  authScheme: 'Bearer', verifyTls: true, timeout: 12,
  endpoints: {
    decisions: '/ipaware/decisions', ip: '/ipaware/ip',
    block: '/ipaware/firewall/block', unblock: '/ipaware/firewall/unblock',
    allowlist: '/ipaware/allowed_ips',
  },
  writeParamsMode: 'query', allowlistDeleteMethod: 'DELETE',
  sseEnabled: true, pollSeconds: 6, sseMaxSeconds: 300, minAutoRefresh: 10,
  requirePublicIp: true, devAllowLocalhost: true, timezone: 'UTC',
  access: { clientIp: '127.0.0.1', allowed: true, allowlistSource: 'preview mock (PHP guard in real deployment)' },
  csrf: 'demo-csrf',
};

const scenarios = [
  ['crowdsecurity/ssh-bf', 'SSH brute-force attempts'],
  ['crowdsecurity/http-probing', 'HTTP path probing / scanning'],
  ['crowdsecurity/http-bf-wordpress', 'WordPress login brute force'],
  ['custom/rate-limit', 'Repeated rate-limit violations'],
  ['crowdsecurity/rdp-bf', 'RDP authentication brute force'],
  ['custom/geo-anomaly', 'Unusual geographic access pattern'],
];
const comments = ['office HQ', 'branch office', 'partner VPN', 'monitoring probe', 'tango', 'CI runner'];
const firstOctets = [5, 23, 37, 45, 58, 91, 103, 119, 141, 167, 181, 185, 193, 202, 209, 213];
let seed = 1337;
const rnd = () => { seed = (seed * 1664525 + 1013904223) % 4294967296; return seed / 4294967296; };
const pick = (a) => a[Math.floor(rnd() * a.length)];
const ip = () => `${pick(firstOctets)}.${1 + Math.floor(rnd() * 254)}.${Math.floor(rnd() * 255)}.${1 + Math.floor(rnd() * 254)}`;
const iso = (offsetSeconds) => new Date(Date.now() + offsetSeconds * 1000).toISOString();

function blockRow(address, i = 0) {
  const [scenario, reason] = scenarios[i % scenarios.length];
  const age = 60 + Math.floor(rnd() * 60 * 60 * 24 * 10);
  const ttl = 3600 + Math.floor(rnd() * 60 * 60 * 40);
  return {
    id: `dec_${i}_${Math.floor(rnd() * 1e9)}`, kind: 'blocked', ip: address, cidr: `${address}/32`,
    reason, comment: reason, scenario, source: pick(['crowdsec', 'lapi', 'firewall', 'manual']),
    action: i % 8 === 0 ? 'captcha' : 'ban', created: iso(-age), expires: iso(-age + ttl),
    ttl: `${Math.floor(ttl / 3600)}h`, origin: 'lapi',
    raw: { scope: 'Ip', value: address, type: 'ban', scenario, reason, origin: 'lapi' },
  };
}
function allowRow(address, i = 0) {
  return {
    id: `allow_${i}_${Math.floor(rnd() * 1e9)}`, kind: 'allowed', ip: address,
    cidr: address.includes('/') ? address : `${address}/32`,
    reason: pick(comments), comment: pick(comments), scenario: 'allowlist',
    source: pick(['admin', 'api', 'console']), action: 'allow',
    created: iso(-Math.floor(rnd() * 60 * 60 * 24 * 80)), expires: '', ttl: '', origin: 'console',
    raw: { cidr: address, comment: pick(comments), created_by: 'admin' },
  };
}

let decisions = Array.from({ length: 158 }, (_, i) => blockRow(ip(), i));
decisions.push(blockRow('2001:db8:4f::a1', 2));
let allowed = Array.from({ length: 29 }, (_, i) => allowRow(i % 8 === 0 ? `${ip()}/29` : ip(), i));
allowed.push(allowRow('2001:db8:1::/48', 1));
let events = [];
let eventSeq = 0;

function log(type, message, address = '', severity = 'info', meta = {}) {
  const event = {
    id: `ev_${Date.now().toString(36)}_${++eventSeq}`, ts: new Date().toISOString(),
    epoch: Math.floor(Date.now() / 1000), type, severity, message, ip: address, meta,
  };
  events = [event, ...events].slice(0, 1500);
  return event;
}
log('system', 'Preview console started (Node mock backend)', '', 'success', { mode: 'preview' });
log('block', `New block detected: ${decisions[0].ip}`, decisions[0].ip, 'warning', { detectedBy: 'stream' });
log('allow', `Allowlist entry detected: ${allowed[0].ip}`, allowed[0].ip, 'success', { detectedBy: 'stream' });

const json = (res, payload, status = 200, extra = {}) => {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'Cache-Control': 'no-store', ...extra,
  });
  res.end(body);
};

const escapeXml = (v) => String(v ?? '').replace(/[<>&"']/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&apos;' })[c]);

function excelXml(rows, filter) {
  const header = ['Type', 'IP / CIDR', 'Reason / Comment', 'Scenario / Action', 'Source', 'Created', 'Expires / TTL', 'ID'];
  const all = filter === 'blocked' ? decisions : filter === 'allowed' ? allowed : [...decisions, ...allowed];
  const body = all.map((r) => [r.kind, r.ip, r.reason, r.scenario, r.source, r.created, r.expires || r.ttl, r.id]);
  const cell = (v) => `<Cell><Data ss:Type="String">${escapeXml(v)}</Data></Cell>`;
  return `<?xml version="1.0"?><?mso-application progid="Excel.Sheet"?>
<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet" xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet">
<Worksheet ss:Name="IP addresses"><Table>
${[header, ...body].map((row) => `<Row>${row.map(cell).join('')}</Row>`).join('\n')}
</Table></Worksheet></Workbook>`;
}

function lookup(address) {
  const decision = decisions.find((r) => r.ip === address) || null;
  const allowlisted = allowed.some((r) => r.ip === address || r.cidr === `${address}/32`);
  const verdict = allowlisted ? 'allowed' : decision ? 'blocked' : 'clean';
  return {
    ip: address, verdict, status: decision ? 'banned' : 'clean',
    decision, allowlisted, reason: decision?.reason || 'No active decision found for this address.',
    scenario: decision?.scenario || '—', firstSeen: iso(-86400), lastSeen: iso(-600), expires: decision?.expires || '',
    country: pick(['Philippines', 'Germany', 'Singapore', 'United States', 'Japan']),
    asn: `AS${10000 + Math.floor(rnd() * 40000)}`, org: 'Example Network',
    events: [
      { ts: iso(-900), type: 'signal', message: 'Request rate anomaly' },
      { ts: iso(-3600), type: 'auth', message: 'Failed authentication' },
    ],
    raw: { ip: address, status: verdict, message: 'Preview data' },
  };
}

function snapshot() {
  const dayAgo = Math.floor(Date.now() / 1000) - 86400;
  return {
    ok: true, decisions, allowed, events: events.slice(0, 40),
    stats: {
      blocked: decisions.length, allowed: allowed.length,
      events24h: events.filter((e) => e.epoch >= dayAgo).length,
      latencyMs: 12, lastSync: new Date().toISOString(), upstream: 'demo',
    },
    meta: {
      fetchedAt: new Date().toISOString(), durationMs: 12, mode: 'demo', demo: true,
      server: 'https://$server', keySource: config.keySource, hasApiKey: config.hasApiKey,
      warnings: ['Preview mode: this live demo is powered by dev/preview.mjs. Deploy the PHP files for real use.'],
      errors: {}, lists: {}, raw: {}, config,
    },
    csrf: config.csrf,
  };
}

async function readBody(req) {
  return new Promise((resolve) => {
    let raw = '';
    req.on('data', (chunk) => { raw += chunk; if (raw.length > 1e6) req.destroy(); });
    req.on('end', () => {
      const type = req.headers['content-type'] || '';
      if (type.includes('application/json')) {
        try { return resolve(JSON.parse(raw || '{}')); } catch { return resolve({}); }
      }
      const out = {};
      new URLSearchParams(raw).forEach((v, k) => { out[k] = v; });
      resolve(out);
    });
  });
}

function handleApi(req, res, url) {
  const action = url.searchParams.get('action') || 'bootstrap';
  if (action === 'bootstrap') return json(res, { ok: true, config, csrf: config.csrf });
  if (action === 'snapshot') return json(res, snapshot());
  if (action === 'decisions') return json(res, { ok: true, rows: decisions, raw: decisions.map((r) => r.raw), meta: { status: 200, durationMs: 8, demo: true } });
  if (action === 'allowed_ips') return json(res, { ok: true, rows: allowed, raw: allowed.map((r) => r.raw), meta: { status: 200, durationMs: 7, demo: true } });
  if (action === 'raw') return json(res, { ok: true, which: url.searchParams.get('which'), raw: { preview: true, sample: (url.searchParams.get('which') === 'allowed_ips' ? allowed : decisions).slice(0, 2) }, meta: { status: 200 } });
  if (action === 'ip' || action === 'lookup') {
    const address = url.searchParams.get('ip') || '';
    if (!address) return json(res, { ok: false, message: 'IP is required' }, 422);
    log('lookup', `Looked up ${address}`, address);
    return json(res, { ok: true, result: lookup(address), raw: lookup(address).raw, meta: { status: 200, demo: true } });
  }
  if (action === 'events') {
    const q = (url.searchParams.get('q') || '').toLowerCase();
    const type = url.searchParams.get('type') || '';
    const limit = Number(url.searchParams.get('limit') || 300);
    const list = events.filter((e) => (!type || e.type === type) && (!q || `${e.message} ${e.type} ${e.ip}`.toLowerCase().includes(q)));
    return json(res, { ok: true, events: list.slice(0, limit) });
  }
  if (action === 'test') return json(res, { ok: true, test: { status: 200, latencyMs: 12, message: 'Preview upstream responded successfully.', sample: [], url: 'demo://ipaware' }, message: 'Preview upstream responded successfully.' });
  return json(res, { ok: false, message: `Unknown action: ${action}` }, 404);
}

async function handlePostApi(req, res, url) {
  const body = await readBody(req);
  const action = url.searchParams.get('action');
  const address = String(body.ip || body.cidr || '').trim();
  switch (action) {
    case 'unblock': {
      const before = decisions.length;
      decisions = decisions.filter((r) => r.ip !== address);
      log('unblock', `Released ${address} from the firewall`, address, 'success', { removed: before - decisions.length });
      return json(res, { ok: true, result: { ok: true, ip: address }, message: `Released ${address}` });
    }
    case 'block': {
      decisions = decisions.filter((r) => r.ip !== address);
      decisions.unshift(blockRow(address, Math.floor(rnd() * 6)));
      decisions[0].reason = body.reason || 'Blocked from IPAware Console';
      decisions[0].scenario = 'manual/console';
      allowed = allowed.filter((r) => r.ip !== address && r.cidr !== `${address}/32`);
      log('block', `Blocked ${address}${body.reason ? ` - ${body.reason}` : ''}`, address, 'danger');
      return json(res, { ok: true, result: { ok: true }, message: `Blocked ${address}` });
    }
    case 'allow': {
      allowed = allowed.filter((r) => r.ip !== address && r.cidr !== address);
      const row = allowRow(address, 0);
      row.comment = body.comment || 'Added from console';
      row.reason = row.comment;
      allowed.unshift(row);
      decisions = decisions.filter((r) => r.ip !== address);
      log('allow', `Allowlisted ${address}`, address, 'success');
      return json(res, { ok: true, result: { ok: true }, message: `Allowlisted ${address}` });
    }
    case 'unallow': {
      allowed = allowed.filter((r) => r.ip !== address && r.cidr !== address && r.cidr !== `${address}/32`);
      log('unallow', `Removed ${address} from the allowlist`, address, 'warning');
      return json(res, { ok: true, result: { ok: true }, message: `Removed ${address} from allowlist` });
    }
    case 'clear_events': {
      events = [];
      log('system', 'Event log cleared', '', 'info');
      return json(res, { ok: true, message: 'Event log cleared.' });
    }
    case 'set_key': {
      config.keySource = body.apiKey ? 'session' : 'none';
      config.hasApiKey = !!body.apiKey;
      if (body.server) { config.server = body.server; config.serverOverridden = true; config.serverConfigured = true; }
      log('auth', body.apiKey ? 'API key updated from the console' : 'API key cleared', '', 'info');
      return json(res, { ok: true, config, message: body.apiKey ? 'API key saved for this session.' : 'API key cleared.' });
    }
    case 'clear_key': {
      config.keySource = 'none'; config.hasApiKey = false;
      return json(res, { ok: true, config, message: 'Session credentials cleared.' });
    }
    default:
      return json(res, { ok: false, message: `Unknown action: ${action}` }, 404);
  }
}

function handleStream(req, res) {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  const send = (event, data, id) => {
    res.write(`${id ? `id: ${id}\n` : ''}event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  };
  res.write('retry: 5000\n\n');
  send('hello', { at: new Date().toISOString(), mode: 'demo', pollSeconds: 6, hasApiKey: config.hasApiKey, client: 'preview' });
  let cursor = events[0]?.id;
  let ticks = 0;
  const timer = setInterval(() => {
    ticks += 1;
    const newer = [];
    for (const event of events) {
      if (event.id === cursor) break;
      newer.push(event);
    }
    newer.reverse().forEach((event) => send('activity', event, event.id));
    if (events[0]) cursor = events[0].id;

    let changed = 0;
    if (ticks % 3 === 0 && Math.random() > 0.35) {
      if (decisions.length > 165 && Math.random() > 0.5) {
        const removed = decisions.shift();
        changed = 1;
        log('unblock', `Block removed/released: ${removed.ip}`, removed.ip, 'info', { detectedBy: 'stream' });
      } else {
        const row = blockRow(ip(), Math.floor(rnd() * 6));
        decisions.unshift(row);
        changed = 1;
        log('block', `New block detected: ${row.ip}`, row.ip, 'warning', { detectedBy: 'stream' });
      }
    }
    send('sync', { at: new Date().toISOString(), decisions: decisions.length, allowed: allowed.length, changed, added: [], removed: [], pollSeconds: 6 });
    if (ticks % 5 === 0) send('heartbeat', { at: new Date().toISOString(), uptime: ticks * 2 });
  }, 2000);
  req.on('close', () => clearInterval(timer));
}

function serveAsset(res, name) {
  const safe = String(name || '');
  if (!/^(js\/[a-z0-9/_-]+\.js|css\/[a-z0-9/_-]+\.css|img\/[a-z0-9/_-]+\.(svg|png|ico))$/i.test(safe)) {
    res.writeHead(404); return res.end('Not found');
  }
  const file = path.join(ROOT, 'assets', safe);
  if (!file.startsWith(path.join(ROOT, 'assets') + path.sep) || !fs.existsSync(file)) {
    res.writeHead(404); return res.end('Not found');
  }
  const ext = path.extname(file).toLowerCase();
  const mime = { '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon' }[ext] || 'application/octet-stream';
  const content = fs.readFileSync(file);
  res.writeHead(200, { 'Content-Type': mime, 'Cache-Control': 'no-cache', 'Content-Length': content.length });
  res.end(content);
}

function serveIndex(res) {
  const template = fs.readFileSync(path.join(ROOT, 'templates/app.html'), 'utf8');
  const html = template
    .replaceAll('{{APP_NAME}}', config.appName)
    .replaceAll('{{VERSION}}', VERSION)
    .replaceAll('{{YEAR}}', String(new Date().getFullYear()))
    .replaceAll('{{CONFIG_JSON}}', JSON.stringify(config).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;'));
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(html);
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const pathname = url.pathname.replace(/^\/+/, '');
  try {
    if (pathname === '' || pathname === 'index.php' || pathname === 'index.html') return serveIndex(res);
    if (pathname === 'asset.php') return serveAsset(res, url.searchParams.get('f'));
    if (pathname === 'api.php' && req.method === 'GET') return handleApi(req, res, url);
    if (pathname === 'api.php' && req.method === 'POST') return await handlePostApi(req, res, url);
    if (pathname === 'stream.php') return handleStream(req, res);
    if (pathname === 'export.php' && req.method === 'POST') {
      const body = await readBody(req);
      const format = body.format === 'csv' ? 'csv' : 'xls';
      const filter = body.type || 'all';
      const stamp = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14);
      if (format === 'csv') {
        const rows = (filter === 'blocked' ? decisions : filter === 'allowed' ? allowed : [...decisions, ...allowed])
          .map((r) => [r.kind, r.ip, r.reason, r.scenario, r.source, r.created, r.expires || r.ttl, r.id]
            .map((v) => `"${String(v ?? '').replace(/"/g, '""')}"`).join(','));
        const content = '\ufeff' + ['Type,IP / CIDR,Reason / Comment,Scenario / Action,Source,Created,Expires / TTL,ID', ...rows].join('\r\n');
        res.writeHead(200, { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="ipaware-${stamp}.csv"`, 'X-Export-Format': 'csv' });
        return res.end(content);
      }
      const content = excelXml(null, filter);
      res.writeHead(200, {
        'Content-Type': 'application/vnd.ms-excel; charset=utf-8',
        'Content-Disposition': `attachment; filename="ipaware-${stamp}.xls"`,
        'X-Export-Format': 'xls',
      });
      return res.end(content);
    }
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('404 Not Found');
  } catch (error) {
    console.error(error);
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: false, message: error.message }));
  }
});

server.listen(PORT, HOST, () => {
  console.log(`IPAware preview (Node mock backend) listening on http://${HOST}:${PORT}`);
});
