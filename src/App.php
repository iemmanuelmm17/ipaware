<?php
declare(strict_types=1);

namespace IpAware;

final class App
{
    public Config $config;
    public AccessGuard $guard;
    private bool $sessionStarted = false;
    private ?EventLog $eventLog = null;

    public function __construct(string $root)
    {
        $this->config = new Config($root);
        $this->guard = new AccessGuard($this->config);
        if ($this->config->bool('APP_DEBUG', false)) {
            error_reporting(E_ALL);
            ini_set('display_errors', '0');
        } else {
            error_reporting(E_ALL & ~E_DEPRECATED & ~E_NOTICE);
            ini_set('display_errors', '0');
        }
    }

    public function session(): void
    {
        if ($this->sessionStarted || session_status() === PHP_SESSION_ACTIVE) {
            $this->sessionStarted = true;
            return;
        }
        $path = $this->config->dataDir() . '/sessions';
        if (is_dir($path)) {
            session_save_path($path);
        }
        session_name('IPAWARESESS');
        session_start([
            'cookie_httponly' => true,
            'cookie_samesite' => 'Strict',
            'cookie_secure' => $this->config->isHttps(),
            'cookie_path' => $this->config->basePath(),
            'use_strict_mode' => 1,
            'gc_maxlifetime' => 7200,
        ]);
        $this->sessionStarted = true;
        if (empty($_SESSION['csrf'])) {
            $_SESSION['csrf'] = bin2hex(random_bytes(32));
        }
    }

    public function csrf(): string
    {
        $this->session();
        return (string) ($_SESSION['csrf'] ?? '');
    }

    public function verifyCsrf(?string $token): bool
    {
        $this->session();
        $expected = (string) ($_SESSION['csrf'] ?? '');
        return $expected !== '' && is_string($token) && hash_equals($expected, $token);
    }

    public function apiKey(): ?string
    {
        $this->session();
        $sessionKey = trim((string) ($_SESSION['api_key'] ?? ''));
        if ($sessionKey !== '') {
            return $sessionKey;
        }
        $envKey = trim((string) $this->config->get('API_KEY', ''));
        return $envKey !== '' ? $envKey : null;
    }

    public function keySource(): string
    {
        $this->session();
        if (trim((string) ($_SESSION['api_key'] ?? '')) !== '') {
            return 'session';
        }
        return trim((string) $this->config->get('API_KEY', '')) !== '' ? 'env' : 'none';
    }

    public function setApiKey(string $key): void
    {
        $this->session();
        if ($key === '') {
            unset($_SESSION['api_key']);
        } else {
            $_SESSION['api_key'] = $key;
        }
    }

    public function serverOverride(): ?string
    {
        $this->session();
        $v = $_SESSION['server_override'] ?? null;
        return is_string($v) && $v !== '' ? $v : null;
    }

    public function setServerOverride(?string $url): void
    {
        $this->session();
        if ($url === null || $url === '') {
            unset($_SESSION['server_override']);
        } else {
            $_SESSION['server_override'] = $url;
        }
    }

    public function apiBaseUrl(): string
    {
        $override = $this->serverOverride();
        if ($override !== null && $this->config->bool('ALLOW_RUNTIME_SERVER_OVERRIDE', true)) {
            return $override;
        }
        return rtrim((string) $this->config->get('API_BASE_URL', ''), '/');
    }

    public function events(): EventLog
    {
        if ($this->eventLog === null) {
            $this->eventLog = new EventLog(
                $this->config->dataDir() . '/events.jsonl',
                $this->config->int('MAX_EVENTS', 1500, 100, 20000),
                (string) $this->config->get('TIMEZONE', 'UTC')
            );
        }
        return $this->eventLog;
    }

    public function upstream(): Upstream
    {
        return new Upstream($this->config, $this->apiKey(), $this->apiBaseUrl(), $this->keySource());
    }

    public function clientConfig(): array
    {
        $cfg = $this->config->publicValues($this->serverOverride(), $this->keySource());
        $cfg['csrf'] = $this->csrf();
        $cfg['access'] = [
            'clientIp' => $this->guard->clientIp(),
            'allowed' => true,
            'allowlistSource' => '.env (ADMIN_ALLOWED_IPS) + .env.local overrides',
        ];
        return $cfg;
    }

    public function clientIp(): string
    {
        return $this->guard->clientIp();
    }
}
