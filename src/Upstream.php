<?php
declare(strict_types=1);

namespace IpAware;

final class ApiException extends \RuntimeException
{
    public function __construct(string $message, public int $httpStatus = 502, public mixed $details = null)
    {
        parent::__construct($message);
    }
}

final class Upstream
{
    private Config $cfg;
    private HttpClient $http;
    private ?string $apiKey;
    private string $baseUrl;
    private string $keySource;
    private bool $demo;
    private ?DemoUpstream $fake = null;

    public function __construct(Config $cfg, ?string $apiKey, string $baseUrl, string $keySource)
    {
        $this->cfg = $cfg;
        $this->http = new HttpClient($cfg);
        $this->apiKey = $apiKey;
        $this->baseUrl = rtrim($baseUrl, '/');
        $this->keySource = $keySource;
        $this->demo = $cfg->isDemo();
        if ($this->demo) {
            $this->fake = new DemoUpstream($cfg);
        }
    }

    public function isDemo(): bool
    {
        return $this->demo;
    }

    public function keySource(): string
    {
        return $this->keySource;
    }

    public function hasKey(): bool
    {
        return $this->apiKey !== null && $this->apiKey !== '';
    }

    public function baseUrl(): string
    {
        return $this->baseUrl;
    }

    public function requireLiveReady(): void
    {
        if ($this->demo) {
            return;
        }
        if ($this->baseUrl === '') {
            throw new ApiException('No upstream server configured. Set API_BASE_URL in .env or use Settings → Server override.', 400);
        }
        if (!$this->hasKey()) {
            throw new ApiException('API key required. Enter it in Settings → API key (stored in your session only).', 401);
        }
    }

    /** @return array{rows:array,raw:mixed,meta:array} */
    public function decisions(): array
    {
        $this->requireLiveReady();
        if ($this->demo) {
            $r = $this->fake->decisions();
            return [
                'rows' => Normalizer::decisions($r['raw']),
                'raw' => Normalizer::raw($r['raw']),
                'meta' => $this->meta($r),
            ];
        }
        $r = $this->call('GET', (string) $this->cfg->get('ENDPOINT_DECISIONS'));
        return [
            'rows' => Normalizer::decisions($r['payload']),
            'raw' => Normalizer::raw($r['payload']),
            'meta' => $this->meta($r),
        ];
    }

    /** @return array{rows:array,raw:mixed,meta:array} */
    public function allowedIps(): array
    {
        $this->requireLiveReady();
        if ($this->demo) {
            $r = $this->fake->allowedIps();
            return [
                'rows' => Normalizer::allowlist($r['raw']),
                'raw' => Normalizer::raw($r['raw']),
                'meta' => $this->meta($r),
            ];
        }
        $r = $this->call('GET', (string) $this->cfg->get('ENDPOINT_ALLOWLIST'));
        return [
            'rows' => Normalizer::allowlist($r['payload']),
            'raw' => Normalizer::raw($r['payload']),
            'meta' => $this->meta($r),
        ];
    }

    /** @return array{result:array,raw:mixed,meta:array} */
    public function lookup(string $ip): array
    {
        $this->requireLiveReady();
        if ($this->demo) {
            $r = $this->fake->lookup($ip);
            return ['result' => $r['raw'], 'raw' => $r['raw']['raw'] ?? $r['raw'], 'meta' => $this->meta($r)];
        }
        $path = rtrim((string) $this->cfg->get('ENDPOINT_IP'), '/') . '/' . rawurlencode($ip);
        $r = $this->call('GET', $path);
        return [
            'result' => Normalizer::lookup($r['payload'], $ip),
            'raw' => Normalizer::raw($r['payload']),
            'meta' => $this->meta($r),
        ];
    }

    /** @return array{result:array,raw:mixed,meta:array} */
    public function unblock(string $ip): array
    {
        $this->requireLiveReady();
        if ($this->demo) {
            $r = $this->fake->unblock($ip);
            return ['result' => $r['raw'], 'raw' => $r['raw'], 'meta' => $this->meta($r)];
        }
        [$query, $body] = $this->writeParams(['ip' => $ip]);
        $r = $this->call('POST', (string) $this->cfg->get('ENDPOINT_UNBLOCK'), $query, $body);
        return ['result' => $this->writeResult($r['payload'], "Released $ip"), 'raw' => Normalizer::raw($r['payload']), 'meta' => $this->meta($r)];
    }

    /** @return array{result:array,raw:mixed,meta:array} */
    public function block(string $ip, string $reason = '', string $duration = '4h'): array
    {
        $this->requireLiveReady();
        if ($this->demo) {
            $r = $this->fake->block($ip, $reason, $duration);
            return ['result' => $r['raw'], 'raw' => $r['raw'], 'meta' => $this->meta($r)];
        }
        $params = ['ip' => $ip];
        if ($reason !== '') {
            $params['reason'] = $reason;
        }
        if ($duration !== '') {
            $params['duration'] = $duration;
        }
        [$query, $body] = $this->writeParams($params);
        $r = $this->call('POST', (string) $this->cfg->get('ENDPOINT_BLOCK'), $query, $body);
        return ['result' => $this->writeResult($r['payload'], "Blocked $ip"), 'raw' => Normalizer::raw($r['payload']), 'meta' => $this->meta($r)];
    }

    /** @return array{result:array,raw:mixed,meta:array} */
    public function allow(string $cidr, string $comment = ''): array
    {
        $this->requireLiveReady();
        if ($this->demo) {
            $r = $this->fake->allow($cidr, $comment);
            return ['result' => $r['raw'], 'raw' => $r['raw'], 'meta' => $this->meta($r)];
        }
        $params = ['cidr' => $cidr];
        if ($comment !== '') {
            $params['comment'] = $comment;
        }
        [$query, $body] = $this->writeParams($params);
        $r = $this->call('POST', (string) $this->cfg->get('ENDPOINT_ALLOWLIST'), $query, $body);
        return ['result' => $this->writeResult($r['payload'], "Allowlisted $cidr"), 'raw' => Normalizer::raw($r['payload']), 'meta' => $this->meta($r)];
    }

    /** @return array{result:array,raw:mixed,meta:array} */
    public function unallow(string $cidr): array
    {
        $this->requireLiveReady();
        if ($this->demo) {
            $r = $this->fake->unallow($cidr);
            return ['result' => $r['raw'], 'raw' => $r['raw'], 'meta' => $this->meta($r)];
        }
        $method = strtoupper((string) $this->cfg->get('ALLOWLIST_DELETE_METHOD', 'DELETE'));
        if (!in_array($method, ['DELETE', 'POST', 'PUT'], true)) {
            $method = 'DELETE';
        }
        [$query, $body] = $this->writeParams(['cidr' => $cidr]);
        $r = $this->call($method, (string) $this->cfg->get('ENDPOINT_ALLOWLIST'), $query, $body);
        return ['result' => $this->writeResult($r['payload'], "Removed $cidr from allowlist"), 'raw' => Normalizer::raw($r['payload']), 'meta' => $this->meta($r)];
    }

    /** @return array{status:int,latencyMs:int,message:string,sample:mixed,url:string} */
    public function test(): array
    {
        $this->requireLiveReady();
        $result = $this->decisions();
        return [
            'status' => (int) ($result['meta']['status'] ?? 200),
            'latencyMs' => (int) ($result['meta']['durationMs'] ?? 0),
            'message' => $this->demo
                ? 'Demo upstream responded successfully.'
                : 'Upstream responded successfully.',
            'sample' => is_array($result['raw']) ? array_slice($result['raw'], 0, 2, true) : mb_substr((string) $result['raw'], 0, 300),
            'url' => (string) ($result['meta']['url'] ?? ''),
        ];
    }

    /** @param array<string,string> $params @return array{0:array,1:?array} */
    private function writeParams(array $params): array
    {
        if (strtolower((string) $this->cfg->get('WRITE_PARAMS_MODE', 'query')) === 'json') {
            return [[], $params];
        }
        return [$params, null];
    }

    private function writeResult(mixed $payload, string $fallback): array
    {
        $message = $fallback;
        if (is_array($payload)) {
            $message = Support::pick($payload, ['message', 'detail', 'result', 'status', 'msg'], $fallback);
        } elseif (is_string($payload) && trim($payload) !== '') {
            $message = mb_substr(trim($payload), 0, 300);
        }
        return ['ok' => true, 'message' => $message, 'data' => Normalizer::raw($payload)];
    }

    /** @return array{payload:mixed,response:array} */
    private function call(string $method, string $endpoint, array $query = [], ?array $jsonBody = null): array
    {
        $url = $this->url($endpoint);
        $response = $this->http->request($method, $url, $query, $this->apiKey, $jsonBody);
        $payload = $response['json'] ?? ($response['body'] !== '' ? $response['body'] : null);

        if ($response['error'] !== null) {
            throw new ApiException('Upstream request failed: ' . $response['error'], 502, [
                'status' => $response['status'], 'url' => $response['url'],
            ]);
        }
        if ($response['status'] < 200 || $response['status'] >= 300) {
            $hint = '';
            if (is_array($payload)) {
                $hint = Support::pick($payload, ['message', 'error', 'detail', 'reason', 'description']);
            } elseif (is_string($payload)) {
                $hint = mb_substr(strip_tags($payload), 0, 200);
            }
            if ($response['status'] === 401 || $response['status'] === 403) {
                $hint = 'Upstream rejected the API key (HTTP ' . $response['status'] . '). Check Settings → API key.'
                    . ($hint !== '' ? ' Upstream said: ' . $hint : '');
            } elseif ($hint === '') {
                $hint = 'Upstream returned HTTP ' . $response['status'] . '.';
            }
            throw new ApiException($hint, $response['status'] >= 400 && $response['status'] < 500 ? $response['status'] : 502, [
                'status' => $response['status'],
                'url' => $response['url'],
                'body' => Normalizer::raw($payload),
            ]);
        }
        return ['payload' => $payload, 'response' => $response];
    }

    private function url(string $endpoint): string
    {
        $endpoint = trim($endpoint);
        if (preg_match('#^https?://#i', $endpoint)) {
            return $endpoint;
        }
        if ($this->baseUrl === '') {
            throw new ApiException('No upstream server configured (API_BASE_URL is empty).', 400);
        }
        return $this->baseUrl . '/' . ltrim($endpoint, '/');
    }

    /** @param array<string,mixed> $r */
    private function meta(array $r): array
    {
        return [
            'status' => (int) ($r['status'] ?? 0),
            'durationMs' => (int) ($r['durationMs'] ?? 0),
            'url' => (string) ($r['url'] ?? ''),
            'demo' => (bool) ($r['demo'] ?? false),
            'contentType' => (string) ($r['contentType'] ?? ''),
            'fetchedAt' => date(DATE_ATOM),
            'server' => $this->baseUrl,
            'keySource' => $this->keySource,
            'hasApiKey' => $this->hasKey(),
        ];
    }
}
