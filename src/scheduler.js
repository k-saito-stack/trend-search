const { readThemes, hasRunOnDate } = require('./storage');
const { runTheme } = require('./trendService');
const { getJstParts } = require('./utils');

function startDailyScheduler(options = {}) {
  const intervalMs = Number(options.intervalMs) || 60 * 1000;
  const log = typeof options.log === 'function' ? options.log : () => {};

  let timer = null;
  let inFlight = false;
  let lastMinuteKey = '';

  async function tick() {
    const now = getJstParts();
    const minuteKey = `${now.date} ${now.hour}:${now.minute}`;

    if (minuteKey === lastMinuteKey) {
      return;
    }
    lastMinuteKey = minuteKey;

    if (now.hour !== '07' || now.minute !== '00') {
      return;
    }

    if (inFlight) {
      return;
    }

    inFlight = true;

    try {
      const themes = readThemes().filter((theme) => theme.enabled);
      if (themes.length === 0) {
        log('[scheduler] enabled theme がないためスキップ');
        return;
      }

      for (const theme of themes) {
        if (hasRunOnDate(theme.id, now.date)) {
          log(`[scheduler] ${theme.name} は ${now.date} 実行済みのためスキップ`);
          continue;
        }

        try {
          await runTheme(theme, options);
          log(`[scheduler] ${theme.name} の収集が完了`);
        } catch (error) {
          log(`[scheduler] ${theme.name} の収集に失敗: ${error.message}`);
        }
      }
    } finally {
      inFlight = false;
    }
  }

  timer = setInterval(() => {
    void tick();
  }, intervalMs);

  if (options.runOnStart) {
    void tick();
  }

  return {
    stop() {
      if (timer) {
        clearInterval(timer);
        timer = null;
      }
    },
    tick,
  };
}

module.exports = {
  startDailyScheduler,
};
