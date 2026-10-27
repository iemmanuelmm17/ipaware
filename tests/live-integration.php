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

// Match the application bootstrap's production error reporting.
error_reporting(E_ALL & ~E_DEPRECATED & ~E_NOTICE);
$server = $argv[1] ?? '';
if ($server === '') {
    fwrite(STDERR, "Run via node tests/live-integration.mjs\n");
    exit(1);
}
$root = sys_get_temp_dir() . '/ipaware-live-test-' . bin2hex(random_bytes(5));
mkdir($root, 0770, true);
file_put_contents($root . '/.env', "APP_MODE=auto\nAPI_BASE_URL=\nDATA_DIR=./data\nAPI_TIMEOUT=5\n");
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

try {
    // Same effective server and key used when a user saves Settings.
    $config = new Config($root);
    $upstream = new Upstream($config, 'integration-test-key', $server, 'session');
    $result = [
        'demo' => $upstream->isDemo(),
        'decisions' => $upstream->decisions(),
        'unrecognized' => $upstream->decisions(),
        'empty' => $upstream->decisions(),
        'allowed' => $upstream->allowedIps(),
    ];
    echo json_encode($result, JSON_UNESCAPED_SLASHES | JSON_THROW_ON_ERROR);
} catch (Throwable $e) {
    fwrite(STDERR, $e->getMessage() . "\n");
    exit(1);
}
