/* Thin client for api.php, export.php and the SSE stream. */

export class ApiError extends Error {
  constructor(message, status = 0, payload = null) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.payload = payload;
  }
}

export function createApi(initialConfig, resolve) {
  let config = { ...initialConfig };

  const endpoint = (path, params = {}) => {
    const url = new URL(resolve(path));
    Object.entries(params).forEach(([key, value]) => {
      if (value !== undefined && value !== null && value !== '') url.searchParams.set(key, value);
    });
    return url.toString();
  };

  async function request(action, { method = 'GET', params = {}, body = null, signal } = {}) {
    const url = endpoint('api.php', { action, ...params });
    const headers = { Accept: 'application/json' };
    const init = { method, headers, credentials: 'same-origin', cache: 'no-store' };
    if (signal) init.signal = signal;
    if (method !== 'GET') {
      headers['Content-Type'] = 'application/json';
      headers['X-CSRF-Token'] = config.csrf || '';
      init.body = JSON.stringify({ csrf: config.csrf, ...(body || {}) });
    }
    let response;
    try {
      response = await fetch(url, init);
    } catch (error) {
      if (error?.name === 'AbortError') throw error;
      throw new ApiError('Cannot reach the PHP backend. Is the web server running?', 0);
    }
    const text = await response.text();
    let payload;
    try {
      payload = JSON.parse(text);
    } catch {
      throw new ApiError(`Unexpected server response (HTTP ${response.status}).`, response.status);
    }
    if (payload?.csrf) updateConfig({ csrf: payload.csrf });
    if (!response.ok || payload?.ok === false) {
      throw new ApiError(payload?.message || `Request failed (HTTP ${response.status}).`, response.status, payload);
    }
    return payload;
  }

  const snapshot = (signal) => request('snapshot', { signal });
  const decisions = (signal) => request('decisions', { signal });
  const allowedIps = (signal) => request('allowed_ips', { signal });
  const lookup = (ip, signal) => request('ip', { params: { ip }, signal });
  const events = ({ limit = 300, q = '', type = '' } = {}, signal) =>
    request('events', { params: { limit, q, type }, signal });
  const test = () => request('test');
  const raw = (which) => request('raw', { params: { which } });

  const block = (data) => request('block', { method: 'POST', body: data });
  const unblock = (ip) => request('unblock', { method: 'POST', body: { ip } });
  const allow = (data) => request('allow', { method: 'POST', body: data });
  const unallow = (cidr) => request('unallow', { method: 'POST', body: { cidr } });
  const clearEvents = () => request('clear_events', { method: 'POST' });
  const setKey = (apiKey, server) => request('set_key', { method: 'POST', body: { apiKey, server: server ?? '' } });
  const clearKey = () => request('clear_key', { method: 'POST' });

  async function exportFile({ format = 'xlsx', type = 'all', q = '' } = {}) {
    const form = new FormData();
    form.append('csrf', config.csrf || '');
    form.append('format', format);
    form.append('type', type);
    form.append('q', q);
    const response = await fetch(resolve('export.php'), {
      method: 'POST',
      body: form,
      headers: { 'X-CSRF-Token': config.csrf || '' },
      credentials: 'same-origin',
      cache: 'no-store',
    });
    if (!response.ok) {
      const message = (await response.text()).replace(/^Export failed:\s*/, '');
      throw new ApiError(message || `Export failed (HTTP ${response.status}).`, response.status);
    }
    const disposition = response.headers.get('Content-Disposition') || '';
    const match = /filename="?([^";]+)"?/i.exec(disposition);
    const formatHeader = response.headers.get('X-Export-Format') || (format === 'csv' ? 'csv' : 'xlsx');
    return {
      blob: await response.blob(),
      filename: match?.[1] || `ipaware-export.${formatHeader}`,
      format: formatHeader,
      fallback: response.headers.get('X-Export-Fallback') === 'csv',
    };
  }

  /** Named SSE events: hello, sync, activity, notice, heartbeat, restart. */
  function connectStream(handlers = {}) {
    const names = ['hello', 'sync', 'activity', 'notice', 'heartbeat', 'restart'];
    let source = null;
    let closed = false;
    let attempt = 0;
    let timer = null;

    const open = () => {
      if (closed) return;
      handlers.onStatus?.('connecting');
      source = new EventSource(resolve('stream.php'));
      names.forEach((name) => {
        source.addEventListener(name, (event) => {
          let data = {};
          try { data = JSON.parse(event.data); } catch { /* ignore malformed frame */ }
          handlers[name]?.(data, event);
        });
      });
      source.onopen = () => {
        attempt = 0;
        handlers.onStatus?.('live');
      };
      source.onerror = () => {
        source?.close();
        handlers.onStatus?.('reconnecting');
        attempt = Math.min(6, attempt + 1);
        const delay = Math.min(30000, 900 * (2 ** attempt));
        timer = setTimeout(open, delay);
      };
    };
    open();

    return {
      close() {
        closed = true;
        clearTimeout(timer);
        source?.close();
        handlers.onStatus?.('off');
      },
      reconnect() {
        clearTimeout(timer);
        source?.close();
        attempt = 0;
        open();
      },
      isClosed: () => closed,
    };
  }

  function updateConfig(partial) {
    config = { ...config, ...partial };
    return config;
  }

  return {
    request, snapshot, decisions, allowedIps, lookup, events, test, raw,
    block, unblock, allow, unallow, clearEvents, setKey, clearKey,
    exportFile, connectStream, updateConfig,
    get config() { return config; },
  };
}
