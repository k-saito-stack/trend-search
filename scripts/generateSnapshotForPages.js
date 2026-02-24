const path = require('node:path');
const fs = require('node:fs');

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

async function main() {
  loadDotEnv();
  const { readPrimaryTheme } = require('../src/storage');
  const { runTheme } = require('../src/trendService');

  const theme = readPrimaryTheme();
  const apiKey = process.env.XAI_API_KEY || '';
  const model = process.env.XAI_MODEL || 'grok-4-1-fast-non-reasoning';

  console.log(`テーマ: ${theme.name}`);
  console.log(`モデル: ${model}`);

  const run = await runTheme(theme, { apiKey, model });

  const snapshot = {
    now: new Date().toISOString(),
    timezone: 'Asia/Tokyo',
    topic: theme.name,
    latestRun: run,
  };

  const outPath = path.resolve(process.cwd(), 'public', 'snapshot.json');
  fs.writeFileSync(outPath, JSON.stringify(snapshot, null, 2) + '\n', 'utf8');
  console.log(`snapshot.json を生成しました: ${outPath}`);
}

main().catch((err) => {
  console.error('スナップショット生成エラー:', err);
  process.exit(1);
});
