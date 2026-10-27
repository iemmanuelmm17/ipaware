/* Searchable API command reference (curl / PowerShell / raw HTTP).
   The API key is NEVER inserted - commands always use a $APIKey placeholder. */

const DEFAULT_ENDPOINTS = {
  decisions: '/ipaware/decisions',
  ip: '/ipaware/ip',
  block: '/ipaware/firewall/block',
  unblock: '/ipaware/firewall/unblock',
  allowlist: '/ipaware/allowed_ips',
};

function authValue(cfg) {
  const scheme = String(cfg.authScheme || 'Bearer').toLowerCase();
  if (scheme === 'apikey') return { header: 'X-API-Key', prefix: '' };
  if (scheme === 'raw') return { header: 'Authorization', prefix: '' };
  return { header: 'Authorization', prefix: 'Bearer' };
}

function query(params) {
  return Object.entries(params || {})
    .filter(([, v]) => v !== '' && v !== null && v !== undefined)
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`)
    .join('&');
}

export function commandList(cfg = {}, vars = {}) {
  const server = String(cfg.server || '').replace(/\/+$/, '') || 'https://$server';
  const ep = { ...DEFAULT_ENDPOINTS, ...(cfg.endpoints || {}) };
  const ip = vars.ip || '37.18.129.253';
  const cidr = vars.cidr || '37.18.129.253';
  const comment = vars.comment || 'tango';
  const reason = vars.reason || 'manual block from console';
  const duration = vars.duration || '4h';
  const asJson = String(cfg.writeParamsMode || 'query').toLowerCase() === 'json';

  const make = (spec) => {
    const params = spec.params || {};
    const qs = asJson && spec.method !== 'GET' ? '' : query(params);
    const path = String(spec.path || '').startsWith('http') ? spec.path : `${server}${spec.path}`;
    return {
      ...spec,
      params,
      path,
      url: qs ? `${path}?${qs}` : path,
      auth: authValue(cfg),
      keywords: `${spec.title} ${spec.description} ${spec.method} ${spec.path} ${spec.group} ${spec.keywords || ''}`.toLowerCase(),
    };
  };

  return [
    make({
      id: 'decisions', group: 'Read', method: 'GET', title: 'What was blocked and why',
      description: 'List active firewall decisions with their reason/scenario.',
      path: ep.decisions, icon: 'ban', keywords: 'blocked list decisions why reason scenario',
    }),
    make({
      id: 'ip', group: 'Read', method: 'GET', title: 'Know everything about an address',
      description: 'Look up one IP: verdict, decision, signals and history.',
      path: `${ep.ip}/${encodeURIComponent(ip)}`, icon: 'search', keywords: 'lookup inspect ip info detail',
    }),
    make({
      id: 'allowed', group: 'Read', method: 'GET', title: 'Show the allow list',
      description: 'List whitelisted IPs and CIDR ranges with comments.',
      path: ep.allowlist, icon: 'check-circle', keywords: 'allowlist whitelist allowed permitted',
    }),
    make({
      id: 'unblock', group: 'Firewall', method: 'POST', title: 'Release an IP (unblock)',
      description: 'Remove an active firewall decision for one address.',
      path: ep.unblock, params: { ip }, icon: 'unlock',
      keywords: 'release unblock free firewall remove decision',
    }),
    make({
      id: 'block', group: 'Firewall', method: 'POST', title: 'Block an IP',
      description: 'Create a firewall decision. Endpoint/params are configurable in .env.',
      path: ep.block, params: { ip, reason, duration }, icon: 'lock',
      keywords: 'ban deny block firewall decision duration reason',
    }),
    make({
      id: 'allow', group: 'Allow list', method: 'POST', title: 'Add to allow list',
      description: 'Whitelist an IP or CIDR with an optional comment.',
      path: ep.allowlist, params: { cidr, comment }, icon: 'plus',
      keywords: 'allowlist whitelist add permit cidr comment tango',
    }),
    make({
      id: 'unallow', group: 'Allow list', method: String(cfg.allowlistDeleteMethod || 'DELETE').toUpperCase(),
      title: 'Remove from allow list',
      description: 'Delete a whitelist entry. Method is configurable in .env.',
      path: ep.allowlist, params: { cidr }, icon: 'trash',
      keywords: 'delete remove allowlist whitelist cidr',
    }),
  ];
}

export function renderCommand(cmd, format = 'curl', cfg = {}) {
  const auth = cmd.auth || authValue(cfg);
  const headerValue = `${auth.prefix ? `${auth.prefix} ` : ''}$APIKey`;
  const asJson = String(cfg.writeParamsMode || 'query').toLowerCase() === 'json' && cmd.method !== 'GET';

  if (format === 'powershell') {
    const lines = [
      `$APIKey = 'paste-your-key-here'`,
      `$headers = @{ '${auth.header}' = "${headerValue.replace('$APIKey', '$APIKey')}"; Accept = 'application/json' }`,
    ];
    let call = `Invoke-RestMethod -Method ${titleCase(cmd.method)} -Uri '${cmd.url}' -Headers $headers`;
    if (asJson) {
      lines.push(`$body = @{ ${Object.entries(cmd.params).map(([k, v]) => `${k} = '${String(v).replace(/'/g, "''")}'`).join('; ')} } | ConvertTo-Json`);
      call += " -ContentType 'application/json' -Body $body";
    }
    lines.push(call);
    return lines.join('\n');
  }

  if (format === 'http') {
    const host = String(cfg.server || 'https://$server').replace(/^https?:\/\//, '').replace(/\/+$/, '') || '$server';
    const pathOnly = cmd.path.replace(/^https?:\/\/[^/]+/, '') || '/';
    const target = asJson ? pathOnly : cmd.url.replace(/^https?:\/\/[^/]+/, '') || '/';
    return [
      `${cmd.method} ${target} HTTP/1.1`,
      `Host: ${host}`,
      `${auth.header}: ${headerValue}`,
      'Accept: application/json',
      asJson ? `Content-Type: application/json\n\n${JSON.stringify(cmd.params, null, 2)}` : '',
    ].filter(Boolean).join('\n');
  }

  const parts = ['curl -sS'];
  if (cmd.method !== 'GET') parts.push(`-X ${cmd.method}`);
  parts.push(`-H "${auth.header}: ${headerValue}"`);
  if (asJson) {
    parts.push(`-H "Content-Type: application/json"`);
    parts.push(`-d '${JSON.stringify(cmd.params)}'`);
  }
  parts.push(`'${cmd.url}'`);
  const line = parts[0] + ' ' + parts.slice(1, -1).join(' ');
  return parts.length > 2 ? `${line} \\\n  ${parts[parts.length - 1]}` : `${parts[0]} '${cmd.url}'`;
}

export function commandGroups(commands) {
  return [...new Set(commands.map((c) => c.group))];
}

function titleCase(value) {
  return String(value).charAt(0).toUpperCase() + String(value).slice(1).toLowerCase();
}
