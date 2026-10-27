/* DOM helpers, formatting, toasts and dialogs. No dependencies. */

export const qs = (selector, root = document) => root.querySelector(selector);
export const qsa = (selector, root = document) => Array.from(root.querySelectorAll(selector));

export function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}

export function icon(name, className = 'icon') {
  return `<svg class="${className}" aria-hidden="true"><use href="#i-${name}"></use></svg>`;
}

export function parseDate(value) {
  if (!value && value !== 0) return null;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
  if (typeof value === 'number') {
    const d = new Date(value > 1e12 ? value : value * 1000);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  const str = String(value).trim();
  if (/^\d{10,13}$/.test(str)) return parseDate(Number(str));
  const d = new Date(str);
  return Number.isNaN(d.getTime()) ? null : d;
}

export function fmtDate(value) {
  const d = parseDate(value);
  if (!d) return value ? String(value) : '—';
  try {
    return new Intl.DateTimeFormat(undefined, {
      year: 'numeric', month: 'short', day: '2-digit',
      hour: '2-digit', minute: '2-digit', hour12: false,
    }).format(d);
  } catch {
    return d.toISOString().slice(0, 16).replace('T', ' ');
  }
}

export function timeAgo(value) {
  const d = parseDate(value);
  if (!d) return '—';
  const seconds = Math.round((Date.now() - d.getTime()) / 1000);
  if (seconds < 5) return 'just now';
  if (seconds < 60) return `${seconds}s ago`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  if (seconds < 2592000) return `${Math.floor(seconds / 86400)}d ago`;
  return fmtDate(d);
}

export function shortNumber(n) {
  const value = Number(n) || 0;
  return value >= 10000 ? `${(value / 1000).toFixed(1)}k` : new Intl.NumberFormat().format(value);
}

export function badge(text, tone = 'muted') {
  return `<span class="badge badge--${tone}">${escapeHtml(text)}</span>`;
}

export function toast(input, tone = 'info', timeout = 4200) {
  const payload = typeof input === 'string' ? { title: input } : (input || {});
  const host = qs('#toasts');
  if (!host) return;
  const tones = { info: 'info', success: 'check-circle', warning: 'alert', error: 'ban' };
  const el = document.createElement('div');
  el.className = `toast tone-${payload.tone || tone}`;
  el.innerHTML = `${icon(tones[payload.tone || tone] || 'info')}<div><strong>${escapeHtml(payload.title || '')}</strong>${
    payload.message ? `<p>${escapeHtml(payload.message)}</p>` : ''
  }</div>`;
  host.appendChild(el);
  const remove = () => {
    el.style.opacity = '0';
    el.style.transform = 'translateY(6px)';
    setTimeout(() => el.remove(), 180);
  };
  el.addEventListener('click', remove);
  setTimeout(remove, payload.timeout ?? timeout);
}

function closeOnEscape(backdrop, onClose) {
  const handler = (event) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      cleanup();
      onClose();
    }
  };
  const cleanup = () => {
    document.removeEventListener('keydown', handler);
    document.body.classList.remove('modal-open');
  };
  document.addEventListener('keydown', handler);
  backdrop._cleanup = cleanup;
  document.body.classList.add('modal-open');
}

export function confirmDialog({ title = 'Are you sure?', message = '', confirmText = 'Confirm', cancelText = 'Cancel', danger = false, iconName = 'alert' } = {}) {
  return new Promise((resolve) => {
    const root = qs('#modal-root');
    const backdrop = document.createElement('div');
    backdrop.className = 'modal-backdrop';
    backdrop.innerHTML = `
      <div class="modal" role="dialog" aria-modal="true" aria-label="${escapeHtml(title)}">
        <div class="modal-head">${icon(iconName)}<h2>${escapeHtml(title)}</h2></div>
        <div class="modal-body"><p class="muted">${escapeHtml(message)}</p></div>
        <div class="modal-foot">
          <button class="btn" data-act="cancel" type="button">${escapeHtml(cancelText)}</button>
          <button class="btn ${danger ? 'btn--danger' : 'btn--primary'}" data-act="ok" type="button">${escapeHtml(confirmText)}</button>
        </div>
      </div>`;
    root.appendChild(backdrop);
    closeOnEscape(backdrop, () => { backdrop.remove(); resolve(false); });
    const finish = (value) => {
      backdrop._cleanup?.();
      backdrop.remove();
      resolve(value);
    };
    backdrop.addEventListener('click', (e) => {
      if (e.target === backdrop || e.target.closest('[data-act="cancel"]')) finish(false);
      if (e.target.closest('[data-act="ok"]')) finish(true);
    });
    qs('[data-act="ok"]', backdrop).focus();
  });
}

export function formDialog({ title = 'Enter details', message = '', fields = [], submitText = 'Save', danger = false, iconName = 'plus' } = {}) {
  return new Promise((resolve) => {
    const root = qs('#modal-root');
    const backdrop = document.createElement('div');
    backdrop.className = 'modal-backdrop';
    const fieldsHtml = fields.map((f) => {
      const id = `fld-${f.name}`;
      const common = `id="${id}" name="${f.name}" ${f.required ? 'required' : ''} ${f.pattern ? `pattern="${escapeHtml(f.pattern)}"` : ''}`;
      let control;
      if (f.type === 'textarea') control = `<textarea class="textarea" ${common} placeholder="${escapeHtml(f.placeholder || '')}">${escapeHtml(f.value || '')}</textarea>`;
      else if (f.type === 'select') control = `<select class="select" ${common}>${(f.options || []).map((o) => `<option value="${escapeHtml(o.value)}" ${o.value === f.value ? 'selected' : ''}>${escapeHtml(o.label)}</option>`).join('')}</select>`;
      else control = `<input class="input ${f.mono ? 'input--mono' : ''}" type="${f.type || 'text'}" ${common} value="${escapeHtml(f.value || '')}" placeholder="${escapeHtml(f.placeholder || '')}" autocomplete="off" spellcheck="false">`;
      return `<div class="field"><label for="${id}">${escapeHtml(f.label)}</label>${control}${f.hint ? `<span class="hint">${escapeHtml(f.hint)}</span>` : ''}</div>`;
    }).join('');
    backdrop.innerHTML = `
      <form class="modal" role="dialog" aria-modal="true" aria-label="${escapeHtml(title)}">
        <div class="modal-head">${icon(iconName)}<h2>${escapeHtml(title)}</h2></div>
        <div class="modal-body">${message ? `<p class="muted">${escapeHtml(message)}</p>` : ''}${fieldsHtml}</div>
        <div class="modal-foot">
          <button class="btn" type="button" data-act="cancel">Cancel</button>
          <button class="btn ${danger ? 'btn--danger' : 'btn--primary'}" type="submit">${escapeHtml(submitText)}</button>
        </div>
      </form>`;
    root.appendChild(backdrop);
    const form = qs('form', backdrop);
    closeOnEscape(backdrop, () => { backdrop.remove(); resolve(null); });
    const finish = (value) => { backdrop._cleanup?.(); backdrop.remove(); resolve(value); };
    backdrop.addEventListener('click', (e) => {
      if (e.target === backdrop || e.target.closest('[data-act="cancel"]')) finish(null);
    });
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      if (!form.reportValidity()) return;
      const data = {};
      new FormData(form).forEach((v, k) => { data[k] = String(v).trim(); });
      finish(data);
    });
    setTimeout(() => qs('input, select, textarea', form)?.focus(), 30);
  });
}

export function jsonDialog(title, data) {
  const text = typeof data === 'string' ? data : JSON.stringify(data, null, 2);
  const root = qs('#modal-root');
  const backdrop = document.createElement('div');
  backdrop.className = 'modal-backdrop';
  backdrop.innerHTML = `
    <div class="modal modal--wide" role="dialog" aria-modal="true" aria-label="${escapeHtml(title)}">
      <div class="modal-head">${icon('file')}<h2>${escapeHtml(title)}</h2>
        <button class="icon-btn" data-act="copy" type="button" title="Copy JSON">${icon('copy')}</button></div>
      <pre class="raw-json">${escapeHtml(text || 'No data')}</pre>
      <div class="modal-foot"><button class="btn" data-act="close" type="button">Close</button></div>
    </div>`;
  root.appendChild(backdrop);
  closeOnEscape(backdrop, () => backdrop.remove());
  backdrop.addEventListener('click', async (e) => {
    if (e.target.closest('[data-act="copy"]')) {
      await copy(text || '');
      toast('JSON copied to clipboard', 'success', 1800);
    }
    if (e.target === backdrop || e.target.closest('[data-act="close"]')) {
      backdrop._cleanup?.();
      backdrop.remove();
    }
  });
}

export async function copy(text) {
  try {
    await navigator.clipboard.writeText(String(text));
    return true;
  } catch {
    const area = document.createElement('textarea');
    area.value = String(text);
    area.style.position = 'fixed';
    area.style.opacity = '0';
    document.body.appendChild(area);
    area.select();
    let ok = false;
    try { ok = document.execCommand('copy'); } catch { ok = false; }
    area.remove();
    return ok;
  }
}

export function download(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

export function debounce(fn, ms = 200) {
  let timer;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), ms);
  };
}

export function emptyState(title, message, iconName = 'search') {
  return `<div class="empty-state">${icon(iconName)}<h3>${escapeHtml(title)}</h3><p>${escapeHtml(message)}</p></div>`;
}

export function sparkline(values, { height = 66, color = 'var(--accent)' } = {}) {
  const data = values.length ? values : [0, 0];
  const max = Math.max(1, ...data);
  const step = 100 / Math.max(1, data.length - 1);
  const points = data.map((v, i) => `${(i * step).toFixed(2)},${(28 - (v / max) * 24).toFixed(2)}`).join(' ');
  const area = `0,30 ${points} 100,30`;
  return `<svg class="sparkline" viewBox="0 0 100 30" preserveAspectRatio="none" style="color:${color};height:${height}px" aria-hidden="true">
    <polygon points="${area}" fill="currentColor" opacity=".12"></polygon>
    <polyline points="${points}" fill="none" stroke="currentColor" stroke-width="1.4" vector-effect="non-scaling-stroke"></polyline>
  </svg>`;
}

const ipv4 = /^(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(\.(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3}$/;

export function isIp(value) {
  const v = String(value || '').trim().toLowerCase();
  if (ipv4.test(v)) return true;
  if (!v.includes(':') || v.length > 45 || !/^[0-9a-f:]+$/.test(v)) return false;
  const halves = v.split('::');
  if (halves.length > 2) return false;
  const groups = halves.join(':').split(':').filter(Boolean);
  if (groups.some((g) => !/^[0-9a-f]{1,4}$/.test(g))) return false;
  return v.includes('::') ? groups.length <= 7 : groups.length === 8;
}

export function isIpOrCidr(value) {
  const v = String(value || '').trim().toLowerCase();
  if (!v.includes('/')) return isIp(v);
  const [addr, bits] = v.split('/');
  if (!isIp(addr) || !/^\d{1,3}$/.test(bits)) return false;
  const max = addr.includes(':') ? 128 : 32;
  return Number(bits) >= 0 && Number(bits) <= max;
}

export function setBusy(element, busy) {
  if (!element) return;
  element.disabled = !!busy;
  element.classList.toggle('is-busy', !!busy);
}
