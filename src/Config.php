<?php
declare(strict_types=1);

namespace IpAware;

final class Config
{
    public const VERSION = '1.0.0';

    private array $vars;
    private string $root;
    private string $dataDir;

    public function __construct(string $root)
    {
        $this->root = rtrim($root, DIRECTORY_SEPARATOR);
        $defaults = [
            'APP_NAME' => 'IPAware Console',
            'APP_MODE' => 'auto',
            'APP_DEBUG' => 'false',
            'TIMEZONE' => 'UTC',
            'ADMIN_ALLOWED_IPS' => '',
            'REQUIRE_PUBLIC_IP' => 'true',
            'DEV_ALLOW_LOCALHOST' => 'true',
            'TRUSTED_PROXIES' => '',
            'CLIENT_IP_HEADER' => '',
            'API_BASE_URL' => '',
            'API_KEY' => '',
            'API_VERIFY_TLS' => 'true',
            'API_TIMEOUT' => '12',
            'AUTH_SCHEME' => 'Bearer',
            'ENDPOINT_DECISIONS' => '/ipaware/decisions',
            'ENDPOINT_IP' => '/ipaware/ip',
            'ENDPOINT_BLOCK' => '/ipaware/firewall/block',
            'ENDPOINT_UNBLOCK' => '/ipaware/firewall/unblock',
            'ENDPOINT_ALLOWLIST' => '/ipaware/allowed_ips',
            'WRITE_PARAMS_MODE' => 'query',
            'ALLOWLIST_DELETE_METHOD' => 'DELETE',
            'ALLOW_RUNTIME_SERVER_OVERRIDE' => 'true',
            'SSE_ENABLED' => 'true',
            'SSE_POLL_SECONDS' => '8',
            'SSE_MAX_SECONDS' => '300',
            'MIN_AUTO_REFRESH' => '10',
            'MAX_EVENTS' => '1500',
            'DATA_DIR' => './data',
            'DEMO_SEED' => '1337',
        ];
        $this->vars = array_merge($defaults, Env::load([
            $this->root . '/.env',
            $this->root . '/.env.local',
        ]));

        $tz = (string) $this->get('TIMEZONE', 'UTC');
        $ok = false;
        try {
            $ok = @date_default_timezone_set($tz);
        } catch (\Throwable) {
            $ok = false;
        }
        if (!$ok) {
            date_default_timezone_set('UTC');
            $this->vars['TIMEZONE'] = 'UTC';
        }

        $dir = $this->get('DATA_DIR', './data');
        $this->dataDir = $this->absolute($dir);
        foreach ([$this->dataDir, $this->dataDir . '/sessions', $this->dataDir . '/cache'] as $path) {
            if (!is_dir($path)) {
                @mkdir($path, 0770, true);
            }
        }
    }

    public function root(): string
    {
        return $this->root;
    }

    public function dataDir(): string
    {
        return $this->dataDir;
    }

    public function absolute(string $path): string
    {
        if ($path === '') {
            return $this->root;
        }
        if (preg_match('#^[A-Za-z]:[\\\\/]#', $path) || str_starts_with($path, '/') || str_starts_with($path, '\\\\')) {
            return rtrim($path, '/\\');
        }
        return $this->root . '/' . ltrim(str_replace('\\', '/', $path), '/');
    }

    public function get(string $key, mixed $default = null): mixed
    {
        return $this->vars[$key] ?? $default;
    }

    public function bool(string $key, bool $default = false): bool
    {
        return Support::bool($this->vars[$key] ?? null, $default);
    }

    public function int(string $key, int $default, int $min = PHP_INT_MIN, int $max = PHP_INT_MAX): int
    {
        return Support::int($this->vars[$key] ?? null, $default, $min, $max);
    }

    public function mode(): string
    {
        $mode = strtolower((string) $this->get('APP_MODE', 'auto'));
        if ($mode === 'auto') {
            return trim((string) $this->get('API_BASE_URL', '')) !== '' ? 'live' : 'demo';
        }
        return in_array($mode, ['demo', 'live'], true) ? $mode : 'demo';
    }

    public function isDemo(): bool
    {
        return $this->mode() === 'demo';
    }

    public function isHttps(): bool
    {
        return (!empty($_SERVER['HTTPS']) && strtolower((string) $_SERVER['HTTPS']) !== 'off')
            || (($_SERVER['HTTP_X_FORWARDED_PROTO'] ?? '') === 'https')
            || (($_SERVER['SERVER_PORT'] ?? '') === '443');
    }

    public function basePath(): string
    {
        $script = (string) ($_SERVER['SCRIPT_NAME'] ?? '/index.php');
        $dir = str_replace('\\', '/', dirname($script));
        return $dir === '/' ? '/' : rtrim($dir, '/') . '/';
    }

    /** Validate a runtime server override coming from the UI. */
    public function validateBaseUrl(string $url): ?string
    {
        $url = trim($url);
        if ($url === '') {
            return '';
        }
        $parts = parse_url($url);
        if (!is_array($parts) || !isset($parts['scheme'], $parts['host'])) {
            return null;
        }
        if (!in_array(strtolower((string) $parts['scheme']), ['http', 'https'], true)) {
            return null;
        }
        if (isset($parts['user']) || isset($parts['pass']) || isset($parts['query']) || isset($parts['fragment'])) {
            return null;
        }
        if (strlen($url) > 300) {
            return null;
        }
        return rtrim($url, '/');
    }

    /** @return array<string,mixed> safe, non-secret values for the browser */
    public function publicValues(?string $serverOverride, ?string $keySource): array
    {
        $base = $serverOverride !== null && $serverOverride !== ''
            ? $serverOverride
            : (string) $this->get('API_BASE_URL', '');
        return [
            'appName' => (string) $this->get('APP_NAME', 'IPAware Console'),
            'version' => self::VERSION,
            'mode' => $this->mode(),
            'demo' => $this->isDemo(),
            'server' => $base,
            'serverConfigured' => trim((string) $this->get('API_BASE_URL', '')) !== '',
            'serverOverridden' => $serverOverride !== null && $serverOverride !== '',
            'runtimeServerOverrideAllowed' => $this->bool('ALLOW_RUNTIME_SERVER_OVERRIDE', true),
            'keySource' => $keySource ?? 'none',
            'hasApiKey' => $keySource !== 'none',
            'authScheme' => (string) $this->get('AUTH_SCHEME', 'Bearer'),
            'verifyTls' => $this->bool('API_VERIFY_TLS', true),
            'timeout' => $this->int('API_TIMEOUT', 12, 2, 60),
            'endpoints' => [
                'decisions' => (string) $this->get('ENDPOINT_DECISIONS'),
                'ip' => (string) $this->get('ENDPOINT_IP'),
                'block' => (string) $this->get('ENDPOINT_BLOCK'),
                'unblock' => (string) $this->get('ENDPOINT_UNBLOCK'),
                'allowlist' => (string) $this->get('ENDPOINT_ALLOWLIST'),
            ],
            'writeParamsMode' => (string) $this->get('WRITE_PARAMS_MODE', 'query'),
            'allowlistDeleteMethod' => strtoupper((string) $this->get('ALLOWLIST_DELETE_METHOD', 'DELETE')),
            'sseEnabled' => $this->bool('SSE_ENABLED', true),
            'pollSeconds' => $this->int('SSE_POLL_SECONDS', 8, 3, 120),
            'sseMaxSeconds' => $this->int('SSE_MAX_SECONDS', 300, 30, 3600),
            'minAutoRefresh' => $this->int('MIN_AUTO_REFRESH', 10, 5, 300),
            'requirePublicIp' => $this->bool('REQUIRE_PUBLIC_IP', true),
            'devAllowLocalhost' => $this->bool('DEV_ALLOW_LOCALHOST', true),
            'timezone' => (string) $this->get('TIMEZONE', 'UTC'),
        ];
    }
}
