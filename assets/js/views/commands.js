/* Search commands tab: filterable, copyable curl / PowerShell / HTTP snippets. */

const VARS_KEY = 'ipa.commandVars';

export function create(ctx) {
  let el = null;
  let format = localStorage.getItem('ipa.commandFormat') || 'curl';
  let group = '';
  let query = '';
  let vars = { ip: '37.18.129.253', cidr: '37.18.129.253', comment: 'tango', reason: 'manual block from console', duration: '4h' };
  try { vars = { ...vars, ...JSON.parse(localStorage.getItem(VARS_KEY) || '{}') }; } catch { /* keep defaults */ }

  function mount(container) {
    el = container;
    if (ctx.pendingCommandVars) {
      vars = { ...vars, ...ctx.pendingCommandVars };
      ctx.pendingCommandVars = null;
    }
    el.innerHTML = `
      <section class="card" style="margin-bottom:16px">
        <div class="card-head"><div><h2>Search commands</h2>
          <p>All calls the console makes, ready to copy. Your API key is replaced by <code class="mono">$APIKey</code>.</p></div>
          <div class="segmented" data-formats>
            <button type="button" data-format="curl">curl</button>
            <button type="button" data-format="powershell">PowerShell</button>
            <button type="button" data-format="http">Raw HTTP</button>
          </div></div>
        <div class="card-body">
          <div class="cmd-vars" data-vars>
            ${[['ip', 'IP address'], ['cidr', 'CIDR / allow-list IP'], ['comment', 'Comment'], ['reason', 'Block reason'], ['duration', 'Duration']]
              .map(([key, label]) => `<div class="field"><label for="var-${key}">${label}</label>
                <input class="input input--mono" id="var-${key}" data-var="${key}" value="${ctx.ui.escapeHtml(vars[key] || '')}" autocomplete="off" spellcheck="false"></div>`).join('')}
          </div>
          <div class="row" style="margin-top:14px">
            <label class="search-mini" style="max-width:420px">${ctx.ui.icon('search')}
              <input type="search" data-q placeholder="Search commands: unblock, allow list, decisions…" autocomplete="off"></label>
            <span class="spacer"></span>
            <div class="chips" data-groups></div>
          </div>
        </div>
      </section>
      <div class="notice notice--info" style="margin-bottom:16px">${ctx.ui.icon('key')}
        <span>These snippets use the server and endpoints from Settings. Set <code class="mono">$APIKey</code> in your shell first — the key is never written into the page or logs.
        For PowerShell on Windows, use <code class="mono">Invoke-RestMethod</code> (not curl, which is an alias).</span></div>
      <div class="cmd-grid" data-cards></div>`;

    el.addEventListener('input', ctx.ui.debounce((event) => {
      if (event.target.matches('[data-q]')) { query = event.target.value; renderCards(); }
      if (event.target.matches('[data-var]')) {
        vars[event.target.dataset.var] = event.target.value;
        localStorage.setItem(VARS_KEY, JSON.stringify(vars));
        renderCards();
      }
    }, 160));
    el.addEventListener('click', async (event) => {
      const fmt = event.target.closest('[data-format]');
      if (fmt) {
        format = fmt.dataset.format;
        localStorage.setItem('ipa.commandFormat', format);
        render();
        return;
      }
      const chip = event.target.closest('[data-group]');
      if (chip) { group = chip.dataset.group === group ? '' : chip.dataset.group; render(); return; }
      const copyBtn = event.target.closest('[data-copy-cmd]');
      if (copyBtn) {
        const command = commands().find((c) => c.id === copyBtn.dataset.copyCmd);
        if (!command) return;
        const ok = await ctx.ui.copy(ctx.commands.renderCommand(command, format, ctx.cfg));
        ctx.ui.toast(ok ? `${command.title} — ${format} command copied` : 'Copy failed', ok ? 'success' : 'error', 1800);
      }
    });
    render();
  }

  function commands() {
    return ctx.commands.commandList(ctx.cfg, vars);
  }

  function render() {
    if (!el) return;
    el.querySelectorAll('[data-format]').forEach((button) => button.classList.toggle('is-active', button.dataset.format === format));
    const q = el.querySelector('[data-q]');
    if (q && q.value !== query) q.value = query;
    el.querySelectorAll('[data-var]').forEach((input) => {
      if (input.value !== (vars[input.dataset.var] || '')) input.value = vars[input.dataset.var] || '';
    });
    const all = commands();
    el.querySelector('[data-groups]').innerHTML = ctx.commands.commandGroups(all)
      .map((g) => `<button class="chip" type="button" data-group="${ctx.ui.escapeHtml(g)}" style="${g === group ? 'border-color:var(--accent);color:var(--accent)' : ''}">${ctx.ui.escapeHtml(g)}</button>`).join('');
    renderCards();
  }

  function renderCards() {
    if (!el) return;
    const all = commands();
    const q = query.trim().toLowerCase();
    const list = all.filter((c) => (!group || c.group === group) && (!q || c.keywords.includes(q)));
    el.querySelector('[data-cards]').innerHTML = list.length
      ? list.map((command) => `
        <article class="cmd-card">
          <div class="cmd-card-head">${ctx.ui.icon(command.icon)}<div><h3>${ctx.ui.escapeHtml(command.title)}</h3>
            <p>${ctx.ui.escapeHtml(command.description)}</p></div>
            <span class="badge ${command.method === 'GET' ? 'badge--blue' : 'badge--amber'}">${ctx.ui.escapeHtml(command.method)}</span></div>
          <pre class="cmd-code">${ctx.ui.escapeHtml(ctx.commands.renderCommand(command, format, ctx.cfg))}</pre>
          <div class="cmd-foot"><span>${ctx.ui.escapeHtml(command.group)} · ${ctx.ui.escapeHtml(command.path)}</span>
            <span class="spacer"></span>
            <button class="btn btn--xs" type="button" data-copy-cmd="${ctx.ui.escapeHtml(command.id)}">${ctx.ui.icon('copy')} Copy</button></div>
        </article>`).join('')
      : `<div class="card">${ctx.ui.emptyState('No matching commands', 'Try “unblock”, “allow”, “decisions” or clear the search.', 'terminal')}</div>`;
  }

  return { mount, update: render };
}
