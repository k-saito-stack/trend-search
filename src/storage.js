const fs = require('node:fs');
const path = require('node:path');
const { createId } = require('./utils');

const DATA_DIR = path.resolve(process.cwd(), 'data');
const THEMES_FILE = path.join(DATA_DIR, 'themes.json');
const TREND_FILE = path.join(DATA_DIR, 'trends.json');

function ensureDataFiles() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }

  if (!fs.existsSync(THEMES_FILE)) {
    const now = new Date().toISOString();
    const defaultThemes = [
      {
        id: createId('theme'),
        name: 'デザイン AI',
        query: 'デザイン AI',
        periodDays: 2,
        enabled: true,
        createdAt: now,
        updatedAt: now,
      },
    ];
    fs.writeFileSync(THEMES_FILE, JSON.stringify(defaultThemes, null, 2));
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
  const themes = readJson(THEMES_FILE, []);
  return Array.isArray(themes) ? themes : [];
}

function writeThemes(themes) {
  writeJson(THEMES_FILE, themes);
}

function createTheme(input) {
  const now = new Date().toISOString();
  const theme = {
    id: createId('theme'),
    name: String(input.name || '').trim(),
    query: String(input.query || '').trim(),
    periodDays: Number(input.periodDays || 2),
    enabled: input.enabled !== false,
    createdAt: now,
    updatedAt: now,
  };

  if (!theme.name || !theme.query) {
    throw new Error('name と query は必須です');
  }

  if (!Number.isFinite(theme.periodDays) || theme.periodDays < 1 || theme.periodDays > 30) {
    throw new Error('periodDays は 1-30 の整数で指定してください');
  }

  theme.periodDays = Math.floor(theme.periodDays);

  const themes = readThemes();
  themes.push(theme);
  writeThemes(themes);
  return theme;
}

function updateTheme(themeId, patch) {
  const themes = readThemes();
  const idx = themes.findIndex((item) => item.id === themeId);
  if (idx < 0) {
    throw new Error('theme が見つかりません');
  }

  const current = themes[idx];
  const next = {
    ...current,
    ...patch,
    updatedAt: new Date().toISOString(),
  };

  if (!String(next.name || '').trim()) {
    throw new Error('name は空にできません');
  }

  if (!String(next.query || '').trim()) {
    throw new Error('query は空にできません');
  }

  const days = Number(next.periodDays);
  if (!Number.isFinite(days) || days < 1 || days > 30) {
    throw new Error('periodDays は 1-30 の整数で指定してください');
  }

  next.name = String(next.name).trim();
  next.query = String(next.query).trim();
  next.periodDays = Math.floor(days);
  next.enabled = Boolean(next.enabled);

  themes[idx] = next;
  writeThemes(themes);
  return next;
}

function deleteTheme(themeId) {
  const themes = readThemes();
  const filtered = themes.filter((item) => item.id !== themeId);
  if (filtered.length === themes.length) {
    throw new Error('theme が見つかりません');
  }

  writeThemes(filtered);
  return true;
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

module.exports = {
  ensureDataFiles,
  readThemes,
  createTheme,
  updateTheme,
  deleteTheme,
  appendRun,
  hasRunOnDate,
  getLatestRunByTheme,
  getRunsByTheme,
  getLatestRunsMap,
};
