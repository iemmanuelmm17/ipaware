<?php
declare(strict_types=1);

/** @var \IpAware\App $app */
$app = require __DIR__ . '/src/bootstrap.php';
$app->guard->enforce('html');

$config = $app->clientConfig();
$template = file_get_contents(__DIR__ . '/templates/app.html');
if ($template === false) {
    http_response_code(500);
    exit('Missing templates/app.html');
}

header('Content-Type: text/html; charset=utf-8');
header('Cache-Control: no-store, no-cache, must-revalidate, max-age=0');
header('Pragma: no-cache');

echo strtr($template, [
    '{{APP_NAME}}' => htmlspecialchars((string) $config['appName'], ENT_QUOTES | ENT_SUBSTITUTE, 'UTF-8'),
    '{{VERSION}}' => htmlspecialchars((string) $config['version'], ENT_QUOTES, 'UTF-8'),
    '{{YEAR}}' => date('Y'),
    '{{CONFIG_JSON}}' => htmlspecialchars(
        json_encode($config, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE | JSON_INVALID_UTF8_SUBSTITUTE) ?: '{}',
        ENT_QUOTES | ENT_SUBSTITUTE,
        'UTF-8'
    ),
]);
