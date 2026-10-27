<?php
declare(strict_types=1);

/**
 * Shared bootstrap. Every entry point (index.php, api.php, stream.php,
 * export.php, asset.php, dev/router.php) requires this file.
 *
 * @return \IpAware\App
 */
$ipaRoot = realpath(__DIR__ . '/..') ?: (__DIR__ . '/..');

spl_autoload_register(static function (string $class) use ($ipaRoot): void {
    $prefix = 'IpAware\\';
    if (!str_starts_with($class, $prefix)) {
        return;
    }
    $relative = substr($class, strlen($prefix));
    $file = $ipaRoot . '/src/' . str_replace('\\', '/', $relative) . '.php';
    if (is_file($file)) {
        require_once $file;
    }
});

return new \IpAware\App($ipaRoot);
