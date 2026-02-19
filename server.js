const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { loadDotEnv } = require('./src/loadEnv');

const {
  ensureDataFiles,
  readThemes,
  createTheme,
  updateTheme,
  deleteTheme,
  getRunsByTheme,
  getLatestRunsMap,
} = require('./src/storage');
const { runThemeById, runAllEnabledThemes } = require('./src/trendService');
const { startDailyScheduler } = require('./src/scheduler');

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
  const themes = readThemes();
  const latestRunsMap = getLatestRunsMap();

  const latestRuns = themes.map((theme) => ({
    themeId: theme.id,
    run: latestRunsMap[theme.id] || null,
  }));

  return {
    now: new Date().toISOString(),
    timezone: 'Asia/Tokyo',
    themes,
    latestRuns,
  };
}

async function handleApi(req, res, urlObj) {
  const { method } = req;
  const pathname = urlObj.pathname;

  if (method === 'GET' && pathname === '/api/health') {
    sendJson(res, 200, {
      ok: true,
      hasApiKey: Boolean(process.env.XAI_API_KEY),
      model: process.env.XAI_MODEL || 'grok-4-1-fast',
    });
    return;
  }

  if (method === 'GET' && pathname === '/api/snapshot') {
    sendJson(res, 200, buildSnapshot());
    return;
  }

  if (method === 'GET' && pathname === '/api/themes') {
    sendJson(res, 200, { themes: readThemes() });
    return;
  }

  if (method === 'POST' && pathname === '/api/themes') {
    const body = await parseRequestBody(req);
    const theme = createTheme(body);
    sendJson(res, 201, { theme });
    return;
  }

  if (method === 'POST' && pathname === '/api/run') {
    const body = await parseRequestBody(req);

    if (body.themeId) {
      const run = await runThemeById(body.themeId);
      sendJson(res, 200, { mode: 'single', run });
      return;
    }

    const results = await runAllEnabledThemes();
    sendJson(res, 200, { mode: 'all', results });
    return;
  }

  if (method === 'GET' && pathname === '/api/runs') {
    const themeId = urlObj.searchParams.get('themeId');
    const limit = Number(urlObj.searchParams.get('limit') || 20);

    if (!themeId) {
      sendJson(res, 400, { error: 'themeId が必要です' });
      return;
    }

    const runs = getRunsByTheme(themeId, limit);
    sendJson(res, 200, { runs });
    return;
  }

  const themeMatch = pathname.match(/^\/api\/themes\/([^/]+)$/);
  if (themeMatch) {
    const themeId = decodeURIComponent(themeMatch[1]);

    if (method === 'PATCH') {
      const body = await parseRequestBody(req);
      const allowed = {
        name: body.name,
        query: body.query,
        periodDays: body.periodDays,
        enabled: body.enabled,
      };

      const cleaned = Object.fromEntries(
        Object.entries(allowed).filter(([, value]) => value !== undefined),
      );

      const theme = updateTheme(themeId, cleaned);
      sendJson(res, 200, { theme });
      return;
    }

    if (method === 'DELETE') {
      deleteTheme(themeId);
      sendJson(res, 200, { ok: true });
      return;
    }
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
