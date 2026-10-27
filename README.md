# IPAware Console

A single-page PHP 8.2 + vanilla JavaScript console for the IPAware firewall API.

- **Single page with tabs** — Overview, Blocked IPs, Whitelist, IP lookup, Live events and Settings. Switching tabs changes the URL hash (`#/decisions`) but never reloads the page.
- **Lazy loading** — every tab's JavaScript is a separate ES module that is `import()`-ed only the first time you open it; tables render rows in chunks via `IntersectionObserver` as you scroll (30 rows at a time by default), with a manual **Load more** fallback.
- **Read events to update** — `stream.php` is a Server-Sent Events endpoint. It tails `data/events.jsonl` and, every `SSE_POLL_SECONDS`, re-reads decisions + allow list, diffs them, and pushes `sync`, `activity`, `notice` and `heartbeat` events to the browser. Lists update without a full page refresh.
- **Auto-refresh options** — Off / 15s / 30s / 60s / 5min in the toolbar, plus a **Live** SSE switch when the server supports it. Polling is the fallback; refreshes pause while the tab is hidden.
- **Search for an IP** — global search in the header filters every table (supports `ip:`, `kind:`, `reason:`, `source:`, `scenario:` field filters); pressing Enter on an IP jumps to IP Lookup.
- **Block / unblock / allow-list** — row actions and quick-action dialogs call the upstream API. Destructive actions ask for confirmation.
- **Quick actions** — `Ctrl+K` / `Cmd+K` searches navigation and common actions.
- **Tables** — one combined table on Overview plus dedicated blocked and whitelist tables. The main table shows IP, when it was added (US date and time) and the explanation of the block. The whitelist also shows source, comment, added by, country, city, domain, added and expiry dates. Click a row or its IP (or focus the row and press Enter/Space) to open the complete upstream record, including nested fields. The popup also has a raw JSON viewer and copy button.
- **IP lookup** — groups the complete upstream record into readable sections, including scores, activity, local enforcement, history, location and risk. Null, false, zero and empty values remain visible; the full untruncated response is available as raw JSON. A historical score is not treated as a current block.
- **Notifications** — every message (success, failure, error, warning) is a toast. Errors stay until you close them; press **Esc** (or click the toast) to close toasts. All dates and times use US format (MM/DD/YYYY, 12-hour clock).
- **Export to Excel** — `export.php` builds a real multi-sheet `.xlsx` (All IPs / Blocked / Whitelist / Summary) using PHP's `ZipArchive`. If the `zip` extension is missing it automatically falls back to an Excel-compatible UTF-8 CSV. CSV is also available directly.
- **API key field** — Settings → API key. The key is stored in the PHP session (never in `localStorage`, never returned to the browser, never logged). An `API_KEY` value in `.env.local` can be used as a fallback.
- **IP allowlist access control** — every PHP entry point runs `AccessGuard` before doing anything. Only IPs in `ADMIN_ALLOWED_IPS` (`.env`) can open the page, the API, the SSE stream, JS/CSS assets, or exports. It fails closed.

No CDN, no build step, no npm packages for the deployed app, no framework. Works offline.

---

## 1. Files

```
index.php                  SPA HTML shell (renders templates/app.html)
api.php                    JSON API: snapshot, lists, lookup, block/unblock/allow, events, key
stream.php                 Server-Sent Events live update stream
export.php                 Excel/CSV export (POST + CSRF)
asset.php                  serves guarded JS/CSS (assets/ is blocked from direct access)
assets/css/app.css         all styles (dark + light)
assets/js/app.js           bootstrap, routing, toolbar, keyboard shortcuts
assets/js/api.js           fetch + EventSource client
assets/js/store.js         state, filters, sorting
assets/js/table.js         lazy table renderer
assets/js/ui.js            helpers, toasts, dialogs
assets/js/palette.js       Ctrl+K quick actions
assets/js/views/*.js       one module per tab (loaded on demand)
src/                       PHP classes (Env, Config, AccessGuard, App, HttpClient,
                           Upstream, DemoUpstream, Normalizer, EventLog, Xlsx, Exporter)
templates/app.html         HTML template shared by PHP and the optional preview
.env                       committed config with SAFE placeholder values
.env.example               documented config template
.env.local                 (you create it; git-ignored) real secrets / overrides
dev/router.php             router for PHP's built-in server (enforces the allowlist)
dev/preview.mjs            optional Node mock backend — preview only, not needed to deploy
tests/                     CLI regression tests and sanitized decision, lookup and allow-list fixtures
data/                      runtime state (git-ignored): events.jsonl, sessions, demo-state.json
```

---

## 2. Configuration

Edit `.env`. Put real secrets in `.env.local` (same keys, overrides `.env`, git-ignored) or type the key into the UI.

### Access control (the important part)

```dotenv
ADMIN_ALLOWED_IPS=112.198.77.21,112.198.77.22/32,2001:db8:1::/48
REQUIRE_PUBLIC_IP=true
DEV_ALLOW_LOCALHOST=true        # set false in production
TRUSTED_PROXIES=                # e.g. 10.0.0.4 if behind your own reverse proxy
CLIENT_IP_HEADER=               # e.g. X-Forwarded-For (only used with TRUSTED_PROXIES)
```

- The shipped values (`203.0.113.10`, `198.51.100.25`, `2001:db8::/32`) are **documentation addresses**. Replace them with your real public IP(s), otherwise nobody except localhost can get in.
- **Fail closed:** an empty `ADMIN_ALLOWED_IPS` denies everyone (except the optional localhost dev bypass).
- `REQUIRE_PUBLIC_IP=true` rejects private/reserved source addresses even if someone lists them.
- `DEV_ALLOW_LOCALHOST=true` exists so you can run the console on your own PC. **Set it to `false` before exposing the site.**
- Behind a reverse proxy: set `TRUSTED_PROXIES` to the proxy's IP and `CLIENT_IP_HEADER=X-Forwarded-For` (or `CF-Connecting-IP`). The guard walks the forwarded chain right-to-left and skips trusted hops. Never trust forwarded headers from untrusted peers.
- The guard applies to `index.php`, `api.php`, `stream.php`, `export.php` **and** `asset.php`. `.htaccess` (Apache) and `web.config` (IIS) add defense in depth by denying `src/`, `data/`, `dev/`, `templates/`, `assets/`, `.env*`.

### Upstream API

```dotenv
APP_MODE=auto                # auto|demo|live ; auto = live when API_BASE_URL is set
API_BASE_URL=https://your-server.example.com
API_VERIFY_TLS=true
API_TIMEOUT=12
AUTH_SCHEME=Bearer           # Bearer | ApiKey | raw
ENDPOINT_DECISIONS=/ipaware/decisions
ENDPOINT_IP=/ipaware/ip
ENDPOINT_BLOCK=/ipaware/firewall/block
ENDPOINT_UNBLOCK=/ipaware/firewall/unblock
ENDPOINT_ALLOWLIST=/ipaware/allowed_ips
WRITE_PARAMS_MODE=query      # query | json
ALLOWLIST_DELETE_METHOD=DELETE
```

If `API_BASE_URL` already includes `/ipaware`, change the endpoints to `/decisions`, `/ip/...`, etc.
`AUTH_SCHEME=raw` sends `Authorization: <key>` (matching the first curl example you gave, which omitted `Bearer`); the default `Bearer` matches the rest. With `APP_MODE=auto`, saving a server URL in Settings switches that session to the live API; explicit `APP_MODE=demo` remains in demo mode.

### Live events

```dotenv
SSE_ENABLED=true
SSE_POLL_SECONDS=8
SSE_MAX_SECONDS=300
MIN_AUTO_REFRESH=10
MAX_EVENTS=1500
```

`SSE_MAX_SECONDS` recycles long-lived PHP workers; the browser reconnects automatically. SSE is automatically disabled on PHP’s built-in development server because a long-lived stream can block other requests. Use auto-refresh there. On Apache/FPM with few workers, set `SSE_ENABLED=false` if streams use up the available workers.

### Demo mode

Leave `API_BASE_URL` empty and the console runs against a built-in deterministic demo upstream (`src/DemoUpstream.php`) with ~190 blocked IPs and ~30 allow-list entries. All actions work and persist in `data/demo-state.json`, and the stream simulates upstream changes. A **Demo data** badge makes it obvious.

---

## 3. API mapping

Your examples map to these endpoints (all requests are proxied by `api.php`, so the API key never reaches the browser):

| What you asked for | Console action | Upstream call |
| --- | --- | --- |
| What was blocked and why | `GET api.php?action=decisions` | `GET {base}/ipaware/decisions` |
| Know about an address | `GET api.php?action=ip&ip=…` | `GET {base}/ipaware/ip/{ip}` |
| Release IP | `POST api.php?action=unblock` | `POST {base}/ipaware/firewall/unblock?ip=…` |
| Allow list add | `POST api.php?action=allow` | `POST {base}/ipaware/allowed_ips?cidr=…&comment=…` |
| On allow list | `GET api.php?action=allowed_ips` | `GET {base}/ipaware/allowed_ips` |
| Block IP (not in your examples) | `POST api.php?action=block` | `POST {base}/ipaware/firewall/block?ip=…&reason=…&duration=…` |
| Remove from allow list (not in your examples) | `POST api.php?action=unallow` | `DELETE {base}/ipaware/allowed_ips?cidr=…` |

All upstream calls send `Authorization: Bearer <APIKey>` (or the configured scheme), `Accept: application/json`, TLS verification, and timeouts. `src/Normalizer.php` accepts a single decision, arrays, common wrappers such as `{data:[…]}`, `{decisions:[…]}`, `{blockedIps:[…]}`, `{allowed_ips:[…]}` and `{items:[…]}`, nested/CrowdSec-style addresses, and IPv4/IPv6 string lists. Server metadata is not treated as an address list. The full upstream record is kept for the row popup. If a nonempty response cannot be recognized, the list displays a diagnostic; **Settings → Raw decisions / Raw allow list** provides a size-limited response preview.

### Things I assumed — please confirm

1. **Block endpoint:** you only gave an unblock example. I assumed `POST /ipaware/firewall/block?ip=<ip>&reason=<text>&duration=<duration>`. If the real path/method/params differ, change `ENDPOINT_BLOCK`, `WRITE_PARAMS_MODE` (set `json` for a JSON body), or edit `Upstream::block()`.
2. **Removing a whitelist entry:** assumed `DELETE /ipaware/allowed_ips?cidr=<cidr>`. Change `ALLOWLIST_DELETE_METHOD=POST` (and add an `action=delete` style param in `Upstream::unallow()`) if your API differs.
3. **Auth header:** assumed `Authorization: Bearer <key>` for all calls; one of your examples omitted `Bearer`. Set `AUTH_SCHEME=raw` for `Authorization: <key>` or `AUTH_SCHEME=ApiKey` for `X-API-Key: <key>`.
4. **"Read events to update"** — interpreted as a live SSE event stream that re-reads decisions/allow list and pushes changes, plus configurable polling. If you meant an existing upstream `/events` endpoint, tell me its path and I'll add `ENDPOINT_EVENTS` and consume it directly.

---

## 4. Security notes

- API key: session-only via the UI, or `.env.local` (never committed). Never put a real key in tracked `.env`; anyone with repository access could read it from Git history. It is never included in JSON responses, logs, or exports.
- Sessions use `HttpOnly`, `SameSite=Strict`, `Secure` on HTTPS, strict mode, and live under `data/sessions`.
- All state-changing `api.php` calls and the export require a per-session CSRF token (`X-CSRF-Token`).
- Security headers on every response: CSP (`default-src 'self'`, no inline scripts), `nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy`, HSTS on HTTPS.
- `.env*`, `src/`, `data/`, `templates/`, `dev/`, `tests/`, `assets/`, `.git*` are blocked by `.htaccess` / `web.config` / `dev/router.php`.
- The upstream URL is validated (http/https only, no credentials/query/fragment) before a runtime override is accepted. Set `ALLOW_RUNTIME_SERVER_OVERRIDE=false` to lock the server URL to `.env`.
- All client-supplied IPs/CIDRs are validated with `filter_var` and a custom IPv4/IPv6 CIDR matcher before being sent upstream.

---

## 5. Troubleshooting

| Symptom | Fix |
| --- | --- |
| 403 Access denied on a public server | Add your public IP to `ADMIN_ALLOWED_IPS`; check `REQUIRE_PUBLIC_IP`; if behind a proxy set `TRUSTED_PROXIES` + `CLIENT_IP_HEADER`. |
| Need access from a LAN IP (192.168.x.x) | Set `REQUIRE_PUBLIC_IP=false` and add e.g. `192.168.1.0/24` to `ADMIN_ALLOWED_IPS`. Do this only on a trusted network. |
| "API key required" | Settings → API key, or set `API_KEY` in `.env.local`. |
| "No upstream server configured" | Set `API_BASE_URL` in `.env` (or `APP_MODE=demo`). |
| HTTP 401/403 from upstream | Wrong key or wrong scheme → `AUTH_SCHEME=raw`/`ApiKey`. |
| Blocked list empty | Check the server, API key and mode in Settings. If the response shape is unrecognized, the list shows a warning; open Settings → Raw decisions to inspect it. |
| Live stream unavailable or reconnecting | PHP’s built-in server uses auto-refresh instead of SSE. For other servers, a proxy may buffer SSE; disable it (`SSE_ENABLED=false`) or check `X-Accel-Buffering: no` on nginx. |
| Export downloads `.csv` instead of `.xlsx` | Enable PHP `ext-zip`. The CSV fallback still opens in Excel. |
| Styles/JS 404 | Your web server must allow `asset.php?f=…`. Do not serve `assets/` directly — it is intentionally blocked. |
| Errors | Check `data/error.log` and `data/access-denied.log`. Set `APP_DEBUG=true` temporarily. |

### Regression tests

With PHP 8.2+ and Node installed, run from the repository root:

```sh
php tests/normalizer.php
php tests/config.php
node --test tests/ui.mjs
node tests/live-integration.mjs
node tests/php-server.mjs
node tests/preview.mjs
```

The integration tests use temporary local servers and a fake API key; they do not contact a real upstream. The PHP-server test covers polling, the nested IP view and allow-list records, and preservation of full raw JSON. Set `PHP_BIN` if the PHP executable is not named `php`. To also run the optional browser checks, set `IPAWARE_PLAYWRIGHT_MODULE` to the absolute path of Playwright Core's `index.mjs` and `IPAWARE_CHROMIUM_EXECUTABLE` to a Chromium executable.

---

## 6. Optional preview (no PHP needed)

A Node mock backend renders the exact same template and front-end assets so you can explore the UI without PHP:

```bash
node dev/preview.mjs       # http://localhost:3000
```

This is **preview only** with sample data. It cannot connect to a real IPAware server and intentionally refuses API keys and server configuration. It does not implement the IP allowlist or other PHP security controls — run or deploy the PHP files for real use.

---

## 7. Deploy on your local PC — `D:\www\ipaware`

**Step 1 — Copy the project**

```powershell
mkdir D:\www\ipaware
xcopy /E /I /Y C:\path\to\this\repo\* D:\www\ipaware\
```

(or `git clone <your-repo-url> D:\www\ipaware`). Make sure `index.php`, `.env`, `src\`, `assets\` and `templates\` are directly inside `D:\www\ipaware`.

**Step 2 — PHP 8.2**

Install PHP 8.2 (XAMPP / Laragon / plain php.net zip). Required extensions: `curl` (or `allow_url_fopen`), `json`, `session`, `mbstring`, `fileinfo`, and `zip` for real `.xlsx` export. Check:

```powershell
php -v
php -m            # look for curl, mbstring, fileinfo, zip
```

In `php.ini`, enabling `extension=curl`, `extension=mbstring`, `extension=fileinfo` and `extension=zip` is enough (Windows DLLs ship with PHP).

**Step 3 — Edit `.env`**

Open `D:\www\ipaware\.env` in Notepad and set:

```dotenv
ADMIN_ALLOWED_IPS=YOUR_REAL_PUBLIC_IP
REQUIRE_PUBLIC_IP=true
DEV_ALLOW_LOCALHOST=true
API_BASE_URL=https://your-server.example.com
```

For local testing with sample data, leave `API_BASE_URL` empty (`APP_MODE=auto` switches to demo). When you put this on a real server, set `DEV_ALLOW_LOCALHOST=false`. Create `.env.local` (git-ignored) if you want to store `API_KEY=` there instead of typing it in the UI.

Make sure PHP can write `D:\www\ipaware\data` (sessions, event log, demo state).

**Step 4 — Run it (choose one)**

**Option A — PHP's built-in server (fastest, no Apache config):**

```powershell
cd /d D:\www\ipaware
php -S 127.0.0.1:8080 -t . dev\router.php
```

Open **http://127.0.0.1:8080/**. `dev\router.php` is important: the built-in server ignores `.htaccess`, and the router enforces the IP allowlist and blocks private directories for every request. Live SSE is disabled on this server to prevent stalled requests; choose an auto-refresh interval instead.

**Option B — XAMPP / Apache:**

1. Put the project in `D:\www\ipaware` (or `C:\xampp\htdocs\ipaware`).
2. Create a VirtualHost whose `DocumentRoot` is `D:\www\ipaware` (or just browse `http://localhost/ipaware/`).
3. Enable `mod_rewrite` and `mod_headers`, and allow `.htaccess` overrides (`AllowOverride All`) so the hardening rules apply. PHP 8.2 must be the active Apache PHP module / FPM handler.
4. Restart Apache and open **http://localhost/ipaware/**.

**Option C — nginx:**

Use the PHP-FPM fastcgi config and deny private paths:

```nginx
server {
    listen 8080;
    root D:/www/ipaware;
    index index.php;
    location ~ ^/(src|data|dev|tests|templates|assets)/ { deny all; }
    location ~ /\.(env|git|htaccess) { deny all; }
    location / { try_files $uri $uri/ /index.php?$query_string; }
    location ~ \.php$ {
        include fastcgi_params;
        fastcgi_pass 127.0.0.1:9000;
        fastcgi_param SCRIPT_FILENAME $document_root$fastcgi_script_name;
        fastcgi_buffering off;      # required for stream.php SSE
        gzip off;
    }
}
```

**Step 5 — First run**

1. Open the site. You should see the console and a **Demo data** or **Live API** badge.
2. Go to **Settings → API key**, paste your key, optionally set the server URL, and click **Save for this session**. Click **Test connection**.
3. Open **Overview** → press **Refresh**. Set **Auto-refresh** to your preferred interval; on supported servers, leave **Live** on for push updates.
4. Use the global search or **IP lookup** for an address; use the row actions to **Release**, **Block**, or **Add to allow list**.
5. Click **Export → Excel workbook (.xlsx)** to download the tables.

**Step 6 — Before exposing it beyond your PC**

Set `DEV_ALLOW_LOCALHOST=false`, put only your real public IP(s) in `ADMIN_ALLOWED_IPS`, enable HTTPS (so session cookies are `Secure` and HSTS is sent), keep `.env.local` out of Git, and confirm `data/` is not web-readable.
