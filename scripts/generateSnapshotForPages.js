const path = require('node:path');
const fs = require('node:fs');
const https = require('node:https');
const http = require('node:http');

function loadDotEnv() {
  const envPath = path.resolve(process.cwd(), '.env');
  if (!fs.existsSync(envPath)) return;
  const lines = fs.readFileSync(envPath, 'utf8').split('\n');
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eqIndex = trimmed.indexOf('=');
    if (eqIndex < 0) continue;
    const key = trimmed.slice(0, eqIndex).trim();
    const val = trimmed.slice(eqIndex + 1).trim();
    if (!process.env[key]) process.env[key] = val;
  }
}

function resolveRedirectUrl(currentUrl, location) {
  try {
    return new URL(String(location || ''), String(currentUrl || '')).toString();
  } catch {
    return '';
  }
}

/**
 * GitHub Pages上の現在デプロイ済み snapshot.json を取得する。
 * 失敗した場合は null を返す（初回デプロイ時など）。
 */
function fetchOldSnapshot(pagesUrl, options = {}) {
  const targetUrl = String(pagesUrl || '').trim();
  if (!targetUrl) {
    return Promise.resolve(null);
  }

  const visited = options.visited instanceof Set ? options.visited : new Set();
  const maxRedirects = Number(options.maxRedirects || 5);

  if (visited.has(targetUrl)) {
    console.log('[cache] 旧snapshot取得スキップ (リダイレクトループ)');
    return Promise.resolve(null);
  }
  if (visited.size >= maxRedirects) {
    console.log('[cache] 旧snapshot取得スキップ (リダイレクト上限)');
    return Promise.resolve(null);
  }

  let requestUrl;
  try {
    requestUrl = new URL(targetUrl);
  } catch {
    console.log('[cache] 旧snapshot取得スキップ (URL不正)');
    return Promise.resolve(null);
  }
  visited.add(targetUrl);

  return new Promise((resolve) => {
    const client = requestUrl.protocol === 'https:' ? https : http;

    let req;
    try {
      req = client.get(requestUrl, { timeout: 15000 }, (res) => {
        // リダイレクト対応（GitHub Pagesは301/302/307/308する場合がある）
        if ((res.statusCode === 301 || res.statusCode === 302 || res.statusCode === 307 || res.statusCode === 308) && res.headers.location) {
          const redirectUrl = resolveRedirectUrl(targetUrl, res.headers.location);
          res.resume();
          if (!redirectUrl) {
            console.log('[cache] 旧snapshot取得スキップ (リダイレクトURL不正)');
            resolve(null);
            return;
          }
          fetchOldSnapshot(redirectUrl, { visited, maxRedirects }).then(resolve);
          return;
        }
        if (res.statusCode !== 200) {
          console.log(`[cache] 旧snapshot取得スキップ (HTTP ${res.statusCode})`);
          res.resume();
          resolve(null);
          return;
        }
        let body = '';
        res.setEncoding('utf8');
        res.on('data', (chunk) => { body += chunk; });
        res.on('end', () => {
          try {
            resolve(JSON.parse(body));
          } catch {
            console.log('[cache] 旧snapshotのパース失敗');
            resolve(null);
          }
        });
      });
    } catch (err) {
      console.log(`[cache] 旧snapshot取得失敗: ${err.message}`);
      resolve(null);
      return;
    }

    req.on('error', (err) => {
      console.log(`[cache] 旧snapshot取得失敗: ${err.message}`);
      resolve(null);
    });
    req.on('timeout', () => {
      req.destroy();
      console.log('[cache] 旧snapshot取得タイムアウト');
      resolve(null);
    });
  });
}

/**
 * GitHub Pages URL を GITHUB_REPOSITORY から自動構築する。
 * 例: "user/repo" → "https://user.github.io/repo/snapshot.json"
 */
function buildPagesSnapshotUrl() {
  const repo = process.env.GITHUB_REPOSITORY || '';
  if (!repo) return '';
  const [owner, name] = repo.split('/');
  if (!owner || !name) return '';
  if (name.toLowerCase() === `${owner.toLowerCase()}.github.io`) {
    return `https://${name}/snapshot.json`;
  }
  return `https://${owner}.github.io/${name}/snapshot.json`;
}

function normalizeCategoryList(value) {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((item) => String(item || '').trim())
    .filter(Boolean);
}

function buildRunConfig(slot) {
  if (slot === 'afternoon_news') {
    return {
      slot: 'afternoon_news',
      sourceMode: 'news_social',
      carryForwardSourceCategories: ['ranking', 'deals'],
    };
  }

  return {
    slot: 'morning_full',
    sourceMode: 'all',
    carryForwardSourceCategories: [],
  };
}

function buildMaterialKey(item) {
  const sourceId = String(item?.sourceId || '').trim();
  const url = String(item?.url || '').trim();
  const title = String(item?.title || '').trim().toLowerCase();

  if (sourceId && url) return `${sourceId}::${url}`;
  if (sourceId && title) return `${sourceId}::${title}`;
  if (url) return `url::${url}`;
  if (title) return `title::${title}`;
  return '';
}

function carryForwardMaterialsFromSnapshot(run, oldSnapshot, categories) {
  const carryCategories = new Set(normalizeCategoryList(categories));
  if (carryCategories.size === 0) {
    return { carriedCount: 0, sourceIds: [] };
  }

  const currentMaterials = Array.isArray(run?.payload?.materials) ? run.payload.materials : [];
  const oldMaterials = Array.isArray(oldSnapshot?.latestRun?.payload?.materials)
    ? oldSnapshot.latestRun.payload.materials
    : [];

  if (oldMaterials.length === 0) {
    return { carriedCount: 0, sourceIds: [] };
  }

  const existingKeys = new Set(currentMaterials.map((item) => buildMaterialKey(item)).filter(Boolean));
  const carried = [];
  const carriedSourceIds = new Set();

  for (const item of oldMaterials) {
    const category = String(item?.sourceCategory || '').trim();
    if (!carryCategories.has(category)) {
      continue;
    }

    const key = buildMaterialKey(item);
    if (key && existingKeys.has(key)) {
      continue;
    }

    if (key) {
      existingKeys.add(key);
    }
    carried.push(item);

    const sourceId = String(item?.sourceId || '').trim();
    if (sourceId) {
      carriedSourceIds.add(sourceId);
    }
  }

  if (carried.length === 0) {
    return { carriedCount: 0, sourceIds: [] };
  }

  if (!run.payload || typeof run.payload !== 'object') {
    run.payload = {};
  }
  run.payload.materials = [...currentMaterials, ...carried];
  if (run.payload.coverage && typeof run.payload.coverage === 'object') {
    run.payload.coverage.signals = run.payload.materials.length;
  }

  return {
    carriedCount: carried.length,
    sourceIds: Array.from(carriedSourceIds),
  };
}

function hasCarryCandidates(snapshot, categories) {
  const carryCategories = new Set(normalizeCategoryList(categories));
  if (carryCategories.size === 0) {
    return true;
  }

  const materials = Array.isArray(snapshot?.latestRun?.payload?.materials)
    ? snapshot.latestRun.payload.materials
    : [];

  return materials.some((item) => carryCategories.has(String(item?.sourceCategory || '').trim()));
}

function resolvePagesRunConfig(options = {}) {
  const preferredSlot = String(options.preferredSlot || '').trim();
  if (preferredSlot === 'morning_full' || preferredSlot === 'afternoon_news') {
    return buildRunConfig(preferredSlot);
  }

  const eventName = String(options.eventName || '').trim();
  const eventSchedule = String(options.eventSchedule || '').trim();
  if (eventName === 'schedule') {
    if (eventSchedule === '0 23 * * *') {
      return buildRunConfig('morning_full');
    }
    if (eventSchedule === '0 7 * * *') {
      return buildRunConfig('afternoon_news');
    }
  }

  const nowJstHour = String(options.nowJstHour || '').trim();
  if (nowJstHour === '16') {
    return buildRunConfig('afternoon_news');
  }

  return buildRunConfig('morning_full');
}

async function main() {
  loadDotEnv();
  const { readPrimaryTheme } = require('../src/storage');
  const { runTheme } = require('../src/trendService');
  const { getJstParts } = require('../src/utils');

  const theme = readPrimaryTheme();
  const apiKey = process.env.XAI_API_KEY || '';
  const model = process.env.XAI_MODEL || 'grok-4-1-fast-non-reasoning';
  const nowJst = getJstParts();
  const runConfig = resolvePagesRunConfig({
    nowJstHour: nowJst.hour,
    eventName: process.env.PAGES_EVENT_NAME || '',
    eventSchedule: process.env.PAGES_EVENT_SCHEDULE || '',
  });

  console.log(`テーマ: ${theme.name}`);
  console.log(`モデル: ${model}`);
  console.log(`実行スロット: ${runConfig.slot}`);

  // 1. 旧snapshotを取得（キャッシュ用）
  const pagesUrl = buildPagesSnapshotUrl();
  let oldSnapshot = null;
  if (pagesUrl) {
    console.log(`[cache] 旧snapshot取得中: ${pagesUrl}`);
    oldSnapshot = await fetchOldSnapshot(pagesUrl);
    if (oldSnapshot) {
      console.log(`[cache] 旧snapshot取得成功 (${oldSnapshot.now || 'unknown'})`);
    }
  } else {
    console.log('[cache] GITHUB_REPOSITORY未設定のためキャッシュスキップ');
  }

  let effectiveRunConfig = runConfig;
  if (
    runConfig.slot === 'afternoon_news' &&
    !hasCarryCandidates(oldSnapshot, runConfig.carryForwardSourceCategories)
  ) {
    console.log('[carry] 旧snapshotにランキング/セールがないため全ソース収集にフォールバック');
    effectiveRunConfig = {
      ...runConfig,
      sourceMode: 'all',
      carryForwardSourceCategories: [],
    };
  }

  // 2. 通常の収集を実行
  const run = await runTheme(theme, {
    apiKey,
    model,
    sourceMode: effectiveRunConfig.sourceMode,
    scheduleSlot: effectiveRunConfig.slot,
    carryForwardSourceCategories: effectiveRunConfig.carryForwardSourceCategories,
  });

  // 3. sourceStatsからエラーソースを特定し、旧データで補完
  const now = new Date().toISOString();
  const sourceStats = run.payload?.sourceStats || [];
  const sourceFetchedAt = {};
  const oldMaterials = oldSnapshot?.latestRun?.payload?.materials || [];
  const oldFetchedAt = oldSnapshot?.sourceFetchedAt || {};

  let cacheUsed = 0;
  for (const stat of sourceStats) {
    if (stat.status === 'ok' && stat.count > 0) {
      // 正常取得 → 現在時刻
      sourceFetchedAt[stat.sourceId] = now;
    } else if (stat.status === 'error' || (stat.status === 'ok' && stat.count === 0)) {
      // 失敗 or 0件 → 旧データから補完を試みる
      const cached = oldMaterials.filter((m) => m.sourceId === stat.sourceId);
      if (cached.length > 0) {
        // 旧データの materials を現在の run に追加
        run.payload.materials = [...(run.payload.materials || []), ...cached];
        // 取得日は旧snapshotの値を引き継ぐ
        sourceFetchedAt[stat.sourceId] = oldFetchedAt[stat.sourceId] || oldSnapshot?.now || now;
        // sourceStatsも補正（UIでの表示用）
        stat.count = cached.length;
        stat.status = 'cached';
        cacheUsed++;
        console.log(`[cache] ${stat.sourceName}: 旧データ${cached.length}件で補完`);
      } else {
        sourceFetchedAt[stat.sourceId] = null;
      }
    } else {
      // skipped等
      sourceFetchedAt[stat.sourceId] = null;
    }
  }

  // 16時実行はランキング/セールを旧snapshotから維持
  const carryResult = carryForwardMaterialsFromSnapshot(
    run,
    oldSnapshot,
    effectiveRunConfig.carryForwardSourceCategories,
  );
  if (carryResult.carriedCount > 0) {
    for (const sourceId of carryResult.sourceIds) {
      if (!sourceFetchedAt[sourceId]) {
        sourceFetchedAt[sourceId] = oldFetchedAt[sourceId] || oldSnapshot?.now || now;
      }
    }
    console.log(`[carry] 旧snapshotから ${carryResult.carriedCount} 件を維持しました`);
  }

  if (cacheUsed > 0) {
    console.log(`[cache] ${cacheUsed}ソースを旧データで補完しました`);
  }

  // 4. snapshot.json を生成（sourceFetchedAt を含む）
  const snapshot = {
    now,
    timezone: 'Asia/Tokyo',
    topic: theme.name,
    latestRun: run,
    sourceFetchedAt,
  };

  const outPath = path.resolve(process.cwd(), 'public', 'snapshot.json');
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, JSON.stringify(snapshot, null, 2) + '\n', 'utf8');
  console.log(`snapshot.json を生成しました: ${outPath}`);
}

main().catch((err) => {
  console.error('スナップショット生成エラー:', err);
  process.exit(1);
});
