/* Overview: stats, event chart, and the combined blocked + whitelisted table. */

export function create(ctx) {
  let el = null;

  function mount(container) {
    el = container;
    el.innerHTML = `
      <div class="stat-grid" data-stats></div>
      <div class="grid-2" style="margin-top:16px">
        <section class="card">
          <div class="card-head"><div><h2>Recent activity</h2><p>From the live event stream and your own actions</p></div>
            <button class="btn btn--xs" type="button" data-go="events">${ctx.ui.icon('activity')} All events</button></div>
          <div class="timeline" data-events></div>
        </section>
        <section class="card">
          <div class="card-head"><div><h2>Event volume</h2><p>Last 12 hours, live from the event log</p></div>
            <span class="badge badge--blue" data-events-total>0 events</span></div>
          <div class="card-body"><div data-chart></div>
            <div class="row" style="justify-content:space-between;margin-top:8px;color:var(--muted);font-size:11px">
              <span>12h ago</span><span>now</span></div>
            <div class="row" style="margin-top:16px">
              <button class="btn btn--xs" type="button" data-quick="block">${ctx.ui.icon('lock')} Block IP</button>
              <button class="btn btn--xs" type="button" data-quick="allow">${ctx.ui.icon('plus')} Add to allow list</button>
              <button class="btn btn--xs" type="button" data-quick="lookup">${ctx.ui.icon('search')} IP lookup</button>
              <button class="btn btn--xs" type="button" data-quick="export">${ctx.ui.icon('download')} Export Excel</button>
            </div>
          </div>
        </section>
      </div>
      <section class="card" style="margin-top:16px">
        <div class="card-head">
          <div><h2>Blocked &amp; whitelisted addresses</h2><p>One searchable table. Rows load lazily as you scroll.</p></div>
          <div class="segmented" data-kinds>
            <button type="button" data-kind="all">All</button>
            <button type="button" data-kind="blocked">Blocked</button>
            <button type="button" data-kind="allowed">Whitelisted</button>
          </div>
        </div>
        <div class="table-tools">
          <label class="search-mini">${ctx.ui.icon('search')}<input type="search" data-q placeholder="Filter by IP, CIDR, reason, scenario, source…" autocomplete="off"></label>
          <span class="muted tiny">Try <code class="mono">kind:allowed</code> or <code class="mono">ip:37.18</code></span>
          <span class="spacer"></span>
          <button class="btn btn--xs" type="button" data-export>${ctx.ui.icon('download')} Export this view</button>
        </div>
        <div data-table></div>
      </section>`;

    el.addEventListener('click', async (event) => {
      const go = event.target.closest('[data-go]');
      if (go) return ctx.navigate(go.dataset.go);
      const quick = event.target.closest('[data-quick]');
      if (quick) {
        const action = quick.dataset.quick;
        if (action === 'block') return ctx.actions.block('');
        if (action === 'allow') return ctx.actions.allow('');
        if (action === 'lookup') return ctx.navigate('lookup');
        if (action === 'export') return ctx.actions.export('xlsx', 'all');
      }
      const kind = event.target.closest('[data-kind]');
      if (kind) { ctx.store.setKind(kind.dataset.kind); update(); return; }
      if (event.target.closest('[data-export]')) return ctx.actions.export('xlsx', ctx.store.state.kind === 'all' ? 'all' : ctx.store.state.kind);
    });
    el.addEventListener('input', ctx.ui.debounce((event) => {
      if (event.target.matches('[data-q]')) ctx.setQuery(event.target.value);
    }, 180));
    update();
  }

  function update() {
    if (!el) return;
    const { ui, store } = ctx;
    const stats = store.stats();
    const cards = [
      { label: 'Blocked IPs', value: stats.blocked, tone: 'red', icon: 'ban', hint: 'Active firewall decisions' },
      { label: 'Whitelisted', value: stats.allowed, tone: 'green', icon: 'check-circle', hint: 'IPs and CIDR ranges' },
      { label: 'Events (24h)', value: stats.events24h, tone: 'blue', icon: 'activity', hint: 'Logged changes and actions' },
      { label: 'Upstream latency', value: `${stats.latencyMs} ms`, tone: 'amber', icon: 'zap', hint: stats.upstream === 'demo' ? 'Demo upstream' : 'Live API response' },
    ];
    el.querySelector('[data-stats]').innerHTML = cards.map((c) => `
      <div class="stat-card stat-card--${c.tone}">
        <div class="stat-card__label">${ui.icon(c.icon)} ${ui.escapeHtml(c.label)}</div>
        <div class="stat-card__value">${ui.escapeHtml(typeof c.value === 'number' ? ui.shortNumber(c.value) : c.value)}</div>
        <div class="stat-card__hint">${ui.escapeHtml(c.hint)}</div>
      </div>`).join('');

    el.querySelector('[data-events]').innerHTML = ctx.shared.renderEventTimeline(ctx, store.state.events, 7);
    el.querySelector('[data-events-total]').textContent = `${store.state.events.length} recent`;
    el.querySelector('[data-chart]').innerHTML = ui.sparkline(store.eventBuckets(12));

    el.querySelectorAll('[data-kind]').forEach((button) => {
      button.classList.toggle('is-active', button.dataset.kind === store.state.kind);
    });
    const qInput = el.querySelector('[data-q]');
    if (qInput && qInput.value !== store.state.query) qInput.value = store.state.query;

    const rows = store.rows({ kind: store.state.kind, query: store.state.query, sort: store.state.sort });
    ctx.table.renderTable(el.querySelector('[data-table]'), {
      rows,
      columns: ctx.shared.rowColumns(ctx),
      actions: ctx.shared.rowActions(ctx),
      onAction: (id, row) => ctx.shared.handleRowAction(ctx, id, row),
      onSort: (key) => { store.setSort(key); update(); },
      sort: store.state.sort,
      chunk: store.state.chunkSize,
      emptyTitle: store.state.query ? 'No matching addresses' : 'No addresses loaded',
      emptyMessage: store.state.query ? 'Clear the search or try a different field filter.' : 'Press Refresh or check your API key in Settings.',
      footerNote: `Lazy loaded ${Math.min(store.state.chunkSize, rows.length)} rows at a time`,
    });
  }

  return { mount, update };
}
