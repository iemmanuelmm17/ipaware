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
    private const BLOCK_LIST_KEYS = [
        'decisions', 'blocked_ips', 'blockedIps', 'blocked', 'blocks', 'blocklist', 'bans',
    ];

    private const ALLOW_LIST_KEYS = [
        'allowed_ips', 'allowedIps', 'allowed', 'allowlist', 'allow_list', 'whitelist', 'whitelisted',
    ];

    private const CONTAINER_KEYS = [
        'data', 'items', 'results', 'result', 'records', 'rows', 'list', 'entries', 'ips', 'value',
    ];

    // These are properties of a decision or response, not lists of addresses.
    private const METADATA_KEYS = [
        'server', 'servers', 'enforcedByServers', 'source', 'geo', 'evidence', 'evidenceFrom',
        'enforcement', 'history', 'rejects', 'paths', 'kinds', 'reasons', 'meta', 'metadata', 'stats', 'pagination',
    ];

    private const IP_KEYS = [
        'cidr', 'ip', 'value', 'address', 'ip_address', 'ipaddress', 'source_ip',
        'scope_value', 'target', 'addr', 'network', 'ip_or_cidr', 'client_ip', 'prefix',
    ];

    public static function decisions(mixed $payload): array
    {
        return self::mapRows(self::findList($payload, 'blocked', 0) ?? [], 'blocked');
    }

    public static function allowlist(mixed $payload): array
    {
        return self::mapRows(self::findList($payload, 'allowed', 0) ?? [], 'allowed');
    }

    /** An empty list is valid; null means the response shape could not be recognized. */
    public static function hasList(mixed $payload, string $kind): bool
    {
        return self::findList($payload, $kind, 0) !== null;
    }

    /** @return array<string,mixed> */
    public static function lookup(mixed $payload, string $ip): array
    {
        $root = self::lookupRoot($payload);
        $enforcement = isset($root['enforcement']) && is_array($root['enforcement']) ? $root['enforcement'] : [];
        $decision = [];
        $hasDecisionField = false;
        foreach (['decision', 'ban', 'current_decision', 'block'] as $key) {
            if (array_key_exists($key, $root) && ($root[$key] === null || is_array($root[$key]))) {
                $hasDecisionField = true;
                if (is_array($root[$key]) && $root[$key] !== []) {
                    $decision = $root[$key];
                    break;
                }
            }
        }
        // Older APIs sometimes put the current decision in a result object.
        if ($decision === [] && isset($root['result']) && is_array($root['result'])
            && array_intersect(['reason', 'scenario', 'scope', 'value', 'expiresAt', 'until'], array_keys($root['result'])) !== []) {
            $decision = $root['result'];
        }
        if ($decision === [] && isset($enforcement['block']) && is_array($enforcement['block'])) {
            $decision = $enforcement['block'];
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
        $allowedRaw = $root['allowed'] ?? $root['allowlisted'] ?? $root['whitelisted'] ?? $root['in_allowlist']
            ?? $enforcement['allowlisted'] ?? null;
        $allowlisted = self::nullableBool($allowedRaw);
        $blockedOnServer = self::nullableBool($enforcement['blockedOnThisServer'] ?? null);
        $currentStatus = strtolower(self::pickScalar($root, ['status', 'state', 'verdict', 'decision', 'result', 'action', 'type']));
        $status = $currentStatus ?: strtolower(Support::pickPath($root, ['score.lastVerdict']));
        $blockStates = ['ban', 'banned', 'block', 'blocked', 'deny', 'denied', 'drop', 'dropped', 'reject', 'rejected'];
        $allowStates = ['allow', 'allowed', 'allowlisted', 'whitelisted', 'permit', 'permitted'];
        $cleanStates = ['clean', 'clear', 'safe', 'ok', 'pass'];
        // score.lastVerdict is historical and cannot establish current enforcement.
        $statusBlocked = in_array($currentStatus, $blockStates, true);
        $statusClear = in_array($currentStatus, array_merge($allowStates, $cleanStates), true);
        // A current server-enforcement flag is authoritative over a historical score.
        $activeDecision = $blockedOnServer;
        if ($activeDecision === null) {
            if ($decision !== [] || $statusBlocked) $activeDecision = true;
            elseif ($hasDecisionField || $statusClear) $activeDecision = false;
        }
        $verdict = $allowlisted === true ? 'allowed'
            : ($activeDecision === true ? 'blocked'
                : (in_array($status, $allowStates, true) ? 'allowed'
                    : (in_array($status, $cleanStates, true) ? 'clean' : 'unknown')));

        // Object-shaped history/activity are summaries, not arrays of event records.
        $events = [];
        foreach (['events', 'history', 'activity', 'logs', 'signals'] as $key) {
            if (!isset($root[$key]) || !is_array($root[$key]) || !array_is_list($root[$key])) continue;
            $events = array_values(array_filter($root[$key], static fn ($event) => is_array($event)
                && array_intersect(['message', 'type', 'ts', 'time', 'timestamp'], array_keys($event)) !== []));
            if ($events !== []) {
                $events = array_slice($events, 0, 20);
                break;
            }
        }

        return [
            'ip' => $ip,
            'verdict' => $verdict,
            'status' => $status,
            'decision' => $decision !== [] ? self::mapRow($decision, 'blocked') : null,
            'activeDecision' => $activeDecision,
            'blockedOnThisServer' => $blockedOnServer,
            'allowlisted' => $allowlisted,
            'reason' => self::pickScalar($root, ['reason', 'message', 'description', 'scenario', 'note'])
                ?: Support::pickPath($root, ['enforcement.block.reason']),
            'scenario' => self::pickScalar($root, ['scenario', 'rule', 'category', 'threat']),
            'firstSeen' => self::time(self::pickScalar($root, ['first_seen', 'firstSeen', 'created_at', 'createdAt', 'created'])
                ?: Support::pickPath($root, ['activity.firstSeen', 'history.firstSeen'])),
            'lastSeen' => self::time(self::pickScalar($root, ['last_seen', 'lastSeen', 'updated_at', 'updatedAt', 'timestamp'])
                ?: Support::pickPath($root, ['activity.lastSeen'])),
            'expires' => self::time(self::pickScalar($root, ['expires_at', 'expiresAt', 'until', 'expires'])
                ?: Support::pickPath($root, ['enforcement.block.expiresAt'])),
            'country' => self::pickScalar($geo, ['country', 'country_name', 'countryCode', 'country_code']),
            'asn' => self::pickScalar($geo, ['asn', 'asn_number', 'as_number']),
            'org' => self::pickScalar($geo, ['org', 'organization', 'isp', 'as_name']),
            'events' => $events,
            // Keep the complete original response, including its outer envelope.
            'raw' => $payload,
        ];
    }

    /** Unwrap common response envelopes without treating a lookup result as a decision. */
    private static function lookupRoot(mixed $payload): array
    {
        $root = is_array($payload) ? $payload : [];
        for ($depth = 0; $depth < 5; $depth++) {
            if (self::address($root, false) !== '' || array_intersect(
                ['score', 'trust', 'activity', 'enforcement', 'geo', 'private', 'known'], array_keys($root)
            ) !== []) break;
            $nested = null;
            foreach (['data', 'result'] as $key) {
                if (isset($root[$key]) && is_array($root[$key]) && !array_is_list($root[$key])) {
                    $nested = $root[$key];
                    break;
                }
            }
            if ($nested === null) break;
            $root = $nested;
        }
        return $root;
    }

    private static function nullableBool(mixed $value): ?bool
    {
        if ($value === null || $value === '') return null;
        if (is_bool($value)) return $value;
        if (!is_scalar($value)) return null;
        return filter_var($value, FILTER_VALIDATE_BOOLEAN, FILTER_NULL_ON_FAILURE);
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
            $raw = $row;
            if (is_object($row)) {
                $row = self::associative($row);
            }
            if (!is_array($row)) {
                continue;
            }
            $mapped = self::mapRow($row, $kind);
            // Keep the original JSON object, not a lossy associative conversion.
            $mapped['raw'] = $raw;
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
        $ip = self::address($row);
        // Nested CrowdSec/cluster-style records: enforcement.block.addedAt, evidence.explanation, ...
        $created = self::time(Support::pick($row, ['created_at', 'createdAt', 'created', 'timestamp', 'time', 'date', 'first_seen', 'firstSeen', 'added_at', 'addedAt', 'inserted_at', 'start_at'])
            ?: Support::pickPath($row, ['enforcement.block.addedAt', 'firstDecidedAt']));
        $expires = self::time(Support::pick($row, ['expires_at', 'expiresAt', 'expires', 'until', 'expiration', 'valid_until', 'expire_at', 'stop_at'])
            ?: Support::pickPath($row, ['enforcement.block.expiresAt']));
        $reason = self::pickScalar($row, ['reason', 'message', 'description', 'detail', 'note', 'comment', 'label'])
            ?: Support::pickPath($row, ['enforcement.block.reason', 'evidence.reason'])
            ?: self::pickScalar($row, ['scenario', 'type', 'action', 'decision']);
        $explanation = Support::pickPath($row, ['evidence.explanation', 'explanation', 'reasonExplanation']) ?: $reason;
        $comment = self::pickScalar($row, ['comment', 'note', 'description', 'message', 'reason', 'label']);
        $originServer = Support::pickPath($row, ['evidence.originServer']);
        return [
            'id' => (string) (Support::pick($row, ['id', 'uuid', 'decision_id', '_id']) ?: substr(hash('sha256', $kind . ':' . $ip), 0, 20)),
            'kind' => $kind,
            'ip' => $ip,
            'cidr' => Support::cidr($ip),
            'reason' => $reason,
            'explanation' => $explanation,
            'comment' => $comment,
            'addedBy' => self::pickScalar($row, ['addedBy', 'added_by', 'createdBy', 'created_by', 'by']),
            'country' => self::pickScalar($row, ['country', 'countryCode', 'country_code']) ?: Support::pickPath($row, ['geo.country']),
            'city' => self::pickScalar($row, ['city']) ?: Support::pickPath($row, ['geo.city']),
            'domain' => self::pickScalar($row, ['domain', 'hostname']),
            'scenario' => Support::pick($row, ['scenario', 'rule', 'threat', 'category', 'event_type']),
            'source' => self::pickScalar($row, ['source', 'origin', 'reporter', 'source_name', 'created_by', 'bouncer', 'instance', 'by'])
                ?: $originServer,
            'action' => self::pickScalar($row, ['action', 'type', 'decision', 'verdict', 'operation', 'kind']),
            'created' => $created,
            'expires' => $expires,
            'ttl' => Support::pick($row, ['duration', 'ttl', 'remaining', 'ban_duration', 'valid_for']),
            'origin' => self::pickScalar($row, ['origin', 'source', 'cluster', 'node']) ?: $originServer,
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

    /** Convert JSON objects for normalization while retaining the original raw record separately. */
    private static function associative(mixed $value): mixed
    {
        if (is_object($value)) $value = get_object_vars($value);
        if (!is_array($value)) return $value;
        foreach ($value as $key => $child) {
            $value[$key] = self::associative($child);
        }
        return $value;
    }

    /** Pick only scalar values; nested objects should never become JSON in summary cells. */
    private static function pickScalar(array $row, array $keys): string
    {
        foreach ($keys as $key) {
            $value = $row[$key] ?? null;
            if (!is_scalar($value)) {
                continue;
            }
            $text = is_bool($value) ? ($value ? 'true' : 'false') : trim((string) $value);
            if ($text !== '') {
                return $text;
            }
        }
        return '';
    }

    /** Extract a real IPv4/IPv6 address or CIDR, including common nested forms. */
    private static function address(array $row, bool $includeNested = true): string
    {
        $lower = array_change_key_case($row, CASE_LOWER);
        foreach (self::IP_KEYS as $key) {
            $value = $lower[strtolower($key)] ?? null;
            if (is_string($value)) {
                $value = strtolower(trim($value));
                if (Support::isIpOrCidr($value)) {
                    return $value;
                }
            }
        }
        if (!$includeNested) {
            return '';
        }
        // Some APIs nest the address, e.g. {"scope":{"value":"1.2.3.4"}}.
        foreach (['scope', 'source', 'target', 'address'] as $key) {
            if (!isset($lower[$key]) || (!is_array($lower[$key]) && !is_object($lower[$key]))) {
                continue;
            }
            $nested = array_change_key_case((array) $lower[$key], CASE_LOWER);
            foreach (self::IP_KEYS as $ipKey) {
                $value = $nested[strtolower($ipKey)] ?? null;
                if (is_string($value)) {
                    $value = strtolower(trim($value));
                    if (Support::isIpOrCidr($value)) {
                        return $value;
                    }
                }
            }
        }
        return '';
    }

    /**
     * Find an address list while distinguishing an explicitly empty list from
     * an unrecognized response. Server names and other metadata are not IPs.
     *
     * @return ?array<int,mixed>
     */
    private static function findList(mixed $value, string $kind, int $depth): ?array
    {
        if ($depth > 7) {
            return null;
        }
        if (is_string($value)) {
            $text = trim($value);
            if (Support::isIpOrCidr($text)) {
                return [$text];
            }
            $decoded = json_decode($text);
            return is_array($decoded) || is_object($decoded) ? self::findList($decoded, $kind, $depth + 1) : null;
        }
        $original = $value;
        $isObject = is_object($value);
        if ($isObject) $value = get_object_vars($value);
        if (!is_array($value)) {
            return null;
        }
        if ($value === []) {
            return $isObject ? null : [];
        }
        if (!$isObject && array_is_list($value)) {
            // Do not assume the first element is a record: lists may start with
            // nulls or contain a mix of valid and invalid entries.
            foreach ($value as $item) {
                $record = is_object($item) ? get_object_vars($item) : $item;
                if ((is_string($item) && Support::isIpOrCidr(trim($item)))
                    || (is_array($record) && (is_object($item) || !array_is_list($record)) && self::address($record) !== '')) {
                    return $value;
                }
            }
            $sawEmpty = false;
            foreach ($value as $item) {
                if (!is_array($item) && !is_object($item)) {
                    continue;
                }
                $found = self::findList($item, $kind, $depth + 1);
                if ($found !== null && $found !== []) {
                    return $found;
                }
                $sawEmpty = $sawEmpty || $found === [];
            }
            return $sawEmpty ? [] : null;
        }

        $ownKeys = $kind === 'allowed' ? self::ALLOW_LIST_KEYS : self::BLOCK_LIST_KEYS;
        $otherKeys = $kind === 'allowed' ? self::BLOCK_LIST_KEYS : self::ALLOW_LIST_KEYS;
        $keys = array_change_key_case($value, CASE_LOWER);

        // Explicit list keys win over metadata and over the other list type,
        // including when the chosen list is empty.
        foreach ($ownKeys as $key) {
            $key = strtolower($key);
            if (array_key_exists($key, $keys)) {
                $found = self::findList($keys[$key], $kind, $depth + 1);
                if ($found !== null) {
                    return $found;
                }
            }
        }
        if (self::address($value, false) !== '') {
            return [$original];
        }
        foreach (self::CONTAINER_KEYS as $key) {
            if (array_key_exists($key, $keys)) {
                $found = self::findList($keys[$key], $kind, $depth + 1);
                if ($found !== null) {
                    return $found;
                }
            }
        }

        // A nested scope/address can itself be a row. A source object alone is
        // ambiguous metadata, so require a decision-like field alongside it.
        $rowMarkers = ['scope', 'target', 'address', 'verdict', 'reason', 'action', 'type', 'enforcement', 'evidence'];
        if (array_intersect($rowMarkers, array_keys($keys)) !== [] && self::address($value) !== '') {
            return [$original];
        }

        // Preserve support for unfamiliar envelope names, but never scan known
        // metadata or the opposite list as if it were the requested list.
        $skip = array_map('strtolower', array_merge($ownKeys, $otherKeys, self::CONTAINER_KEYS, self::METADATA_KEYS));
        foreach ($value as $key => $nested) {
            if ((!is_array($nested) && !is_object($nested)) || in_array(strtolower((string) $key), $skip, true)) {
                continue;
            }
            $found = self::findList($nested, $kind, $depth + 1);
            if ($found !== null && $found !== []) {
                return $found;
            }
        }
        return null;
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
            return $payload;
        }
        return ['_truncated' => true, 'preview' => mb_substr($json, 0, 20000)];
    }
}
