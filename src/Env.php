<?php
declare(strict_types=1);

namespace IpAware;

/** Minimal .env parser. Later files override earlier ones (e.g. .env.local). */
final class Env
{
    /** @param string[] $files @return array<string,string> */
    public static function load(array $files): array
    {
        $out = [];
        foreach ($files as $file) {
            if (!is_string($file) || !is_file($file) || !is_readable($file)) {
                continue;
            }
            $lines = file($file, FILE_IGNORE_NEW_LINES | FILE_SKIP_EMPTY_LINES);
            if ($lines === false) {
                continue;
            }
            foreach ($lines as $line) {
                $line = trim($line);
                if ($line === '' || str_starts_with($line, '#') || str_starts_with($line, ';')) {
                    continue;
                }
                if (str_starts_with($line, 'export ')) {
                    $line = trim(substr($line, 7));
                }
                if (!str_contains($line, '=')) {
                    continue;
                }
                [$key, $value] = explode('=', $line, 2);
                $key = trim($key);
                if ($key === '' || !preg_match('/^[A-Za-z_][A-Za-z0-9_]*$/', $key)) {
                    continue;
                }
                $out[strtoupper($key)] = self::value(trim($value));
            }
        }
        return $out;
    }

    private static function value(string $raw): string
    {
        if ($raw === '') {
            return '';
        }
        $quote = $raw[0];
        if (($quote === '"' || $quote === "'") && strlen($raw) >= 2 && str_ends_with($raw, $quote)) {
            $inner = substr($raw, 1, -1);
            if ($quote === '"') {
                $inner = str_replace(['\\n', '\\r', '\\"', '\\\\'], ["\n", "\r", '"', '\\'], $inner);
            }
            return $inner;
        }
        // Strip an unquoted trailing comment, but keep # inside a URL fragment.
        $hash = strpos($raw, ' #');
        if ($hash !== false) {
            $raw = substr($raw, 0, $hash);
        } elseif (str_starts_with($raw, '#')) {
            $raw = '';
        }
        return trim($raw);
    }
}
