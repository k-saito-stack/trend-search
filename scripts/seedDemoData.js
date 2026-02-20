const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const THEMES_FILE = path.resolve(process.cwd(), 'data/themes.json');
const TRENDS_FILE = path.resolve(process.cwd(), 'data/trends.json');

function readJson(filePath, fallback) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return fallback;
  }
}

function writeJson(filePath, value) {
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

function id(prefix) {
  return `${prefix}_${Date.now().toString(36)}_${crypto.randomBytes(4).toString('hex')}`;
}

function daysAgoIso(days) {
  const date = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
  return date.toISOString();
}

function daysAgoJstDate(days) {
  const date = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Tokyo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);

  const map = {};
  for (const part of parts) {
    map[part.type] = part.value;
  }

  return `${map.year}-${map.month}-${map.day}`;
}

function makeRun(theme, index) {
  const createdAt = daysAgoIso(index);
  const runDateJst = daysAgoJstDate(index);
  const sinceDate = daysAgoJstDate(index + 2);

  const clusters = [
    {
      name: '新刊告知',
      keyphrases: ['新刊', '発売', '編集部'],
      posts: [
        {
          url: `https://x.com/i/status/20100000000000${index}1`,
          summary: '新刊の発売案内が拡散し、予約導線の分かりやすさが評価された。',
          likes: 520 + index * 11,
        },
        {
          url: `https://x.com/i/status/20100000000000${index}2`,
          summary: 'シリーズ横断の紹介投稿が再共有され、既刊との比較が話題に。',
          likes: 410 + index * 9,
        },
      ],
    },
    {
      name: '書評連鎖',
      keyphrases: ['書評', '読了', '感想まとめ'],
      posts: [
        {
          url: `https://x.com/i/status/20200000000000${index}1`,
          summary: '読者レビューの要点整理ポストが複数アカウントに引用され、波及した。',
          likes: 380 + index * 8,
        },
        {
          url: `https://x.com/i/status/20200000000000${index}2`,
          summary: '章ごとの学びを箇条書きにした投稿が保存目的で伸びた。',
          likes: 340 + index * 7,
        },
      ],
    },
    {
      name: '引用論点',
      keyphrases: ['引用', '要約', '議論'],
      posts: [
        {
          url: `https://x.com/i/status/20300000000000${index}1`,
          summary: '印象的な一節の引用を起点に、関連テーマの議論が再燃した。',
          likes: 295 + index * 6,
        },
        {
          url: `https://x.com/i/status/20300000000000${index}2`,
          summary: '引用部分の背景説明付き投稿が、初見読者にも理解しやすいと反応を集めた。',
          likes: 270 + index * 5,
        },
      ],
    },
  ];

  const materials = clusters
    .flatMap((cluster) => cluster.posts)
    .sort((a, b) => b.likes - a.likes)
    .slice(0, 10)
    .map((post, materialIndex) => ({
      ...post,
      title: post.summary.slice(0, 42),
      metricLabel: 'likes',
      metricValue: post.likes,
      sourceName: materialIndex % 2 === 0 ? 'X / Grok x_search' : 'Google News / 書評・レビュー',
      sourceCategory: materialIndex % 2 === 0 ? 'social' : 'book_review',
      publishedAt: createdAt,
    }));

  return {
    id: id('run'),
    themeId: theme.id,
    themeName: theme.name,
    query: theme.query,
    periodDays: theme.periodDays,
    periodLabel: `直近${theme.periodDays}日`,
    model: 'grok-4-1-fast',
    queryWithSince: `${theme.query} since:${sinceDate}`,
    sinceDate,
    runDateJst,
    createdAt,
    parseStatus: 'ok',
    payload: {
      clusters,
      themes: ['現代新書', '社会', '読書', '新刊', '議論'],
      materials,
      sourceStats: [
        {
          sourceId: 'x_grok_social',
          sourceName: 'X / Grok x_search',
          category: 'social',
          status: 'ok',
          costTier: 'api',
          count: 8,
          durationMs: 2300,
          error: '',
        },
        {
          sourceId: 'news_book_review',
          sourceName: 'Google News / 書評・レビュー',
          category: 'book_review',
          status: 'ok',
          costTier: 'free',
          count: 7,
          durationMs: 420,
          error: '',
        },
      ],
      coverage: {
        sourceTotal: 2,
        sourceOk: 2,
        sourceError: 0,
        sourceSkipped: 0,
        signals: materials.length,
        beforeDedupe: materials.length + 2,
        duplicateDrop: 2,
      },
    },
    rawText: JSON.stringify({ clusters, materials }),
  };
}

function main() {
  const themes = readJson(THEMES_FILE, []);
  if (!Array.isArray(themes) || themes.length === 0) {
    console.error('themes.json が空です。先にテーマを1件以上作成してください。');
    process.exit(1);
  }

  const targetTheme = themes[0];
  const store = readJson(TRENDS_FILE, { runs: [] });
  const runs = Array.isArray(store.runs) ? store.runs : [];

  const demoDateSet = new Set([daysAgoJstDate(0), daysAgoJstDate(1), daysAgoJstDate(2)]);
  const filtered = runs.filter((run) => {
    if (run.themeId !== targetTheme.id) return true;
    return !demoDateSet.has(run.runDateJst);
  });

  const demoRuns = [makeRun(targetTheme, 0), makeRun(targetTheme, 1), makeRun(targetTheme, 2)];
  const nextRuns = [...demoRuns, ...filtered].slice(0, 1000);

  writeJson(TRENDS_FILE, { runs: nextRuns });

  console.log(`Demo data seeded for theme: ${targetTheme.name}`);
  console.log(`Added runs: ${demoRuns.length}`);
}

main();
