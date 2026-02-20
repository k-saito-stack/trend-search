const fs = require('node:fs');
const path = require('node:path');
const { createId } = require('./utils');

const DATA_DIR = path.resolve(process.cwd(), 'data');
const THEMES_FILE = path.join(DATA_DIR, 'themes.json');
const TREND_FILE = path.join(DATA_DIR, 'trends.json');
const FIXED_THEME_NAME = '出版業界と周辺業界';
const FIXED_THEME_QUERY =
  '出版業界 周辺業界 出版社 書店 新刊 書評 PR TIMES 人事 異動 テレビ ラジオ ベストセラー Amazon Kindle';
const FIXED_PERIOD_DAYS = 1;

function ensureDataFiles() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }

  if (!fs.existsSync(THEMES_FILE)) {
    const primary = buildPrimaryTheme(null);
    fs.writeFileSync(THEMES_FILE, JSON.stringify([primary], null, 2));
  }

  if (!fs.existsSync(TREND_FILE)) {
    fs.writeFileSync(
      TREND_FILE,
      JSON.stringify({
        runs: [],
      }, null, 2),
    );
  }
}

function buildPrimaryTheme(current, now = new Date().toISOString()) {
  return {
    id: current?.id || createId('theme'),
    name: FIXED_THEME_NAME,
    query: FIXED_THEME_QUERY,
    periodDays: FIXED_PERIOD_DAYS,
    enabled: true,
    createdAt: current?.createdAt || now,
    updatedAt: current?.updatedAt || now,
  };
}

function readJson(filePath, fallback) {
  try {
    const text = fs.readFileSync(filePath, 'utf8');
    return JSON.parse(text);
  } catch {
    return fallback;
  }
}

function writeJson(filePath, data) {
  fs.writeFileSync(filePath, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
}

function readThemes() {
  ensureDataFiles();
  const now = new Date().toISOString();
  const themes = readJson(THEMES_FILE, []);
  const current = Array.isArray(themes) ? themes[0] : null;
  const primary = buildPrimaryTheme(current, now);

  const changed =
    !current ||
    current.name !== primary.name ||
    current.query !== primary.query ||
    Number(current.periodDays) !== primary.periodDays ||
    current.enabled !== true ||
    !Array.isArray(themes) ||
    themes.length !== 1;

  if (changed) {
    const refreshed = { ...primary, updatedAt: now };
    writeJson(THEMES_FILE, [refreshed]);
    return [refreshed];
  }

  return [primary];
}

function writeThemes(themes) {
  writeJson(THEMES_FILE, themes);
}

function createTheme(input) {
  throw new Error('固定テーマモードのため createTheme は無効です');
}

function updateTheme(themeId, patch) {
  throw new Error('固定テーマモードのため updateTheme は無効です');
}

function deleteTheme(themeId) {
  throw new Error('固定テーマモードのため deleteTheme は無効です');
}

function readTrendStore() {
  ensureDataFiles();
  const store = readJson(TREND_FILE, { runs: [] });
  if (!store.runs || !Array.isArray(store.runs)) {
    return { runs: [] };
  }
  return store;
}

function writeTrendStore(store) {
  writeJson(TREND_FILE, store);
}

function appendRun(run) {
  const store = readTrendStore();
  store.runs.unshift(run);
  // ファイルサイズ肥大化防止: 最新 1000 件だけ保持
  store.runs = store.runs.slice(0, 1000);
  writeTrendStore(store);
}

function hasRunOnDate(themeId, runDateJst) {
  const store = readTrendStore();
  return store.runs.some((run) => run.themeId === themeId && run.runDateJst === runDateJst);
}

function getLatestRunByTheme(themeId) {
  const store = readTrendStore();
  return store.runs.find((run) => run.themeId === themeId) || null;
}

function getRunsByTheme(themeId, limit = 20) {
  const store = readTrendStore();
  return store.runs.filter((run) => run.themeId === themeId).slice(0, limit);
}

function getLatestRunsMap() {
  const store = readTrendStore();
  const map = {};
  for (const run of store.runs) {
    if (!map[run.themeId]) {
      map[run.themeId] = run;
    }
  }
  return map;
}

function readPrimaryTheme() {
  return readThemes()[0];
}

module.exports = {
  ensureDataFiles,
  readThemes,
  readPrimaryTheme,
  createTheme,
  updateTheme,
  deleteTheme,
  appendRun,
  hasRunOnDate,
  getLatestRunByTheme,
  getRunsByTheme,
  getLatestRunsMap,
};
