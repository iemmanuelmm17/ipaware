/* Ctrl+K quick actions: search navigation and common actions. */

export function openPalette(ctx, initial = '') {
  const root = document.querySelector('#palette-root');
  if (!root || root.querySelector('.palette-backdrop')) return;
  const { ui } = ctx;

  const items = [];
  const nav = [
    ['overview', 'Overview', 'grid', 'dashboard stats combined table'],
    ['decisions', 'Blocked IPs', 'ban', 'decisions bans what was blocked why'],
    ['allowlist', 'Whitelist', 'check-circle', 'allow list allowed ips cidr'],
    ['lookup', 'IP lookup', 'search', 'inspect ip address details'],
    ['events', 'Live events', 'activity', 'stream log activity sse'],
    ['settings', 'Settings', 'settings', 'api key server env access control'],
  ];
  nav.forEach(([route, title, ico, keywords]) => items.push({
    id: `nav-${route}`, group: 'Navigate', title, icon: ico,
    subtitle: `Open the ${title} tab`, keywords,
    run: () => ctx.navigate(route),
  }));

  const actions = [
    { id: 'refresh', group: 'Actions', title: 'Refresh lists now', icon: 'refresh', subtitle: 'Re-read decisions and allow list from upstream', keywords: 'reload sync update', run: () => ctx.refresh() },
    { id: 'export', group: 'Actions', title: 'Export to Excel', icon: 'download', subtitle: 'Download the current IP lists as .xlsx', keywords: 'xlsx csv export excel', run: () => ctx.actions.export('xlsx', 'all') },
    { id: 'block', group: 'Actions', title: 'Block an IP', icon: 'lock', subtitle: 'Create a firewall decision', keywords: 'ban deny firewall', run: () => ctx.actions.block('') },
    { id: 'allow', group: 'Actions', title: 'Add to allow list', icon: 'plus', subtitle: 'Whitelist an IP or CIDR', keywords: 'allowlist whitelist permit', run: () => ctx.actions.allow('') },
    ...(ctx.cfg.sseEnabled ? [{ id: 'live', group: 'Actions', title: 'Toggle live events', icon: 'zap', subtitle: 'Enable/disable the SSE stream', keywords: 'sse stream realtime', run: () => ctx.setLive(!ctx.isLive()) }] : []),
    ...(!ctx.cfg.previewOnly ? [{ id: 'test', group: 'Actions', title: 'Test API connection', icon: 'server', subtitle: 'Ping the upstream decisions endpoint', keywords: 'ping check connection api key', run: async () => {
      try { const r = await ctx.api.test(); ui.toast({ title: r.test?.message || r.message, message: `HTTP ${r.test?.status} · ${r.test?.latencyMs} ms` }, 'success'); }
      catch (e) { ui.toast(e.message, 'error'); }
    } }] : []),
    { id: 'theme', group: 'Actions', title: 'Toggle theme', icon: 'moon', subtitle: 'Switch between dark and light', keywords: 'dark light appearance', run: () => ctx.toggleTheme() },
  ];
  items.push(...actions);

  let query = initial || '';
  let activeIndex = 0;
  let filtered = [];

  const backdrop = document.createElement('div');
  backdrop.className = 'palette-backdrop';
  backdrop.innerHTML = `
    <div class="palette" role="dialog" aria-modal="true" aria-label="Quick actions">
      <div class="palette-input-wrap">${ui.icon('command')}<input type="text" placeholder="Search actions, tabs, IPs…" autocomplete="off" spellcheck="false"><kbd>ESC</kbd></div>
      <div class="palette-results" data-results></div>
      <div class="palette-foot"><span>↑↓ navigate</span><span>↵ run</span><span>esc close</span><span class="spacer" style="flex:1"></span><span>${items.length} actions and tabs</span></div>
    </div>`;
  root.appendChild(backdrop);
  document.body.classList.add('modal-open');
  const input = backdrop.querySelector('input');
  const results = backdrop.querySelector('[data-results]');
  input.value = query;

  function score(item, q) {
    if (!q) return 1;
    const title = item.title.toLowerCase();
    const hay = `${title} ${item.keywords || ''} ${item.subtitle || ''}`.toLowerCase();
    if (title.includes(q)) return 3;
    if (hay.includes(q)) return 2;
    const words = q.split(/\s+/);
    return words.every((w) => hay.includes(w)) ? 1 : 0;
  }

  function render() {
    const q = query.trim().toLowerCase();
    filtered = items.filter((item) => score(item, q) > 0);
    if (q && ui.isIp(q)) {
      filtered.unshift({
        id: 'dynamic-lookup', group: 'IP address', title: `Look up ${q}`, icon: 'search',
        subtitle: 'Open IP lookup with this address', keywords: q,
        run: () => ctx.actions.lookup(q),
      });
    }
    activeIndex = Math.min(activeIndex, Math.max(0, filtered.length - 1));
    let lastGroup = '';
    results.innerHTML = filtered.length
      ? filtered.map((item, index) => {
        const groupHeader = item.group !== lastGroup ? `<div class="palette-group">${ui.escapeHtml(item.group)}</div>` : '';
        lastGroup = item.group;
        return `${groupHeader}<button class="palette-item ${index === activeIndex ? 'is-active' : ''}" type="button" data-index="${index}">
          ${ui.icon(item.icon)}<span><strong>${ui.escapeHtml(item.title)}</strong><small>${ui.escapeHtml(item.subtitle || '')}</small></span>
          ${index === activeIndex ? '<kbd>↵</kbd>' : ''}</button>`;
      }).join('')
      : ui.emptyState('No matches', 'Try “unblock”, “export”, “allow list” or a tab name.', 'command');
    results.querySelector('.is-active')?.scrollIntoView({ block: 'nearest' });
  }

  function close() {
    document.removeEventListener('keydown', onKey);
    document.body.classList.remove('modal-open');
    backdrop.remove();
  }

  async function run(index) {
    const item = filtered[index];
    if (!item) return;
    close();
    try { await item.run(); } catch (e) { ui.toast(e.message, 'error'); }
  }

  function onKey(event) {
    if (event.key === 'Escape') { event.preventDefault(); close(); return; }
    if (event.key === 'ArrowDown') { event.preventDefault(); activeIndex = Math.min(filtered.length - 1, activeIndex + 1); render(); return; }
    if (event.key === 'ArrowUp') { event.preventDefault(); activeIndex = Math.max(0, activeIndex - 1); render(); return; }
    if (event.key === 'Enter') { event.preventDefault(); run(activeIndex); }
  }

  input.addEventListener('input', () => { query = input.value; activeIndex = 0; render(); });
  results.addEventListener('click', (event) => {
    const button = event.target.closest('[data-index]');
    if (button) run(Number(button.dataset.index));
  });
  backdrop.addEventListener('click', (event) => { if (event.target === backdrop) close(); });
  document.addEventListener('keydown', onKey);
  render();
  input.focus();
  input.select();
}
