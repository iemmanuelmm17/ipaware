<?php
declare(strict_types=1);

/**
 * Router for PHP's built-in development server:
 *   php -S 127.0.0.1:8080 -t . dev/router.php
 *
 * The built-in server ignores .htaccess, so this router enforces the same
 * IP allowlist and blocks private paths for EVERY request.
 */
$root = realpath(__DIR__ . '/..');
if ($root === false) {
    exit('Invalid root');
}

/** @var \IpAware\App $guardApp */
$guardApp = require $root . '/src/bootstrap.php';
$guardApp->guard->enforce('html');

$path = rawurldecode((string) (parse_url((string) ($_SERVER['REQUEST_URI'] ?? '/'), PHP_URL_PATH) ?: '/'));
if (preg_match('#(?:^|/)(?:\.env(?:\..*)?|\.git.*|\.htaccess|\.gitignore|composer\.(?:json|lock)|README\.md|web\.config|src|data|dev|tests|templates|assets)(?:/|$)#i', $path)) {
    http_response_code(404);
    header('Content-Type: text/plain; charset=utf-8');
    exit('Not found');
}

$target = realpath($root . $path);
if ($path === '/' || $path === '') {
    $target = $root . '/index.php';
}

if ($target !== false && is_file($target) && str_starts_with($target, $root . DIRECTORY_SEPARATOR)) {
    if (str_ends_with(strtolower($target), '.php')) {
        chdir(dirname($target));
        $_SERVER['SCRIPT_NAME'] = '/' . ltrim(str_replace('\\', '/', substr($target, strlen($root) + 1)), '/');
        require $target;
        exit;
    }
    return false; // let the built-in server serve static files (none are exposed by default)
}

if (is_dir($root . $path) && is_file($root . $path . '/index.php')) {
    chdir($root . $path);
    require $root . $path . '/index.php';
    exit;
}

http_response_code(404);
header('Content-Type: text/plain; charset=utf-8');
echo "404 Not Found\n";
