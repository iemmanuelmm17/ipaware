/* Live events tab: tails the SSE activity log with filters, pause and clear. */

export function create(ctx) {
  let el = null;
  let paused = false;
  let query = '';
  let type = '';
  let severity = '';
  let loaded = 0;

  function mount(container) {
    el = container;
    el.innerHTML = `
      <div class="grid-2" style="margin-bottom:16px">
        <section class="card"><div class="card-head"><div><h2>Event stream</h2>
          <p>Changes are pushed from <code class="mono">stream.php</code> via Server-Sent Events.</p></div>
          <span class="pill pill--muted" data-live><span class="dot"></span><span data-live-text>Offline</span></span></div>
          <div class="card-body"><div data-chart></div>
            <div class="row" style="justify-content:space-between;margin-top:6px;color:var(--muted);font-size:11px"><span>12h ago</span><span>now</span></div>
            <div class="row" style="margin-top:14px">
              <span class="badge badge--blue" data-total>0 events</span>
              <span class="badge badge--green" data-new>live</span>
              <span class="spacer"></span>
              <button class="btn btn--xs" type="button" data-load>${ctx.ui.icon('download')} Load history</button>
            </div>
          </div></section>
        <section class="card"><div class="card-head"><div><h2>How updates work</h2><p>Three layers keep the page fresh</p></div></div>
          <div class="card-body"><dl class="kv">
            <dt>Live events</dt><dd>SSE stream.php — pushes activity + upstream changes</dd>
            <dt>Change detection</dt><dd>Every ${ctx.cfg.pollSeconds || 8}s the server re-reads decisions + allow list</dd>
            <dt>Auto-refresh</dt><dd>Full snapshot on the interval you choose in the toolbar</dd>
            <dt>Fallback</dt><dd>If SSE is blocked, polling still updates the tables</dd>
          </dl>
          <div class="notice notice--info" style="margin-top:14px">${ctx.ui.icon('info')}
            <span>Event log is stored in <code class="mono">data/events.jsonl</code>. No event contains your API key.</span></div>
          </div></section>
      </div>
      <section class="card">
        <div class="card-head"><div><h2>Activity log</h2><p>Newest first. Filter by text, type or severity.</p></div>
          <div class="card-head-actions">
            <button class="btn btn--xs" type="button" data-pause>${ctx.ui.icon('pause')} <span>Pause</span></button>
            <button class="btn btn--xs" type="button" data-copy>${ctx.ui.icon('copy')} Copy JSON</button>
            <button class="btn btn--xs btn--danger" type="button" data-clear>${ctx.ui.icon('trash')} Clear</button>
          </div></div>
        <div class="event-filters">
          <label class="search-mini">${ctx.ui.icon('search')}<input type="search" data-q placeholder="Search events…" autocomplete="off"></label>
          <select class="select" data-type><option value="">All types</option></select>
          <select class="select" data-severity><option value="">All severities</option>
            <option value="info">Info</option><option value="success">Success</option>
            <option value="warning">Warning</option><option value="danger">Danger</option></select>
          <span class="spacer"></span><span class="muted tiny" data-match></span>
        </div>
        <div data-list></div>
      </section>`;

    el.addEventListener('input', ctx.ui.debounce((event) => {
      if (event.target.matches('[data-q]')) { query = event.target.value; render(); }
    }, 160));
    el.addEventListener('change', (event) => {
      if (event.target.matches('[data-type]')) { type = event.target.value; render(); }
      if (event.target.matches('[data-severity]')) { severity = event.target.value; render(); }
    });
    el.addEventListener('click', async (event) => {
      if (event.target.closest('[data-pause]')) {
        paused = !paused;
        updatePauseButton();
        if (!paused) render();
        return;
      }
      if (event.target.closest('[data-load]')) return loadHistory();
      if (event.target.closest('[data-copy]')) {
        const ok = await ctx.ui.copy(JSON.stringify(filtered(), null, 2));
        ctx.ui.toast(ok ? 'Filtered events copied as JSON' : 'Copy failed', ok ? 'success' : 'error', 1800);
        return;
      }
      if (event.target.closest('[data-clear]')) {
        const ok = await ctx.ui.confirmDialog({
          title: 'Clear the event log?', danger: true, confirmText: 'Clear events',
          message: 'This removes data/events.jsonl on the server. IP lists are not affected.',
        });
        if (!ok) return;
        try {
          await ctx.api.clearEvents();
          ctx.store.setEvents([]);
          ctx.ui.toast('Event log cleared', 'success');
          render();
        } catch (e) { ctx.ui.toast(e.message, 'error'); }
      }
    });
    loadHistory();
    render();
  }

  async function loadHistory() {
    try {
      const response = await ctx.api.events({ limit: 500 });
      ctx.store.setEvents(response.events || []);
      loaded = (response.events || []).length;
      render();
    } catch (e) {
      ctx.ui.toast(e.message, 'error');
    }
  }

  function filtered() {
    const q = query.trim().toLowerCase();
    return ctx.store.state.events.filter((event) => {
      if (type && event.type !== type) return false;
      if (severity && event.severity !== severity) return false;
      if (!q) return true;
      return [event.message, event.type, event.ip, JSON.stringify(event.meta || {})]
        .join(' ').toLowerCase().includes(q);
    });
  }

  function updatePauseButton() {
    const button = el?.querySelector('[data-pause]');
    if (button) button.innerHTML = `${ctx.ui.icon(paused ? 'play' : 'pause')} <span>${paused ? 'Resume' : 'Pause'}</span>`;
    const badge = el?.querySelector('[data-new]');
    if (badge) {
      badge.textContent = paused ? 'paused' : 'live';
      badge.className = `badge badge--${paused ? 'amber' : 'green'}`;
    }
  }

  function render() {
    if (!el || paused) return;
    const { ui, store } = ctx;
    const events = filtered();
    const all = store.state.events;
    const types = [...new Set(all.map((e) => e.type).filter(Boolean))].sort();
    const typeSelect = el.querySelector('[data-type]');
    const currentType = type;
    typeSelect.innerHTML = `<option value="">All types</option>${types.map((t) => `<option value="${ui.escapeHtml(t)}" ${t === currentType ? 'selected' : ''}>${ui.escapeHtml(t)}</option>`).join('')}`;
    const qInput = el.querySelector('[data-q]');
    if (qInput && qInput.value !== query) qInput.value = query;
    el.querySelector('[data-severity]').value = severity;
    el.querySelector('[data-match]').textContent = `${events.length} of ${all.length} events${loaded ? ` · ${loaded} loaded from server` : ''}`;
    el.querySelector('[data-total]').textContent = `${all.length} events`;
    el.querySelector('[data-chart]').innerHTML = ui.sparkline(store.eventBuckets(12));

    const status = store.state.liveStatus;
    const pill = el.querySelector('[data-live]');
    pill.className = `pill ${status === 'live' ? 'pill--live' : 'pill--muted'}`;
    el.querySelector('[data-live-text]').textContent = {
      live: 'Streaming', connecting: 'Connecting…', reconnecting: 'Reconnecting…', off: 'Disabled',
    }[status] || 'Offline';
    updatePauseButton();

    el.querySelector('[data-list]').innerHTML = `<div class="timeline" style="max-height:none">${events.length
      ? events.slice(0, 400).map((event) => `
        <div class="timeline-item sev-${ui.escapeHtml(event.severity || 'info')}">
          <span class="marker"></span>
          <div><div class="msg">${ui.escapeHtml(event.message)}</div>
            <div class="meta"><span>${ui.badge(event.type || 'event', 'muted')}</span>
              ${event.ip ? `<span class="mono">${ui.escapeHtml(event.ip)}</span>` : ''}
              <span>${ui.escapeHtml(ui.timeAgo(event.ts))}</span>
              ${event.meta?.detectedBy ? `<span>via ${ui.escapeHtml(event.meta.detectedBy)}</span>` : ''}</div></div>
          <span class="timeline-time" title="${ui.escapeHtml(ui.fmtDate(event.ts))}">${ui.escapeHtml(ui.fmtDate(event.ts))}</span>
        </div>`).join('')
      : ui.emptyState('No matching events', 'Change the filters or perform an action to generate events.', 'activity')}</div>`;
  }

  return { mount, update: render };
}
