<?php
declare(strict_types=1);

/** Serves guarded JS/CSS. Direct access to /assets is blocked by .htaccess. */
/** @var \IpAware\App $app */
$app = require __DIR__ . '/src/bootstrap.php';
$app->guard->enforce('html');

$file = (string) ($_GET['f'] ?? '');
if ($file === '' || !preg_match('#^(js/[a-z0-9/_-]+\.js|css/[a-z0-9/_-]+\.css|img/[a-z0-9/_-]+\.(svg|png|ico))$#i', $file)) {
    http_response_code(404);
    header('Content-Type: text/plain; charset=utf-8');
    exit('Not found');
}

$base = realpath(__DIR__ . '/assets');
$path = realpath(__DIR__ . '/assets/' . $file);
if ($base === false || $path === false || !str_starts_with($path, $base . DIRECTORY_SEPARATOR) || !is_file($path)) {
    http_response_code(404);
    header('Content-Type: text/plain; charset=utf-8');
    exit('Not found');
}

$extension = strtolower(pathinfo($path, PATHINFO_EXTENSION));
$mime = [
    'js' => 'text/javascript; charset=utf-8',
    'css' => 'text/css; charset=utf-8',
    'svg' => 'image/svg+xml',
    'png' => 'image/png',
    'ico' => 'image/x-icon',
][$extension] ?? 'application/octet-stream';

$mtime = filemtime($path) ?: time();
$etag = '"' . md5($path . '|' . $mtime . '|' . filesize($path)) . '"';
header('Content-Type: ' . $mime);
header('Cache-Control: no-cache, must-revalidate');
header('ETag: ' . $etag);
header('Last-Modified: ' . gmdate('D, d M Y H:i:s', $mtime) . ' GMT');
header('Vary: Cookie');

$ifNoneMatch = trim((string) ($_SERVER['HTTP_IF_NONE_MATCH'] ?? ''));
if ($ifNoneMatch === $etag) {
    http_response_code(304);
    exit;
}
header('Content-Length: ' . (string) filesize($path));
readfile($path);
exit;
