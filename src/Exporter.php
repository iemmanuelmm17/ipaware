<?php
declare(strict_types=1);

namespace IpAware;

final class Exporter
{
    /** @param array<int,array<string,mixed>> $rows */
    public static function build(array $rows, string $format, array $meta): array
    {
        $format = strtolower($format) === 'csv' ? 'csv' : 'xlsx';
        $stamp = gmdate('Ymd-His');
        $headers = ['Type', 'IP / CIDR', 'Reason / Comment', 'Scenario / Action', 'Source', 'Created', 'Expires / TTL', 'ID'];
        $data = [$headers];
        foreach ($rows as $row) {
            $data[] = [
                $row['kind'] === 'allowed' ? 'Whitelisted' : 'Blocked',
                (string) ($row['ip'] ?? ''),
                (string) ($row['reason'] ?? $row['comment'] ?? ''),
                (string) ($row['scenario'] ?? $row['action'] ?? ''),
                (string) ($row['source'] ?? $row['origin'] ?? ''),
                (string) ($row['created'] ?? ''),
                (string) ($row['expires'] ?? $row['ttl'] ?? ''),
                (string) ($row['id'] ?? ''),
            ];
        }

        if ($format === 'xlsx') {
            $body = array_slice($data, 1);
            $blockedRows = array_values(array_filter($body, static fn ($r) => $r[0] === 'Blocked'));
            $allowedRows = array_values(array_filter($body, static fn ($r) => $r[0] === 'Whitelisted'));
            $binary = Xlsx::build([
                ['name' => 'All IPs', 'rows' => $data],
                ['name' => 'Blocked', 'rows' => array_merge([$headers], $blockedRows)],
                ['name' => 'Whitelist', 'rows' => array_merge([$headers], $allowedRows)],
                ['name' => 'Summary', 'rows' => self::summary($rows, $meta)],
            ]);
            if ($binary !== null) {
                return [
                    'filename' => 'ipaware-' . $stamp . '.xlsx',
                    'mime' => 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
                    'content' => $binary,
                    'format' => 'xlsx',
                    'fallback' => false,
                ];
            }
        }

        return [
            'filename' => 'ipaware-' . $stamp . '.csv',
            'mime' => 'text/csv; charset=utf-8',
            'content' => self::csv($data),
            'format' => 'csv',
            'fallback' => $format === 'xlsx',
        ];
    }

    /** @param array<int,array<string,mixed>> $rows */
    private static function summary(array $rows, array $meta): array
    {
        $blocked = count(array_filter($rows, static fn ($r) => ($r['kind'] ?? '') !== 'allowed'));
        $allowed = count($rows) - $blocked;
        return [
            ['IPAware Console - IP export', ''],
            ['Generated (UTC)', gmdate('c')],
            ['Source', (string) ($meta['mode'] ?? 'demo') === 'demo' ? 'Demo data' : (string) ($meta['server'] ?? 'Upstream API')],
            ['Filter', (string) ($meta['filter'] ?? 'all')],
            ['Search', (string) ($meta['query'] ?? '')],
            ['Total rows', count($rows)],
            ['Blocked IPs', $blocked],
            ['Whitelisted IPs / CIDRs', $allowed],
            ['', ''],
            ['Note', 'Never share exported files containing security data. The API key is never included.'],
        ];
    }

    /** @param array<int,array<int,mixed>> $data */
    private static function csv(array $data): string
    {
        $handle = fopen('php://temp', 'w+');
        if ($handle === false) {
            return '';
        }
        fwrite($handle, "\xEF\xBB\xBF"); // UTF-8 BOM so Excel opens it correctly
        foreach ($data as $row) {
            fputcsv($handle, array_map(static fn ($v) => (string) ($v ?? ''), array_values($row)), ',', '"', '\\');
        }
        rewind($handle);
        $out = (string) stream_get_contents($handle);
        fclose($handle);
        return $out;
    }
}
