/* Shared table columns and row actions used by Overview, Decisions and Whitelist. */

export function rowColumns(ctx) {
  const { escapeHtml: esc, fmtDate, timeAgo, badge, icon } = ctx.ui;
  return [
    {
      key: 'kind', label: 'Type',
      render: (row) => row.kind === 'allowed'
        ? badge('Whitelisted', 'green')
        : badge(row.action && row.action !== 'ban' ? String(row.action).toUpperCase() : 'Blocked', 'red'),
    },
    {
      key: 'ip', label: 'IP / CIDR', className: 'col-ip',
      render: (row, index) => `<button class="text-link" type="button" data-action="lookup" data-index="${index}" title="Look up ${esc(row.ip)}">${esc(row.ip)}</button>`
        + (row.cidr && row.cidr !== row.ip ? `<span class="cell-sub">${esc(row.cidr)}</span>` : ''),
    },
    {
      key: 'reason', label: 'Reason / comment',
      render: (row) => `<span class="truncate" style="display:inline-block;max-width:280px" title="${esc(row.reason || row.comment)}">${esc(row.reason || row.comment || '—')}</span>`
        + (row.ttl ? `<span class="cell-sub">TTL ${esc(row.ttl)}</span>` : ''),
    },
    {
      key: 'scenario', label: 'Scenario / source',
      render: (row) => `${esc(row.scenario || row.action || row.comment || '—')}<span class="cell-sub">${esc(row.source || row.origin || '—')}</span>`,
    },
    {
      key: 'created', label: 'Created',
      render: (row) => `${fmtDate(row.created)}<span class="cell-sub">${timeAgo(row.created)}</span>`,
    },
    {
      key: 'expires', label: 'Expires / TTL',
      render: (row) => row.expires ? `${fmtDate(row.expires)}<span class="cell-sub">${timeAgo(row.expires)}</span>` : esc(row.ttl || '—'),
    },
  ];
}

export function rowActions(ctx) {
  return [
    { id: 'lookup', icon: 'search', title: 'Look up this IP' },
    { id: 'details', icon: 'eye', title: 'View raw record' },
    { id: 'copy', icon: 'copy', title: 'Copy IP / CIDR' },
    { id: 'unblock', icon: 'unlock', title: 'Release / unblock IP', visible: (r) => r.kind !== 'allowed' },
    { id: 'allow', icon: 'check-circle', title: 'Add to allow list', visible: (r) => r.kind !== 'allowed' },
    { id: 'block', icon: 'lock', title: 'Block this IP', visible: (r) => r.kind === 'allowed', className: 'btn--danger' },
    { id: 'remove', icon: 'trash', title: 'Remove from allow list', visible: (r) => r.kind === 'allowed' },
  ];
}

export async function handleRowAction(ctx, id, row) {
  switch (id) {
    case 'lookup': return ctx.actions.lookup(row.ip);
    case 'details': return ctx.ui.jsonDialog(`Raw record — ${row.ip}`, row.raw || row);
    case 'copy': {
      const ok = await ctx.ui.copy(row.ip);
      return ctx.ui.toast(ok ? `Copied ${row.ip}` : 'Could not copy', ok ? 'success' : 'error', 1800);
    }
    case 'unblock': return ctx.actions.unblock(row.ip);
    case 'allow': return ctx.actions.allow(row.ip);
    case 'block': return ctx.actions.block(row.ip);
    case 'remove': return ctx.actions.unallow(row.ip);
    default: return undefined;
  }
}

export function renderEventTimeline(ctx, events, limit = 8) {
  const { escapeHtml: esc, fmtDate, timeAgo, emptyState } = ctx.ui;
  if (!events.length) return emptyState('No events yet', 'Actions and upstream changes will appear here in real time.', 'activity');
  const tone = { success: 'success', warning: 'warning', danger: 'danger', info: 'info' };
  return `<div class="event-list">${events.slice(0, limit).map((event) => `
    <div class="timeline-item sev-${tone[event.severity] || 'info'}">
      <span class="marker"></span>
      <div><div class="msg">${esc(event.message)}</div>
        <div class="meta"><span>${esc(event.type)}</span>${event.ip ? `<span class="mono">${esc(event.ip)}</span>` : ''}<span>${esc(timeAgo(event.ts))}</span></div>
      </div>
      <span class="timeline-time" title="${esc(fmtDate(event.ts))}">${esc(timeAgo(event.ts))}</span>
    </div>`).join('')}</div>`;
}
