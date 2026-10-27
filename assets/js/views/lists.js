/* Blocked IPs and Whitelist tabs (loaded on demand). */

function tableCard(ctx, { kind, title, subtitle, extraHead = '' }) {
  return `
    <section class="card">
      <div class="card-head">
        <div><h2>${title}</h2><p>${subtitle}</p></div>
        <div class="card-head-actions">${extraHead}</div>
      </div>
      <div class="table-tools">
        <label class="search-mini">${ctx.ui.icon('search')}<input type="search" data-q placeholder="Search this list…" autocomplete="off"></label>
        <span class="muted tiny" data-count></span>
        <span class="spacer"></span>
        ${kind === 'blocked'
          ? `<button class="btn btn--xs" type="button" data-add="block">${ctx.ui.icon('lock')} Block IP</button>`
          : `<button class="btn btn--xs" type="button" data-add="allow">${ctx.ui.icon('plus')} Add entry</button>`}
        <button class="btn btn--xs" type="button" data-export>${ctx.ui.icon('download')} Export</button>
      </div>
      <div data-table></div>
    </section>`;
}

function bind(ctx, el, kind, update) {
  el.addEventListener('click', (event) => {
    if (event.target.closest('[data-add="block"]')) return ctx.actions.block('');
    if (event.target.closest('[data-add="allow"]')) return ctx.actions.allow('');
    if (event.target.closest('[data-export]')) return ctx.actions.export('xlsx', kind === 'blocked' ? 'blocked' : 'allowed');
  });
  el.addEventListener('input', ctx.ui.debounce((event) => {
    if (event.target.matches('[data-q]')) ctx.setQuery(event.target.value);
  }, 180));
}

function renderTable(ctx, el, kind) {
  const rows = ctx.store.rows({ kind, query: ctx.store.state.query, sort: ctx.store.state.sort });
  const count = el.querySelector('[data-count]');
  if (count) count.textContent = `${rows.length.toLocaleString()} row${rows.length === 1 ? '' : 's'}`;
  const q = el.querySelector('[data-q]');
  if (q && q.value !== ctx.store.state.query) q.value = ctx.store.state.query;
  ctx.table.renderTable(el.querySelector('[data-table]'), {
    rows,
    columns: ctx.shared.rowColumns(ctx, { showType: kind === 'allowed' }),
    actions: ctx.shared.rowActions(ctx),
    onAction: (id, row) => ctx.shared.handleRowAction(ctx, id, row),
    onRowClick: (row) => ctx.shared.showRecord(ctx, row),
    onSort: (key) => { ctx.store.setSort(key); renderTable(ctx, el, kind); },
    sort: ctx.store.state.sort,
    chunk: ctx.store.state.chunkSize,
    emptyTitle: ctx.store.state.meta?.errors?.[kind === 'blocked' ? 'decisions' : 'allowed_ips']
      ? 'Upstream list unavailable'
      : 'No matching addresses',
    emptyMessage: ctx.store.state.meta?.errors?.[kind === 'blocked' ? 'decisions' : 'allowed_ips']
      || (ctx.store.state.query ? 'Try another search term.' : 'Press Refresh to load data.'),
    footerNote: 'Rows stream in as you scroll',
  });
}

export function createDecisions(ctx) {
  let el = null;
  function mount(container) {
    el = container;
    el.innerHTML = `
      <div class="grid-2" style="margin-bottom:16px">
        <section class="card"><div class="card-head"><div><h2>Top reasons</h2><p>What is triggering blocks right now</p></div></div>
          <div class="card-body" data-reasons></div></section>
        <section class="card"><div class="card-head"><div><h2>Quick reference</h2><p>Endpoints used by this tab</p></div></div>
          <div class="card-body">
            <dl class="kv">
              <dt>List decisions</dt><dd>GET ${ctx.ui.escapeHtml(ctx.cfg.endpoints.decisions)}</dd>
              <dt>Release IP</dt><dd>POST ${ctx.ui.escapeHtml(ctx.cfg.endpoints.unblock)}?ip=…</dd>
              <dt>Block IP</dt><dd>POST ${ctx.ui.escapeHtml(ctx.cfg.endpoints.block)}?ip=…</dd>
              <dt>Look up</dt><dd>GET ${ctx.ui.escapeHtml(ctx.cfg.endpoints.ip)}/{ip}</dd>
            </dl>
            <div class="notice notice--info" style="margin-top:14px">${ctx.ui.icon('info')}
              <span>Block and allow-list endpoints are configurable in <code class="mono">.env</code>. The unblock, decisions and allow-list list calls match your curl examples.</span></div>
          </div></section>
      </div>
      ${tableCard(ctx, { kind: 'blocked', title: 'Blocked IP addresses', subtitle: 'What was blocked and why — active firewall decisions.' })}`;
    bind(ctx, el, 'blocked', update);
    update();
  }

  function update() {
    if (!el) return;
    const rows = ctx.store.state.decisions;
    const groups = new Map();
    rows.forEach((row) => {
      const key = row.scenario || row.reason || 'Unspecified';
      groups.set(key, (groups.get(key) || 0) + 1);
    });
    const top = [...groups.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6);
    const max = Math.max(1, ...top.map(([, n]) => n));
    el.querySelector('[data-reasons]').innerHTML = top.length
      ? top.map(([label, n]) => `<div style="margin-bottom:11px">
          <div class="row" style="justify-content:space-between;font-size:12px"><span class="truncate">${ctx.ui.escapeHtml(label)}</span><span class="mono muted">${n}</span></div>
          <div class="lazy-progress" style="width:100%;margin-top:5px"><i style="width:${Math.round((n / max) * 100)}%;background:var(--red)"></i></div>
        </div>`).join('')
      : ctx.ui.emptyState('No decisions', 'Blocked IPs will appear here once the upstream responds.', 'ban');
    renderTable(ctx, el, 'blocked');
  }

  return { mount, update };
}

export function createAllowlist(ctx) {
  let el = null;
  function mount(container) {
    el = container;
    el.innerHTML = `
      <section class="card" style="margin-bottom:16px">
        <div class="card-head"><div><h2>Add to allow list</h2><p>POST to ${ctx.ui.escapeHtml(ctx.cfg.endpoints.allowlist)}?cidr=…&amp;comment=…</p></div></div>
        <form class="card-body" data-add-form>
          <div class="cmd-vars">
            <div class="field"><label for="allow-cidr">IP or CIDR</label><input class="input input--mono" id="allow-cidr" name="cidr" placeholder="37.18.129.253 or 10.0.0.0/24" required></div>
            <div class="field"><label for="allow-comment">Comment</label><input class="input" id="allow-comment" name="comment" placeholder="tango" maxlength="200"></div>
            <div class="field"><label>&nbsp;</label><button class="btn btn--primary" type="submit">${ctx.ui.icon('plus')} Add entry</button></div>
          </div>
          <p class="hint muted">IPv4 and IPv6 are supported. This also releases the address if it is currently blocked.</p>
        </form>
      </section>
      ${tableCard(ctx, { kind: 'allowed', title: 'Whitelisted IP addresses', subtitle: 'Allowed IPs and CIDR ranges from the upstream allow list.' })}`;
    bind(ctx, el, 'allowed', update);
    el.querySelector('[data-add-form]').addEventListener('submit', async (event) => {
      event.preventDefault();
      const form = event.currentTarget;
      const cidr = form.elements.cidr.value.trim();
      const comment = form.elements.comment.value.trim();
      if (!ctx.ui.isIpOrCidr(cidr)) {
        ctx.ui.toast('Enter a valid IPv4/IPv6 address or CIDR range', 'error');
        return;
      }
      const ok = await ctx.actions.allow(cidr, comment);
      if (ok) form.reset();
    });
    update();
  }

  function update() {
    if (!el) return;
    renderTable(ctx, el, 'allowed');
  }

  return { mount, update };
}
