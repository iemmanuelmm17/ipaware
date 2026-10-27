/* IPAware Console bootstrap.
   Tabs (and their JS) are dynamically imported only when first opened. */

const cfg = JSON.parse(document.body.dataset.config || '{}');
const resolve = (path) => new URL(path, document.baseURI).href;
const assetUrl = (name) => resolve(`asset.php?f=${encodeURIComponent(name)}`);
window.IPAWARE = { cfg, resolve, assetUrl };

const [apiMod, uiMod, storeMod, tableMod, sharedMod, paletteMod] = await Promise.all([
  import(assetUrl('js/api.js')),
  import(assetUrl('js/ui.js')),
  import(assetUrl('js/store.js')),
  import(assetUrl('js/table.js')),
  import(assetUrl('js/views/shared.js')),
  import(assetUrl('js/palette.js')),
]);

const ui = uiMod;
const { qs, qsa } = ui;
const api = apiMod.createApi(cfg, resolve);
const store = storeMod.createStore(cfg);
const table = tableMod;
const shared = sharedMod;

const viewEl = qs('#view');
const routes = {
  overview: { title: 'Overview', subtitle: 'Live posture, recent activity and the combined IP table.', load: () => import(assetUrl('js/views/overview.js')).then((m) => m.create) },
  decisions: { title: 'Blocked IPs', subtitle: 'What was blocked and why — active firewall decisions.', load: () => import(assetUrl('js/views/lists.js')).then((m) => m.createDecisions) },
  allowlist: { title: 'Whitelist', subtitle: 'Allowed IPs and CIDR ranges, with comments.', load: () => import(assetUrl('js/views/lists.js')).then((m) => m.createAllowlist) },
  lookup: { title: 'IP lookup', subtitle: 'Inspect a single address and act on it immediately.', load: () => import(assetUrl('js/views/lookup.js')).then((m) => m.create) },
  events: { title: 'Live events', subtitle: 'Server-Sent Events activity log and upstream change detection.', load: () => import(assetUrl('js/views/events.js')).then((m) => m.create) },
  settings: { title: 'Settings', subtitle: 'API key, server, access control and diagnostics.', load: () => import(assetUrl('js/views/settings.js')).then((m) => m.create) },
};

const mounted = new Map();
let activeRoute = null;
let inflight = null;
let refreshTimer = null;
let fallbackTimer = null;
let stream = null;
let lastError = null;
let lastRefreshAt = 0;
let lastUpstreamErrorKey = '';

const ctx = {
  get cfg() { return api.config; },
  api, ui, store, table, shared,
  assetUrl, resolve,
  pendingLookup: null,
};

function parseHash() {
  const route = (location.hash || '').replace(/^#\/?/, '').split('?')[0];
  return routes[route] ? route : 'overview';
}

function renderActive() {
  const instance = mounted.get(activeRoute);
  try { instance?.update?.(); } catch (error) { console.error('view update failed', error); }
}

function updateChrome() {
  const config = api.config;
  const pill = qs('#connection-pill');
  let tone = 'pill--live';
  let label = 'Live API';
  if (config.demo) { tone = 'pill--demo'; label = 'Demo data'; }
  if (config.previewOnly) { tone = 'pill--demo'; label = 'Preview only'; }
  if (!config.demo && !config.hasApiKey) { tone = 'pill--demo'; label = 'API key needed'; }
  if (lastError) { tone = 'pill--error'; label = 'Connection error'; }
  pill.className = `pill ${tone}`;
  pill.innerHTML = `<span class="dot"></span>${ui.escapeHtml(label)}`;
  pill.title = lastError || (config.previewOnly ? 'Sample data only; run the PHP app for live IPAware data.' : `${config.mode} mode · ${config.keySource}`);

  qs('#client-ip').textContent = config.access?.clientIp || '—';
  const stats = store.stats();
  qs('#badge-decisions').textContent = ui.shortNumber(stats.blocked);
  qs('#badge-allowlist').textContent = ui.shortNumber(stats.allowed);
  qs('#badge-events').textContent = ui.shortNumber(store.state.events.length);

  const warnings = store.state.meta?.warnings || [];
  const errors = Object.values(store.state.meta?.errors || {});
  const message = lastError || errors[0] || warnings[0] || '';
  const messageEl = qs('#status-message');
  messageEl.textContent = message;
  messageEl.className = `status-message${lastError || errors.length ? ' is-error' : ''}`;
  qs('#last-updated').innerHTML = `${ui.icon('clock', 'icon icon--xs')} ${
    store.state.lastUpdated ? `Updated ${ui.timeAgo(new Date(store.state.lastUpdated))}` : 'Not loaded yet'
  }`;
  qs('#row-count').textContent = store.state.lastUpdated
    ? `${ui.shortNumber(stats.blocked + stats.allowed)} addresses · ${stats.latencyMs} ms · ${stats.upstream}`
    : '';

  const status = store.state.liveStatus;
  const liveToggle = qs('#live-toggle');
  liveToggle.disabled = !config.sseEnabled;
  liveToggle.checked = !!config.sseEnabled && isLive();
  liveToggle.parentElement.title = config.sseEnabled
    ? 'Server-Sent Events push updates'
    : (config.sseDisabledReason || 'Live stream disabled. Use auto-refresh instead.');
  const liveRow = qs('#live-dot').parentElement;
  liveRow.classList.toggle('is-live', status === 'live');
  qs('#live-label').textContent = !config.sseEnabled ? 'Live stream unavailable' : ({
    live: 'Live stream connected', connecting: 'Connecting…', reconnecting: 'Reconnecting…', off: 'Live stream off',
  }[status] || 'Live stream offline');
}

async function navigate(route, options = {}) {
  if (!routes[route]) route = 'overview';
  const hash = `#/${route}`;
  if (location.hash !== hash) {
    history.pushState(null, '', hash);
  }
  if (activeRoute === route && !options.force) {
    renderActive();
    return;
  }
  activeRoute = route;
  qsa('.tab').forEach((tab) => {
    const selected = tab.dataset.route === route;
    tab.setAttribute('aria-selected', String(selected));
    tab.tabIndex = selected ? 0 : -1;
  });
  qs('#page-title').textContent = routes[route].title;
  qs('#page-subtitle').textContent = routes[route].subtitle;
  document.title = `${routes[route].title} · ${api.config.appName || 'IPAware Console'}`;

  if (!mounted.has(route)) {
    table.renderSkeleton(viewEl);
    try {
      const factory = await routes[route].load();
      mounted.set(route, factory(ctx));
    } catch (error) {
      ui.toast({ title: 'Could not load this tab', message: error.message }, 'error');
      viewEl.innerHTML = ui.emptyState('Could not load this tab', error.message, 'alert');
      return;
    }
  }
  if (activeRoute !== route) return; // a newer navigation won the race
  viewEl.innerHTML = '';
  try {
    mounted.get(route).mount(viewEl);
  } catch (error) {
    ui.toast({ title: 'Tab error', message: error.message }, 'error');
    viewEl.innerHTML = ui.emptyState('Tab error', error.message, 'alert');
  }
  updateChrome();
}

async function refresh({ silent = false, reason = 'manual', force = false } = {}) {
  if (inflight && !force) return inflight;
  if (inflight) inflight.abort();
  const controller = new AbortController();
  inflight = controller;
  store.loading = true;
  const button = qs('#refresh-now');
  button.disabled = true;
  try {
    const data = await api.snapshot(controller.signal);
    store.setSnapshot(data, { silent: true });
    if (data.meta?.config) api.updateConfig(data.meta.config);
    const upstreamErrors = Object.values(store.state.meta?.errors || {});
    const errorKey = upstreamErrors.join(' | ');
    if (errorKey && (errorKey !== lastUpstreamErrorKey || (!silent && reason === 'manual'))) {
      ui.toast({ title: 'Upstream error', message: upstreamErrors[0] }, 'error');
    }
    lastUpstreamErrorKey = errorKey;
    lastError = store.state.error;
    lastRefreshAt = Date.now();
    renderActive();
    if (!silent && reason === 'manual' && !errorKey) {
      const listWarning = data.meta?.lists?.decisions?.warning || data.meta?.lists?.allowed_ips?.warning;
      if (listWarning) ui.toast({ title: 'Response needs attention', message: listWarning }, 'warning', 6000);
      else ui.toast('Lists refreshed', 'success', 1600);
    }
  } catch (error) {
    if (error?.name === 'AbortError') return;
    lastError = error.message;
    store.state.requestError = error.message;
    renderActive();
    if (!silent) ui.toast({ title: 'Refresh failed', message: error.message }, 'error', 6000);
  } finally {
    if (inflight === controller) inflight = null;
    store.loading = false;
    button.disabled = false;
    updateChrome();
  }
}

function isLive() {
  return localStorage.getItem('ipa.live') !== '0';
}

function setLive(value) {
  if (value && !api.config.sseEnabled) return;
  localStorage.setItem('ipa.live', value ? '1' : '0');
  qs('#live-toggle').checked = !!value;
  configureStream();
  configureAutoRefresh();
}

function configureAutoRefresh() {
  clearInterval(refreshTimer);
  clearInterval(fallbackTimer);
  const config = api.config;
  const select = qs('#auto-refresh');
  let seconds = Number(select.value || localStorage.getItem('ipa.autorefresh') || 30);
  if (seconds > 0 && seconds < (config.minAutoRefresh || 10)) seconds = config.minAutoRefresh;
  select.value = String(seconds);
  localStorage.setItem('ipa.autorefresh', String(seconds));
  if (seconds > 0) {
    refreshTimer = setInterval(() => {
      if (!document.hidden) refresh({ silent: true, reason: 'auto' });
    }, seconds * 1000);
  }
  if (isLive() && config.sseEnabled) {
    // Safety net: if SSE is not connected, polling still keeps the page fresh.
    const every = Math.max(30000, (config.pollSeconds || 8) * 3 * 1000);
    fallbackTimer = setInterval(() => {
      if (!document.hidden && store.state.liveStatus !== 'live') refresh({ silent: true, reason: 'fallback' });
    }, every);
  }
}

function configureStream() {
  stream?.close();
  stream = null;
  if (!isLive() || !api.config.sseEnabled) {
    store.liveStatus = 'off';
    updateChrome();
    return;
  }
  stream = api.connectStream({
    onStatus(status) {
      store.liveStatus = status;
      updateChrome();
    },
    hello() { /* initial snapshot already handled by refresh() */ },
    sync(data) {
      store.liveStats = data;
      if (data.changed > 0) refresh({ silent: true, reason: 'event' });
      else updateChrome();
    },
    activity(event) {
      store.addEvent(event);
      if (activeRoute === 'events') renderActive();
      updateChrome();
    },
    notice(data) {
      ui.toast({ title: 'Live stream', message: data.message }, data.level === 'danger' ? 'error' : 'warning', 6000);
    },
  });
}

function setQuery(value) {
  store.setQuery(value);
  const search = qs('#global-search');
  if (search.value !== value) search.value = value;
  renderActive();
}

function toggleTheme() {
  const next = document.documentElement.dataset.theme === 'light' ? 'dark' : 'light';
  document.documentElement.dataset.theme = next;
  localStorage.setItem('ipa.theme', next);
  qs('#theme-toggle').innerHTML = ui.icon(next === 'dark' ? 'sun' : 'moon');
}

function applyTheme() {
  const theme = localStorage.getItem('ipa.theme') || 'dark';
  document.documentElement.dataset.theme = theme;
  qs('#theme-toggle').innerHTML = ui.icon(theme === 'dark' ? 'sun' : 'moon');
}

async function runAction(fn, successMessage) {
  try {
    const result = await fn();
    if (successMessage) ui.toast(successMessage, 'success', 2600);
    await refresh({ silent: true, reason: 'action', force: true });
    return result === undefined ? true : result;
  } catch (error) {
    ui.toast({ title: 'Action failed', message: error.message }, 'error', 6500);
    return false;
  }
}

const actions = {
  lookup(ip) {
    if (!ip) { navigate('lookup'); return; }
    if (activeRoute === 'lookup' && mounted.get('lookup')?.lookup) {
      mounted.get('lookup').lookup(ip);
      return;
    }
    ctx.pendingLookup = ip;
    navigate('lookup');
  },
  block(ip = '') {
    return ui.formDialog({
      title: 'Block an IP address',
      message: `POST ${api.config.endpoints?.block || '/ipaware/firewall/block'}?ip=…&reason=…&duration=…`,
      iconName: 'lock', danger: true, submitText: 'Block IP',
      fields: [
        { name: 'ip', label: 'IP address', value: ip, required: true, mono: true, placeholder: '37.18.129.253', hint: 'IPv4 or IPv6 address' },
        { name: 'reason', label: 'Reason', value: 'manual block from console', placeholder: 'Why is this address blocked?' },
        { name: 'duration', label: 'Duration', type: 'select', value: '4h', options: [
          { value: '1h', label: '1 hour' }, { value: '4h', label: '4 hours' },
          { value: '24h', label: '24 hours' }, { value: '7d', label: '7 days' }, { value: '30d', label: '30 days' },
        ] },
      ],
    }).then(async (data) => {
      if (!data) return false;
      if (!ui.isIp(data.ip)) { ui.toast('Enter a valid IPv4 or IPv6 address', 'error'); return false; }
      return runAction(() => api.block(data), `Blocked ${data.ip}`);
    });
  },
  unblock(ip) {
    return ui.confirmDialog({
      title: `Release ${ip}?`, iconName: 'unlock', confirmText: 'Release IP',
      message: `This removes the active firewall decision for ${ip} via POST ${api.config.endpoints?.unblock || '/ipaware/firewall/unblock'}?ip=...`,
    }).then((ok) => ok ? runAction(() => api.unblock(ip), `Released ${ip}`) : false);
  },
  allow(cidr = '', comment) {
    // Whitelist tab passes the comment explicitly (even an empty one) -> no dialog.
    if (comment !== undefined) return runAction(() => api.allow({ cidr, comment }), `Allow-listed ${cidr}`);
    return ui.formDialog({
      title: 'Add to allow list',
      message: `POST ${api.config.endpoints?.allowlist || '/ipaware/allowed_ips'}?cidr=…&comment=…`,
      iconName: 'plus', submitText: 'Add entry',
      fields: [
        { name: 'cidr', label: 'IP or CIDR range', value: cidr, required: true, mono: true, placeholder: '37.18.129.253', hint: 'IPv4/IPv6 address or CIDR' },
        { name: 'comment', label: 'Comment', value: 'tango', placeholder: 'e.g. office HQ' },
      ],
    }).then(async (data) => {
      if (!data) return false;
      if (!ui.isIpOrCidr(data.cidr)) { ui.toast('Enter a valid IP or CIDR range', 'error'); return false; }
      return runAction(() => api.allow(data), `Allow-listed ${data.cidr}`);
    });
  },
  unallow(cidr) {
    return ui.confirmDialog({
      title: `Remove ${cidr} from allow list?`, iconName: 'trash', danger: true, confirmText: 'Remove',
      message: `Uses ${api.config.allowlistDeleteMethod || 'DELETE'} ${api.config.endpoints?.allowlist || '/ipaware/allowed_ips'}?cidr=...`,
    }).then((ok) => ok ? runAction(() => api.unallow(cidr), `Removed ${cidr}`) : false);
  },
  async export(format = 'xlsx', type = 'all') {
    try {
      const result = await api.exportFile({ format, type, q: store.state.query });
      ui.download(result.blob, result.filename);
      ui.toast({ title: result.fallback ? 'Exported as CSV' : `Exported ${result.filename}`, message: result.fallback ? 'PHP zip extension is missing, so a CSV fallback was generated.' : 'Excel-compatible file downloaded.' }, 'success', 4500);
      return true;
    } catch (error) {
      ui.toast({ title: 'Export failed', message: error.message }, 'error', 6000);
      return false;
    }
  },
  async saveCredentials(key, server) {
    try {
      const response = await api.setKey(key, server || '');
      if (response.config) api.updateConfig(response.config);
      ui.toast(response.message || 'Saved', 'success');
      configureStream();
      await refresh({ silent: true, force: true });
      return true;
    } catch (error) {
      ui.toast(error.message, 'error');
      return false;
    }
  },
  async clearCredentials() {
    try {
      const response = await api.clearKey();
      if (response.config) api.updateConfig(response.config);
      ui.toast(response.message || 'Session credentials cleared', 'success');
      configureStream();
      await refresh({ silent: true, force: true });
      return true;
    } catch (error) {
      ui.toast(error.message, 'error');
      return false;
    }
  },
};

Object.assign(ctx, {
  actions, refresh, navigate, renderActive, updateChrome,
  setQuery, setLive, isLive, toggleTheme,
  openPalette: (initial = '') => paletteMod.openPalette(ctx, initial),
});

function bindChrome() {
  qsa('.tab').forEach((tab, index, all) => {
    tab.addEventListener('click', () => navigate(tab.dataset.route));
    tab.addEventListener('keydown', (event) => {
      if (!['ArrowDown', 'ArrowUp', 'ArrowRight', 'ArrowLeft'].includes(event.key)) return;
      event.preventDefault();
      const delta = ['ArrowDown', 'ArrowRight'].includes(event.key) ? 1 : -1;
      const next = all[(index + delta + all.length) % all.length];
      next.focus();
      navigate(next.dataset.route);
    });
  });

  qs('#global-search').addEventListener('input', ui.debounce((event) => setQuery(event.target.value), 200));
  qs('#global-search').addEventListener('keydown', (event) => {
    if (event.key !== 'Enter') return;
    const value = event.target.value.trim();
    if (ui.isIp(value) || ui.isIpOrCidr(value)) {
      actions.lookup(value.split('/')[0]);
    } else {
      ctx.openPalette(value);
    }
  });

  qs('#refresh-now').addEventListener('click', () => refresh());
  qs('#palette-trigger').addEventListener('click', () => ctx.openPalette());
  qs('#theme-toggle').addEventListener('click', toggleTheme);
  qs('#live-toggle').addEventListener('change', (event) => setLive(event.target.checked));
  qs('#auto-refresh').addEventListener('change', () => {
    configureAutoRefresh();
    ui.toast(`Auto-refresh: ${qs('#auto-refresh').selectedOptions[0].textContent}`, 'info', 1800);
  });

  const exportTrigger = qs('#export-trigger');
  const exportMenu = qs('#export-menu');
  exportTrigger.addEventListener('click', (event) => {
    event.stopPropagation();
    exportMenu.hidden = !exportMenu.hidden;
    exportTrigger.setAttribute('aria-expanded', String(!exportMenu.hidden));
  });
  exportMenu.addEventListener('click', (event) => {
    const button = event.target.closest('[data-export]');
    if (!button) return;
    exportMenu.hidden = true;
    exportTrigger.setAttribute('aria-expanded', 'false');
    actions.export(button.dataset.export, button.dataset.type);
  });
  document.addEventListener('click', (event) => {
    if (!qs('#export-dropdown').contains(event.target)) {
      exportMenu.hidden = true;
      exportTrigger.setAttribute('aria-expanded', 'false');
    }
  });

  window.addEventListener('hashchange', () => navigate(parseHash()));
  window.addEventListener('popstate', () => navigate(parseHash()));
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden && Date.now() - lastRefreshAt > 60000) refresh({ silent: true, reason: 'visibility' });
  });

  document.addEventListener('keydown', (event) => {
    const typing = ['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement?.tagName);
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
      event.preventDefault();
      ctx.openPalette();
      return;
    }
    if (typing || event.ctrlKey || event.metaKey || event.altKey) return;
    if (event.key === '/') { event.preventDefault(); qs('#global-search').focus(); qs('#global-search').select(); }
    if (event.key.toLowerCase() === 'r') { event.preventDefault(); refresh(); }
    if (event.key === '?') {
      event.preventDefault();
      ui.jsonDialog('Keyboard shortcuts', [
        'Ctrl+K / Cmd+K  -  quick actions (search actions and tabs)',
        '/                -  focus global IP search',
        'R                -  refresh lists now',
        '?                -  this help',
        'Arrow keys       -  move between tabs when a tab is focused',
        'Escape           -  close a toast, dialog or palette',
      ].join('\n'));
    }
  });
}

applyTheme();
bindChrome();
qs('#live-toggle').checked = isLive();
qs('#auto-refresh').value = localStorage.getItem('ipa.autorefresh') || '30';
navigate(parseHash());
refresh({ silent: true, reason: 'initial' });
configureAutoRefresh();
configureStream();
updateChrome();
setInterval(updateChrome, 15000);
