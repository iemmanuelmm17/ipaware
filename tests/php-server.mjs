/* Real built-in PHP server + isolated fake upstream. No real credentials or server. */
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import http from 'node:http';
import net from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const sample = JSON.parse(await readFile(path.join(root, 'tests/fixtures/cluster-decision.json'), 'utf8'));
const lookupSample = JSON.parse(await readFile(path.join(root, 'tests/fixtures/ip-lookup.json'), 'utf8'));
const allowedSamples = JSON.parse(await readFile(path.join(root, 'tests/fixtures/allowlist.json'), 'utf8'));
sample.evidence.emptyObject = {};
sample.evidence.emptyArray = [];
sample.evidence.numericKeys = { 0: 'first', 1: 'second' };
allowedSamples[0].extra = {};
const longLookup = structuredClone(lookupSample);
longLookup.ip = '192.0.2.175';
longLookup.history.explanation = 'detailed lookup evidence '.repeat(3000);
longLookup.history.emptyObject = {};
longLookup.history.emptyArray = [];
const unknownLookup = {
  ip: '192.0.2.176', score: { lastVerdict: 'block' },
  enforcement: { allowlisted: null, blockedOnThisServer: null, block: null },
  decisions: { count: 4, mostRecent: { reason: 'historical' } },
};
const hostileLookup = structuredClone(lookupSample);
hostileLookup.ip = '192.0.2.177';
hostileLookup.status = '<img src=x onerror="window.lookupXss=true">';
hostileLookup.reason = '<svg onload="window.lookupXss=true">';
hostileLookup.geo.isp = '<b>Untrusted provider</b>';
const temp = await mkdtemp(path.join(tmpdir(), 'ipaware-php-server-'));
const phpBin = process.env.PHP_BIN || 'php';
const fakeKey = 'ipaware-test-only-key';
const upstreamRequests = [];
let failDecisions = false;
let php;
let browser;

const listen = (server, host = '127.0.0.1') => new Promise((resolve, reject) => {
  server.once('error', reject);
  server.listen(0, host, () => resolve(server.address().port));
});
const closeServer = (server) => new Promise((resolve) => server.close(resolve));
const upstream = http.createServer((req, res) => {
  upstreamRequests.push(req.url);
  res.setHeader('Content-Type', 'application/json');
  if (req.headers.authorization !== `Bearer ${fakeKey}`) {
    res.writeHead(401).end(JSON.stringify({ error: 'Test authentication failed' }));
    return;
  }
  if (req.url === '/ipaware/decisions') {
    if (failDecisions) {
      res.writeHead(503).end(JSON.stringify({ error: `Test upstream unavailable (${fakeKey})` }));
      return;
    }
    res.end(JSON.stringify({ data: { blocked: [sample] } }));
  } else if (req.url === '/ipaware/allowed_ips') {
    res.end(JSON.stringify({ allowed_ips: allowedSamples }));
  } else if (req.url === `/ipaware/ip/${sample.ip}`) {
    res.end(JSON.stringify(sample));
  } else if (req.url === `/ipaware/ip/${lookupSample.ip}`) {
    res.end(JSON.stringify(lookupSample));
  } else if (req.url === `/ipaware/ip/${longLookup.ip}`) {
    res.end(JSON.stringify(longLookup));
  } else if (req.url === `/ipaware/ip/${unknownLookup.ip}`) {
    res.end(JSON.stringify(unknownLookup));
  } else if (req.url === `/ipaware/ip/${hostileLookup.ip}`) {
    res.end(JSON.stringify(hostileLookup));
  } else {
    res.writeHead(404).end(JSON.stringify({ error: 'Unknown test endpoint' }));
  }
});

try {
  const upstreamPort = await listen(upstream);
  const reserve = net.createServer();
  const phpPort = await listen(reserve, '0.0.0.0');
  await closeServer(reserve);

  for (const entry of ['src', 'templates', 'assets', 'index.php', 'api.php', 'stream.php', 'asset.php']) {
    await cp(path.join(root, entry), path.join(temp, entry), { recursive: true });
  }
  await mkdir(path.join(temp, 'dev'));
  await cp(path.join(root, 'dev/router.php'), path.join(temp, 'dev/router.php'));
  await writeFile(path.join(temp, '.env'), [
    'APP_MODE=auto',
    'APP_DEBUG=true',
    'API_BASE_URL=',
    'API_KEY=',
    'AUTH_SCHEME=Bearer',
    'API_TIMEOUT=5',
    'REQUIRE_PUBLIC_IP=false',
    'DEV_ALLOW_LOCALHOST=true',
    'SSE_ENABLED=true',
    'DATA_DIR=./data',
    '',
  ].join('\n'));

  const env = { ...process.env };
  // Ensure the test exercises PHP's default single-worker development server.
  delete env.PHP_CLI_SERVER_WORKERS;
  php = spawn(phpBin, ['-S', `0.0.0.0:${phpPort}`, '-t', '.', 'dev/router.php'], {
    cwd: temp, env, stdio: ['ignore', 'pipe', 'pipe'],
  });
  let logs = '';
  await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error(`PHP server did not start. ${logs}`)), 15000);
    const started = (data) => {
      logs = (logs + String(data)).slice(-5000);
      if (logs.includes('Development Server')) { clearTimeout(timeout); resolve(); }
    };
    php.stdout.on('data', started);
    php.stderr.on('data', started);
    php.once('error', (error) => { clearTimeout(timeout); reject(error); });
    php.once('exit', (code) => { clearTimeout(timeout); reject(new Error(`PHP server exited (${code}). ${logs}`)); });
  });

  const base = `http://127.0.0.1:${phpPort}`;
  const get = (url) => fetch(base + url, { signal: AbortSignal.timeout(5000) });
  // Some PHP-WASM builds print the startup line just before their socket is ready.
  let bootstrap;
  for (let attempt = 0; attempt < 30; attempt += 1) {
    try { bootstrap = await get('/api.php?action=bootstrap'); break; }
    catch (error) {
      if (error.cause?.code !== 'ECONNREFUSED' || attempt === 29) throw error;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }
  assert.equal(bootstrap.status, 200);
  const cookie = bootstrap.headers.get('set-cookie')?.split(';')[0];
  const { config, csrf } = await bootstrap.json();
  assert.ok(cookie && csrf, 'the test needs a session cookie and CSRF token');
  assert.equal(config.mode, 'demo');
  assert.equal(config.hasApiKey, false);
  assert.equal(config.sseEnabled, false, 'the browser must not open a stream on the built-in server');
  assert.match(config.sseDisabledReason, /built-in development server.*auto-refresh/i);

  const post = (action, body) => fetch(`${base}/api.php?action=${action}`, {
    method: 'POST', signal: AbortSignal.timeout(5000),
    headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrf, Cookie: cookie },
    body: JSON.stringify(body),
  });
  const saved = await (await post('set_key', { apiKey: fakeKey, server: `http://127.0.0.1:${upstreamPort}` })).json();
  assert.equal(saved.config.keySource, 'session');
  assert.equal(saved.config.mode, 'live', 'a session server must switch auto mode to live');

  // A direct stream request must also finish rather than tying up the only PHP worker.
  const stream = await get('/stream.php');
  assert.equal(stream.status, 204);
  const response = await fetch(`${base}/api.php?action=snapshot`, { headers: { Cookie: cookie }, signal: AbortSignal.timeout(5000) });
  assert.equal(response.status, 200, 'the list request should respond after a stream request');
  const snapshot = await response.json();
  assert.equal(snapshot.ok, true);
  assert.equal(snapshot.decisions.length, 1);
  assert.equal(snapshot.decisions[0].ip, sample.ip);
  assert.deepEqual(snapshot.decisions[0].raw, sample);
  assert.equal(snapshot.allowed.length, 2);
  assert.deepEqual(snapshot.allowed.map((row) => row.ip), allowedSamples.map((row) => row.cidr));
  assert.deepEqual(snapshot.allowed.map((row) => row.raw), allowedSamples);
  assert.equal(snapshot.allowed[0].addedBy, 'admin@example.invalid');
  assert.equal(snapshot.allowed[1].ip, '2001:db8:11:21::10');
  assert.equal(snapshot.meta.lists.decisions.status, 200);
  assert.deepEqual(snapshot.meta.errors, []);
  assert.ok(upstreamRequests.includes('/ipaware/decisions'));
  assert.ok(upstreamRequests.includes('/ipaware/allowed_ips'));

  const lookupResponse = await fetch(`${base}/api.php?action=ip&ip=${lookupSample.ip}`, { headers: { Cookie: cookie } });
  const lookup = await lookupResponse.json();
  assert.equal(lookupResponse.status, 200);
  assert.equal(lookup.result.verdict, 'allowed');
  assert.equal(lookup.result.allowlisted, true);
  assert.equal(lookup.result.activeDecision, false);
  assert.deepEqual(lookup.result.events, []);
  assert.deepEqual(lookup.raw, lookupSample);
  assert.deepEqual(lookup.result.raw, lookupSample);
  const longResponse = await (await fetch(`${base}/api.php?action=ip&ip=${longLookup.ip}`, { headers: { Cookie: cookie } })).json();
  assert.deepEqual(longResponse.raw, longLookup);
  assert.deepEqual(longResponse.result.raw, longLookup, 'large upstream lookup data is never truncated');

  const update = await (await post('set_key', { apiKey: '', server: `http://127.0.0.1:${upstreamPort}` })).json();
  assert.equal(update.config.keySource, 'session', 'saving only the server must keep the existing session key');
  assert.equal(update.config.hasApiKey, true);
  const invalid = await post('set_key', { apiKey: 'different-fake-key', server: 'not-a-valid-url' });
  assert.equal(invalid.status, 422);
  const afterInvalid = await fetch(`${base}/api.php?action=decisions`, { headers: { Cookie: cookie }, signal: AbortSignal.timeout(5000) });
  assert.equal(afterInvalid.status, 200, 'an invalid server must not replace the saved key');
  failDecisions = true;
  const failure = await fetch(`${base}/api.php?action=decisions`, { headers: { Cookie: cookie }, signal: AbortSignal.timeout(5000) });
  assert.equal(failure.status, 502);
  const failureBody = await failure.json();
  assert.match(failureBody.message, /HTTP 503/);
  assert.ok(!JSON.stringify(failureBody).includes(fakeKey), 'the upstream error must not echo the API key');
  const partial = await fetch(`${base}/api.php?action=snapshot`, { headers: { Cookie: cookie }, signal: AbortSignal.timeout(5000) });
  const partialBody = await partial.json();
  assert.match(partialBody.meta.errors.decisions, /HTTP 503/);
  assert.equal(partialBody.allowed.length, 2, 'a blocked-list error does not hide the allow list');
  assert.ok(!JSON.stringify(partialBody).includes(fakeKey));
  failDecisions = false;
  const cleared = await (await post('clear_key', {})).json();
  assert.equal(cleared.config.keySource, 'none', 'Clear session should still remove the session key');
  assert.equal(cleared.config.mode, 'demo');
  console.log('PHP built-in server test passed: stream disabled, authenticated live-shaped lists responsive, full record and session key preserved.');

  // Optional browser pass: set both paths to run against the real PHP server.
  const playwrightPath = process.env.IPAWARE_PLAYWRIGHT_MODULE;
  const chromiumPath = process.env.IPAWARE_CHROMIUM_EXECUTABLE;
  if (playwrightPath && chromiumPath) {
    const playwright = await import(pathToFileURL(playwrightPath).href);
    browser = await playwright.chromium.launch({
      executablePath: chromiumPath, headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
    });
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.addInitScript(() => {
      localStorage.setItem('ipa.live', '1');
      localStorage.setItem('ipa.autorefresh', '30');
      const OriginalEventSource = window.EventSource;
      window.streamConnections = 0;
      window.EventSource = class extends OriginalEventSource {
        constructor(...args) { super(...args); window.streamConnections += 1; }
      };
    });
    await page.goto(`${base}/#/settings`);
    await page.locator('#api-key').fill(fakeKey);
    await page.locator('#server-url').fill(`http://127.0.0.1:${upstreamPort}`);
    await page.getByRole('button', { name: 'Save for this session' }).click();
    await page.getByText('LIVE MODE', { exact: true }).waitFor();
    // A second save leaves the blank API-key field untouched.
    await page.getByRole('button', { name: 'Save for this session' }).click();
    await page.getByText('Session (entered in UI)', { exact: true }).waitFor();
    await page.getByRole('tab', { name: /Blocked IPs/ }).click();
    const row = page.locator('tbody tr').filter({ hasText: sample.ip });
    await row.waitFor({ timeout: 15000 });
    assert.equal(await page.evaluate(() => window.streamConnections), 0);
    assert.equal(await page.locator('#live-toggle').isDisabled(), true);
    assert.equal(await page.getByRole('tab', { name: 'Commands' }).count(), 0);
    await row.getByRole('button', { name: sample.ip }).click();
    const dialog = page.getByRole('dialog', { name: sample.ip });
    await dialog.waitFor();
    const details = await dialog.innerText();
    for (const text of ['Enforced by servers', 'Evidence from', 'Frankfurt am Main', 'History', 'null', 'false']) {
      assert.ok(details.includes(text), `Record popup missing ${text}`);
    }
    await page.keyboard.press('Escape');

    // The allow-list endpoint and the single-IP endpoint use different schemas.
    await page.getByRole('tab', { name: /Whitelist/ }).click();
    const allowRow = page.locator('tbody tr').filter({ hasText: lookupSample.ip });
    await allowRow.waitFor();
    const tableText = await page.locator('[data-table]').innerText();
    for (const text of ['Source', 'Comment', 'Added by', 'Country', 'City', 'Domain', 'Added', 'Expires', '2001:db8:11:21::10']) {
      assert.ok(tableText.toLowerCase().includes(text.toLowerCase()), `Allow-list table missing ${text}`);
    }
    const rowText = await allowRow.innerText();
    for (const text of ['db', 'Office device', 'admin@example.invalid', 'PH', 'Example City']) {
      assert.ok(rowText.includes(text), `Allow-list row missing ${text}`);
    }
    await allowRow.getByRole('button', { name: lookupSample.ip }).click();
    const allowDialog = page.getByRole('dialog', { name: lookupSample.ip });
    await allowDialog.waitFor();
    const allowDetails = await allowDialog.innerText();
    for (const text of ['Added by', 'admin@example.invalid', 'Country', 'City', 'Domain', 'null']) {
      assert.ok(allowDetails.includes(text), `Allow-list popup missing ${text}`);
    }
    await allowDialog.getByRole('button', { name: 'IP lookup' }).click();
    await page.waitForURL('**/#/lookup');
    await page.getByRole('heading', { name: 'Enforcement', exact: true }).waitFor();
    const lookupText = await page.locator('[data-result]').innerText();
    assert.match(lookupText, /Allow-listed\s+Yes/i);
    assert.match(lookupText, /Active decision\s+No/i);
    for (const text of ['Score', 'Last score', 'Trust', 'Activity', 'Enforcement', 'Recognition', 'History', 'Rejects', 'Geo', 'Risk', 'Decisions', '2641', 'false', 'null', 'ungrouped=1']) {
      assert.ok(lookupText.includes(text), `IP view missing ${text}`);
    }
    assert.ok(!lookupText.includes('No signals'), 'summary objects must not be presented as an empty event timeline');
    await page.getByRole('button', { name: 'Raw JSON' }).click();
    const rawDialog = page.getByRole('dialog', { name: `Raw response — ${lookupSample.ip}` });
    await rawDialog.waitFor();
    assert.deepEqual(JSON.parse(await rawDialog.locator('pre').innerText()), lookupSample);
    await page.keyboard.press('Escape');

    const lookupInput = page.locator('input[name="ip"]');
    await lookupInput.fill(unknownLookup.ip);
    await page.getByRole('button', { name: 'Look up IP' }).click();
    await page.locator('[data-result] .detail-ip').filter({ hasText: unknownLookup.ip }).waitFor();
    const unknownText = await page.locator('[data-result]').innerText();
    assert.match(unknownText, /Allow-listed\s+Unknown/i);
    assert.match(unknownText, /Active decision\s+Unknown/i);
    assert.ok(unknownText.includes('UNKNOWN'), 'a historical block score must not become a current block');

    await lookupInput.fill(hostileLookup.ip);
    await page.getByRole('button', { name: 'Look up IP' }).click();
    await page.locator('[data-result] .detail-ip').filter({ hasText: hostileLookup.ip }).waitFor();
    const hostileText = await page.locator('[data-result]').innerText();
    assert.ok(hostileText.includes(hostileLookup.status));
    assert.ok(hostileText.includes(hostileLookup.reason));
    assert.ok(hostileText.includes(hostileLookup.geo.isp));
    assert.equal(await page.locator('[data-result] img').count(), 0);
    assert.equal(await page.evaluate(() => window.lookupXss), undefined);

    await page.setViewportSize({ width: 390, height: 844 });
    const mobileWidth = await page.evaluate(() => ({ width: document.documentElement.clientWidth, scroll: document.documentElement.scrollWidth }));
    assert.equal(mobileWidth.scroll, mobileWidth.width, 'the lookup view should fit a mobile screen');
    await page.getByRole('tab', { name: /Whitelist/ }).click();
    await page.locator('tbody tr').filter({ hasText: lookupSample.ip }).waitFor();
    const mobileListWidth = await page.evaluate(() => ({ width: document.documentElement.clientWidth, scroll: document.documentElement.scrollWidth }));
    assert.equal(mobileListWidth.scroll, mobileListWidth.width, 'only the table, not the whole page, should scroll horizontally');
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.getByRole('tab', { name: /Blocked IPs/ }).click();
    await row.waitFor();

    failDecisions = true;
    await page.locator('#refresh-now').click();
    await page.getByText(/Upstream returned HTTP 503/).first().waitFor();
    assert.equal(await page.getByText('Lists refreshed', { exact: true }).count(), 0, 'a failed list request must not show a success toast');
    failDecisions = false;
    await page.locator('#refresh-now').click();
    await row.waitFor();

    await page.getByRole('tab', { name: 'Settings' }).click();
    await page.getByText(/Disabled on PHP's built-in development server/).waitFor();
    assert.equal(await page.getByRole('button', { name: 'Commands' }).count(), 0);
    await page.locator('#palette-trigger').click();
    const palette = page.getByRole('dialog', { name: 'Quick actions' });
    await palette.waitFor();
    assert.equal(await palette.getByText('Commands', { exact: true }).count(), 0);
    await palette.getByRole('button', { name: /Blocked IPs/ }).click();
    await row.waitFor();

    // Existing links/bookmarks to the removed tab fall back safely to Overview.
    await page.evaluate(() => { location.hash = '#/commands'; });
    await page.waitForURL('**/#/overview');
    assert.equal(await page.locator('#page-title').innerText(), 'Overview');
    assert.deepEqual(errors, []);

    // Surface a backend/network failure in the empty table, not just the status bar.
    const offline = await browser.newPage();
    await offline.route('**/api.php?action=snapshot', (route) => route.abort('failed'));
    await offline.goto(`${base}/#/decisions`);
    await offline.locator('[data-table]').getByText(/Cannot reach the PHP backend/).waitFor();
    await offline.close();

    // An authenticated but genuinely empty response has a distinct explanation.
    const empty = await browser.newPage();
    await empty.route('**/api.php?action=snapshot', (route) => route.fulfill({
      status: 200, contentType: 'application/json',
      body: JSON.stringify({ ok: true, decisions: [], allowed: [], events: [], stats: {}, meta: { errors: {}, lists: {} } }),
    }));
    await empty.goto(`${base}/#/decisions`);
    await empty.locator('[data-table]').getByText(/server returned no addresses/).waitFor();
    await empty.close();
    console.log('PHP browser test passed: real list request, details, clear diagnostics, polling, quick actions, and removed Commands navigation.');
  }
} finally {
  if (browser) await browser.close();
  if (php && php.exitCode === null) {
    const exited = new Promise((resolve) => php.once('exit', resolve));
    php.kill('SIGTERM');
    const timeout = setTimeout(() => php.kill('SIGKILL'), 2000);
    await exited;
    clearTimeout(timeout);
  }
  await closeServer(upstream);
  await rm(temp, { recursive: true, force: true });
}
