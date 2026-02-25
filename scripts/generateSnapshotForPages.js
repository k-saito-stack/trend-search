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

/**
 * GitHub Pages上の現在デプロイ済み snapshot.json を取得する。
 * 失敗した場合は null を返す（初回デプロイ時など）。
 */
function fetchOldSnapshot(pagesUrl) {
  return new Promise((resolve) => {
    const client = pagesUrl.startsWith('https') ? https : http;
    const req = client.get(pagesUrl, { timeout: 15000 }, (res) => {
      // リダイレクト対応（GitHub Pagesは301/302する場合がある）
      if ((res.statusCode === 301 || res.statusCode === 302) && res.headers.location) {
        fetchOldSnapshot(res.headers.location).then(resolve);
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
  return `https://${owner}.github.io/${name}/snapshot.json`;
}

async function main() {
  loadDotEnv();
  const { readPrimaryTheme } = require('../src/storage');
  const { runTheme } = require('../src/trendService');

  const theme = readPrimaryTheme();
  const apiKey = process.env.XAI_API_KEY || '';
  const model = process.env.XAI_MODEL || 'grok-4-1-fast-non-reasoning';

  console.log(`テーマ: ${theme.name}`);
  console.log(`モデル: ${model}`);

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

  // 2. 通常の収集を実行
  const run = await runTheme(theme, { apiKey, model });

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
  fs.writeFileSync(outPath, JSON.stringify(snapshot, null, 2) + '\n', 'utf8');
  console.log(`snapshot.json を生成しました: ${outPath}`);
}

main().catch((err) => {
  console.error('スナップショット生成エラー:', err);
  process.exit(1);
});
