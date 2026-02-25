const { readPrimaryTheme, hasRunOnDateSlot } = require('./storage');
const { runTheme } = require('./trendService');
const { getJstParts } = require('./utils');

const SCHEDULE_SLOTS = [
  {
    hour: '08',
    minute: '00',
    slot: 'morning_full',
    sourceMode: 'all',
    carryForwardSourceCategories: [],
  },
  {
    hour: '16',
    minute: '00',
    slot: 'afternoon_news',
    sourceMode: 'news_social',
    carryForwardSourceCategories: ['ranking', 'deals'],
  },
];

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

    const activeSlot = SCHEDULE_SLOTS.find(
      (slot) => slot.hour === now.hour && slot.minute === now.minute,
    );
    if (!activeSlot) {
      return;
    }

    if (inFlight) {
      return;
    }

    inFlight = true;

    try {
      const theme = readPrimaryTheme();
      if (!theme || theme.enabled === false) {
        log('[scheduler] テーマが無効のためスキップ');
        return;
      }

      if (hasRunOnDateSlot(theme.id, now.date, activeSlot.slot)) {
        log(`[scheduler] ${theme.name} は ${now.date} ${activeSlot.slot} 実行済みのためスキップ`);
        return;
      }

      try {
        await runTheme(theme, {
          ...options,
          sourceMode: activeSlot.sourceMode,
          scheduleSlot: activeSlot.slot,
          carryForwardSourceCategories: activeSlot.carryForwardSourceCategories,
        });
        log(`[scheduler] ${theme.name} の収集が完了 (${activeSlot.slot})`);
      } catch (error) {
        if (error?.code === 'THEME_RUN_IN_PROGRESS') {
          log(`[scheduler] ${theme.name} は他の実行が進行中のためスキップ (${activeSlot.slot})`);
          return;
        }
        log(`[scheduler] ${theme.name} の収集に失敗 (${activeSlot.slot}): ${error.message}`);
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
