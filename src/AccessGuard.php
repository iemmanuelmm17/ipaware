<?php
declare(strict_types=1);

namespace IpAware;

final class AccessGuard
{
    private Config $cfg;

    public function __construct(Config $cfg)
    {
        $this->cfg = $cfg;
    }

    public function clientIp(): string
    {
        $remote = trim((string) ($_SERVER['REMOTE_ADDR'] ?? ''));
        $trusted = Support::csv($this->cfg->get('TRUSTED_PROXIES', ''));
        $isTrusted = false;
        foreach ($trusted as $range) {
            if (Support::cidrContains($range, $remote)) {
                $isTrusted = true;
                break;
            }
        }
        if (!$isTrusted) {
            return $remote;
        }

        $header = trim((string) $this->cfg->get('CLIENT_IP_HEADER', ''));
        $header = $header !== '' ? $header : 'X-Forwarded-For';
        $serverKey = 'HTTP_' . strtoupper(str_replace('-', '_', $header));
        $raw = (string) ($_SERVER[$serverKey] ?? '');
        if ($raw === '') {
            return $remote;
        }
        // Walk right-to-left, skipping proxies we trust, to find the real client.
        $chain = array_reverse(array_map('trim', explode(',', $raw)));
        $candidate = $remote;
        foreach ($chain as $hop) {
            $hop = trim($hop);
            if ($hop === '' || !Support::isIp($hop)) {
                continue;
            }
            $candidate = $hop;
            $hopIsTrusted = false;
            foreach ($trusted as $range) {
                if (Support::cidrContains($range, $hop)) {
                    $hopIsTrusted = true;
                    break;
                }
            }
            if (!$hopIsTrusted) {
                break;
            }
        }
        return $candidate;
    }

    /** @return array{allowed:bool,reason:string,ip:string} */
    public function check(?string $ip = null): array
    {
        $ip = trim($ip ?? $this->clientIp());
        if (!Support::isIp($ip)) {
            return ['allowed' => false, 'reason' => 'Invalid or missing client IP address.', 'ip' => $ip];
        }

        if ($this->cfg->bool('REQUIRE_PUBLIC_IP', true)
            && !Support::isPublicIp($ip)
            && !(Support::isLoopback($ip) && $this->cfg->bool('DEV_ALLOW_LOCALHOST', true))) {
            return ['allowed' => false, 'reason' => 'Private/reserved source addresses are not allowed.', 'ip' => $ip];
        }

        foreach (Support::csv($this->cfg->get('ADMIN_ALLOWED_IPS', '')) as $entry) {
            if (Support::cidrContains($entry, $ip)) {
                return ['allowed' => true, 'reason' => 'Matched allowlist entry.', 'ip' => $ip];
            }
        }

        if (Support::isLoopback($ip) && $this->cfg->bool('DEV_ALLOW_LOCALHOST', true)) {
            return ['allowed' => true, 'reason' => 'Local development bypass (DEV_ALLOW_LOCALHOST=true).', 'ip' => $ip];
        }

        return ['allowed' => false, 'reason' => 'Your IP is not in ADMIN_ALLOWED_IPS.', 'ip' => $ip];
    }

    public function enforce(string $format = 'html'): string
    {
        Support::securityHeaders($this->cfg->isHttps());
        $result = $this->check();
        if ($result['allowed']) {
            return $result['ip'];
        }

        $this->logDenied($result['ip'], $result['reason']);
        http_response_code(403);
        header('Cache-Control: no-store, no-cache, must-revalidate');

        if ($format === 'json') {
            header('Content-Type: application/json; charset=utf-8');
            echo json_encode([
                'ok' => false,
                'error' => 'forbidden',
                'message' => 'Access denied. This console is restricted to approved public IP addresses.',
                'reason' => $result['reason'],
                'ip' => $result['ip'],
            ], JSON_UNESCAPED_SLASHES);
            exit;
        }

        header('Content-Type: text/html; charset=utf-8');
        $name = htmlspecialchars((string) $this->cfg->get('APP_NAME', 'IPAware Console'), ENT_QUOTES);
        $ip = htmlspecialchars($result['ip'], ENT_QUOTES);
        $reason = htmlspecialchars($result['reason'], ENT_QUOTES);
        echo '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">'
            . '<title>403 - Access denied - ' . $name . '</title><style>'
            . 'body{margin:0;min-height:100vh;display:grid;place-items:center;background:#0b1120;color:#e2e8f0;font:16px/1.6 system-ui,-apple-system,Segoe UI,Roboto,sans-serif}'
            . '.box{max-width:34rem;padding:2.5rem;border:1px solid #1e293b;border-radius:18px;background:#111c2e;box-shadow:0 24px 60px #0006}'
            . 'h1{margin:0 0 .5rem;font-size:1.5rem;color:#f8fafc}.code{font-size:3.5rem;font-weight:800;color:#f87171;letter-spacing:-.05em}'
            . 'p{color:#94a3b8}code{background:#0b1120;padding:.15rem .4rem;border-radius:6px;color:#67e8f9;font-size:.9rem}'
            . '</style></head><body><div class="box"><div class="code">403</div><h1>Access denied</h1>'
            . '<p>' . $name . ' is only reachable from approved public IP addresses.</p>'
            . '<p>Your address: <code>' . $ip . '</code><br>' . $reason . '</p>'
            . '<p>Admin: add your public IP to <code>ADMIN_ALLOWED_IPS</code> in <code>.env</code>.</p>'
            . '</div></body></html>';
        exit;
    }

    private function logDenied(string $ip, string $reason): void
    {
        $line = gmdate('c') . "\t" . $ip . "\t" . str_replace(["\r", "\n", "\t"], ' ', $reason) . "\t"
            . substr((string) ($_SERVER['REQUEST_URI'] ?? ''), 0, 200) . "\n";
        @file_put_contents($this->cfg->dataDir() . '/access-denied.log', $line, FILE_APPEND | LOCK_EX);
    }
}
