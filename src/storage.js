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
    writeJson(THEMES_FILE, [primary]);
  }

  if (!fs.existsSync(TREND_FILE)) {
    writeJson(TREND_FILE, {
      runs: [],
    });
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

function readJson(filePath, fallback, options = {}) {
  const allowMissing = options.allowMissing !== false;
  const label = options.label || path.basename(filePath);

  try {
    const text = fs.readFileSync(filePath, 'utf8');
    return JSON.parse(text);
  } catch (error) {
    if (error && error.code === 'ENOENT' && allowMissing) {
      return fallback;
    }

    if (error instanceof SyntaxError) {
      throw new Error(`${label} のJSONが破損しています。バックアップから復旧してください。`);
    }

    throw error;
  }
}

function writeJson(filePath, data) {
  const dir = path.dirname(filePath);
  const base = path.basename(filePath);
  const tempPath = path.join(dir, `.${base}.${process.pid}.${Date.now()}.tmp`);
  const text = `${JSON.stringify(data, null, 2)}\n`;
  let fd = null;

  try {
    fd = fs.openSync(tempPath, 'w', 0o600);
    fs.writeFileSync(fd, text, 'utf8');
    safeFsync(fd);
    fs.closeSync(fd);
    fd = null;

    fs.renameSync(tempPath, filePath);

    // rename の耐久性を高めるため、親ディレクトリも fsync する
    const dirFd = fs.openSync(dir, 'r');
    try {
      safeFsync(dirFd);
    } finally {
      fs.closeSync(dirFd);
    }
  } catch (error) {
    if (fd !== null) {
      try {
        fs.closeSync(fd);
      } catch {
        // noop
      }
    }

    if (fs.existsSync(tempPath)) {
      try {
        fs.unlinkSync(tempPath);
      } catch {
        // noop
      }
    }

    throw error;
  }
}

function safeFsync(fd) {
  try {
    fs.fsyncSync(fd);
  } catch (error) {
    const code = String(error && error.code ? error.code : '');
    // Some Windows/filesystem combinations do not permit fsync.
    if (code === 'EPERM' || code === 'EINVAL' || code === 'ENOSYS' || code === 'EBADF' || code === 'EROFS') {
      return;
    }
    throw error;
  }
}

function readThemes() {
  ensureDataFiles();
  const now = new Date().toISOString();
  const themes = readJson(THEMES_FILE, [], { label: 'themes.json' });
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
  const store = readJson(TREND_FILE, { runs: [] }, { label: 'trends.json' });
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

function hasRunOnDateSlot(themeId, runDateJst, scheduleSlot) {
  const slot = String(scheduleSlot || '').trim();
  if (!slot) return false;

  const store = readTrendStore();
  return store.runs.some(
    (run) =>
      run.themeId === themeId &&
      run.runDateJst === runDateJst &&
      String(run.scheduleSlot || '').trim() === slot,
  );
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
  hasRunOnDateSlot,
  getLatestRunByTheme,
  getRunsByTheme,
  getLatestRunsMap,
};
