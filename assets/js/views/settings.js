/* Settings: API key, server override, access control, live updates, diagnostics. */

export function create(ctx) {
  let el = null;
  let testResult = null;
  let testing = false;

  function mount(container) {
    el = container;
    render();
  }

  function render() {
    if (!el) return;
    const { ui, cfg } = ctx;
    const keySourceLabel = { session: 'Session (entered in UI)', env: '.env / .env.local', none: 'Not set' }[cfg.keySource || 'none'];
    const endpoints = cfg.endpoints || {};
    el.innerHTML = `
      <div class="settings-grid">
        <section class="card">
          <div class="card-head"><div><h2>API connection</h2><p>Credentials are never sent back to the browser.</p></div>
            ${ui.badge(cfg.demo ? 'DEMO MODE' : 'LIVE MODE', cfg.demo ? 'amber' : 'green')}</div>
          <form class="card-body" data-creds>
            <div class="field"><label for="api-key">API key</label>
              <div class="input-group">
                <input class="input input--mono" id="api-key" name="apiKey" type="password" placeholder="${cfg.hasApiKey ? '•••••••• (leave blank to keep current)' : 'Paste your API key'}" autocomplete="new-password" spellcheck="false">
                <button class="btn" type="button" data-show-key title="Show / hide">${ui.icon('eye')}</button>
              </div>
              <span class="hint">Stored in your PHP session only (or in <code class="mono">.env.local</code>). Current source: <strong>${ui.escapeHtml(keySourceLabel)}</strong>.</span></div>
            <div class="field"><label for="server-url">Upstream server URL</label>
              <input class="input input--mono" id="server-url" name="server" type="url" value="${ui.escapeHtml(cfg.server || '')}" placeholder="https://your-server.example.com" ${cfg.runtimeServerOverrideAllowed ? '' : 'disabled'}>
              <span class="hint">Configured: <code class="mono">${ui.escapeHtml(cfg.server || 'not set')}</code>${cfg.serverOverridden ? ' (session override)' : ''}. ${cfg.runtimeServerOverrideAllowed ? 'Change it here for this session.' : 'Runtime overrides are disabled in .env.'}</span></div>
            <div class="row">
              <button class="btn btn--primary" type="submit">${ui.icon('key')} Save for this session</button>
              <button class="btn" type="button" data-clear-key>${ui.icon('trash')} Clear session</button>
              <span class="spacer"></span>
              <button class="btn" type="button" data-test>${ui.icon('zap')} ${testing ? 'Testing…' : 'Test connection'}</button>
            </div>
          </form>
        </section>

        <section class="card">
          <div class="card-head"><div><h2>Access control</h2><p>Only known public IPs may open this console.</p></div>${ui.badge('Allowed', 'green')}</div>
          <div class="card-body"><dl class="kv">
            <dt>Your IP</dt><dd>${ui.escapeHtml(cfg.access?.clientIp || 'unknown')}</dd>
            <dt>Allowlist</dt><dd>${ui.escapeHtml(cfg.access?.allowlistSource || '.env')}</dd>
            <dt>Public IP required</dt><dd>${cfg.requirePublicIp ? 'yes' : 'no'}</dd>
            <dt>Localhost dev bypass</dt><dd>${cfg.devAllowLocalhost ? 'enabled (turn off in production)' : 'disabled'}</dd>
            <dt>Config file</dt><dd>.env (secrets in .env.local)</dd>
            <dt>Auth header</dt><dd>${ui.escapeHtml(cfg.authScheme === 'apikey' ? 'X-API-Key' : `Authorization: ${cfg.authScheme}`)}</dd>
            <dt>TLS verify</dt><dd>${cfg.verifyTls ? 'on' : 'OFF - unsafe'}</dd>
            <dt>Timeout</dt><dd>${cfg.timeout}s</dd>
          </dl>
          <div class="notice" style="margin-top:14px">${ui.icon('shield')}
            <span>Add your real public IP to <code class="mono">ADMIN_ALLOWED_IPS</code> in <code class="mono">.env</code> and set <code class="mono">DEV_ALLOW_LOCALHOST=false</code> before exposing this site. The guard runs on every PHP file, including assets and exports.</span></div>
          </div></section>

        <section class="card">
          <div class="card-head"><div><h2>Live updates &amp; lazy loading</h2><p>Choose how fresh the tables stay.</p></div></div>
          <div class="card-body"><dl class="kv">
            <dt>SSE stream</dt><dd>${cfg.sseEnabled ? 'enabled' : 'disabled in .env'}</dd>
            <dt>Stream status</dt><dd data-live-status>${ui.escapeHtml(ctx.store.state.liveStatus)}</dd>
            <dt>Server poll</dt><dd>every ${cfg.pollSeconds}s</dd>
            <dt>Auto-refresh</dt><dd>${ui.escapeHtml(document.querySelector('#auto-refresh')?.selectedOptions?.[0]?.textContent || 'Every 30 s')}</dd>
            <dt>Min interval</dt><dd>${cfg.minAutoRefresh}s</dd>
            <dt>Lazy chunk</dt><dd>${ctx.store.state.chunkSize} rows</dd>
          </dl>
          <div class="field" style="margin-top:14px"><label for="chunk-size">Rows rendered per lazy chunk</label>
            <div class="input-group"><input class="input" id="chunk-size" type="number" min="10" max="500" step="10" value="${ctx.store.state.chunkSize}">
              <button class="btn" type="button" data-chunk>Apply</button></div></div>
          <p class="hint muted" style="margin-top:9px">Tabs and their JavaScript are loaded only when you open them; tables render rows in chunks as you scroll.</p>
          </div></section>

        <section class="card">
          <div class="card-head"><div><h2>Endpoints &amp; diagnostics</h2><p>Adapt these in .env if your API differs.</p></div>
            <button class="btn btn--xs" type="button" data-copy-diag>${ui.icon('copy')} Copy config</button></div>
          <div class="card-body"><dl class="kv">
            <dt>Decisions</dt><dd>GET ${ui.escapeHtml(endpoints.decisions)}</dd>
            <dt>IP detail</dt><dd>GET ${ui.escapeHtml(endpoints.ip)}/{ip}</dd>
            <dt>Unblock</dt><dd>POST ${ui.escapeHtml(endpoints.unblock)}?ip=</dd>
            <dt>Block</dt><dd>POST ${ui.escapeHtml(endpoints.block)}?ip=</dd>
            <dt>Allow list</dt><dd>GET/POST ${ui.escapeHtml(endpoints.allowlist)}</dd>
            <dt>Delete method</dt><dd>${ui.escapeHtml(cfg.allowlistDeleteMethod || 'DELETE')}</dd>
            <dt>Write params</dt><dd>${ui.escapeHtml(cfg.writeParamsMode || 'query')}</dd>
          </dl>
          <div class="row" style="margin-top:14px">
            <button class="btn btn--xs" type="button" data-raw="decisions">${ui.icon('file')} Raw decisions</button>
            <button class="btn btn--xs" type="button" data-raw="allowed_ips">${ui.icon('file')} Raw allow list</button>
            <button class="btn btn--xs" type="button" data-go="commands">${ui.icon('terminal')} Commands</button>
          </div>
          <p class="hint muted" style="margin-top:10px">If your upstream uses different JSON field names, use the raw viewer and add them to <code class="mono">src/Normalizer.php</code>.</p>
          </div></section>
      </div>
      <section class="card" style="margin-top:16px">
        <div class="card-head"><div><h2>Local preferences</h2><p>Stored in this browser only.</p></div></div>
        <div class="card-body row">
          <button class="btn" type="button" data-toggle-theme>${ui.icon('moon')} Toggle theme</button>
          <button class="btn" type="button" data-clear-events>${ui.icon('trash')} Clear server event log</button>
          <button class="btn btn--danger" type="button" data-reset>${ui.icon('refresh')} Reset local preferences</button>
        </div>
      </section>`;

    bind();
  }

  function bind() {
    el.querySelector('[data-creds]').addEventListener('submit', async (event) => {
      event.preventDefault();
      const form = event.currentTarget;
      await ctx.actions.saveCredentials(form.elements.apiKey.value.trim(), form.elements.server.value.trim());
      render();
    });
    el.querySelector('[data-show-key]').addEventListener('click', () => {
      const input = el.querySelector('#api-key');
      input.type = input.type === 'password' ? 'text' : 'password';
    });
    el.querySelector('[data-clear-key]').addEventListener('click', async () => {
      await ctx.actions.clearCredentials();
      testResult = null;
      render();
    });
    el.querySelector('[data-test]').addEventListener('click', async () => {
      testing = true; render();
      try {
        const response = await ctx.api.test();
        testResult = { ok: true, message: response.test?.message || response.message, detail: `HTTP ${response.test?.status} · ${response.test?.latencyMs} ms` };
        ctx.ui.toast({ title: 'Connection test passed', message: `${testResult.message} (${testResult.detail})` }, 'success');
      } catch (e) {
        testResult = { ok: false, message: e.message, detail: '' };
        ctx.ui.toast({ title: 'Connection test failed', message: e.message }, 'error');
      } finally { testing = false; render(); }
    });
    el.querySelector('[data-chunk]').addEventListener('click', () => {
      const value = Number(el.querySelector('#chunk-size').value);
      ctx.store.setChunk(value);
      ctx.ui.toast(`Lazy chunk set to ${ctx.store.state.chunkSize} rows`, 'success', 1800);
      ctx.renderActive();
    });
    el.querySelector('[data-copy-diag]').addEventListener('click', async () => {
      const safe = { ...ctx.cfg };
      delete safe.csrf;
      delete safe.access;
      const ok = await ctx.ui.copy(JSON.stringify(safe, null, 2));
      ctx.ui.toast(ok ? 'Redacted config copied' : 'Copy failed', ok ? 'success' : 'error', 1800);
    });
    el.querySelectorAll('[data-raw]').forEach((button) => button.addEventListener('click', async () => {
      try {
        const response = await ctx.api.raw(button.dataset.raw);
        ctx.ui.jsonDialog(`Raw response — ${button.dataset.raw}`, response.raw);
      } catch (e) { ctx.ui.toast(e.message, 'error'); }
    }));
    const go = el.querySelector('[data-go]');
    if (go) go.addEventListener('click', () => ctx.navigate(go.dataset.go));
    el.querySelector('[data-toggle-theme]').addEventListener('click', () => ctx.toggleTheme());
    el.querySelector('[data-clear-events]').addEventListener('click', async () => {
      const ok = await ctx.ui.confirmDialog({ title: 'Clear the server event log?', danger: true, confirmText: 'Clear', message: 'This deletes data/events.jsonl. IP lists are not affected.' });
      if (!ok) return;
      try { await ctx.api.clearEvents(); ctx.store.setEvents([]); ctx.ui.toast('Event log cleared', 'success'); }
      catch (e) { ctx.ui.toast(e.message, 'error'); }
    });
    el.querySelector('[data-reset]').addEventListener('click', async () => {
      const ok = await ctx.ui.confirmDialog({ title: 'Reset browser preferences?', confirmText: 'Reset', message: 'Clears theme, auto-refresh, command variables and chunk size stored in this browser.' });
      if (!ok) return;
      ['ipa.theme', 'ipa.autorefresh', 'ipa.live', 'ipa.chunk', 'ipa.commandVars', 'ipa.commandFormat', 'ipa.recentLookups'].forEach((k) => localStorage.removeItem(k));
      ctx.ui.toast('Preferences reset — reloading…', 'success', 1200);
      setTimeout(() => location.reload(), 800);
    });
  }

  function update() {
    // Avoid rebuilding the form while the user is typing; refresh only live bits.
    const status = el?.querySelector('[data-live-status]');
    if (status) status.textContent = ctx.store.state.liveStatus;
  }

  return { mount, update };
}
