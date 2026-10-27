import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

// These ES modules are served directly to browsers, without a package/build step.
// Stub the one document listener so their pure rendering helpers can run in Node.
globalThis.document = { addEventListener() {} };
const loadModule = async (path) => {
  const source = await readFile(new URL(path, import.meta.url), 'utf8');
  return import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);
};
const ui = await loadModule('../assets/js/ui.js');
const shared = await loadModule('../assets/js/views/shared.js');
const lookupView = await loadModule('../assets/js/views/lookup.js');
const storeModule = await loadModule('../assets/js/store.js');
const sample = JSON.parse(await readFile(new URL('./fixtures/cluster-decision.json', import.meta.url), 'utf8'));
const ipSample = JSON.parse(await readFile(new URL('./fixtures/ip-lookup.json', import.meta.url), 'utf8'));
const allowedSamples = JSON.parse(await readFile(new URL('./fixtures/allowlist.json', import.meta.url), 'utf8'));

test('full record renders cluster enforcement, evidence, source, counts, and values', () => {
  const html = ui.renderRecordFields(sample);
  for (const text of [
    'Enforced by servers', 'core1-nyc.example.net', 'mis1.pdx.example.net',
    'Enforced by server count', 'Blocked on this server', 'Enforcement', 'Expires at',
    'Suppressed reason', 'First decided at', 'Decision count', 'Threshold note',
    'Reasons', 'community blocklist feed', 'Evidence from', 'Reason truncated',
    'Geo', 'Frankfurt am Main', '50.11088', 'AS64500', 'History', 'Rejects',
    'Extensions truncated', 'Window days', 'Sightings',
  ]) assert.ok(html.includes(text), `Missing ${text}`);
  assert.match(html, /<dt>Suppressed reason<\/dt><dd><span class="muted mono">null<\/span>/);
  assert.match(html, /<dt>Gate<\/dt><dd><span class="badge badge--muted">false<\/span>/);
  assert.match(html, /<dt>Kinds<\/dt><dd><span class="muted mono">\[\]<\/span>/);
  assert.ok(html.includes('title="2026-10-27T06:20:17.620Z"'), 'original date remains available');
});

test('record fields escape untrusted values and preserve empty structures', () => {
  const html = ui.renderRecordFields({
    '<img src=x onerror=alert(1)>': '<script>alert(2)</script>',
    emptyString: '', emptyObject: {}, emptyArray: [],
    mixed: [null, false, {}, [], '<svg onload=alert(3)>'],
  });
  assert.ok(!html.includes('<script>') && !html.includes('<img ') && !html.includes('<svg '));
  assert.ok(html.includes('&lt;script&gt;alert(2)&lt;/script&gt;'));
  assert.ok(html.includes('&lt;img src=x onerror=alert(1)&gt;'));
  assert.ok(html.includes('&lt;svg onload=alert(3)&gt;'));
  assert.ok(html.includes('&quot;&quot;') && html.includes('{}') && html.includes('[]'));
  assert.ok(!html.includes('[object Object]'));
});

test('row and IP button open the complete raw record rather than a lookup', () => {
  const row = {
    ip: sample.ip, kind: 'blocked', created: sample.enforcement.block.addedAt,
    expires: sample.enforcement.block.expiresAt, reason: sample.enforcement.block.reason,
    explanation: sample.evidence.explanation, source: sample.evidence.originServer,
    raw: sample,
  };
  let dialog;
  const ctx = {
    ui: { ...ui, recordDialog(options) { dialog = options; } },
    actions: { lookup() {} },
  };
  shared.showRecord(ctx, row);
  assert.equal(dialog.record, sample);
  assert.equal(dialog.title, sample.ip);
  assert.equal(dialog.subtitle, 'Blocked address');
  assert.ok(dialog.summary.some(([label, value]) => label === 'Explanation' && value === sample.evidence.explanation));
  const ipColumn = shared.rowColumns(ctx).find((column) => column.key === 'ip');
  assert.match(ipColumn.render(row, 0), /data-action="details"/);
  assert.doesNotMatch(ipColumn.render(row, 0), /data-action="lookup"/);
});

test('IP lookup shows every sample section and keeps false, zero, null and empty values', () => {
  const html = lookupView.renderLookupSections(ui, ipSample);
  for (const text of [
    '<h2>Address information</h2>', '<h2>Score</h2>', '<h2>Trust</h2>',
    '<h2>Activity</h2>', '<h2>Enforcement</h2>', '<h2>Recognition</h2>',
    '<h2>History</h2>', '<h2>Rejects</h2>', '<h2>Geo</h2>', '<h2>Risk</h2>', '<h2>Decisions</h2>',
    'core.example.net', 'Last score', 'Scored after', 'Recheck after days', 'Threshold name',
    'Applies to', 'registrar', 'Sightings', '2641', 'Last answered', 'Blocked on this server',
    'Allowlisted', 'Registration age seconds', 'Window days', 'Extensions truncated',
    'Example City', 'Fraud score', 'Is proxy', 'Cached at', 'Enforced by server count',
    'Read hit limit', 'Most recent', 'ungrouped=1',
  ]) assert.ok(html.includes(text), `Missing ${text}`);
  assert.match(html, /<dt>Last score<\/dt><dd>0<\/dd>/);
  assert.match(html, /<dt>Is proxy<\/dt><dd><span class="badge badge--muted">false<\/span>/);
  assert.match(html, /<dt>Most recent<\/dt><dd><span class="muted mono">null<\/span>/);
  assert.match(html, /<dt>Enforced by servers<\/dt><dd><span class="muted mono">\[\]<\/span>/);
  assert.ok(html.includes('title="2026-10-18T12:55:49.000Z"'));
});

test('IP lookup sections escape untrusted field names and values', () => {
  const html = lookupView.renderLookupSections(ui, {
    server: '<img src=x onerror=alert(1)>',
    '<script>alert(2)</script>': { note: '<svg onload=alert(3)>' },
    risk: { reputation: null, isProxy: false },
  });
  assert.ok(!html.includes('<script>') && !html.includes('<img ') && !html.includes('<svg onload'));
  assert.ok(html.includes('&lt;img src=x onerror=alert(1)&gt;'));
  assert.ok(html.includes('&lt;script&gt;alert(2)&lt;/script&gt;'));
  assert.ok(html.includes('&lt;svg onload=alert(3)&gt;'));
});

test('allow-list table and popup expose sample-specific fields safely', () => {
  const raw = allowedSamples[0];
  const row = {
    ip: raw.cidr, cidr: `${raw.cidr}/32`, kind: 'allowed', source: raw.source,
    comment: raw.comment, addedBy: raw.addedBy, country: raw.country, city: raw.city,
    domain: '', created: '', expires: '', raw,
  };
  const columns = shared.allowlistColumns({ ui });
  assert.deepEqual(columns.map((column) => column.label), [
    'IP / CIDR', 'Source', 'Comment', 'Added by', 'Country', 'City', 'Domain', 'Added', 'Expires',
  ]);
  for (const [key, value] of [['source', 'db'], ['comment', 'Office device'], ['addedBy', 'admin@example.invalid'], ['country', 'PH'], ['city', 'Example City']]) {
    assert.ok(columns.find((column) => column.key === key).render(row).includes(value));
  }
  assert.ok(!columns.find((column) => column.key === 'comment').render({ comment: '<script>alert(1)</script>' }).includes('<script>'));
  let dialog;
  shared.showRecord({ ui: { ...ui, recordDialog(options) { dialog = options; } }, actions: { lookup() {} } }, row);
  assert.equal(dialog.record, raw);
  assert.ok(dialog.summary.some(([label, value]) => label === 'Added by' && value === raw.addedBy));
  assert.ok(dialog.summary.some(([label, value]) => label === 'Domain' && value === null));
});

test('allow-list metadata can be searched and sorted', () => {
  globalThis.localStorage = { getItem() { return null; }, setItem() {} };
  const store = storeModule.createStore({ demo: false });
  const rows = [
    { ip: '192.0.2.174', kind: 'allowed', country: 'PH', city: 'Example City', addedBy: 'Zoe', domain: 'office.example', comment: 'Office' },
    { ip: '2001:db8::10', kind: 'allowed', country: 'CA', city: 'Test City', addedBy: 'Alice', domain: 'node.example', comment: 'Monitoring' },
  ];
  store.setSnapshot({ ok: true, allowed: rows });
  assert.deepEqual(store.rows({ kind: 'allowed', query: 'city:example' }).map((row) => row.ip), ['192.0.2.174']);
  assert.deepEqual(store.rows({ kind: 'allowed', query: 'node.example' }).map((row) => row.ip), ['2001:db8::10']);
  store.setSort('addedBy');
  assert.deepEqual(store.rows({ kind: 'allowed' }).map((row) => row.addedBy), ['Alice', 'Zoe']);
});
