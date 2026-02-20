const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
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
const PUBLIC_DIR = path.resolve(process.cwd(), 'public');
const MAX_BODY_BYTES = 1024 * 1024;

ensureDataFiles();

const scheduler = startDailyScheduler({
  log: (message) => console.log(message),
  runOnStart: process.env.RUN_ON_START === '1',
});

function sendJson(res, statusCode, data) {
  const body = JSON.stringify(data);
  res.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
  });
  res.end(body);
}

function sendText(res, statusCode, text) {
  res.writeHead(statusCode, {
    'Content-Type': 'text/plain; charset=utf-8',
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
    await parseRequestBody(req);
    const theme = readPrimaryTheme();
    const run = await runTheme(theme);
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

server.listen(PORT, () => {
  console.log(`Trend Dashboard: http://localhost:${PORT}`);
});

function shutdown() {
  scheduler.stop();
  server.close(() => process.exit(0));
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
