const { appendRun, readThemes } = require('./storage');
const { createId, getJstParts, getSinceDate, getPeriodLabel } = require('./utils');
const { collectThemeSignals } = require('./sourceCollector');
const { buildTrendPayload } = require('./signalDigest');

function buildUserMessage(theme) {
  const sinceDate = getSinceDate(theme.periodDays);
  return {
    sinceDate,
    text: `${theme.query} since:${sinceDate}`,
  };
}

async function runTheme(theme, options = {}) {
  const apiKey = options.apiKey || process.env.XAI_API_KEY;
  const model = options.model || process.env.XAI_MODEL || 'grok-4-1-fast';

  const userMessage = buildUserMessage(theme);
  const collection = await collectThemeSignals(theme, {
    apiKey,
    model,
  });
  const digest = buildTrendPayload(theme, collection);
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
