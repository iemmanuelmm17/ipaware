<?php
declare(strict_types=1);

namespace IpAware;

/**
 * Turns the many possible upstream response shapes into one flat row schema.
 * If your API uses different field names, add them to the $IP_KEYS etc. lists
 * (or use the Diagnostics > Raw response viewer to see the exact shape).
 */
final class Normalizer
{
    private const LIST_KEYS = [
        'decisions', 'allowed_ips', 'allowedIps', 'allowlist', 'whitelist', 'data',
        'items', 'results', 'records', 'rows', 'list', 'entries', 'ips', 'value',
    ];

    private const IP_KEYS = [
        'cidr', 'ip', 'value', 'address', 'ip_address', 'ipaddress', 'source_ip',
        'scope_value', 'target', 'addr', 'network', 'ip_or_cidr', 'client_ip', 'prefix',
    ];

    public static function decisions(mixed $payload): array
    {
        return self::mapRows(self::findList($payload, 0), 'blocked');
    }

    public static function allowlist(mixed $payload): array
    {
        return self::mapRows(self::findList($payload, 0), 'allowed');
    }

    /** @return array<string,mixed> */
    public static function lookup(mixed $payload, string $ip): array
    {
        $root = is_array($payload) ? $payload : [];
        $decision = [];
        foreach (['decision', 'ban', 'current_decision', 'block', 'result'] as $key) {
            if (isset($root[$key]) && is_array($root[$key])) {
                $decision = $root[$key];
                break;
            }
        }
        $geo = [];
        foreach (['geo', 'geolocation', 'location', 'asn_info'] as $key) {
            if (isset($root[$key]) && is_array($root[$key])) {
                $geo = $root[$key];
                break;
            }
        }
        if ($geo === []) {
            $geo = $root;
        }
        $allowedRaw = $root['allowed'] ?? $root['allowlisted'] ?? $root['whitelisted'] ?? $root['in_allowlist'] ?? null;
        $allowlisted = $allowedRaw === true || $allowedRaw === 1 || $allowedRaw === 'true' || $allowedRaw === 'yes';
        $status = strtolower(Support::pick($root, ['status', 'state', 'verdict', 'decision', 'result', 'action']));
        $blocked = $decision !== [] || str_contains($status, 'ban') || str_contains($status, 'block') || str_contains($status, 'deny');
        $verdict = $allowlisted ? 'allowed' : ($blocked ? 'blocked' : ($status !== '' ? 'clean' : 'unknown'));

        $events = [];
        foreach (['events', 'history', 'activity', 'logs', 'signals'] as $key) {
            if (isset($root[$key]) && is_array($root[$key])) {
                $events = array_slice(array_values(array_filter($root[$key], 'is_array')), 0, 20);
                break;
            }
        }

        return [
            'ip' => $ip,
            'verdict' => $verdict,
            'status' => $status,
            'decision' => $decision !== [] ? self::mapRow($decision, 'blocked') : null,
            'allowlisted' => $allowlisted,
            'reason' => Support::pick($root, ['reason', 'message', 'description', 'scenario', 'note']),
            'scenario' => Support::pick($root, ['scenario', 'rule', 'category', 'threat']),
            'firstSeen' => self::time(Support::pick($root, ['first_seen', 'firstSeen', 'created_at', 'createdAt', 'created'])),
            'lastSeen' => self::time(Support::pick($root, ['last_seen', 'lastSeen', 'updated_at', 'updatedAt', 'timestamp'])),
            'expires' => self::time(Support::pick($root, ['expires_at', 'until', 'expires'])),
            'country' => Support::pick($geo, ['country', 'country_name', 'countryCode', 'country_code']),
            'asn' => Support::pick($geo, ['asn', 'asn_number', 'as_number']),
            'org' => Support::pick($geo, ['org', 'organization', 'isp', 'as_name']),
            'events' => $events,
            'raw' => self::raw($payload),
        ];
    }

    /** @param array<int,mixed> $rows */
    private static function mapRows(array $rows, string $kind): array
    {
        $out = [];
        $seen = [];
        foreach ($rows as $row) {
            if (is_string($row) || is_numeric($row)) {
                $row = ['cidr' => (string) $row];
            }
            if (!is_array($row)) {
                continue;
            }
            $mapped = self::mapRow($row, $kind);
            if ($mapped['ip'] === '') {
                continue;
            }
            $key = $mapped['kind'] . ':' . $mapped['ip'];
            if (isset($seen[$key])) {
                continue;
            }
            $seen[$key] = true;
            $out[] = $mapped;
        }
        return $out;
    }

    /** @return array<string,mixed> */
    private static function mapRow(array $row, string $kind): array
    {
        $ip = Support::pick($row, self::IP_KEYS);
        // Some APIs nest the address: {"scope":{"value":"1.2.3.4"}}
        if ($ip === '') {
            foreach (['scope', 'source', 'target', 'address'] as $nested) {
                if (isset($row[$nested]) && is_array($row[$nested])) {
                    $ip = Support::pick($row[$nested], self::IP_KEYS);
                    if ($ip !== '') {
                        break;
                    }
                }
            }
        }
        $ip = strtolower(trim($ip));
        $created = self::time(Support::pick($row, ['created_at', 'createdAt', 'created', 'timestamp', 'time', 'date', 'first_seen', 'firstSeen', 'added_at', 'inserted_at', 'start_at']));
        $expires = self::time(Support::pick($row, ['expires_at', 'expiresAt', 'expires', 'until', 'expiration', 'valid_until', 'expire_at', 'stop_at']));
        $reason = Support::pick($row, ['reason', 'message', 'description', 'detail', 'note', 'comment', 'scenario', 'type', 'action', 'decision', 'label']);
        $comment = Support::pick($row, ['comment', 'note', 'description', 'message', 'reason', 'label']);
        return [
            'id' => (string) (Support::pick($row, ['id', 'uuid', 'decision_id', '_id']) ?: substr(hash('sha256', $kind . ':' . $ip), 0, 20)),
            'kind' => $kind,
            'ip' => $ip,
            'cidr' => Support::cidr($ip),
            'reason' => $reason,
            'comment' => $comment,
            'scenario' => Support::pick($row, ['scenario', 'rule', 'threat', 'category', 'event_type']),
            'source' => Support::pick($row, ['source', 'origin', 'reporter', 'source_name', 'created_by', 'bouncer', 'instance', 'by']),
            'action' => Support::pick($row, ['action', 'type', 'decision', 'verdict', 'operation', 'kind']),
            'created' => $created,
            'expires' => $expires,
            'ttl' => Support::pick($row, ['duration', 'ttl', 'remaining', 'ban_duration', 'valid_for']),
            'origin' => Support::pick($row, ['origin', 'source', 'cluster', 'node']),
            'raw' => $row,
        ];
    }

    private static function time(string $value): string
    {
        if ($value === '') {
            return '';
        }
        if (ctype_digit($value)) {
            $n = (int) $value;
            if ($n > 1_000_000_000 && $n < 4_000_000_000) {
                return Support::iso($n, date_default_timezone_get());
            }
            return $value;
        }
        return $value;
    }

    /** @return array<int,mixed> */
    private static function findList(mixed $value, int $depth): array
    {
        if ($depth > 7) {
            return [];
        }
        if (is_string($value)) {
            $decoded = json_decode($value, true);
            return is_array($decoded) ? self::findList($decoded, $depth + 1) : [];
        }
        if (!is_array($value) || $value === []) {
            return [];
        }
        if (array_is_list($value)) {
            $first = $value[0];
            if (is_array($first)) {
                if (self::looksLikeIpRow($first)) {
                    return $value;
                }
                foreach (array_slice($value, 0, 5) as $item) {
                    $nested = self::findList($item, $depth + 1);
                    if ($nested !== []) {
                        return $nested;
                    }
                }
                return [];
            }
            return array_values(array_filter($value, static fn ($v) => is_string($v) || is_numeric($v)));
        }
        // Associative: check well-known container keys first.
        foreach (self::LIST_KEYS as $key) {
            foreach (array_keys($value) as $actual) {
                if (strcasecmp((string) $actual, $key) !== 0 || !array_key_exists($actual, $value)) {
                    continue;
                }
                $nested = self::findList($value[$actual], $depth + 1);
                if ($nested !== []) {
                    return $nested;
                }
            }
        }
        foreach ($value as $nested) {
            if (!is_array($nested)) {
                continue;
            }
            $found = self::findList($nested, $depth + 1);
            if ($found !== []) {
                return $found;
            }
        }
        return [];
    }

    private static function looksLikeIpRow(array $row): bool
    {
        foreach (self::IP_KEYS as $key) {
            if (array_key_exists($key, $row) && is_scalar($row[$key]) && (string) $row[$key] !== '') {
                return true;
            }
        }
        return false;
    }

    public static function raw(mixed $payload): mixed
    {
        if (is_string($payload)) {
            return mb_substr($payload, 0, 20000);
        }
        $json = json_encode($payload, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE | JSON_INVALID_UTF8_SUBSTITUTE);
        if ($json === false) {
            return null;
        }
        if (strlen($json) <= 20000) {
            return json_decode($json, true);
        }
        return ['_truncated' => true, 'preview' => mb_substr($json, 0, 20000)];
    }
}
