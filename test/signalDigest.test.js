const test = require('node:test');
const assert = require('node:assert/strict');

const { buildTrendPayload } = require('../src/signalDigest');

test('buildTrendPayload creates ranked materials and coverage', () => {
  const theme = {
    name: '出版',
    query: '出版',
    periodDays: 2,
  };

  const collection = {
    sinceDate: '2026-02-18',
    totalSignalsBeforeDedupe: 5,
    sourceStats: [
      { status: 'ok' },
      { status: 'ok' },
      { status: 'error' },
    ],
    signals: [
      {
        sourceId: 'x_grok_social',
        sourceName: 'X / Grok',
        sourceCategory: 'social',
        sourceKind: 'x_grok',
        sourcePriority: 5,
        title: '著者インタビューが話題',
        summary: '著者インタビューが拡散',
        url: 'https://x.com/i/status/1',
        publishedAt: new Date().toISOString(),
        metricLabel: 'likes',
        metricValue: 800,
      },
      {
        sourceId: 'news_book_review',
        sourceName: 'Google News',
        sourceCategory: 'book_review',
        sourceKind: 'google_news',
        sourcePriority: 4,
        title: '週末書評まとめ',
        summary: '書評記事のまとめ',
        url: 'https://example.com/review',
        publishedAt: new Date().toISOString(),
        metricLabel: 'mentions',
        metricValue: 1,
      },
    ],
    xMeta: {
      parseStatus: 'ok',
      queryWithSince: '出版 since:2026-02-18',
      rawText: '{"ok":true}',
    },
  };

  const digest = buildTrendPayload(theme, collection);
  assert.equal(digest.parseStatus, 'ok');
  assert.equal(digest.payload.materials.length, 2);
  assert.equal(digest.payload.materials[0].url, 'https://x.com/i/status/1');
  assert.equal(digest.payload.coverage.sourceOk, 2);
  assert.equal(digest.payload.coverage.sourceError, 1);
  assert.equal(digest.payload.coverage.duplicateDrop, 3);
  assert.equal(digest.queryWithSince, '出版 since:2026-02-18');
});

test('buildTrendPayload returns no_signals on empty signals', () => {
  const digest = buildTrendPayload(
    {
      name: '出版',
      query: '出版',
      periodDays: 2,
    },
    {
      sinceDate: '2026-02-18',
      totalSignalsBeforeDedupe: 0,
      sourceStats: [],
      signals: [],
      xMeta: null,
    },
  );

  assert.equal(digest.parseStatus, 'no_signals');
  assert.equal(digest.payload.materials.length, 0);
});

test('queryWithSince uses since: format when xMeta is null', () => {
  const digest = buildTrendPayload(
    {
      name: '出版業界と周辺業界',
      query: '出版業界 周辺業界',
      periodDays: 1,
    },
    {
      sinceDate: '2026-03-09',
      totalSignalsBeforeDedupe: 0,
      sourceStats: [],
      signals: [],
      xMeta: null,
    },
  );

  assert.ok(
    digest.queryWithSince.includes('since:'),
    `expected since: format but got: ${digest.queryWithSince}`,
  );
  assert.ok(
    !digest.queryWithSince.includes('source-window:'),
    `should not contain source-window: but got: ${digest.queryWithSince}`,
  );
});
