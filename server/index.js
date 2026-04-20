const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');

loadDotEnv(path.join(__dirname, '.env'));

const PORT = normalizePort(process.env.PORT, 8787);
const HOST = String(process.env.HOST || '127.0.0.1').trim() || '127.0.0.1';
const EBAY_CLIENT_ID = String(process.env.EBAY_CLIENT_ID || '').trim();
const EBAY_CLIENT_SECRET = String(process.env.EBAY_CLIENT_SECRET || '').trim();
const EBAY_SCOPE = String(process.env.EBAY_SCOPE || 'https://api.ebay.com/oauth/api_scope').trim();
const EBAY_API_BASE_URL = normalizeBaseUrl(process.env.EBAY_API_BASE_URL || 'https://api.ebay.com');
const EBAY_IDENTITY_BASE_URL = normalizeBaseUrl(process.env.EBAY_IDENTITY_BASE_URL || 'https://api.ebay.com');
const PROXY_ACCESS_KEY = String(process.env.PROXY_ACCESS_KEY || '').trim();
const RATE_LIMIT_MAX = normalizePositiveInteger(process.env.RATE_LIMIT_MAX, 60);
const RATE_LIMIT_WINDOW_MS = normalizePositiveInteger(process.env.RATE_LIMIT_WINDOW_MS, 60_000);
const REQUIRED_CLIENT_HEADER = 'extension';

let tokenCache = {
  accessToken: '',
  expiresAt: 0,
};
let tokenPromise = null;
const rateLimitBuckets = new Map();

validateStartupConfiguration();

const server = http.createServer((request, response) => {
  void handleRequest(request, response).catch((error) => {
    sendJson(response, 500, {
      ok: false,
      error: error?.message || 'Unexpected proxy error.',
    });
  });
});

server.listen(PORT, HOST, () => {
  console.log(`MarketMatch eBay proxy listening on http://${HOST}:${PORT}`);
});

async function handleRequest(request, response) {
  const corsOrigin = getAllowedCorsOrigin(request.headers.origin);
  setCorsHeaders(response, corsOrigin);

  if (request.method === 'OPTIONS') {
    response.writeHead(204);
    response.end();
    return;
  }

  const requestUrl = new URL(request.url || '/', `http://${request.headers.host || 'localhost'}`);
  if (!requestUrl.pathname.startsWith('/api/')) {
    sendJson(response, 404, {
      ok: false,
      error: 'Not found.',
    });
    return;
  }

  if (!hasRequiredClientHeader(request)) {
    sendJson(response, 400, {
      ok: false,
      error: 'Missing X-MarketMatch-Client extension header.',
    });
    return;
  }

  const rateLimit = consumeRateLimit(request);
  if (!rateLimit.allowed) {
    response.setHeader('Retry-After', String(rateLimit.retryAfterSeconds));
    sendJson(response, 429, {
      ok: false,
      error: 'Proxy rate limit exceeded. Try again shortly.',
    });
    return;
  }

  if (PROXY_ACCESS_KEY && !hasValidProxyAccessKey(request)) {
    sendJson(response, 401, {
      ok: false,
      error: 'Proxy access key rejected.',
    });
    return;
  }

  if (requestUrl.pathname === '/api/health') {
    sendJson(response, 200, {
      ok: true,
      reachable: true,
      ready: hasEbayCredentials(),
      environment: /sandbox/i.test(EBAY_API_BASE_URL) ? 'sandbox' : 'production',
    });
    return;
  }

  if (request.method !== 'GET') {
    sendJson(response, 405, {
      ok: false,
      error: 'Only GET and OPTIONS are supported.',
    });
    return;
  }

  if (!hasEbayCredentials()) {
    sendJson(response, 503, {
      ok: false,
      error: 'Missing EBAY_CLIENT_ID or EBAY_CLIENT_SECRET on the proxy server.',
    });
    return;
  }

  if (requestUrl.pathname === '/api/ebay/search') {
    await proxyBrowseSearch(requestUrl, response);
    return;
  }

  if (requestUrl.pathname.startsWith('/api/ebay/item/')) {
    const itemId = decodeURIComponent(requestUrl.pathname.slice('/api/ebay/item/'.length));
    if (!itemId) {
      sendJson(response, 400, {
        ok: false,
        error: 'Missing eBay item id.',
      });
      return;
    }

    await proxyBrowseItem(itemId, requestUrl, response);
    return;
  }

  sendJson(response, 404, {
    ok: false,
    error: 'Not found.',
  });
}

async function proxyBrowseSearch(requestUrl, response) {
  const upstreamUrl = new URL('/buy/browse/v1/item_summary/search', `${EBAY_API_BASE_URL}/`);
  copyAllowedQueryParams(requestUrl.searchParams, upstreamUrl.searchParams, ['q', 'limit', 'fieldgroups', 'filter']);

  const upstreamResponse = await proxyToEbay(upstreamUrl, {
    marketplaceId: requestUrl.searchParams.get('marketplaceId') || 'EBAY_US',
    endUserZip: requestUrl.searchParams.get('endUserZip') || '',
  });

  await sendUpstreamResponse(response, upstreamResponse);
}

async function proxyBrowseItem(itemId, requestUrl, response) {
  const upstreamUrl = new URL(`/buy/browse/v1/item/${encodeURIComponent(itemId)}`, `${EBAY_API_BASE_URL}/`);
  const upstreamResponse = await proxyToEbay(upstreamUrl, {
    marketplaceId: requestUrl.searchParams.get('marketplaceId') || 'EBAY_US',
    endUserZip: requestUrl.searchParams.get('endUserZip') || '',
  });

  await sendUpstreamResponse(response, upstreamResponse);
}

async function proxyToEbay(url, { marketplaceId = 'EBAY_US', endUserZip = '' } = {}) {
  const accessToken = await getApplicationToken();
  const headers = {
    Authorization: `Bearer ${accessToken}`,
    Accept: 'application/json',
    'X-EBAY-C-MARKETPLACE-ID': marketplaceId,
  };

  if (endUserZip) {
    headers['X-EBAY-C-ENDUSERCTX'] = `contextualLocation=country=US,zip=${encodeURIComponent(endUserZip)}`;
  }

  const response = await fetch(url, {
    method: 'GET',
    headers,
  });

  if (response.status === 401) {
    clearCachedToken();
    const retryToken = await getApplicationToken();
    headers.Authorization = `Bearer ${retryToken}`;
    return fetch(url, {
      method: 'GET',
      headers,
    });
  }

  return response;
}

async function getApplicationToken() {
  if (hasValidCachedToken()) {
    return tokenCache.accessToken;
  }

  if (!tokenPromise) {
    tokenPromise = mintApplicationToken().finally(() => {
      tokenPromise = null;
    });
  }

  return tokenPromise;
}

async function mintApplicationToken() {
  const basicAuth = Buffer.from(`${EBAY_CLIENT_ID}:${EBAY_CLIENT_SECRET}`).toString('base64');
  const body = new URLSearchParams({
    grant_type: 'client_credentials',
    scope: EBAY_SCOPE,
  });

  const response = await fetch(new URL('/identity/v1/oauth2/token', `${EBAY_IDENTITY_BASE_URL}/`), {
    method: 'POST',
    headers: {
      Authorization: `Basic ${basicAuth}`,
      Accept: 'application/json',
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body,
  });

  const responseText = await response.text();
  if (!response.ok) {
    throw new Error(`eBay token mint failed ${response.status}: ${responseText}`);
  }

  let data;
  try {
    data = JSON.parse(responseText);
  } catch {
    throw new Error('eBay token mint returned non-JSON data.');
  }

  const accessToken = String(data?.access_token || '').trim();
  const expiresIn = Math.max(120, Number(data?.expires_in || 7200));
  if (!accessToken) {
    throw new Error('eBay token mint response did not include access_token.');
  }

  tokenCache = {
    accessToken,
    expiresAt: Date.now() + Math.max(60, expiresIn - 60) * 1000,
  };

  return accessToken;
}

async function sendUpstreamResponse(response, upstreamResponse) {
  const body = await upstreamResponse.text();
  response.statusCode = upstreamResponse.status;
  response.setHeader('Content-Type', upstreamResponse.headers.get('content-type') || 'application/json; charset=utf-8');
  response.end(body);
}

function copyAllowedQueryParams(source, destination, keys) {
  for (const key of keys) {
    const value = source.get(key);
    if (value) {
      destination.set(key, value);
    }
  }
}

function setCorsHeaders(response, origin = '') {
  if (origin) {
    response.setHeader('Access-Control-Allow-Origin', origin);
  }

  response.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  response.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-MarketMatch-Client, X-MarketMatch-Proxy-Key');
  response.setHeader('Cache-Control', 'no-store');
  response.setHeader('Vary', 'Origin');
}

function sendJson(response, statusCode, payload) {
  response.statusCode = statusCode;
  response.setHeader('Content-Type', 'application/json; charset=utf-8');
  response.end(JSON.stringify(payload, null, 2));
}

function hasEbayCredentials() {
  return Boolean(EBAY_CLIENT_ID && EBAY_CLIENT_SECRET);
}

function hasValidCachedToken() {
  return Boolean(tokenCache.accessToken) && Date.now() < tokenCache.expiresAt;
}

function clearCachedToken() {
  tokenCache = {
    accessToken: '',
    expiresAt: 0,
  };
  tokenPromise = null;
}

function getAllowedCorsOrigin(originHeader) {
  const origin = String(originHeader || '').trim();
  if (!origin) {
    return '';
  }

  return /^(moz|chrome)-extension:\/\/[a-z0-9-]+$/i.test(origin) ? origin : '';
}

function hasRequiredClientHeader(request) {
  return String(request.headers['x-marketmatch-client'] || '').trim().toLowerCase() === REQUIRED_CLIENT_HEADER;
}

function hasValidProxyAccessKey(request) {
  return String(request.headers['x-marketmatch-proxy-key'] || '').trim() === PROXY_ACCESS_KEY;
}

function consumeRateLimit(request) {
  const now = Date.now();
  const clientIp = getClientIp(request);
  cleanupExpiredRateLimits(now);

  const existingBucket = rateLimitBuckets.get(clientIp);
  const bucket = existingBucket && existingBucket.resetAt > now
    ? existingBucket
    : { count: 0, resetAt: now + RATE_LIMIT_WINDOW_MS };

  bucket.count += 1;
  rateLimitBuckets.set(clientIp, bucket);

  if (bucket.count <= RATE_LIMIT_MAX) {
    return { allowed: true, retryAfterSeconds: 0 };
  }

  return {
    allowed: false,
    retryAfterSeconds: Math.max(1, Math.ceil((bucket.resetAt - now) / 1000)),
  };
}

function cleanupExpiredRateLimits(now) {
  for (const [key, bucket] of rateLimitBuckets.entries()) {
    if (!bucket || bucket.resetAt <= now) {
      rateLimitBuckets.delete(key);
    }
  }
}

function getClientIp(request) {
  const rawAddress = String(request.socket?.remoteAddress || 'unknown').trim().toLowerCase();
  return rawAddress.startsWith('::ffff:') ? rawAddress.slice('::ffff:'.length) : rawAddress;
}

function validateStartupConfiguration() {
  if (!isLoopbackHost(HOST) && !PROXY_ACCESS_KEY) {
    throw new Error('PROXY_ACCESS_KEY is required when HOST is not loopback.');
  }
}

function isLoopbackHost(value) {
  const normalized = String(value || '').trim().toLowerCase();
  return normalized === 'localhost' || normalized === '127.0.0.1' || normalized === '::1' || normalized === '[::1]';
}

function normalizeBaseUrl(value) {
  const parsed = new URL(String(value || '').trim());
  if (!/^https?:$/i.test(parsed.protocol)) {
    throw new Error(`Unsupported URL protocol for ${value}`);
  }

  parsed.pathname = parsed.pathname.replace(/\/+$/, '');
  parsed.search = '';
  parsed.hash = '';
  return parsed.toString().replace(/\/+$/, '');
}

function normalizePort(value, fallback) {
  const parsed = Number(value || fallback);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function normalizePositiveInteger(value, fallback) {
  const parsed = Number(value || fallback);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function loadDotEnv(filePath) {
  if (!fs.existsSync(filePath)) {
    return;
  }

  const content = fs.readFileSync(filePath, 'utf8');
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) {
      continue;
    }

    const separatorIndex = line.indexOf('=');
    if (separatorIndex < 0) {
      continue;
    }

    const key = line.slice(0, separatorIndex).trim();
    const value = stripMatchingQuotes(line.slice(separatorIndex + 1).trim());
    if (!key || Object.prototype.hasOwnProperty.call(process.env, key)) {
      continue;
    }

    process.env[key] = value;
  }
}

function stripMatchingQuotes(value) {
  if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
    return value.slice(1, -1);
  }

  return value;
}
