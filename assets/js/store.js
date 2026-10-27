/* Single source of truth for lists, events and UI filters. */

function dateValue(value) {
  if (!value) return 0;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? 0 : d.getTime();
}

function haystack(row) {
  return [
    row.ip, row.cidr, row.reason, row.comment, row.scenario,
    row.source, row.origin, row.action, row.kind, row.ttl, row.created, row.expires,
  ].filter(Boolean).join(' ').toLowerCase();
}

function matches(row, query) {
  const q = String(query || '').trim().toLowerCase();
  if (!q) return true;
  const hay = haystack(row);
  const tokens = q.split(/\s+/);
  return tokens.every((token) => {
    const colon = token.indexOf(':');
    if (colon > 0) {
      const field = token.slice(0, colon);
      const value = token.slice(colon + 1);
      if (!value) return true;
      if (['kind', 'type'].includes(field)) {
        if (['allowed', 'allow', 'whitelist', 'white'].includes(value)) return row.kind === 'allowed';
        if (['blocked', 'block', 'ban', 'deny'].includes(value)) return row.kind !== 'allowed';
      }
      if (field === 'ip') return String(row.ip || '').toLowerCase().includes(value);
      if (field === 'reason') return String(row.reason || row.comment || '').toLowerCase().includes(value);
      if (field === 'source') return String(row.source || row.origin || '').toLowerCase().includes(value);
      if (field === 'scenario') return String(row.scenario || '').toLowerCase().includes(value);
      if (field === 'comment') return String(row.comment || '').toLowerCase().includes(value);
    }
    return hay.includes(token);
  });
}

const comparators = {
  ip: (a, b) => String(a.ip || '').localeCompare(String(b.ip || ''), undefined, { numeric: true }),
  kind: (a, b) => String(a.kind || '').localeCompare(String(b.kind || '')),
  reason: (a, b) => String(a.reason || a.comment || '').localeCompare(String(b.reason || b.comment || '')),
  source: (a, b) => String(a.source || a.origin || '').localeCompare(String(b.source || b.origin || '')),
  created: (a, b) => dateValue(a.created) - dateValue(b.created),
  expires: (a, b) => dateValue(a.expires) - dateValue(b.expires),
};

export function createStore(config) {
  const state = {
    decisions: [],
    allowed: [],
    events: [],
    stats: {},
    meta: {},
    query: '',
    kind: 'all',
    sort: { key: 'created', dir: 'desc' },
    loading: false,
    lastUpdated: null,
    error: null,
    liveStatus: 'off',
    liveStats: null,
    chunkSize: Number(localStorage.getItem('ipa.chunk') || 30),
  };
  const listeners = new Set();

  function emit(reason = 'change') {
    listeners.forEach((fn) => {
      try { fn(state, reason); } catch (error) { console.error('store listener', error); }
    });
  }

  function setSnapshot(payload, { silent = false } = {}) {
    if (!payload?.ok) return;
    state.decisions = Array.isArray(payload.decisions) ? payload.decisions : [];
    state.allowed = Array.isArray(payload.allowed) ? payload.allowed : [];
    state.stats = payload.stats || {};
    state.meta = payload.meta || {};
    state.lastUpdated = Date.now();
    if (Array.isArray(payload.events)) {
      const merged = new Map(state.events.map((event) => [event.id, event]));
      payload.events.forEach((event) => { if (event?.id) merged.set(event.id, event); });
      state.events = [...merged.values()]
        .sort((a, b) => (Number(b.epoch) || 0) - (Number(a.epoch) || 0))
        .slice(0, 2000);
    }
    const errors = Object.values(state.meta.errors || {});
    state.error = errors.length ? errors.join(' · ') : null;
    if (!silent) emit('snapshot');
  }

  function setEvents(events, { silent = false } = {}) {
    state.events = Array.isArray(events) ? events.slice(0, 2000) : [];
    if (!silent) emit('events');
  }

  function addEvent(event) {
    if (!event?.id || state.events.some((e) => e.id === event.id)) return;
    state.events = [event, ...state.events].slice(0, 2000);
    emit('activity');
  }

  function rows({ kind = 'all', query = state.query, sort = state.sort, limit = 0 } = {}) {
    let list = kind === 'blocked'
      ? state.decisions
      : kind === 'allowed'
        ? state.allowed
        : [...state.decisions, ...state.allowed];
    if (query) list = list.filter((row) => matches(row, query));
    const cmp = comparators[sort.key] || comparators.created;
    list = [...list].sort((a, b) => {
      const result = cmp(a, b);
      return sort.dir === 'asc' ? result : -result;
    });
    return limit > 0 ? list.slice(0, limit) : list;
  }

  function setQuery(query, { silent = false } = {}) {
    state.query = String(query || '');
    if (!silent) emit('query');
  }

  function setKind(kind, { silent = false } = {}) {
    state.kind = kind;
    if (!silent) emit('kind');
  }

  function setSort(key) {
    if (state.sort.key === key) state.sort.dir = state.sort.dir === 'asc' ? 'desc' : 'asc';
    else state.sort = { key, dir: key === 'ip' || key === 'reason' || key === 'source' || key === 'kind' ? 'asc' : 'desc' };
    emit('sort');
  }

  function setChunk(size) {
    state.chunkSize = Math.max(10, Math.min(500, Number(size) || 30));
    localStorage.setItem('ipa.chunk', String(state.chunkSize));
    emit('chunk');
  }

  function stats() {
    return {
      blocked: state.stats.blocked ?? state.decisions.length,
      allowed: state.stats.allowed ?? state.allowed.length,
      events24h: state.stats.events24h ?? state.events.length,
      latencyMs: state.stats.latencyMs ?? 0,
      lastSync: state.stats.lastSync ?? null,
      upstream: state.stats.upstream ?? (config.demo ? 'demo' : 'live'),
    };
  }

  function eventBuckets(hours = 12) {
    const now = Date.now();
    const buckets = Array.from({ length: hours }, () => 0);
    state.events.forEach((event) => {
      const ts = Number(event.epoch || 0) * 1000;
      const index = hours - 1 - Math.floor((now - ts) / 3600000);
      if (index >= 0 && index < hours) buckets[index] += 1;
    });
    return buckets;
  }

  return {
    state,
    subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); },
    emit,
    setSnapshot, setEvents, addEvent, rows, setQuery, setKind, setSort, setChunk,
    stats, eventBuckets, matches,
    set loading(value) { state.loading = value; emit('loading'); },
    get loading() { return state.loading; },
    set liveStatus(value) { state.liveStatus = value; emit('liveStatus'); },
    get liveStatus() { return state.liveStatus; },
    set liveStats(value) { state.liveStats = value; },
    get liveStats() { return state.liveStats; },
  };
}
