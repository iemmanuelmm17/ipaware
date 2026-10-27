<?php
declare(strict_types=1);

namespace IpAware;

/** Append-only JSONL activity log. Used by the Events tab and the SSE stream. */
final class EventLog
{
    private string $file;
    private int $max;
    private string $tz;

    public function __construct(string $file, int $max, string $tz)
    {
        $this->file = $file;
        $this->max = $max;
        $this->tz = $tz;
        $dir = dirname($file);
        if (!is_dir($dir)) {
            @mkdir($dir, 0770, true);
        }
    }

    /** @param array<string,mixed> $meta */
    public function append(string $type, string $message, string $ip = '', string $severity = 'info', array $meta = []): array
    {
        $event = [
            'id' => Support::id('ev_'),
            'ts' => (new \DateTimeImmutable('now'))->setTimezone(new \DateTimeZone($this->tz))->format(DATE_ATOM),
            'epoch' => time(),
            'type' => $type,
            'severity' => in_array($severity, ['info', 'success', 'warning', 'danger'], true) ? $severity : 'info',
            'message' => mb_substr($message, 0, 500),
            'ip' => $ip,
            'meta' => $meta,
        ];
        $line = json_encode($event, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE | JSON_INVALID_UTF8_SUBSTITUTE) . "\n";
        $handle = @fopen($this->file, 'c+');
        if ($handle !== false) {
            if (flock($handle, LOCK_EX)) {
                fseek($handle, 0, SEEK_END);
                @fwrite($handle, $line);
                fflush($handle);
                $this->trim($handle);
                flock($handle, LOCK_UN);
            }
            fclose($handle);
        }
        return $event;
    }

    private function trim($handle): void
    {
        $size = fstat($handle)['size'] ?? 0;
        if ($size < 900000) {
            return;
        }
        rewind($handle);
        $lines = [];
        while (($line = fgets($handle)) !== false) {
            $lines[] = $line;
            if (count($lines) > $this->max + 200) {
                array_shift($lines);
            }
        }
        $keep = array_slice($lines, -$this->max);
        ftruncate($handle, 0);
        rewind($handle);
        fwrite($handle, implode('', $keep));
        fflush($handle);
    }

    public function lastId(): ?string
    {
        $events = $this->read(1);
        return $events[0]['id'] ?? null;
    }

    /** Newest first. */
    public function recent(int $limit = 100, string $query = '', string $type = ''): array
    {
        $events = $this->read(max(1, min(2000, $limit)) * 4 + 100);
        $events = array_reverse($events);
        $query = mb_strtolower(trim($query));
        if ($query !== '' || $type !== '') {
            $events = array_values(array_filter($events, static function (array $e) use ($query, $type): bool {
                if ($type !== '' && ($e['type'] ?? '') !== $type) {
                    return false;
                }
                if ($query === '') {
                    return true;
                }
                $hay = mb_strtolower(implode(' ', [
                    (string) ($e['message'] ?? ''),
                    (string) ($e['type'] ?? ''),
                    (string) ($e['ip'] ?? ''),
                    json_encode($e['meta'] ?? [], JSON_UNESCAPED_UNICODE) ?: '',
                ]));
                return str_contains($hay, $query);
            }));
        }
        return array_slice($events, 0, max(1, min(2000, $limit)));
    }

    /** Events written after $afterId, oldest first (for SSE replay). */
    public function since(?string $afterId, int $limit = 60): array
    {
        $events = $this->read(600);
        $out = [];
        $found = $afterId === null || $afterId === '';
        foreach ($events as $e) {
            if (!$found) {
                if (($e['id'] ?? '') === $afterId) {
                    $found = true;
                }
                continue;
            }
            $out[] = $e;
            if (count($out) >= $limit) {
                break;
            }
        }
        return $out;
    }

    public function clear(): void
    {
        $handle = @fopen($this->file, 'c+');
        if ($handle !== false) {
            if (flock($handle, LOCK_EX)) {
                ftruncate($handle, 0);
                flock($handle, LOCK_UN);
            }
            fclose($handle);
        }
    }

    /** @return array<int,array<string,mixed>> oldest first */
    private function read(int $tailLines): array
    {
        if (!is_file($this->file)) {
            return [];
        }
        $handle = @fopen($this->file, 'r');
        if ($handle === false) {
            return [];
        }
        flock($handle, LOCK_SH);
        $buffer = [];
        while (($line = fgets($handle)) !== false) {
            $decoded = json_decode($line, true);
            if (is_array($decoded)) {
                $buffer[] = $decoded;
            }
            if (count($buffer) > $tailLines) {
                array_shift($buffer);
            }
        }
        flock($handle, LOCK_UN);
        fclose($handle);
        return $buffer;
    }
}
