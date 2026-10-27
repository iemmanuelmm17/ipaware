<?php
declare(strict_types=1);

use IpAware\ApiException;
use IpAware\Exporter;
use IpAware\Support;

/** @var \IpAware\App $app */
$app = require __DIR__ . '/src/bootstrap.php';
$app->guard->enforce('html');

function export_fail(string $message, int $status = 400): never
{
    http_response_code($status);
    header('Content-Type: text/plain; charset=utf-8');
    header('Cache-Control: no-store');
    echo $message;
    exit;
}

try {
    if (strtoupper((string) ($_SERVER['REQUEST_METHOD'] ?? 'GET')) !== 'POST') {
        throw new ApiException('Export requires a POST request.', 405);
    }
    $token = (string) ($_SERVER['HTTP_X_CSRF_TOKEN'] ?? ($_POST['csrf'] ?? ''));
    if (!$app->verifyCsrf($token)) {
        throw new ApiException('Session expired. Reload the page and try again.', 403);
    }

    $type = strtolower(trim((string) ($_POST['type'] ?? 'all')));
    if (!in_array($type, ['all', 'blocked', 'allowed'], true)) {
        $type = 'all';
    }
    $format = strtolower(trim((string) ($_POST['format'] ?? 'xlsx'))) === 'csv' ? 'csv' : 'xlsx';
    $query = strtolower(trim(mb_substr((string) ($_POST['q'] ?? ''), 0, 200)));

    $upstream = $app->upstream();
    $rows = array_merge($upstream->decisions()['rows'], $upstream->allowedIps()['rows']);
    if ($type === 'blocked') {
        $rows = array_values(array_filter($rows, static fn ($r) => ($r['kind'] ?? '') !== 'allowed'));
    } elseif ($type === 'allowed') {
        $rows = array_values(array_filter($rows, static fn ($r) => ($r['kind'] ?? '') === 'allowed'));
    }
    if ($query !== '') {
        $rows = array_values(array_filter($rows, static function ($row) use ($query): bool {
            $hay = strtolower(implode(' ', [
                (string) ($row['ip'] ?? ''), (string) ($row['cidr'] ?? ''),
                (string) ($row['reason'] ?? ''), (string) ($row['comment'] ?? ''),
                (string) ($row['scenario'] ?? ''), (string) ($row['source'] ?? ''),
            ]));
            return str_contains($hay, $query);
        }));
    }

    $built = Exporter::build($rows, $format, [
        'mode' => $upstream->isDemo() ? 'demo' : 'live',
        'server' => $upstream->baseUrl(),
        'filter' => $type,
        'query' => $query,
    ]);

    $app->events()->append('export', "Exported " . count($rows) . " rows as " . strtoupper($built['format']), '', 'info', [
        'filter' => $type, 'query' => $query, 'by' => Support::maskIp($app->clientIp()),
    ]);

    header('Content-Type: ' . $built['mime']);
    header('Content-Disposition: attachment; filename="' . $built['filename'] . '"');
    header('Content-Length: ' . strlen($built['content']));
    header('Cache-Control: no-store, no-cache, must-revalidate');
    header('Pragma: no-cache');
    header('X-Export-Format: ' . $built['format']);
    if ($built['fallback']) {
        header('X-Export-Fallback: csv');
    }
    echo $built['content'];
    exit;
} catch (\Throwable $e) {
    $status = $e instanceof ApiException ? $e->httpStatus : 500;
    export_fail('Export failed: ' . $e->getMessage(), $status >= 400 && $status <= 599 ? $status : 500);
}
