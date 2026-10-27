<?php
declare(strict_types=1);

if (PHP_SAPI !== 'cli') {
    http_response_code(404);
    exit;
}

require __DIR__ . '/../src/Support.php';
require __DIR__ . '/../src/Normalizer.php';

use IpAware\Normalizer;

$sample = json_decode((string) file_get_contents(__DIR__ . '/fixtures/cluster-decision.json'), true, 512, JSON_THROW_ON_ERROR);
$lookupSample = json_decode((string) file_get_contents(__DIR__ . '/fixtures/ip-lookup.json'), true, 512, JSON_THROW_ON_ERROR);
$allowSample = json_decode((string) file_get_contents(__DIR__ . '/fixtures/allowlist.json'), true, 512, JSON_THROW_ON_ERROR);
$failures = 0;

function check(string $name, callable $test): void
{
    global $failures;
    try {
        $test();
        echo "PASS $name\n";
    } catch (Throwable $e) {
        $failures++;
        fwrite(STDERR, "FAIL $name: {$e->getMessage()}\n");
    }
}

function same(mixed $expected, mixed $actual, string $message = ''): void
{
    if ($expected !== $actual) {
        throw new RuntimeException(($message !== '' ? $message . ': ' : '') . 'expected ' . var_export($expected, true) . ', got ' . var_export($actual, true));
    }
}

check('normalizes a cluster decision and preserves the complete record', function () use ($sample): void {
    $rows = Normalizer::decisions([$sample]);
    same(1, count($rows));
    $row = $rows[0];
    same('203.0.113.83', $row['ip']);
    same('203.0.113.83/32', $row['cidr']);
    same('blocked', $row['kind']);
    same('community_blocklist', $row['reason']);
    same($sample['evidence']['explanation'], $row['explanation']);
    same('mis1.pdx.example.net', $row['source']);
    same('mis1.pdx.example.net', $row['origin']);
    same('block', $row['action']);
    same('2026-10-27T06:20:17.620Z', $row['created']);
    same('2026-11-03T06:20:17.620Z', $row['expires']);
    same($sample, $row['raw'], 'raw record must not be truncated or flattened');
});

check('keeps long records intact even when the response preview is truncated', function () use ($sample): void {
    $sample['source']['history']['explanation'] = str_repeat('long evidence ', 2000);
    $rows = Normalizer::decisions(['decisions' => [$sample]]);
    same($sample, $rows[0]['raw']);
    same(true, Normalizer::raw(['decisions' => [$sample]])['_truncated']);
});

check('preserves native JSON objects, including empty and numeric-key objects, inside rows', function (): void {
    $payload = json_decode('{"data":{"blocked":[{"ip":"192.0.2.7","emptyObject":{},"emptyArray":[],"numericKeys":{"0":"a","1":"b"}}]}}', false, 512, JSON_THROW_ON_ERROR);
    $rows = Normalizer::decisions($payload);
    same(1, count($rows));
    same('192.0.2.7', $rows[0]['ip']);
    same(json_encode($payload->data->blocked[0]), json_encode($rows[0]['raw']));
    same(json_encode($payload), json_encode(Normalizer::raw($payload)), 'a small raw preview should retain JSON object types');
});

check('handles a single decision object without confusing its server list for IPs', function () use ($sample): void {
    $rows = Normalizer::decisions($sample);
    same(['203.0.113.83'], array_column($rows, 'ip'));
    same($sample, $rows[0]['raw']);
});

check('finds blocked rows inside a wrapper with metadata and a leading null', function () use ($sample): void {
    $payload = [
        'servers' => ['core1-nyc.example.net', 'core1-pdx.example.net'],
        'data' => ['blocked' => [null, $sample, ['ip' => '2001:db8::3', 'verdict' => 'block']]],
    ];
    same(['203.0.113.83', '2001:db8::3'], array_column(Normalizer::decisions($payload), 'ip'));
});

check('prefers the requested list and does not confuse allow and block lists', function () use ($sample): void {
    $payload = [
        'allowed_ips' => [['cidr' => '198.51.100.0/24', 'comment' => 'office']],
        'decisions' => [$sample],
    ];
    same(['203.0.113.83'], array_column(Normalizer::decisions($payload), 'ip'));
    same(['198.51.100.0/24'], array_column(Normalizer::allowlist($payload), 'ip'));
    same([], Normalizer::decisions(['allowed_ips' => $payload['allowed_ips']]));
    same([], Normalizer::allowlist(['decisions' => $payload['decisions']]));
});

check('an explicitly empty list stays empty even when metadata contains addresses', function (): void {
    $payload = ['servers' => ['192.0.2.1'], 'decisions' => [], 'allowed_ips' => ['198.51.100.8']];
    same([], Normalizer::decisions($payload));
    same(true, Normalizer::hasList($payload, 'blocked'));
    same(true, Normalizer::hasList(['data' => ['items' => []]], 'blocked'));
});

check('handles common aliases, nested addresses, IPv6, and string lists', function () use ($sample): void {
    same(['203.0.113.83'], array_column(Normalizer::decisions(['blockedIps' => [$sample]]), 'ip'));
    $payload = ['result' => ['items' => [
        ['scope' => ['value' => '2001:DB8::2'], 'reason' => 'nested'],
        ['cidr' => '198.51.100.0/24'],
        ['address' => ['ip' => '192.0.2.7']],
        ['ip' => 'not-an-ip'],
    ]]];
    same(['2001:db8::2', '198.51.100.0/24', '192.0.2.7'], array_column(Normalizer::decisions($payload), 'ip'));
    same(['192.0.2.1', '2001:db8::1'], array_column(Normalizer::allowlist(['ips' => ['192.0.2.1', 'hostname.example', '2001:db8::1']]), 'ip'));
    same(['203.0.113.83'], array_column(Normalizer::decisions(json_encode(['records' => [$sample]], JSON_THROW_ON_ERROR)), 'ip'));
});

check('skips invalid addresses, server metadata, and duplicate addresses', function () use ($sample): void {
    same([], Normalizer::decisions(['servers' => ['192.0.2.1'], 'paths' => ['community_blocklist']]));
    same([], Normalizer::decisions(['source' => ['ip' => '192.0.2.2'], 'server' => ['ip' => '192.0.2.1']]));
    same([], Normalizer::decisions(['items' => ['not-an-ip', 'server.example']]));
    same(false, Normalizer::hasList(['unexpected' => ['not-an-ip']], 'blocked'));
    same(['203.0.113.83'], array_column(Normalizer::decisions([$sample, $sample]), 'ip'));
});

check('still handles common legacy response shapes', function (): void {
    same(['192.0.2.5'], array_column(Normalizer::decisions(['decisions' => [['scope' => 'Ip', 'value' => '192.0.2.5', 'type' => 'ban']]]), 'ip'));
    same(['198.51.100.8'], array_column(Normalizer::allowlist(['allowed_ips' => [['cidr' => '198.51.100.8', 'comment' => 'office']]]), 'ip'));
    same(['192.0.2.9'], array_column(Normalizer::decisions(['customWrapper' => ['entries' => [['IP' => '192.0.2.9']]]]), 'ip'));
});

check('normalizes the nested IP lookup without inventing signals or losing fields', function () use ($lookupSample): void {
    $lookup = Normalizer::lookup($lookupSample, $lookupSample['ip']);
    same('allowed', $lookup['verdict']);
    same('allow', $lookup['status']);
    same(true, $lookup['allowlisted']);
    same(false, $lookup['blockedOnThisServer']);
    same(false, $lookup['activeDecision']);
    same('2026-09-17T18:17:52.000Z', $lookup['firstSeen']);
    same('2026-10-27T17:37:04.000Z', $lookup['lastSeen']);
    same('PH', $lookup['country']);
    same('AS64500', $lookup['asn']);
    same('Example Network', $lookup['org']);
    same([], $lookup['events'], 'history and activity objects are not event lists');
    same($lookupSample, $lookup['raw'], 'all risk, history, scores and false/null/empty values survive');
});

check('handles nested blocked lookups and preserves unknown states', function () use ($lookupSample): void {
    $blocked = $lookupSample;
    $blocked['enforcement'] = ['allowlisted' => false, 'blockedOnThisServer' => true, 'block' => [
        'reason' => 'test rule', 'expiresAt' => '2026-11-03T17:28:26.885Z',
    ]];
    $blocked['score']['lastVerdict'] = 'block';
    $lookup = Normalizer::lookup($blocked, $blocked['ip']);
    same('blocked', $lookup['verdict']);
    same(true, $lookup['activeDecision']);
    same('test rule', $lookup['reason']);
    same('2026-11-03T17:28:26.885Z', $lookup['expires']);
    same($blocked, $lookup['raw']);

    $unknown = Normalizer::lookup(['ip' => '192.0.2.7'], '192.0.2.7');
    same('unknown', $unknown['verdict']);
    same(null, $unknown['allowlisted']);
    same(null, $unknown['activeDecision']);
    $historical = Normalizer::lookup([
        'ip' => '192.0.2.7', 'score' => ['lastVerdict' => 'block'],
        'decisions' => ['count' => 4, 'mostRecent' => ['reason' => 'old']],
        'activity' => ['sources' => ['audit' => 12]],
        'enforcement' => ['allowlisted' => 'unknown', 'blockedOnThisServer' => null, 'block' => null],
    ], '192.0.2.7');
    same('block', $historical['status'], 'the last score is still visible');
    same('unknown', $historical['verdict'], 'a historical score is not a current block');
    same(null, $historical['activeDecision']);
    same(null, $historical['allowlisted']);
    same([], $historical['events']);
    $legacy = Normalizer::lookup(['ip' => '192.0.2.8', 'status' => 'banned', 'decision' => ['reason' => 'legacy rule']], '192.0.2.8');
    same('blocked', $legacy['verdict']);
    same(true, $legacy['activeDecision']);
    $wrapped = ['data' => $lookupSample, 'meta' => ['note' => 'wrapper']];
    $lookup = Normalizer::lookup($wrapped, $lookupSample['ip']);
    same('allowed', $lookup['verdict']);
    same($wrapped, $lookup['raw'], 'the original wrapper is also retained');
});

check('does not truncate a large IP lookup record', function () use ($lookupSample): void {
    $lookupSample['history']['explanation'] = str_repeat('long detail ', 3000);
    $lookup = Normalizer::lookup($lookupSample, $lookupSample['ip']);
    same($lookupSample, $lookup['raw']);
});

check('normalizes the example allow-list fields without dropping nulls or IPv6', function () use ($allowSample): void {
    $rows = Normalizer::allowlist(['allowed_ips' => $allowSample]);
    same(['192.0.2.174', '2001:db8:11:21::10'], array_column($rows, 'ip'));
    same('db', $rows[0]['source']);
    same('Office device', $rows[0]['comment']);
    same('admin@example.invalid', $rows[0]['addedBy']);
    same('PH', $rows[0]['country']);
    same('Example City', $rows[0]['city']);
    same('', $rows[0]['created']);
    same('', $rows[0]['expires']);
    same($allowSample[0], $rows[0]['raw']);
    same('builtin', $rows[1]['source']);
    same('2026-09-17T18:17:12.341Z', $rows[1]['created']);
    same('2026-11-03T17:28:26.885Z', $rows[1]['expires']);
    same($allowSample[1], $rows[1]['raw']);
});

if ($failures > 0) {
    fwrite(STDERR, "$failures test(s) failed.\n");
    exit(1);
}
echo "All normalizer tests passed.\n";
