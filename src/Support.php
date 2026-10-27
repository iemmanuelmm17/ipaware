<?php
declare(strict_types=1);

namespace IpAware;

final class Support
{
    public static function bool(mixed $v, bool $default = false): bool
    {
        if (is_bool($v)) {
            return $v;
        }
        if ($v === null || $v === '') {
            return $default;
        }
        if (is_int($v) || is_float($v)) {
            return (bool) $v;
        }
        return filter_var($v, FILTER_VALIDATE_BOOLEAN, FILTER_NULL_ON_FAILURE) ?? $default;
    }

    public static function int(mixed $v, int $default, int $min = PHP_INT_MIN, int $max = PHP_INT_MAX): int
    {
        if ($v === '' || $v === null || !is_numeric($v)) {
            return $default;
        }
        return max($min, min($max, (int) $v));
    }

    /** @return string[] */
    public static function csv(mixed $v): array
    {
        if (is_array($v)) {
            return array_values(array_filter(array_map('strval', $v), static fn ($s) => trim($s) !== ''));
        }
        $parts = preg_split('/[,\s;]+/', (string) $v) ?: [];
        return array_values(array_filter(array_map('trim', $parts), static fn ($s) => $s !== ''));
    }

    public static function isIp(string $ip): bool
    {
        return filter_var($ip, FILTER_VALIDATE_IP) !== false;
    }

    public static function isIpOrCidr(string $value): bool
    {
        $value = trim($value);
        if ($value === '') {
            return false;
        }
        if (!str_contains($value, '/')) {
            return self::isIp($value);
        }
        [$net, $bits] = explode('/', $value, 2);
        if (!self::isIp($net) || !ctype_digit($bits)) {
            return false;
        }
        $max = str_contains($net, ':') ? 128 : 32;
        return (int) $bits >= 0 && (int) $bits <= $max;
    }

    public static function cidr(string $value): string
    {
        $value = strtolower(trim($value));
        if ($value === '') {
            return '';
        }
        if (!str_contains($value, '/')) {
            return $value . (str_contains($value, ':') ? '/128' : '/32');
        }
        return $value;
    }

    /** IPv4 + IPv6 CIDR membership test. A bare address is treated as /32 or /128. */
    public static function cidrContains(string $cidr, string $ip): bool
    {
        $cidr = trim($cidr);
        $ip = trim($ip);
        if ($cidr === '' || !self::isIp($ip)) {
            return false;
        }
        if (!str_contains($cidr, '/')) {
            $cidr .= str_contains($cidr, ':') ? '/128' : '/32';
        }
        [$net, $bits] = explode('/', $cidr, 2);
        if (!self::isIp($net) || !ctype_digit($bits)) {
            return false;
        }
        $ipBin = inet_pton($ip);
        $netBin = inet_pton($net);
        if ($ipBin === false || $netBin === false || strlen($ipBin) !== strlen($netBin)) {
            return false;
        }
        $bits = (int) $bits;
        $maxBits = strlen($ipBin) * 8;
        if ($bits < 0 || $bits > $maxBits) {
            return false;
        }
        $whole = intdiv($bits, 8);
        $remainder = $bits % 8;
        if ($whole > 0 && strncmp($ipBin, $netBin, $whole) !== 0) {
            return false;
        }
        if ($remainder === 0) {
            return true;
        }
        $mask = (0xFF << (8 - $remainder)) & 0xFF;
        return (ord($ipBin[$whole]) & $mask) === (ord($netBin[$whole]) & $mask);
    }

    public static function isPublicIp(string $ip): bool
    {
        return filter_var($ip, FILTER_VALIDATE_IP, FILTER_FLAG_NO_PRIV_RANGE | FILTER_FLAG_NO_RES_RANGE) !== false;
    }

    public static function isLoopback(string $ip): bool
    {
        return in_array($ip, ['127.0.0.1', '::1', 'localhost'], true)
            || self::cidrContains('127.0.0.0/8', $ip)
            || self::cidrContains('::1/128', $ip);
    }

    public static function pick(array $row, array $keys, string $default = ''): string
    {
        foreach ($keys as $key) {
            if (!array_key_exists($key, $row) || $row[$key] === null || $row[$key] === '') {
                continue;
            }
            $v = $row[$key];
            if (is_array($v)) {
                $v = json_encode($v, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE);
            } elseif (is_bool($v)) {
                $v = $v ? 'true' : 'false';
            }
            return trim((string) $v);
        }
        return $default;
    }

    /**
     * Like pick(), but accepts dot paths for nested fields, e.g. "enforcement.block.addedAt".
     *
     * @param array<int,string> $paths
     */
    public static function pickPath(array $row, array $paths, string $default = ''): string
    {
        foreach ($paths as $path) {
            $node = $row;
            foreach (explode('.', $path) as $segment) {
                if (!is_array($node) || !array_key_exists($segment, $node)) {
                    $node = null;
                    break;
                }
                $node = $node[$segment];
            }
            if ($node === null || $node === '' || is_array($node)) {
                continue;
            }
            return trim(is_bool($node) ? ($node ? 'true' : 'false') : (string) $node);
        }
        return $default;
    }

    /**
     * US-style date and time (MM/DD/YYYY hh:mm:ss AM/PM) in the server timezone.
     * Returns the input unchanged when it cannot be parsed.
     */
    public static function usDateTime(string $value): string
    {
        $value = trim($value);
        if ($value === '') {
            return '';
        }
        try {
            if (ctype_digit($value)) {
                $n = (int) $value;
                $date = new \DateTimeImmutable('@' . $n);
            } else {
                $date = new \DateTimeImmutable($value);
            }
        } catch (\Exception) {
            return $value;
        }
        return $date->setTimezone(new \DateTimeZone(date_default_timezone_get()))->format('m/d/Y h:i:s A');
    }

    public static function redact(string $text, string $secret): string
    {
        if ($secret !== '') {
            $text = str_replace([$secret, urlencode($secret)], ['***REDACTED***', '***REDACTED***'], $text);
        }
        return $text;
    }

    public static function id(string $prefix = ''): string
    {
        return $prefix . bin2hex(random_bytes(9));
    }

    public static function iso(int $epoch, string $tz = 'UTC'): string
    {
        return (new \DateTimeImmutable('@' . $epoch))
            ->setTimezone(new \DateTimeZone($tz))
            ->format(DATE_ATOM);
    }

    public static function maskIp(string $ip): string
    {
        if (str_contains($ip, ':')) {
            $parts = explode(':', $ip);
            return implode(':', array_slice($parts, 0, 3)) . ':****:****';
        }
        $parts = explode('.', $ip);
        if (count($parts) === 4) {
            return $parts[0] . '.' . $parts[1] . '.' . $parts[2] . '.*';
        }
        return $ip;
    }

    public static function securityHeaders(bool $https): void
    {
        header('X-Content-Type-Options: nosniff');
        header('Referrer-Policy: no-referrer');
        header('X-Frame-Options: DENY');
        header('Permissions-Policy: geolocation=(), microphone=(), camera=()');
        header("Content-Security-Policy: default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'");
        if ($https) {
            header('Strict-Transport-Security: max-age=31536000; includeSubDomains');
        }
    }
}
