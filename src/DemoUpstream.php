<?php
declare(strict_types=1);

namespace IpAware;

/** Fully working fake upstream so the console is usable before you configure a real server. */
final class DemoUpstream
{
    private string $file;
    private string $tz;
    private array $state;

    private const SCENARIOS = [
        ['crowdsecurity/ssh-bf', 'SSH brute-force attempts'],
        ['crowdsecurity/http-probing', 'HTTP path probing / scanning'],
        ['crowdsecurity/http-bf-wordpress', 'WordPress login brute force'],
        ['crowdsecurity/sql-injection', 'SQL injection pattern detected'],
        ['crowdsecurity/rdp-bf', 'RDP authentication brute force'],
        ['crowdsecurity/http-crawl-non_statics', 'Aggressive web crawling'],
        ['crowdsecurity/smtp-bf', 'SMTP AUTH brute force'],
        ['crowdsecurity/voip-bf', 'SIP/VoIP registration flood'],
        ['custom/geo-anomaly', 'Unusual geographic access pattern'],
        ['custom/rate-limit', 'Repeated rate-limit violations'],
    ];

    private const COMMENTS = [
        'office HQ', 'branch office', 'monitoring probe', 'partner VPN', 'home admin',
        'CI runner', 'support jump host', 'payment gateway callback', 'tango', 'ups monitoring',
    ];

    private const COUNTRIES = ['Philippines', 'Germany', 'United States', 'Singapore', 'Japan', 'Brazil', 'India', 'Netherlands', 'Australia', 'France'];

    public function __construct(Config $cfg)
    {
        $this->file = $cfg->dataDir() . '/demo-state.json';
        $this->tz = (string) $cfg->get('TIMEZONE', 'UTC');
        mt_srand($cfg->int('DEMO_SEED', 1337, 1, 999999));
        $loaded = null;
        if (is_file($this->file)) {
            $decoded = json_decode((string) file_get_contents($this->file), true);
            if (is_array($decoded) && isset($decoded['decisions'], $decoded['allowed'])) {
                $loaded = $decoded;
            }
        }
        $this->state = $loaded ?? $this->seed();
        if ($loaded === null) {
            $this->save();
        }
    }

    private function seed(): array
    {
        $now = time();
        $decisions = [];
        $allowed = [];
        for ($i = 0; $i < 186; $i++) {
            $ip = $this->randomIp();
            [$scenario, $reason] = self::SCENARIOS[$i % count(self::SCENARIOS)];
            $age = $now - mt_rand(60, 60 * 60 * 24 * 12);
            $ttl = mt_rand(15, 60 * 60 * 48);
            $decisions[] = [
                'id' => 'dec_' . $i,
                'scope' => 'Ip',
                'value' => $ip,
                'type' => $i % 7 === 0 ? 'captcha' : 'ban',
                'scenario' => $scenario,
                'reason' => $reason,
                'origin' => ['crowdsec', 'firewall', 'manual', 'lapi'][$i % 4],
                'created_at' => Support::iso($age, $this->tz),
                'until' => Support::iso($age + $ttl, $this->tz),
                'duration' => $this->humanDuration($ttl),
            ];
        }
        for ($i = 0; $i < 31; $i++) {
            $allowed[] = [
                'id' => 'allow_' . $i,
                'cidr' => $i % 9 === 0 ? $this->randomIp() . '/29' : $this->randomIp(),
                'comment' => self::COMMENTS[$i % count(self::COMMENTS)],
                'created_at' => Support::iso($now - mt_rand(3600, 60 * 60 * 24 * 90), $this->tz),
                'created_by' => ['admin', 'api', 'console'][$i % 3],
            ];
        }
        // A few IPv6 entries to prove IPv6 works end-to-end.
        $decisions[] = [
            'id' => 'dec_v6', 'scope' => 'Ip', 'value' => '2001:db8:4f::a1',
            'type' => 'ban', 'scenario' => 'custom/ipv6-scan', 'reason' => 'IPv6 port scan',
            'origin' => 'lapi', 'created_at' => Support::iso($now - 7200, $this->tz),
            'until' => Support::iso($now + 7200, $this->tz), 'duration' => '4h',
        ];
        $allowed[] = [
            'id' => 'allow_v6', 'cidr' => '2001:db8:1::/48', 'comment' => 'IPv6 office range',
            'created_at' => Support::iso($now - 86400, $this->tz), 'created_by' => 'admin',
        ];
        return ['decisions' => $decisions, 'allowed' => $allowed, 'lastDrift' => $now, 'seededAt' => $now];
    }

    public function decisions(): array
    {
        $this->maybeDrift();
        return $this->wrap(['decisions' => $this->state['decisions']]);
    }

    public function allowedIps(): array
    {
        return $this->wrap(['allowed_ips' => $this->state['allowed']]);
    }

    public function lookup(string $ip): array
    {
        $decision = null;
        foreach ($this->state['decisions'] as $row) {
            if (strcasecmp((string) $row['value'], $ip) === 0 || Support::cidrContains((string) $row['value'], $ip)) {
                $decision = $row;
                break;
            }
        }
        $allowed = false;
        foreach ($this->state['allowed'] as $row) {
            if (Support::cidrContains((string) $row['cidr'], $ip)) {
                $allowed = true;
                break;
            }
        }
        $seed = crc32($ip);
        $payload = [
            'ip' => $ip,
            'status' => $decision !== null ? 'banned' : 'clean',
            'decision' => $decision ?? [],
            'allowed' => $allowed,
            'message' => $decision !== null
                ? (string) ($decision['reason'] ?? 'Active decision')
                : 'No active decision found for this address.',
            'first_seen' => Support::iso(time() - (($seed % 86400) + 3600), $this->tz),
            'last_seen' => Support::iso(time() - ($seed % 3600), $this->tz),
            'geo' => [
                'country' => self::COUNTRIES[$seed % count(self::COUNTRIES)],
                'asn' => 'AS' . (10000 + ($seed % 50000)),
                'org' => 'Example Network ' . (1 + ($seed % 40)),
            ],
            'events' => [
                ['ts' => Support::iso(time() - 900, $this->tz), 'type' => 'signal', 'message' => 'Request rate anomaly'],
                ['ts' => Support::iso(time() - 3600, $this->tz), 'type' => 'auth', 'message' => 'Failed authentication'],
            ],
        ];
        return $this->wrap(Normalizer::lookup($payload, $ip));
    }

    public function unblock(string $ip): array
    {
        $before = count($this->state['decisions']);
        $this->state['decisions'] = array_values(array_filter(
            $this->state['decisions'],
            static fn ($r) => strcasecmp((string) ($r['value'] ?? ''), $ip) !== 0
        ));
        $this->save();
        return $this->wrap(['ok' => true, 'status' => 200, 'removed' => $before - count($this->state['decisions']), 'ip' => $ip]);
    }

    public function block(string $ip, string $reason, string $duration): array
    {
        $seconds = $this->parseDuration($duration);
        $now = time();
        $this->state['decisions'] = array_values(array_filter(
            $this->state['decisions'],
            static fn ($r) => strcasecmp((string) ($r['value'] ?? ''), $ip) !== 0
        ));
        array_unshift($this->state['decisions'], [
            'id' => 'dec_' . Support::id(),
            'scope' => 'Ip',
            'value' => $ip,
            'type' => 'ban',
            'scenario' => 'manual/console',
            'reason' => $reason !== '' ? $reason : 'Blocked from IPAware Console',
            'origin' => 'console',
            'created_at' => Support::iso($now, $this->tz),
            'until' => Support::iso($now + $seconds, $this->tz),
            'duration' => $this->humanDuration($seconds),
        ]);
        $this->state['allowed'] = array_values(array_filter(
            $this->state['allowed'],
            static fn ($r) => !Support::cidrContains((string) ($r['cidr'] ?? ''), $ip)
        ));
        $this->save();
        return $this->wrap(['ok' => true, 'status' => 201, 'ip' => $ip, 'duration' => $duration]);
    }

    public function allow(string $cidr, string $comment): array
    {
        $this->state['allowed'] = array_values(array_filter(
            $this->state['allowed'],
            static fn ($r) => strcasecmp((string) ($r['cidr'] ?? ''), $cidr) !== 0
        ));
        array_unshift($this->state['allowed'], [
            'id' => 'allow_' . Support::id(),
            'cidr' => $cidr,
            'comment' => $comment !== '' ? $comment : 'Added from IPAware Console',
            'created_at' => Support::iso(time(), $this->tz),
            'created_by' => 'console',
        ]);
        $this->state['decisions'] = array_values(array_filter(
            $this->state['decisions'],
            static fn ($r) => strcasecmp((string) ($r['value'] ?? ''), $cidr) !== 0
        ));
        $this->save();
        return $this->wrap(['ok' => true, 'status' => 201, 'cidr' => $cidr]);
    }

    public function unallow(string $cidr): array
    {
        $before = count($this->state['allowed']);
        $this->state['allowed'] = array_values(array_filter(
            $this->state['allowed'],
            static fn ($r) => strcasecmp((string) ($r['cidr'] ?? ''), $cidr) !== 0
                && strcasecmp(Support::cidr((string) ($r['cidr'] ?? '')), Support::cidr($cidr)) !== 0
        ));
        $this->save();
        return $this->wrap(['ok' => true, 'status' => 200, 'removed' => $before - count($this->state['allowed']), 'cidr' => $cidr]);
    }

    public function test(): array
    {
        return $this->wrap([
            'ok' => true,
            'status' => 200,
            'message' => 'Demo upstream is active. Set API_BASE_URL in .env to connect to your real server.',
            'sample' => ['decisions' => count($this->state['decisions']), 'allowed' => count($this->state['allowed'])],
        ]);
    }

    private function maybeDrift(): void
    {
        $now = time();
        if ($now - (int) ($this->state['lastDrift'] ?? 0) < 18) {
            return;
        }
        $this->state['lastDrift'] = $now;
        if (random_int(1, 100) > 55) {
            return;
        }
        if (count($this->state['decisions']) > 190 && random_int(0, 1) === 1) {
            array_shift($this->state['decisions']);
        } else {
            [$scenario, $reason] = self::SCENARIOS[random_int(0, count(self::SCENARIOS) - 1)];
            array_unshift($this->state['decisions'], [
                'id' => 'dec_' . Support::id(),
                'scope' => 'Ip',
                'value' => $this->randomIp(),
                'type' => 'ban',
                'scenario' => $scenario,
                'reason' => $reason,
                'origin' => 'lapi',
                'created_at' => Support::iso($now, $this->tz),
                'until' => Support::iso($now + 14400, $this->tz),
                'duration' => '4h',
            ]);
        }
        $this->save();
    }

    private function wrap(mixed $data): array
    {
        return [
            'status' => 200,
            'body' => '',
            'json' => $data,
            'raw' => $data,
            'error' => null,
            'durationMs' => random_int(3, 24),
            'url' => 'demo://ipaware',
            'contentType' => 'application/json',
            'demo' => true,
        ];
    }

    private function randomIp(): string
    {
        $first = [5, 23, 31, 37, 45, 58, 61, 77, 80, 91, 103, 104, 111, 119, 122, 141, 167, 176, 181, 185, 188, 193, 200, 202, 209, 212, 213, 217];
        return $first[mt_rand(0, count($first) - 1)] . '.' . mt_rand(1, 254) . '.' . mt_rand(0, 255) . '.' . mt_rand(1, 254);
    }

    private function humanDuration(int $seconds): string
    {
        if ($seconds >= 86400) {
            return intdiv($seconds, 86400) . 'd ' . intdiv($seconds % 86400, 3600) . 'h';
        }
        if ($seconds >= 3600) {
            return intdiv($seconds, 3600) . 'h ' . intdiv($seconds % 3600, 60) . 'm';
        }
        return max(1, intdiv($seconds, 60)) . 'm';
    }

    private function parseDuration(string $duration): int
    {
        if (preg_match('/^(\d+)\s*([smhd])$/i', trim($duration), $m)) {
            $mult = ['s' => 1, 'm' => 60, 'h' => 3600, 'd' => 86400][strtolower($m[2])];
            return max(60, min(30 * 86400, (int) $m[1] * $mult));
        }
        return 4 * 3600;
    }

    private function save(): void
    {
        $json = json_encode($this->state, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE);
        @file_put_contents($this->file, $json === false ? '{}' : $json, LOCK_EX);
    }
}
