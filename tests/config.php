<?php
declare(strict_types=1);

if (PHP_SAPI !== 'cli') {
    http_response_code(404);
    exit;
}

require __DIR__ . '/../src/Support.php';
require __DIR__ . '/../src/Env.php';
require __DIR__ . '/../src/Config.php';
require __DIR__ . '/../src/HttpClient.php';
require __DIR__ . '/../src/Normalizer.php';
require __DIR__ . '/../src/DemoUpstream.php';
require __DIR__ . '/../src/Upstream.php';

use IpAware\Config;
use IpAware\Upstream;

$root = sys_get_temp_dir() . '/ipaware-config-test-' . bin2hex(random_bytes(5));
mkdir($root, 0770, true);
register_shutdown_function(static function () use ($root): void {
    $remove = static function (string $path) use (&$remove): void {
        if (!is_dir($path)) { @unlink($path); return; }
        foreach (scandir($path) ?: [] as $name) {
            if ($name !== '.' && $name !== '..') $remove($path . '/' . $name);
        }
        @rmdir($path);
    };
    $remove($root);
});

function same(mixed $expected, mixed $actual, string $message): void
{
    if ($expected !== $actual) {
        throw new RuntimeException($message . ': expected ' . var_export($expected, true) . ', got ' . var_export($actual, true));
    }
}

function configFor(string $root, string $env): Config
{
    file_put_contents($root . '/.env', $env . "\nDATA_DIR=./data\n");
    return new Config($root);
}

$cfg = configFor($root, "APP_MODE=auto\nAPI_BASE_URL=\nALLOW_RUNTIME_SERVER_OVERRIDE=true");
same('demo', $cfg->mode(), 'empty automatic configuration starts in demo');
$public = $cfg->publicValues('https://upstream.example.net', 'session');
same('live', $public['mode'], 'session server makes auto mode live');
same(false, $public['demo'], 'UI no longer reports demo');
same(true, $public['serverConfigured'], 'effective server is configured');
same(true, $public['serverOverridden'], 'override is reported');
$upstream = new Upstream($cfg, 'test-key', 'https://upstream.example.net', 'session');
same(false, $upstream->isDemo(), 'requests use the overridden live server');

$cfg = configFor($root, "APP_MODE=auto\nAPI_BASE_URL=https://configured.example.net\nALLOW_RUNTIME_SERVER_OVERRIDE=false");
$public = $cfg->publicValues('https://ignored.example.net', 'session');
same('https://configured.example.net', $public['server'], 'disabled override is not reported as active');
same(false, $public['serverOverridden'], 'disabled override is not active');
same('live', $public['mode'], 'configured server uses live mode');

$cfg = configFor($root, "APP_MODE=demo\nAPI_BASE_URL=\nALLOW_RUNTIME_SERVER_OVERRIDE=true");
$public = $cfg->publicValues('https://upstream.example.net', 'session');
same('demo', $public['mode'], 'explicit demo mode is respected');
$demo = new Upstream($cfg, null, '', 'none');
same(true, $demo->isDemo(), 'explicit demo uses the built-in upstream');
$demoDecisions = $demo->decisions();
same(true, count($demoDecisions['rows']) > 100, 'legacy demo decisions still load');
same(false, isset($demoDecisions['meta']['warning']), 'demo decisions are recognized');
same(true, count($demo->allowedIps()['rows']) > 20, 'demo allow list still loads');
$cfg = configFor($root, "APP_MODE=live\nAPI_BASE_URL=\nALLOW_RUNTIME_SERVER_OVERRIDE=true");
same('live', $cfg->mode(), 'explicit live mode is respected even without a server');

// Explicitly disabling SSE remains respected on non-web CLI runtimes.
$cfg = configFor($root, "SSE_ENABLED=false");
same(false, $cfg->sseEnabled(), 'SSE can be disabled by configuration');
same('Disabled by SSE_ENABLED in configuration.', $cfg->sseDisabledReason(), 'disabled reason is available to the UI');
$cfg = configFor($root, "SSE_ENABLED=true");
same(true, $cfg->sseEnabled(), 'SSE remains available outside the built-in web server');
same(null, $cfg->sseDisabledReason(), 'available SSE has no disabled reason');

// Exercise list diagnostics and live response metadata without making network requests.
$cfg = configFor($root, "APP_MODE=auto\nAPI_BASE_URL=\nALLOW_RUNTIME_SERVER_OVERRIDE=true");
$upstream = new Upstream($cfg, 'test-key', 'https://upstream.example.net', 'session');
$listResponse = new ReflectionMethod(Upstream::class, 'listResponse');
$http = ['response' => ['status' => 200, 'durationMs' => 42, 'url' => 'https://upstream.example.net/ipaware/decisions']];
$sample = json_decode((string) file_get_contents(__DIR__ . '/fixtures/cluster-decision.json'), true, 512, JSON_THROW_ON_ERROR);
$result = $listResponse->invoke($upstream, ['data' => ['blocked' => [$sample]]], $http, 'blocked');
same('203.0.113.83', $result['rows'][0]['ip'], 'live decision is normalized');
same(200, $result['meta']['status'], 'live HTTP status is retained');
same(42, $result['meta']['durationMs'], 'live HTTP latency is retained');
same(false, isset($result['meta']['warning']), 'recognized response has no warning');
$result = $listResponse->invoke($upstream, ['unexpected' => ['not-an-ip']], $http, 'blocked');
same(true, isset($result['meta']['warning']), 'unrecognized response has an actionable warning');
$result = $listResponse->invoke($upstream, ['decisions' => []], $http, 'blocked');
same(false, isset($result['meta']['warning']), 'explicit empty list has no warning');

echo "All configuration and response tests passed.\n";
