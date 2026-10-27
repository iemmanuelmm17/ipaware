/* IP lookup tab: /ipaware/ip/{ip} + quick block / release / allow actions. */

const RECENT_KEY = 'ipa.recentLookups';

function recent() {
  try { return JSON.parse(localStorage.getItem(RECENT_KEY) || '[]').slice(0, 8); } catch { return []; }
}
function remember(ip) {
  const next = [ip, ...recent().filter((x) => x !== ip)].slice(0, 8);
  localStorage.setItem(RECENT_KEY, JSON.stringify(next));
  return next;
}

/** Show every upstream field, grouping top-level objects into readable cards. */
export function renderLookupSections(ui, record) {
  if (!record || typeof record !== 'object' || Array.isArray(record)) return '';
  const entries = Object.entries(record);
  const groups = entries.filter(([, value]) => value !== null && typeof value === 'object'
    && !Array.isArray(value) && Object.keys(value).length > 0);
  const fields = Object.fromEntries(entries.filter(([, value]) => value === null || typeof value !== 'object'
    || Array.isArray(value) || Object.keys(value).length === 0));
  const section = (title, value) => `<section class="card lookup-section">
    <div class="card-head"><h2>${ui.escapeHtml(title)}</h2></div>
    <div class="card-body">${ui.renderRecordFields(value)}</div>
  </section>`;
  const content = [
    ...(Object.keys(fields).length ? [section('Address information', fields)] : []),
    ...groups.map(([key, value]) => section(ui.humanizeKey(key), value)),
  ];
  return content.length ? `<div class="lookup-sections" data-lookup-details>${content.join('')}</div>` : '';
}

export function create(ctx) {
  let el = null;
  let result = null;
  let raw = null;
  let error = null;
  let loading = false;
  let ip = '';

  function mount(container) {
    el = container;
    el.innerHTML = `
      <section class="card">
        <div class="card-head"><div><h2>Know about an address</h2>
          <p>GET ${ctx.ui.escapeHtml(ctx.cfg.endpoints.ip)}/{ip} — verdict, decision, signals and raw response.</p></div></div>
        <form class="card-body" data-lookup-form>
          <div class="input-group">
            <input class="input input--mono" name="ip" type="search" placeholder="108.21.251.157 or 2001:db8::1" autocomplete="off" spellcheck="false" required>
            <button class="btn btn--primary" type="submit">${ctx.ui.icon('search')} Look up IP</button>
          </div>
          <div class="row" style="margin-top:10px"><span class="muted tiny">Recent:</span><span class="chips" data-recent></span></div>
        </form>
      </section>
      <div data-result style="margin-top:16px"></div>`;

    el.querySelector('[data-lookup-form]').addEventListener('submit', (event) => {
      event.preventDefault();
      doLookup(event.currentTarget.elements.ip.value.trim());
    });
    el.addEventListener('click', (event) => {
      const chip = event.target.closest('[data-recent-ip]');
      if (chip) return doLookup(chip.dataset.recentIp);
      const action = event.target.closest('[data-lookup-action]');
      if (action && result) {
        const id = action.dataset.lookupAction;
        if (id === 'block') return ctx.actions.block(result.ip);
        if (id === 'unblock') return ctx.actions.unblock(result.ip);
        if (id === 'allow') return ctx.actions.allow(result.ip);
        if (id === 'raw') return ctx.ui.jsonDialog(`Raw response — ${result.ip}`, raw);
      }
    });
    if (ctx.pendingLookup) {
      doLookup(ctx.pendingLookup);
      ctx.pendingLookup = null;
    } else {
      render();
    }
  }

  async function doLookup(value) {
    ip = String(value || '').trim();
    if (!ctx.ui.isIp(ip)) {
      ctx.ui.toast('Enter a valid IPv4 or IPv6 address', 'error');
      return;
    }
    loading = true; error = null; render();
    try {
      const response = await ctx.api.lookup(ip);
      result = response.result;
      raw = response.raw ?? response.result?.raw;
      remember(ip);
    } catch (e) {
      error = e.message;
      result = null;
      ctx.ui.toast({ title: 'Lookup failed', message: e.message }, 'error');
    } finally {
      loading = false;
      render();
    }
  }

  function render() {
    if (!el) return;
    const { ui } = ctx;
    const form = el.querySelector('[data-lookup-form]');
    if (form && form.elements.ip.value !== ip) form.elements.ip.value = ip;
    el.querySelector('[data-recent]').innerHTML = recent().length
      ? recent().map((r) => `<button class="chip mono" type="button" data-recent-ip="${ui.escapeHtml(r)}">${ui.escapeHtml(r)}</button>`).join('')
      : '<span class="muted tiny">none yet</span>';

    const host = el.querySelector('[data-result]');
    if (loading) {
      host.innerHTML = '<div class="skeleton-card"><div class="skeleton-line w40"></div><div class="skeleton-line"></div><div class="skeleton-line w70"></div></div>';
      return;
    }
    if (error) {
      host.innerHTML = `<div class="card">${ui.emptyState('Lookup failed', error, 'alert')}</div>`;
      return;
    }
    if (!result) {
      host.innerHTML = `<div class="card">${ui.emptyState('Look up any IP address', 'See whether it is blocked, allow-listed, or clean — then act on it without leaving the page.', 'globe')}</div>`;
      return;
    }

    const verdict = String(result.verdict || 'unknown').toLowerCase();
    const verdictTone = { blocked: 'red', allowed: 'green', clean: 'blue' }[verdict] || 'muted';
    const text = (value) => ui.escapeHtml(value === null || value === undefined || value === '' ? '—' : value);
    const yesNo = (value, yesTone) => value === true ? ui.badge('Yes', yesTone)
      : value === false ? ui.badge('No', 'muted') : ui.badge('Unknown', 'muted');
    const active = result.activeDecision === undefined ? (result.decision ? true : null) : result.activeDecision;
    const details = [
      ['Verdict', ui.badge(verdict.toUpperCase(), verdictTone)],
      ['Status', text(result.status)],
      ['Reason', text(result.reason)],
      ['Scenario', text(result.scenario)],
      ['First seen', text(ui.fmtDate(result.firstSeen))],
      ['Last seen', text(ui.fmtDate(result.lastSeen))],
      ['Expires', text(ui.fmtDate(result.expires))],
      ['Country', text(result.country)],
      ['ASN', text(result.asn)],
      ['Organisation', text(result.org)],
      ['Allow-listed', yesNo(result.allowlisted, 'green')],
      ['Active decision', yesNo(active, 'red')],
    ];
    host.innerHTML = `
      <section class="card">
        <div class="detail-hero">
          <div><div class="muted tiny" style="text-transform:uppercase;letter-spacing:.08em">Address</div>
            <div class="detail-ip">${ui.escapeHtml(result.ip)}</div></div>
          ${ui.badge(verdict.toUpperCase(), verdictTone)}
          <span class="spacer"></span>
          <div class="row">
            <button class="btn btn--xs" type="button" data-lookup-action="raw">${ui.icon('file')} Raw JSON</button>
            <button class="btn btn--xs" type="button" data-lookup-action="allow">${ui.icon('check-circle')} Allow list</button>
            <button class="btn btn--xs" type="button" data-lookup-action="unblock">${ui.icon('unlock')} Release</button>
            <button class="btn btn--xs btn--danger" type="button" data-lookup-action="block">${ui.icon('lock')} Block</button>
          </div>
        </div>
        <dl class="detail-grid">${details.map(([k, v]) => `<div><dt>${ui.escapeHtml(k)}</dt><dd>${v}</dd></div>`).join('')}</dl>
      </section>
      ${renderLookupSections(ui, raw)}
      ${(result.events || []).length ? `<section class="card" style="margin-top:16px">
        <div class="card-head"><div><h2>Recent signals</h2><p>Events returned by the upstream for this address</p></div></div>
        <div class="timeline">${result.events.map((e) => `<div class="timeline-item sev-info"><span class="marker"></span>
          <div><div class="msg">${ui.escapeHtml(e.message || e.type || 'Event')}</div>
          <div class="meta"><span>${ui.escapeHtml(e.type || 'signal')}</span><span>${ui.escapeHtml(ui.fmtDate(e.ts || e.time))}</span></div></div></div>`).join('')}</div>
      </section>` : ''}`;
  }

  return { mount, update: render, lookup: doLookup };
}
