/* Verify the Node preview cannot be mistaken for a live IPAware connection. */
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const reserve = net.createServer();
const port = await new Promise((resolve, reject) => {
  reserve.once('error', reject);
  reserve.listen(0, '0.0.0.0', () => resolve(reserve.address().port));
});
await new Promise((resolve) => reserve.close(resolve));
const child = spawn(process.execPath, ['dev/preview.mjs'], {
  cwd: root, env: { ...process.env, PORT: String(port) }, stdio: ['ignore', 'pipe', 'pipe'],
});
let browser;
try {
  await new Promise((resolve, reject) => {
    let logs = '';
    const timeout = setTimeout(() => reject(new Error(`Preview did not start: ${logs}`)), 10000);
    const onData = (data) => {
      logs += String(data);
      if (logs.includes('listening on')) { clearTimeout(timeout); resolve(); }
    };
    child.stdout.on('data', onData);
    child.stderr.on('data', onData);
    child.once('error', (error) => { clearTimeout(timeout); reject(error); });
    child.once('exit', (code) => { clearTimeout(timeout); reject(new Error(`Preview exited (${code}): ${logs}`)); });
  });
  const base = `http://127.0.0.1:${port}`;
  const bootstrap = await (await fetch(`${base}/api.php?action=bootstrap`)).json();
  assert.equal(bootstrap.config.previewOnly, true);
  assert.equal(bootstrap.config.hasApiKey, false);
  assert.equal(bootstrap.config.runtimeServerOverrideAllowed, false);
  const snapshot = await (await fetch(`${base}/api.php?action=snapshot`)).json();
  assert.match(snapshot.meta.warnings[0], /Preview only.*cannot connect/i);
  assert.equal(snapshot.allowed.find((row) => row.ip === '192.0.2.174')?.addedBy, 'admin@example.invalid');
  assert.equal(snapshot.allowed.find((row) => row.ip === '2001:db8:11:21::10')?.source, 'builtin');
  const exampleLookup = await (await fetch(`${base}/api.php?action=ip&ip=192.0.2.174`)).json();
  assert.equal(exampleLookup.result.verdict, 'allowed');
  assert.equal(exampleLookup.result.activeDecision, false);
  assert.equal(exampleLookup.raw.enforcement.blockedOnThisServer, false);
  assert.equal(exampleLookup.raw.activity.sightings, 2641);
  const connection = await fetch(`${base}/api.php?action=test`);
  assert.equal(connection.status, 409);
  assert.match((await connection.json()).message, /Preview only/);
  const save = await fetch(`${base}/api.php?action=set_key`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ apiKey: 'fake-test-key', server: 'https://example.invalid' }),
  });
  assert.equal(save.status, 409);
  assert.match((await save.json()).message, /Preview only/);
  const after = await (await fetch(`${base}/api.php?action=bootstrap`)).json();
  assert.equal(after.config.hasApiKey, false);
  assert.equal(after.config.server, '');
  console.log('Preview API test passed: sample-only status, no simulated live connection, and credentials rejected.');

  const playwrightPath = process.env.IPAWARE_PLAYWRIGHT_MODULE;
  const chromiumPath = process.env.IPAWARE_CHROMIUM_EXECUTABLE;
  if (playwrightPath && chromiumPath) {
    const playwright = await import(pathToFileURL(playwrightPath).href);
    browser = await playwright.chromium.launch({
      executablePath: chromiumPath, headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
    });
    const page = await browser.newPage();
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.goto(`${base}/#/settings`);
    await page.getByText('PREVIEW ONLY', { exact: true }).waitFor();
    assert.equal(await page.locator('#connection-pill').innerText(), 'Preview only');
    assert.equal(await page.locator('#api-key').isDisabled(), true);
    assert.equal(await page.locator('#server-url').isDisabled(), true);
    assert.equal(await page.getByRole('button', { name: 'Test connection' }).isDisabled(), true);
    assert.equal(await page.getByRole('button', { name: 'Save for this session' }).isDisabled(), true);
    await page.getByText(/This preview shows sample data and cannot connect/).waitFor();
    await page.getByRole('tab', { name: /Whitelist/ }).click();
    await page.locator('input[data-q]').fill('192.0.2.174');
    const exampleRow = page.locator('tbody tr').filter({ hasText: '192.0.2.174' });
    await exampleRow.waitFor();
    await exampleRow.getByRole('button', { name: '192.0.2.174' }).click();
    await page.getByRole('dialog', { name: '192.0.2.174' }).getByRole('button', { name: 'IP lookup' }).click();
    await page.getByRole('heading', { name: 'Enforcement', exact: true }).waitFor();
    assert.deepEqual(errors, []);
    console.log('Preview browser test passed: sample-only labeling, disabled connection controls and example IP view.');
  }
} finally {
  if (browser) await browser.close();
  if (child.exitCode === null) {
    const exited = new Promise((resolve) => child.once('exit', resolve));
    child.kill('SIGTERM');
    const timeout = setTimeout(() => child.kill('SIGKILL'), 2000);
    await exited;
    clearTimeout(timeout);
  }
}
