<?php
declare(strict_types=1);

if (PHP_SAPI !== 'cli') {
    http_response_code(404);
    exit;
}

// Isolated copy of the API so the test never changes a developer's .env or sessions.
$server = $argv[1] ?? '';
if ($server === '') {
    fwrite(STDERR, "Run via node tests/live-integration.mjs\n");
    exit(1);
}
$root = sys_get_temp_dir() . '/ipaware-api-test-' . bin2hex(random_bytes(5));
mkdir($root . '/src', 0770, true);
foreach (glob(__DIR__ . '/../src/*.php') ?: [] as $file) {
    copy($file, $root . '/src/' . basename($file));
}
copy(__DIR__ . '/../api.php', $root . '/api.php');
file_put_contents($root . '/.env', "APP_MODE=auto\nAPI_BASE_URL=\nDATA_DIR=./data\nDEV_ALLOW_LOCALHOST=true\nAPI_TIMEOUT=5\n");
register_shutdown_function(static function () use ($root): void {
    if (session_status() === PHP_SESSION_ACTIVE) session_write_close();
    $remove = static function (string $path) use (&$remove): void {
        if (!is_dir($path)) { @unlink($path); return; }
        foreach (scandir($path) ?: [] as $name) {
            if ($name !== '.' && $name !== '..') $remove($path . '/' . $name);
        }
        @rmdir($path);
    };
    $remove($root);
});

$_SERVER['REMOTE_ADDR'] = '127.0.0.1';
$_SERVER['SCRIPT_NAME'] = '/api.php';
$_SERVER['REQUEST_METHOD'] = 'GET';
$_SERVER['SERVER_PORT'] = '80';
$_GET = ['action' => 'snapshot'];
$app = require $root . '/src/bootstrap.php';
$app->setApiKey('integration-test-key');
$app->setServerOverride($server);
require $root . '/api.php';
