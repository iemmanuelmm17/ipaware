/* Lazy table renderer: only a chunk of rows is in the DOM at first; the rest
   stream in as the sentinel scrolls into view (or via "Load more"). */

export function renderSkeleton(container, columns = 5, rows = 7) {
  container.innerHTML = `<div class="card"><div class="card-head"><div class="skeleton-line w40" style="width:180px;margin:0"></div></div>
    <div style="padding:14px">${Array.from({ length: rows }, (_, i) =>
      `<div class="skeleton-line" style="width:${92 - (i % 4) * 11}%;margin-bottom:14px"></div>`).join('')}</div></div>`;
}

export function renderTable(container, options = {}) {
  const {
    rows = [], columns = [], actions = [], onAction = () => {},
    chunk = 30, emptyTitle = 'Nothing here yet', emptyMessage = 'Try a different search or refresh the list.',
    sort = null, onSort = () => {}, footerNote = '',
  } = options;

  if (container._tableObserver) {
    container._tableObserver.disconnect();
    container._tableObserver = null;
  }
  if (container._tableClickHandler) {
    container.removeEventListener('click', container._tableClickHandler);
  }

  if (!rows.length) {
    container._tableClickHandler = null;
    container.innerHTML = `<div class="empty-state">
      <svg class="icon"><use href="#i-search"></use></svg>
      <h3>${escape(emptyTitle)}</h3><p>${escape(emptyMessage)}</p></div>`;
    return;
  }

  const head = columns.map((col) => {
    const active = sort && sort.key === col.key;
    const arrow = active ? (sort.dir === 'asc' ? '↑' : '↓') : '';
    const label = col.sortable === false
      ? escape(col.label)
      : `<button type="button" data-sort="${escape(col.key)}" aria-label="Sort by ${escape(col.label)}">${escape(col.label)} <span class="muted">${arrow}</span></button>`;
    return `<th class="${col.className || ''}">${label}</th>`;
  }).join('');

  container.innerHTML = `
    <div class="table-wrap">
      <table class="data-table"><thead><tr>${head}${actions.length ? '<th class="col-actions">Actions</th>' : ''}</tr></thead>
      <tbody data-tbody></tbody></table>
      <div class="table-sentinel" data-sentinel></div>
    </div>
    <div class="table-footer">
      <span data-count></span>
      <span class="row">${escape(footerNote)}</span>
      <div class="row"><div class="lazy-progress" data-progress><i style="width:0%"></i></div><button class="btn btn--xs" type="button" data-more>Load more</button></div>
    </div>`;

  const tbody = container.querySelector('[data-tbody]');
  const sentinel = container.querySelector('[data-sentinel]');
  const scroller = container.querySelector('.table-wrap');
  const countEl = container.querySelector('[data-count]');
  const progress = container.querySelector('[data-progress] i');
  const moreBtn = container.querySelector('[data-more]');
  let shown = 0;
  const size = Math.max(10, Number(chunk) || 30);

  function appendChunk() {
    if (shown >= rows.length) return;
    const next = rows.slice(shown, shown + size);
    const fragment = document.createElement('div');
    fragment.innerHTML = `<table><tbody>${next.map((row, offset) => {
      const index = shown + offset;
      const cells = columns.map((col) => `<td class="${col.className || ''}">${col.render(row, index)}</td>`).join('');
      const buttons = actions
        .filter((action) => !action.visible || action.visible(row))
        .map((action) => `<button class="icon-btn ${action.className || ''}" type="button" data-action="${escape(action.id)}" data-index="${index}" title="${escape(action.title || action.label)}" aria-label="${escape(action.title || action.label)}"><svg class="icon"><use href="#i-${escape(action.icon)}"></use></svg></button>`)
        .join('');
      return `<tr data-index="${index}">${cells}${actions.length ? `<td class="col-actions"><span class="row-actions">${buttons}</span></td>` : ''}</tr>`;
    }).join('')}</tbody></table>`;
    const nodes = Array.from(fragment.querySelector('tbody').children);
    nodes.forEach((node) => tbody.appendChild(node));
    shown += next.length;
    countEl.textContent = `Showing ${shown.toLocaleString()} of ${rows.length.toLocaleString()} rows`;
    progress.style.width = `${Math.round((shown / rows.length) * 100)}%`;
    moreBtn.disabled = shown >= rows.length;
    moreBtn.textContent = shown >= rows.length ? 'All loaded' : `Load more (${(rows.length - shown).toLocaleString()} left)`;
  }

  appendChunk();

  if (typeof IntersectionObserver !== 'undefined') {
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) appendChunk();
    }, { root: scroller, rootMargin: '300px 0px', threshold: 0 });
    observer.observe(sentinel);
    container._tableObserver = observer;
  }

  moreBtn.addEventListener('click', appendChunk);

  container._tableClickHandler = (event) => {
    const sortButton = event.target.closest('[data-sort]');
    if (sortButton) {
      onSort(sortButton.dataset.sort);
      return;
    }
    const actionButton = event.target.closest('[data-action]');
    if (actionButton) {
      const index = Number(actionButton.dataset.index);
      if (Number.isInteger(index) && rows[index]) onAction(actionButton.dataset.action, rows[index], event);
    }
  };
  container.addEventListener('click', container._tableClickHandler);
}

function escape(value) {
  return String(value ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}
