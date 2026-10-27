import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const fixture = JSON.parse(await readFile(new URL('./fixtures/cluster-decision.json', import.meta.url), 'utf8'));
const requests = [];
let decisions = 0;
const server = createServer((req, res) => {
  requests.push({ path: req.url, authorization: req.headers.authorization });
  let payload;
  if (req.url === '/ipaware/decisions') {
    decisions += 1;
    payload = [1, 4].includes(decisions)
      ? { servers: ['192.0.2.1'], data: { blockedIps: [null, fixture, { ip: '2001:db8::3', verdict: 'block' }] } }
      : [2, 5].includes(decisions) ? { servers: ['192.0.2.1'], unexpected: ['not-an-ip'] } : { decisions: [], servers: ['192.0.2.1'] };
  } else if (req.url === '/ipaware/allowed_ips') {
    payload = { allowed_ips: [{ cidr: '198.51.100.0/24', comment: 'office' }] };
  } else {
    res.writeHead(404); res.end(); return;
  }
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(payload));
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
try {
  const url = `http://127.0.0.1:${server.address().port}`;
  async function runPhp(file) {
    const php = spawn(process.env.PHP_BIN || 'php', [fileURLToPath(new URL(file, import.meta.url)), url]);
    let stdout = '';
    let stderr = '';
    php.stdout.setEncoding('utf8').on('data', chunk => { stdout += chunk; });
    php.stderr.setEncoding('utf8').on('data', chunk => { stderr += chunk; });
    const code = await new Promise((resolve, reject) => { php.on('error', reject); php.on('close', resolve); });
    assert.equal(code, 0, stderr);
    assert.equal(stderr, '', stderr);
    return JSON.parse(stdout);
  }
  const result = await runPhp('./live-integration.php');
  assert.equal(result.demo, false, 'auto mode must use the supplied server');
  assert.deepEqual(result.decisions.rows.map(row => row.ip), ['203.0.113.83', '2001:db8::3']);
  assert.deepEqual(result.decisions.rows[0].raw, fixture, 'the entire nested record reaches the client');
  assert.equal(result.decisions.meta.status, 200);
  assert.ok(result.decisions.meta.durationMs >= 0);
  assert.match(result.unrecognized.meta.warning, /Settings → Raw decisions/);
  assert.deepEqual(result.empty.rows, []);
  assert.equal(result.empty.meta.warning, undefined);
  assert.deepEqual(result.allowed.rows.map(row => row.ip), ['198.51.100.0/24']);
  const snapshot = await runPhp('./api-snapshot.php');
  assert.equal(snapshot.ok, true);
  assert.equal(snapshot.meta.mode, 'live');
  assert.equal(snapshot.meta.config.demo, false);
  assert.equal(snapshot.stats.blocked, 2);
  assert.deepEqual(snapshot.decisions[0].raw, fixture);
  assert.equal(snapshot.meta.lists.decisions.status, 200);
  assert.equal(snapshot.meta.errors.decisions, undefined);
  assert.deepEqual(snapshot.allowed.map(row => row.ip), ['198.51.100.0/24']);
  const unknownSnapshot = await runPhp('./api-snapshot.php');
  assert.deepEqual(unknownSnapshot.decisions, []);
  assert.match(unknownSnapshot.meta.lists.decisions.warning, /Settings → Raw decisions/);
  assert.ok(unknownSnapshot.meta.warnings.includes(unknownSnapshot.meta.lists.decisions.warning));
  assert.equal(requests.length, 8);
  assert.ok(requests.every(request => request.authorization === 'Bearer integration-test-key'));
  console.log('Live HTTP and snapshot integration passed: session server, authenticated fetch, normalization, warnings, and allow list.');
} finally {
  server.close();
}
