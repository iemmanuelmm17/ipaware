<?php
declare(strict_types=1);

/**
 * Server-Sent Events stream. It re-reads the upstream decisions/allowlist on an
 * interval, emits changes, and tails the local activity log. The browser uses
 * this to update without a full page refresh (polling is the fallback).
 */
/** @var \IpAware\App $app */
$app = require __DIR__ . '/src/bootstrap.php';
$app->guard->enforce('json');

if (!$app->config->sseEnabled()) {
    http_response_code(204);
    exit;
}

$app->session();
$upstream = $app->upstream();
$events = $app->events();
$pollEvery = $app->config->int('SSE_POLL_SECONDS', 8, 3, 120);
$maxSeconds = $app->config->int('SSE_MAX_SECONDS', 300, 30, 3600);
$lastEventId = trim((string) ($_SERVER['HTTP_LAST_EVENT_ID'] ?? ($_GET['lastEventId'] ?? '')));
$cursor = $lastEventId !== '' ? $lastEventId : $events->lastId();

// Release the session lock before the long-running loop.
session_write_close();

@ini_set('zlib.output_compression', '0');
@ini_set('implicit_flush', '1');
@ini_set('output_buffering', '0');
header('Content-Type: text/event-stream; charset=utf-8');
header('Cache-Control: no-cache, no-transform');
header('X-Accel-Buffering: no');
header('Connection: keep-alive');
while (ob_get_level() > 0) {
    @ob_end_flush();
}
ob_implicit_flush(true);
set_time_limit(0);
ignore_user_abort(false);

function sse_send(string $event, array $data, ?string $id = null): void
{
    if ($id !== null && $id !== '') {
        echo 'id: ' . preg_replace('/[\r\n]/', '', $id) . "\n";
    }
    echo 'event: ' . $event . "\n";
    echo 'data: ' . (json_encode($data, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE | JSON_INVALID_UTF8_SUBSTITUTE) ?: '{}') . "\n\n";
    @flush();
}

/** @param array<int,array<string,mixed>> $rows @return array<string,array<string,mixed>> */
function sse_map(array $rows): array
{
    $map = [];
    foreach ($rows as $row) {
        $key = (string) ($row['kind'] ?? '') . ':' . (string) ($row['ip'] ?? '');
        $map[$key] = $row;
    }
    return $map;
}

echo "retry: 6000\n\n";
@flush();
sse_send('hello', [
    'at' => date(DATE_ATOM),
    'mode' => $upstream->isDemo() ? 'demo' : 'live',
    'pollSeconds' => $pollEvery,
    'hasApiKey' => $upstream->hasKey(),
    'client' => bin2hex(random_bytes(4)),
]);

if (!$upstream->isDemo() && !$upstream->hasKey()) {
    sse_send('notice', ['level' => 'warning', 'message' => 'No API key set. Open Settings to enter it.']);
}

$start = time();
$nextPoll = 0;
$lastHeartbeat = time();
$previous = null;
$lastError = '';
$lastErrorAt = 0;

while (!connection_aborted()) {
    $now = time();
    if ($now - $start >= $maxSeconds) {
        sse_send('restart', ['at' => date(DATE_ATOM), 'reason' => 'Stream recycled; reconnecting.']);
        break;
    }

    foreach ($events->since($cursor, 60) as $event) {
        sse_send('activity', $event, (string) ($event['id'] ?? ''));
        $cursor = (string) ($event['id'] ?? $cursor);
    }

    if ($now >= $nextPoll) {
        $nextPoll = $now + $pollEvery;
        try {
            $decisions = $upstream->decisions()['rows'];
            $allowed = $upstream->allowedIps()['rows'];
            $current = array_merge(sse_map($decisions), sse_map($allowed));
            $added = [];
            $removed = [];
            if ($previous !== null) {
                foreach ($current as $key => $row) {
                    if (!isset($previous[$key])) {
                        $added[] = $row;
                    }
                }
                foreach ($previous as $key => $row) {
                    if (!isset($current[$key])) {
                        $removed[] = $row;
                    }
                }
                $logged = 0;
                foreach (array_slice($added, 0, 6) as $row) {
                    $isAllowed = ($row['kind'] ?? '') === 'allowed';
                    $events->append(
                        $isAllowed ? 'allow' : 'block',
                        ($isAllowed ? 'Allowlist entry detected: ' : 'New block detected: ') . (string) ($row['ip'] ?? ''),
                        (string) ($row['ip'] ?? ''),
                        $isAllowed ? 'success' : 'warning',
                        ['detectedBy' => 'stream', 'reason' => (string) ($row['reason'] ?? '')]
                    );
                    $logged++;
                }
                foreach (array_slice($removed, 0, 6 - $logged) as $row) {
                    $isAllowed = ($row['kind'] ?? '') === 'allowed';
                    $events->append(
                        $isAllowed ? 'unallow' : 'unblock',
                        ($isAllowed ? 'Allowlist entry removed: ' : 'Block removed/released: ') . (string) ($row['ip'] ?? ''),
                        (string) ($row['ip'] ?? ''),
                        'info',
                        ['detectedBy' => 'stream']
                    );
                }
            }
            $previous = $current;
            sse_send('sync', [
                'at' => date(DATE_ATOM),
                'decisions' => count($decisions),
                'allowed' => count($allowed),
                'changed' => count($added) + count($removed),
                'added' => array_slice($added, 0, 20),
                'removed' => array_slice($removed, 0, 20),
                'pollSeconds' => $pollEvery,
            ]);
            $lastError = '';
        } catch (\Throwable $e) {
            $message = $e->getMessage();
            if ($message !== $lastError || $now - $lastErrorAt > 60) {
                sse_send('notice', ['level' => 'danger', 'message' => $message]);
                $lastError = $message;
                $lastErrorAt = $now;
            }
        }
    }

    if ($now - $lastHeartbeat >= 15) {
        $lastHeartbeat = $now;
        sse_send('heartbeat', ['at' => date(DATE_ATOM), 'uptime' => $now - $start]);
    }
    echo ": ping\n\n";
    @flush();
    sleep(1);
}
