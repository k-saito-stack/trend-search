const { getPeriodLabel } = require('./utils');

const STOP_WORDS = new Set([
  'こと',
  'これ',
  'それ',
  'ため',
  'よう',
  'から',
  'まで',
  'について',
  'および',
  'など',
  'する',
  'した',
  'いる',
  'ある',
  'れる',
  'より',
  'として',
  'the',
  'and',
  'with',
  'from',
  'this',
  'that',
  'news',
  'google',
  'times',
  'pr',
  'jp',
]);

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function toIsoOrNull(value) {
  if (!value) return null;
  const time = Date.parse(String(value));
  if (Number.isNaN(time)) return null;
  return new Date(time).toISOString();
}

function recencyBoost(publishedAt) {
  const iso = toIsoOrNull(publishedAt);
  if (!iso) return 2;

  const ageHours = (Date.now() - Date.parse(iso)) / (1000 * 60 * 60);
  if (ageHours <= 12) return 12;
  if (ageHours <= 24) return 9;
  if (ageHours <= 72) return 6;
  if (ageHours <= 168) return 3;
  return 1;
}

function metricBoost(item) {
  if (item.metricLabel === 'likes') {
    return clamp(Math.log10(Number(item.metricValue || 0) + 1) * 12, 0, 40);
  }

  if (item.metricLabel === 'rank') {
    const rank = Number(item.metricValue || 100);
    return clamp(30 - rank, 0, 24);
  }

  return 6;
}

function scoreSignal(item) {
  const sourcePriority = Number(item.sourcePriority || 1) * 4;
  const metric = metricBoost(item);
  const recency = recencyBoost(item.publishedAt);
  return sourcePriority + metric + recency;
}

function tokenize(text) {
  const raw = String(text || '').toLowerCase();
  const matches = raw.match(/[a-z0-9]{3,}|[一-龠ぁ-んァ-ヶー]{2,}/g) || [];

  return matches
    .map((token) => token.trim())
    .filter((token) => token.length >= 2)
    .filter((token) => !STOP_WORDS.has(token))
    .filter((token) => !/^\d+$/.test(token));
}

function buildTokenStats(signals) {
  const stats = new Map();

  signals.forEach((signal, index) => {
    const uniqueTokens = new Set(tokenize(`${signal.title} ${signal.summary}`));
    uniqueTokens.forEach((token) => {
      if (!stats.has(token)) {
        stats.set(token, {
          token,
          count: 0,
          score: 0,
          itemIndexes: [],
        });
      }

      const row = stats.get(token);
      row.count += 1;
      row.score += Number(signal.score || 0);
      row.itemIndexes.push(index);
    });
  });

  return Array.from(stats.values()).sort((a, b) => {
    const left = a.count * 5 + a.score;
    const right = b.count * 5 + b.score;
    return right - left;
  });
}

function buildThemes(scoredSignals, limit = 10) {
  const stats = buildTokenStats(scoredSignals);
  return stats.slice(0, limit).map((row) => row.token);
}

function postFromSignal(signal) {
  return {
    url: signal.url,
    title: signal.title,
    summary: signal.summary,
    likes: signal.metricLabel === 'likes' ? Number(signal.metricValue || 0) : 0,
    metricLabel: signal.metricLabel,
    metricValue: Number(signal.metricValue || 0),
    sourceName: signal.sourceName,
    sourceCategory: signal.sourceCategory,
    publishedAt: toIsoOrNull(signal.publishedAt),
  };
}

function pickKeyphrases(signals, limit = 4) {
  const localStats = buildTokenStats(signals);
  return localStats.slice(0, limit).map((row) => row.token);
}

function buildClusters(scoredSignals, maxClusters = 5) {
  const stats = buildTokenStats(scoredSignals);
  const clusters = [];
  const usedIndexes = new Set();

  for (const row of stats) {
    if (clusters.length >= maxClusters) break;
    if (row.count < 2) continue;

    const clusterSignals = row.itemIndexes
      .map((index) => scoredSignals[index])
      .filter(Boolean)
      .sort((a, b) => b.score - a.score)
      .slice(0, 3);

    if (clusterSignals.length === 0) continue;

    const indexes = clusterSignals.map((signal) => scoredSignals.indexOf(signal));
    const hasFreshSignal = indexes.some((index) => !usedIndexes.has(index));
    if (!hasFreshSignal) continue;

    indexes.forEach((index) => usedIndexes.add(index));

    clusters.push({
      name: row.token.slice(0, 12),
      keyphrases: pickKeyphrases(clusterSignals),
      posts: clusterSignals.map(postFromSignal),
    });
  }

  if (clusters.length > 0) {
    return clusters;
  }

  const fallbackPosts = scoredSignals.slice(0, 3).map(postFromSignal);
  if (fallbackPosts.length === 0) {
    return [];
  }

  return [
    {
      name: '主要トピック',
      keyphrases: [],
      posts: fallbackPosts,
    },
  ];
}

function buildMaterials(scoredSignals, limit = 20) {
  return scoredSignals.slice(0, limit).map((signal) => ({
    url: signal.url,
    title: signal.title,
    summary: signal.summary,
    likes: signal.metricLabel === 'likes' ? Number(signal.metricValue || 0) : 0,
    metricLabel: signal.metricLabel,
    metricValue: Number(signal.metricValue || 0),
    sourceName: signal.sourceName,
    sourceCategory: signal.sourceCategory,
    publishedAt: toIsoOrNull(signal.publishedAt),
  }));
}

function buildCoverage(sourceStats, dedupedSignals, totalBeforeDedupe) {
  const ok = sourceStats.filter((source) => source.status === 'ok').length;
  const error = sourceStats.filter((source) => source.status === 'error').length;
  const skipped = sourceStats.filter((source) => source.status === 'skipped').length;

  return {
    sourceTotal: sourceStats.length,
    sourceOk: ok,
    sourceError: error,
    sourceSkipped: skipped,
    signals: dedupedSignals,
    beforeDedupe: totalBeforeDedupe,
    duplicateDrop: Math.max(0, totalBeforeDedupe - dedupedSignals),
  };
}

function buildTrendPayload(theme, collection) {
  const scoredSignals = (collection.signals || [])
    .filter((item) => item && item.url)
    .map((signal) => ({
      ...signal,
      score: scoreSignal(signal),
    }))
    .sort((a, b) => b.score - a.score);

  const clusters = buildClusters(scoredSignals);
  const themes = buildThemes(scoredSignals);
  const materials = buildMaterials(scoredSignals);
  const coverage = buildCoverage(
    collection.sourceStats || [],
    scoredSignals.length,
    Number(collection.totalSignalsBeforeDedupe || scoredSignals.length),
  );

  let parseStatus = 'ok';
  if (scoredSignals.length === 0) {
    parseStatus = 'no_signals';
  } else if (collection.xMeta?.parseStatus === 'fallback_text') {
    parseStatus = 'ok_with_x_fallback';
  }

  const queryWithSince =
    collection.xMeta?.queryWithSince ||
    `${theme.query || theme.name} source-window:${collection.sinceDate}..today`;

  const rawText = collection.xMeta?.rawText || '';

  return {
    parseStatus,
    queryWithSince,
    rawText,
    payload: {
      clusters,
      themes,
      materials,
      sourceStats: collection.sourceStats || [],
      coverage,
      periodLabel: getPeriodLabel(theme.periodDays),
    },
  };
}

module.exports = {
  buildTrendPayload,
};
