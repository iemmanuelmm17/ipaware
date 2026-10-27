/* Shared table columns and row actions used by Overview, Decisions and Whitelist. */

/** Main table: IP, when it was added (US date + time), and why it was blocked. */
export function rowColumns(ctx, { showType = false } = {}) {
  const { escapeHtml: esc, fmtDate, badge } = ctx.ui;
  const columns = [];
  if (showType) {
    columns.push({
      key: 'kind', label: 'Type',
      render: (row) => row.kind === 'allowed'
        ? badge('Whitelisted', 'green')
        : badge(row.action && row.action !== 'ban' ? String(row.action).toUpperCase() : 'Blocked', 'red'),
    });
  }
  columns.push(
    {
      key: 'ip', label: 'IP / CIDR', className: 'col-ip',
      render: (row, index) => `<button class="text-link" type="button" data-action="lookup" data-index="${index}" title="Look up ${esc(row.ip)}">${esc(row.ip)}</button>`
        + (row.cidr && row.cidr !== row.ip ? `<span class="cell-sub">${esc(row.cidr)}</span>` : ''),
    },
    {
      key: 'created', label: 'Added',
      render: (row) => `<span class="nowrap">${esc(fmtDate(row.created))}</span>`,
    },
    {
      key: 'reason', label: 'Explanation', className: 'col-explanation',
      render: (row) => {
        const text = row.explanation || row.reason || row.comment || '';
        return text
          ? `<span class="explanation" title="${esc(text)}">${esc(text)}</span>`
          : '<span class="muted">—</span>';
      },
    },
  );
  return columns;
}

export function rowActions(ctx) {
  return [
    { id: 'lookup', icon: 'search', title: 'Look up this IP' },
    { id: 'details', icon: 'eye', title: 'View full details' },
    { id: 'copy', icon: 'copy', title: 'Copy IP / CIDR' },
    { id: 'unblock', icon: 'unlock', title: 'Release / unblock IP', visible: (r) => r.kind !== 'allowed' },
    { id: 'allow', icon: 'check-circle', title: 'Add to allow list', visible: (r) => r.kind !== 'allowed' },
    { id: 'block', icon: 'lock', title: 'Block this IP', visible: (r) => r.kind === 'allowed', className: 'btn--danger' },
    { id: 'remove', icon: 'trash', title: 'Remove from allow list', visible: (r) => r.kind === 'allowed' },
  ];
}

/** Popup with every field for one row (opened by clicking the row, or the eye button). */
export function showRecord(ctx, row) {
  const allowed = row.kind === 'allowed';
  const record = row.raw && typeof row.raw === 'object' ? row.raw : row;
  return ctx.ui.recordDialog({
    title: row.ip,
    subtitle: allowed ? 'Whitelisted address' : 'Blocked address',
    summary: [
      ['IP / CIDR', row.ip],
      ['Type', allowed ? 'Whitelisted' : 'Blocked'],
      ['Added', row.created],
      ['Expires', row.expires],
      ['TTL', row.ttl],
      ['Explanation', row.explanation || row.reason || row.comment],
      ['Reason', row.reason],
      ['Source', row.source || row.origin],
      ['Scenario', row.scenario],
      ['Comment', row.comment],
      ['Record ID', row.id],
    ],
    record,
    actions: [
      { label: 'IP lookup', icon: 'search', run: () => ctx.actions.lookup(row.ip) },
      { label: 'Copy IP', icon: 'copy', run: async () => {
        const ok = await ctx.ui.copy(row.ip);
        ctx.ui.toast(ok ? `Copied ${row.ip}` : 'Could not copy', ok ? 'success' : 'error', 1800);
      } },
    ],
  });
}

export async function handleRowAction(ctx, id, row) {
  switch (id) {
    case 'lookup': return ctx.actions.lookup(row.ip);
    case 'details': return showRecord(ctx, row);
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
