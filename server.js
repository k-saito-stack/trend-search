const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { loadDotEnv } = require('./src/loadEnv');

const {
  ensureDataFiles,
  readPrimaryTheme,
  getRunsByTheme,
  getLatestRunByTheme,
} = require('./src/storage');
const { runTheme } = require('./src/trendService');
const { startDailyScheduler } = require('./src/scheduler');
const { getSourceCatalog, summarizeSourceCost } = require('./src/sourceCatalog');

loadDotEnv();

const PORT = Number(process.env.PORT || 3000);
const HOST = process.env.HOST || '127.0.0.1';
const PUBLIC_DIR = path.resolve(process.cwd(), 'public');
const MAX_BODY_BYTES = 1024 * 1024;
const RUN_API_TOKEN = String(process.env.RUN_API_TOKEN || '').trim();
const RUN_AUTH_PROXY_HEADER = String(process.env.RUN_AUTH_PROXY_HEADER || '').trim().toLowerCase();
const RUN_MIN_INTERVAL_MS = Math.max(1000, Number(process.env.RUN_MIN_INTERVAL_MS || 30_000));

ensureDataFiles();

const scheduler = startDailyScheduler({
  log: (message) => console.log(message),
  runOnStart: process.env.RUN_ON_START === '1',
});

const manualRunState = {
  inFlight: null,
  lastStartedAt: 0,
};

function sendJson(res, statusCode, data, extraHeaders = {}) {
  const body = JSON.stringify(data);
  res.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    ...extraHeaders,
  });
  res.end(body);
}

function sendText(res, statusCode, text, extraHeaders = {}) {
  res.writeHead(statusCode, {
    'Content-Type': 'text/plain; charset=utf-8',
    'X-Content-Type-Options': 'nosniff',
    ...extraHeaders,
  });
  res.end(text);
}

function getMimeType(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === '.html') return 'text/html; charset=utf-8';
  if (ext === '.css') return 'text/css; charset=utf-8';
  if (ext === '.js') return 'application/javascript; charset=utf-8';
  if (ext === '.json') return 'application/json; charset=utf-8';
  if (ext === '.svg') return 'image/svg+xml';
  if (ext === '.png') return 'image/png';
  if (ext === '.jpg' || ext === '.jpeg') return 'image/jpeg';
  return 'application/octet-stream';
}

function serveStatic(req, res, pathname) {
  const safePath = pathname === '/' ? '/index.html' : pathname;
  const filePath = path.join(PUBLIC_DIR, safePath);
  const normalized = path.normalize(filePath);

  if (!normalized.startsWith(PUBLIC_DIR)) {
    sendText(res, 403, 'Forbidden');
    return;
  }

  fs.readFile(normalized, (err, data) => {
    if (err) {
      sendText(res, 404, 'Not Found');
      return;
    }

    res.writeHead(200, {
      'Content-Type': getMimeType(normalized),
      'Cache-Control': 'no-cache',
    });
    res.end(data);
  });
}

function parseRequestBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;

    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        reject(new Error('request body が大きすぎます'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });

    req.on('end', () => {
      if (chunks.length === 0) {
        resolve({});
        return;
      }

      const raw = Buffer.concat(chunks).toString('utf8');
      try {
        resolve(JSON.parse(raw));
      } catch {
        reject(new Error('JSON パースに失敗しました'));
      }
    });

    req.on('error', reject);
  });
}

function parseBearerToken(req) {
  const header = String(req.headers.authorization || '');
  const match = header.match(/^Bearer\s+(.+)$/i);
  return match ? match[1].trim() : '';
}

function getProxyAuthValue(req) {
  if (!RUN_AUTH_PROXY_HEADER) return '';
  const value = req.headers[RUN_AUTH_PROXY_HEADER];
  if (Array.isArray(value)) {
    return String(value[0] || '').trim();
  }
  return String(value || '').trim();
}

function secureEqual(a, b) {
  const left = Buffer.from(String(a || ''), 'utf8');
  const right = Buffer.from(String(b || ''), 'utf8');
  if (left.length !== right.length) return false;
  return crypto.timingSafeEqual(left, right);
}

function isLoopbackAddress(address) {
  const value = String(address || '').toLowerCase();
  return value === '127.0.0.1' || value === '::1' || value === '::ffff:127.0.0.1';
}

function isSameOriginRequest(req) {
  const origin = String(req.headers.origin || '').trim();
  if (!origin) return true;

  const host = String(req.headers.host || '').trim();
  if (!host) return false;

  try {
    const url = new URL(origin);
    return url.host === host;
  } catch {
    return false;
  }
}

function getRunAuthMode() {
  if (RUN_API_TOKEN) {
    return 'token';
  }
  if (RUN_AUTH_PROXY_HEADER) {
    return 'proxy_header';
  }
  return 'loopback_only';
}

function authorizeRunRequest(req) {
  if (!isSameOriginRequest(req)) {
    return {
      ok: false,
      statusCode: 403,
      error: 'Origin が不正です',
      code: 'CSRF_BLOCKED',
    };
  }

  if (RUN_API_TOKEN) {
    const bearerToken = parseBearerToken(req);
    const headerToken = String(req.headers['x-run-token'] || '').trim();
    const providedToken = bearerToken || headerToken;

    if (providedToken && secureEqual(providedToken, RUN_API_TOKEN)) {
      return { ok: true };
    }

    return {
      ok: false,
      statusCode: 401,
      error: 'Run API token が必要です',
      code: 'RUN_AUTH_REQUIRED',
    };
  }

  if (RUN_AUTH_PROXY_HEADER) {
    if (getProxyAuthValue(req)) {
      return { ok: true };
    }
    return {
      ok: false,
      statusCode: 401,
      error: `認証済みヘッダー(${RUN_AUTH_PROXY_HEADER})が必要です`,
      code: 'RUN_AUTH_REQUIRED',
    };
  }

  if (isLoopbackAddress(req.socket?.remoteAddress)) {
    return { ok: true };
  }

  return {
    ok: false,
    statusCode: 401,
    error: 'loopback 以外からの実行には RUN_API_TOKEN か RUN_AUTH_PROXY_HEADER が必要です',
    code: 'RUN_AUTH_REQUIRED',
  };
}

function checkManualRunRateLimit() {
  if (manualRunState.inFlight) {
    return {
      ok: false,
      statusCode: 409,
      error: '現在収集中です。完了後に再実行してください',
      code: 'RUN_ALREADY_RUNNING',
    };
  }

  const elapsed = Date.now() - manualRunState.lastStartedAt;
  if (elapsed < RUN_MIN_INTERVAL_MS) {
    const retryInMs = RUN_MIN_INTERVAL_MS - elapsed;
    return {
      ok: false,
      statusCode: 429,
      error: `実行間隔が短すぎます。${Math.ceil(retryInMs / 1000)}秒後に再試行してください`,
      code: 'RUN_RATE_LIMITED',
      retryInMs,
    };
  }

  return { ok: true };
}

function buildSnapshot() {
  const theme = readPrimaryTheme();
  const latestRun = getLatestRunByTheme(theme.id);

  return {
    now: new Date().toISOString(),
    timezone: 'Asia/Tokyo',
    topic: theme.name,
    latestRun,
  };
}

async function handleApi(req, res, urlObj) {
  const { method } = req;
  const pathname = urlObj.pathname;

  if (method === 'GET' && pathname === '/api/health') {
    const sourceCatalog = getSourceCatalog();
    const sourceCost = summarizeSourceCost(sourceCatalog);

    sendJson(res, 200, {
      ok: true,
      hasApiKey: Boolean(process.env.XAI_API_KEY),
      hasXaiApiKey: Boolean(process.env.XAI_API_KEY),
      xCollectionEnabled: process.env.SOURCE_ENABLE_X !== '0',
      model: process.env.XAI_MODEL || 'grok-4-1-fast',
      sourceCount: sourceCost.total,
      freeSourceCount: sourceCost.free,
      apiSourceCount: sourceCost.api,
      runAuthMode: getRunAuthMode(),
      runMinIntervalMs: RUN_MIN_INTERVAL_MS,
      runInFlight: Boolean(manualRunState.inFlight),
    });
    return;
  }

  if (method === 'GET' && pathname === '/api/snapshot') {
    sendJson(res, 200, buildSnapshot());
    return;
  }

  if (method === 'GET' && pathname === '/api/sources') {
    sendJson(res, 200, { sources: getSourceCatalog() });
    return;
  }

  if (method === 'POST' && pathname === '/api/run') {
    const auth = authorizeRunRequest(req);
    if (!auth.ok) {
      sendJson(res, auth.statusCode, { error: auth.error, code: auth.code });
      return;
    }

    const guard = checkManualRunRateLimit();
    if (!guard.ok) {
      const extraHeaders = guard.statusCode === 429
        ? { 'Retry-After': String(Math.max(1, Math.ceil((guard.retryInMs || 0) / 1000))) }
        : {};
      sendJson(
        res,
        guard.statusCode,
        { error: guard.error, code: guard.code, retryInMs: guard.retryInMs || 0 },
        extraHeaders,
      );
      return;
    }

    await parseRequestBody(req);
    manualRunState.lastStartedAt = Date.now();
    manualRunState.inFlight = (async () => {
      const theme = readPrimaryTheme();
      return runTheme(theme);
    })();

    let run;
    try {
      run = await manualRunState.inFlight;
    } finally {
      manualRunState.inFlight = null;
    }

    sendJson(res, 200, { mode: 'single', run });
    return;
  }

  if (method === 'GET' && pathname === '/api/runs') {
    const theme = readPrimaryTheme();
    const limit = Number(urlObj.searchParams.get('limit') || 20);

    const runs = getRunsByTheme(theme.id, limit);
    sendJson(res, 200, { runs });
    return;
  }

  sendJson(res, 404, { error: 'Not Found' });
}

const server = http.createServer(async (req, res) => {
  try {
    const urlObj = new URL(req.url, `http://${req.headers.host}`);

    if (urlObj.pathname.startsWith('/api/')) {
      await handleApi(req, res, urlObj);
      return;
    }

    if (req.method !== 'GET' && req.method !== 'HEAD') {
      sendText(res, 405, 'Method Not Allowed');
      return;
    }

    serveStatic(req, res, urlObj.pathname);
  } catch (error) {
    sendJson(res, 500, { error: error.message || 'Internal Server Error' });
  }
});

server.listen(PORT, HOST, () => {
  const displayHost = HOST === '0.0.0.0' ? 'localhost' : HOST;
  console.log(`Trend Dashboard: http://${displayHost}:${PORT}`);
});

function shutdown() {
  scheduler.stop();
  server.close(() => process.exit(0));
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
