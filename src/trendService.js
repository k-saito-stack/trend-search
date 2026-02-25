const { appendRun, readThemes, getRunsByTheme } = require('./storage');
const { createId, getJstParts, getSinceDate, getPeriodLabel } = require('./utils');
const { collectThemeSignals } = require('./sourceCollector');
const { buildTrendPayload } = require('./signalDigest');

const inFlightThemeRuns = new Map();

function buildUserMessage(theme) {
  const sinceDate = getSinceDate(theme.periodDays);
  return {
    sinceDate,
    text: `${theme.query} since:${sinceDate}`,
  };
}

function normalizeCarryCategories(value) {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((item) => String(item || '').trim())
    .filter(Boolean);
}

function carryForwardSourceCategories(digest, themeId, categories) {
  const carryCategories = normalizeCarryCategories(categories);
  if (carryCategories.length === 0) {
    return;
  }

  const currentMaterials = Array.isArray(digest?.payload?.materials)
    ? digest.payload.materials
    : [];

  const existingCategories = new Set(
    currentMaterials.map((item) => String(item?.sourceCategory || '').trim()),
  );
  const missingCategories = carryCategories.filter((category) => !existingCategories.has(category));
  if (missingCategories.length === 0) {
    return;
  }

  const recentRuns = getRunsByTheme(themeId, 10);
  if (recentRuns.length === 0) {
    return;
  }

  const carriedMaterials = [];
  const filled = new Set();

  for (const pastRun of recentRuns) {
    const pastMaterials = Array.isArray(pastRun?.payload?.materials)
      ? pastRun.payload.materials
      : [];

    for (const category of missingCategories) {
      if (filled.has(category)) {
        continue;
      }

      const found = pastMaterials.filter((item) => String(item?.sourceCategory || '').trim() === category);
      if (found.length > 0) {
        carriedMaterials.push(...found);
        filled.add(category);
      }
    }

    if (filled.size === missingCategories.length) {
      break;
    }
  }

  if (carriedMaterials.length === 0) {
    return;
  }

  digest.payload.materials = [...currentMaterials, ...carriedMaterials];
  if (digest.payload.coverage && typeof digest.payload.coverage === 'object') {
    digest.payload.coverage.signals = digest.payload.materials.length;
  }
}

async function runThemeOnce(theme, options = {}) {
  const apiKey = options.apiKey || process.env.XAI_API_KEY;
  const model = options.model || process.env.XAI_MODEL || 'grok-4-1-fast';

  const userMessage = buildUserMessage(theme);
  const collection = await collectThemeSignals(theme, {
    apiKey,
    model,
    sourceMode: options.sourceMode || 'all',
  });
  const digest = buildTrendPayload(theme, collection);

  // X投稿フォールバック: 今回0件の場合、直近の成功したrunからキャッシュを補完
  const currentXCount = (digest.payload?.materials || []).filter((m) => m.sourceKind === 'x_grok').length;
  if (currentXCount === 0) {
    const recentRuns = getRunsByTheme(theme.id, 10);
    for (const pastRun of recentRuns) {
      const cachedX = (pastRun.payload?.materials || [])
        .filter((m) => m.sourceKind === 'x_grok')
        .sort((a, b) => Number(b.metricValue || 0) - Number(a.metricValue || 0))
        .slice(0, 14);
      if (cachedX.length > 0) {
        const nonRanking = (digest.payload.materials || []).filter((m) => m.sourceCategory !== 'ranking');
        const ranking = (digest.payload.materials || []).filter((m) => m.sourceCategory === 'ranking');
        digest.payload.materials = [...nonRanking, ...cachedX, ...ranking];
        break;
      }
    }
  }

  carryForwardSourceCategories(digest, theme.id, options.carryForwardSourceCategories);

  const now = new Date();
  const jst = getJstParts(now);

  const run = {
    id: createId('run'),
    themeId: theme.id,
    themeName: theme.name,
    query: theme.query,
    periodDays: theme.periodDays,
    periodLabel: getPeriodLabel(theme.periodDays),
    model: apiKey ? model : 'no_x_model',
    scheduleSlot: String(options.scheduleSlot || 'manual').trim() || 'manual',
    queryWithSince: digest.queryWithSince || userMessage.text,
    sinceDate: userMessage.sinceDate,
    runDateJst: jst.date,
    createdAt: now.toISOString(),
    parseStatus: digest.parseStatus,
    payload: digest.payload,
    rawText: digest.rawText,
  };

  appendRun(run);
  return run;
}

async function runTheme(theme, options = {}) {
  const themeId = String(theme?.id || '').trim();
  if (!themeId) {
    throw new Error('theme.id が不正です');
  }

  if (inFlightThemeRuns.has(themeId)) {
    const error = new Error('他の実行が進行中です');
    error.code = 'THEME_RUN_IN_PROGRESS';
    throw error;
  }

  const inFlight = runThemeOnce(theme, options);
  inFlightThemeRuns.set(themeId, inFlight);

  try {
    return await inFlight;
  } finally {
    if (inFlightThemeRuns.get(themeId) === inFlight) {
      inFlightThemeRuns.delete(themeId);
    }
  }
}

async function runThemeById(themeId, options = {}) {
  const themes = readThemes();
  const theme = themes.find((item) => item.id === themeId);

  if (!theme) {
    throw new Error('theme が見つかりません');
  }

  return runTheme(theme, options);
}

async function runAllEnabledThemes(options = {}) {
  const themes = readThemes().filter((theme) => theme.enabled);

  const results = [];
  for (const theme of themes) {
    try {
      // ソース単位で失敗しても処理継続するが、念のためテーマ単位でも継続する
      const run = await runTheme(theme, options);
      results.push({ themeId: theme.id, ok: true, run });
    } catch (error) {
      results.push({ themeId: theme.id, ok: false, error: error.message });
    }
  }

  return results;
}

module.exports = {
  runTheme,
  runThemeById,
  runAllEnabledThemes,
};
