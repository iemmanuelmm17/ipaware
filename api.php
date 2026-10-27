<?php
declare(strict_types=1);

use IpAware\ApiException;
use IpAware\Normalizer;
use IpAware\Support;

/** @var \IpAware\App $app */
$app = require __DIR__ . '/src/bootstrap.php';
$app->guard->enforce('json');

header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-store, no-cache, must-revalidate, max-age=0');
header('Pragma: no-cache');

function ipa_send(array $payload, int $status = 200): never
{
    http_response_code($status);
    echo json_encode($payload, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE | JSON_INVALID_UTF8_SUBSTITUTE);
    exit;
}

function ipa_body(): array
{
    $raw = (string) file_get_contents('php://input');
    $contentType = strtolower((string) ($_SERVER['CONTENT_TYPE'] ?? ''));
    if (str_contains($contentType, 'application/json') && $raw !== '') {
        $decoded = json_decode($raw, true);
        return is_array($decoded) ? $decoded : [];
    }
    if ($raw !== '' && !str_contains($contentType, 'multipart/form-data')) {
        $parsed = [];
        parse_str($raw, $parsed);
        return is_array($parsed) ? $parsed : [];
    }
    return is_array($_POST) ? $_POST : [];
}

function ipa_string(array $data, string $key, int $max = 300): string
{
    $value = $data[$key] ?? '';
    return is_scalar($value) ? mb_substr(trim((string) $value), 0, $max) : '';
}

function ipa_address(array $data, string $key = 'ip', bool $allowCidr = true): string
{
    $value = strtolower(ipa_string($data, $key, 100));
    if ($value === '' || ($allowCidr ? !Support::isIpOrCidr($value) : !Support::isIp($value))) {
        throw new ApiException('Please enter a valid IPv4 or IPv6 address' . ($allowCidr ? ' or CIDR range' : '') . '.', 422);
    }
    return $value;
}

function ipa_csrf(\IpAware\App $app, array $body, bool $required): void
{
    if (!$required) {
        return;
    }
    $token = (string) ($_SERVER['HTTP_X_CSRF_TOKEN'] ?? ($body['csrf'] ?? ($body['_csrf'] ?? '')));
    if (!$app->verifyCsrf($token)) {
        throw new ApiException('Your session expired. Reload the page and try again.', 403);
    }
}

try {
    $action = strtolower(trim((string) ($_GET['action'] ?? $_POST['action'] ?? 'bootstrap')));
    $method = strtoupper((string) ($_SERVER['REQUEST_METHOD'] ?? 'GET'));
    $body = $method === 'POST' ? ipa_body() : [];
    $isWrite = in_array($action, [
        'block', 'unblock', 'allow', 'unallow', 'set_key', 'clear_key', 'clear_events',
    ], true);
    if ($isWrite && $method !== 'POST') {
        throw new ApiException('This action requires a POST request.', 405);
    }
    ipa_csrf($app, $body, $isWrite);

    $upstream = $app->upstream();
    $events = $app->events();
    $ip = $app->clientIp();
    $cfg = $app->clientConfig();

    switch ($action) {
        case 'bootstrap':
            ipa_send(['ok' => true, 'config' => $cfg, 'csrf' => $app->csrf()]);

        case 'snapshot':
            $decisions = [];
            $allowed = [];
            $errors = [];
            $meta = [];
            $raws = [];
            try {
                $d = $upstream->decisions();
                $decisions = $d['rows'];
                $raws['decisions'] = $d['raw'];
                $meta['decisions'] = $d['meta'];
            } catch (\Throwable $e) {
                $errors['decisions'] = $e->getMessage();
            }
            try {
                $a = $upstream->allowedIps();
                $allowed = $a['rows'];
                $raws['allowed_ips'] = $a['raw'];
                $meta['allowed_ips'] = $a['meta'];
            } catch (\Throwable $e) {
                $errors['allowed_ips'] = $e->getMessage();
            }
            $recent = $events->recent(400);
            $dayAgo = time() - 86400;
            $latency = 0;
            foreach ($meta as $m) {
                $latency = max($latency, (int) ($m['durationMs'] ?? 0));
            }
            $warnings = [];
            if ($upstream->isDemo()) {
                $warnings[] = 'Demo mode: showing built-in sample data. Set API_BASE_URL in .env to connect to your server.';
            } elseif (!$upstream->hasKey()) {
                $warnings[] = 'No API key set. Open Settings and enter your API key.';
            }
            if (!$cfg['verifyTls']) {
                $warnings[] = 'TLS verification is disabled (API_VERIFY_TLS=false). Do not use this in production.';
            }
            ipa_send([
                'ok' => true,
                'decisions' => $decisions,
                'allowed' => $allowed,
                'events' => array_slice($recent, 0, 40),
                'stats' => [
                    'blocked' => count($decisions),
                    'allowed' => count($allowed),
                    'events24h' => count(array_filter($recent, static fn ($e) => (int) ($e['epoch'] ?? 0) >= $dayAgo)),
                    'latencyMs' => $latency,
                    'lastSync' => date(DATE_ATOM),
                    'upstream' => $upstream->isDemo() ? 'demo' : 'live',
                ],
                'meta' => [
                    'fetchedAt' => date(DATE_ATOM),
                    'durationMs' => $latency,
                    'mode' => $cfg['mode'],
                    'demo' => $upstream->isDemo(),
                    'server' => $upstream->baseUrl(),
                    'keySource' => $upstream->keySource(),
                    'hasApiKey' => $upstream->hasKey(),
                    'warnings' => $warnings,
                    'errors' => $errors,
                    'lists' => $meta,
                    'raw' => $raws,
                    'config' => $cfg,
                ],
                'csrf' => $app->csrf(),
            ]);

        case 'decisions':
        case 'allowed_ips':
            $result = $action === 'decisions' ? $upstream->decisions() : $upstream->allowedIps();
            ipa_send(['ok' => true, 'rows' => $result['rows'], 'raw' => $result['raw'], 'meta' => $result['meta']]);

        case 'raw':
            $which = (string) ($_GET['which'] ?? 'decisions');
            $result = $which === 'allowed_ips' ? $upstream->allowedIps() : $upstream->decisions();
            ipa_send(['ok' => true, 'which' => $which, 'raw' => $result['raw'], 'meta' => $result['meta']]);

        case 'ip':
        case 'lookup':
            $address = ipa_address($_GET, 'ip', false);
            $result = $upstream->lookup($address);
            $events->append('lookup', "Looked up $address", $address, 'info', ['verdict' => $result['result']['verdict'] ?? 'unknown']);
            ipa_send([
                'ok' => true,
                'result' => $result['result'],
                'raw' => $result['raw'],
                'meta' => $result['meta'],
            ]);

        case 'unblock':
            $address = ipa_address($body, 'ip', false);
            $result = $upstream->unblock($address);
            $events->append('unblock', "Released $address from the firewall", $address, 'success', [
                'by' => Support::maskIp($ip), 'response' => $result['result'],
            ]);
            ipa_send(['ok' => true, 'result' => $result['result'], 'message' => "Released $address"]);

        case 'block':
            $address = ipa_address($body, 'ip', false);
            $reason = ipa_string($body, 'reason', 200);
            $duration = ipa_string($body, 'duration', 20) ?: '4h';
            $result = $upstream->block($address, $reason, $duration);
            $events->append('block', "Blocked $address" . ($reason !== '' ? " - $reason" : ''), $address, 'danger', [
                'by' => Support::maskIp($ip), 'duration' => $duration,
            ]);
            ipa_send(['ok' => true, 'result' => $result['result'], 'message' => "Blocked $address"]);

        case 'allow':
            $cidr = ipa_address($body, 'cidr', true);
            $comment = ipa_string($body, 'comment', 200);
            $result = $upstream->allow($cidr, $comment);
            $events->append('allow', "Allowlisted $cidr" . ($comment !== '' ? " ($comment)" : ''), $cidr, 'success', [
                'by' => Support::maskIp($ip),
            ]);
            ipa_send(['ok' => true, 'result' => $result['result'], 'message' => "Allowlisted $cidr"]);

        case 'unallow':
            $cidr = ipa_address($body, 'cidr', true);
            $result = $upstream->unallow($cidr);
            $events->append('unallow', "Removed $cidr from the allowlist", $cidr, 'warning', [
                'by' => Support::maskIp($ip),
            ]);
            ipa_send(['ok' => true, 'result' => $result['result'], 'message' => "Removed $cidr from allowlist"]);

        case 'events':
            $limit = Support::int($_GET['limit'] ?? 200, 200, 1, 2000);
            ipa_send(['ok' => true, 'events' => $events->recent(
                $limit,
                (string) ($_GET['q'] ?? ''),
                (string) ($_GET['type'] ?? '')
            )]);

        case 'clear_events':
            $events->clear();
            $events->append('system', 'Event log cleared', '', 'info', ['by' => Support::maskIp($ip)]);
            ipa_send(['ok' => true, 'message' => 'Event log cleared.']);

        case 'set_key':
            $key = trim(ipa_string($body, 'apiKey', 2000));
            $server = trim(ipa_string($body, 'server', 300));
            $app->setApiKey($key);
            if ($server !== '') {
                if (!$cfg['runtimeServerOverrideAllowed']) {
                    throw new ApiException('Runtime server overrides are disabled (ALLOW_RUNTIME_SERVER_OVERRIDE=false).', 403);
                }
                $valid = $app->config->validateBaseUrl($server);
                if ($valid === null) {
                    throw new ApiException('Server URL must be a plain http(s) origin, e.g. https://myserver.example.com', 422);
                }
                $app->setServerOverride($valid);
            }
            $events->append('auth', $key !== '' ? 'API key updated from the console' : 'API key cleared from the session', '', 'info', [
                'by' => Support::maskIp($ip),
            ]);
            ipa_send(['ok' => true, 'config' => $app->clientConfig(), 'message' => $key !== '' ? 'API key saved for this session.' : 'API key cleared.']);

        case 'clear_key':
            $app->setApiKey('');
            $app->setServerOverride(null);
            $events->append('auth', 'Session API key and server override cleared', '', 'info', ['by' => Support::maskIp($ip)]);
            ipa_send(['ok' => true, 'config' => $app->clientConfig(), 'message' => 'Session credentials cleared.']);

        case 'test':
            $result = $upstream->test();
            ipa_send(['ok' => true, 'test' => $result, 'message' => $result['message']]);

        default:
            throw new ApiException('Unknown action: ' . $action, 404);
    }
} catch (ApiException $e) {
    ipa_send([
        'ok' => false,
        'error' => 'api_error',
        'message' => $e->getMessage(),
        'details' => $app->config->bool('APP_DEBUG', false) ? $e->details : null,
        'csrf' => $app->csrf(),
    ], $e->httpStatus >= 400 && $e->httpStatus <= 599 ? $e->httpStatus : 400);
} catch (\Throwable $e) {
    @file_put_contents(
        $app->config->dataDir() . '/error.log',
        date('c') . "\t" . get_class($e) . "\t" . $e->getMessage() . "\t" . $e->getFile() . ':' . $e->getLine() . "\n",
        FILE_APPEND | LOCK_EX
    );
    ipa_send([
        'ok' => false,
        'error' => 'server_error',
        'message' => $app->config->bool('APP_DEBUG', false)
            ? $e->getMessage()
            : 'An unexpected server error occurred. Check data/error.log.',
        'csrf' => $app->csrf(),
    ], 500);
}
