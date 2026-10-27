<?php
declare(strict_types=1);

namespace IpAware;

final class HttpClient
{
    private Config $cfg;

    public function __construct(Config $cfg)
    {
        $this->cfg = $cfg;
    }

    /**
     * @return array{status:int,body:string,json:mixed,error:?string,durationMs:int,url:string,contentType:string}
     */
    public function request(string $method, string $url, array $query = [], ?string $apiKey = null, ?array $jsonBody = null): array
    {
        $method = strtoupper($method);
        if ($query !== []) {
            $separator = str_contains($url, '?') ? '&' : '?';
            $url .= $separator . http_build_query($query, '', '&', PHP_QUERY_RFC3986);
        }
        $headers = ['Accept: application/json', 'User-Agent: IPAware-Console/' . Config::VERSION];
        if ($apiKey !== null && $apiKey !== '') {
            $scheme = strtolower((string) $this->cfg->get('AUTH_SCHEME', 'Bearer'));
            if ($scheme === 'apikey') {
                $headers[] = 'X-API-Key: ' . $apiKey;
            } elseif ($scheme === 'raw') {
                $headers[] = 'Authorization: ' . $apiKey;
            } else {
                $headers[] = 'Authorization: Bearer ' . $apiKey;
            }
        }
        $body = null;
        if ($jsonBody !== null) {
            $body = json_encode($jsonBody, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE);
            $headers[] = 'Content-Type: application/json';
        }
        $timeout = $this->cfg->int('API_TIMEOUT', 12, 2, 60);
        $verify = $this->cfg->bool('API_VERIFY_TLS', true);
        $started = microtime(true);

        $result = function_exists('curl_init')
            ? $this->curl($method, $url, $headers, $body, $timeout, $verify)
            : $this->stream($method, $url, $headers, $body, $timeout, $verify);

        $result['durationMs'] = (int) round((microtime(true) - $started) * 1000);
        $result['url'] = Support::redact($url, (string) $apiKey);
        if ($result['error'] !== null) {
            $result['error'] = Support::redact($result['error'], (string) $apiKey);
        }
        if ($result['body'] === '' && $result['error'] === null && $result['status'] === 0) {
            $result['error'] = 'No response from upstream server.';
        }
        $result['json'] = json_decode($result['body'], true);
        return $result;
    }

    /** @param string[] $headers */
    private function curl(string $method, string $url, array $headers, ?string $body, int $timeout, bool $verify): array
    {
        $ch = curl_init($url);
        curl_setopt_array($ch, [
            CURLOPT_CUSTOMREQUEST => $method,
            CURLOPT_HTTPHEADER => $headers,
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_HEADER => false,
            CURLOPT_FOLLOWLOCATION => false,
            CURLOPT_MAXREDIRS => 0,
            CURLOPT_CONNECTTIMEOUT => min($timeout, 8),
            CURLOPT_TIMEOUT => $timeout,
            CURLOPT_SSL_VERIFYPEER => $verify,
            CURLOPT_SSL_VERIFYHOST => $verify ? 2 : 0,
            CURLOPT_ENCODING => '',
            CURLOPT_PROTOCOLS => CURLPROTO_HTTP | CURLPROTO_HTTPS,
            CURLOPT_REDIR_PROTOCOLS => CURLPROTO_HTTP | CURLPROTO_HTTPS,
        ]);
        if ($body !== null) {
            curl_setopt($ch, CURLOPT_POSTFIELDS, $body);
        }
        $raw = curl_exec($ch);
        $status = (int) curl_getinfo($ch, CURLINFO_RESPONSE_CODE);
        $contentType = (string) curl_getinfo($ch, CURLINFO_CONTENT_TYPE);
        $error = $raw === false ? ('cURL: ' . curl_error($ch)) : null;
        curl_close($ch);
        return [
            'status' => $status,
            'body' => is_string($raw) ? $raw : '',
            'json' => null,
            'error' => $error,
            'durationMs' => 0,
            'url' => '',
            'contentType' => $contentType,
        ];
    }

    /** @param string[] $headers */
    private function stream(string $method, string $url, array $headers, ?string $body, int $timeout, bool $verify): array
    {
        $context = stream_context_create([
            'http' => [
                'method' => $method,
                'header' => implode("\r\n", $headers),
                'content' => $body,
                'timeout' => $timeout,
                'ignore_errors' => true,
                'follow_location' => 0,
            ],
            'ssl' => [
                'verify_peer' => $verify,
                'verify_peer_name' => $verify,
                'allow_self_signed' => !$verify,
            ],
        ]);
        $raw = @file_get_contents($url, false, $context);
        $status = 0;
        $contentType = '';
        foreach ($http_response_header ?? [] as $line) {
            if (preg_match('#^HTTP/\S+\s+(\d{3})#', $line, $m)) {
                $status = (int) $m[1];
            } elseif (stripos($line, 'Content-Type:') === 0) {
                $contentType = trim(substr($line, 14));
            }
        }
        return [
            'status' => $status,
            'body' => is_string($raw) ? $raw : '',
            'json' => null,
            'error' => $raw === false ? 'Unable to reach upstream server (stream wrapper).' : null,
            'durationMs' => 0,
            'url' => '',
            'contentType' => $contentType,
        ];
    }
}
