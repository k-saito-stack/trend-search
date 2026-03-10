const test = require('node:test');
const assert = require('node:assert/strict');

const { _private } = require('../src/sourceCollector');

const FIXTURE_HTML = `
<html><body>
<article class="post-1234">
  <h2 class="entry-title"><a href="/article/entry-2025030101/" title="オーディオブック市場が拡大">オーディオブック市場が拡大</a></h2>
  <time class="entry-date" datetime="2026-03-08T10:00:00+09:00">2026年3月8日</time>
  <div class="entry-summary"><p>音声コンテンツ市場が前年比120%で成長している。</p></div>
</article>
<article class="post-5678">
  <h2 class="entry-title"><a href="/article/entry-2025030102/">講談社が新サービス発表</a></h2>
  <time class="entry-date" datetime="2026-03-07T14:00:00+09:00">2026年3月7日</time>
  <p>講談社は新しい電子書籍サービスを開始すると発表した。</p>
</article>
<article class="post-9999">
  <div>no heading link here</div>
</article>
</body></html>
`;

test('parseBunkaNewsArchive extracts articles from fixture HTML', () => {
  const results = _private.parseBunkaNewsArchive(FIXTURE_HTML, 10, 'https://www.bunkanews.jp');

  assert.equal(results.length, 2);

  assert.equal(results[0].title, 'オーディオブック市場が拡大');
  assert.ok(results[0].url.includes('/article/entry-2025030101/'));
  assert.equal(results[0].publishedAt, '2026-03-08T10:00:00+09:00');
  assert.ok(results[0].summary.includes('音声コンテンツ市場'));

  assert.equal(results[1].title, '講談社が新サービス発表');
  assert.ok(results[1].url.includes('/article/entry-2025030102/'));
  assert.equal(results[1].publishedAt, '2026-03-07T14:00:00+09:00');
});

test('parseBunkaNewsArchive respects limit', () => {
  const results = _private.parseBunkaNewsArchive(FIXTURE_HTML, 1, 'https://www.bunkanews.jp');
  assert.equal(results.length, 1);
});

test('parseBunkaNewsArchive deduplicates by URL', () => {
  const dupeHtml = `
  <article><h2><a href="/article/same/">Title A</a></h2><time datetime="2026-03-08"></time></article>
  <article><h2><a href="/article/same/">Title B</a></h2><time datetime="2026-03-07"></time></article>
  `;
  const results = _private.parseBunkaNewsArchive(dupeHtml, 10, 'https://www.bunkanews.jp');
  assert.equal(results.length, 1);
});

test('parseBunkaNewsArchive returns empty for no articles', () => {
  const results = _private.parseBunkaNewsArchive('<html></html>', 10, 'https://www.bunkanews.jp');
  assert.equal(results.length, 0);
});

// --- parseBunkaNewsSchedule tests ---

const SCHEDULE_FIXTURE = `
<html><body>
<h2>2026年度 業界スケジュール</h2>
<h3>3月March</h3>
<ul>
<li>
10日（月）
【出版】三省堂書店リニューアルオープン
<a href="/article/schedule/12345/">詳細はこちら</a>
</li>
<li>
14日（土）
【出版】KOBE BOOK FAIR（3月14日〜15日）
11:00〜 場所：神戸ファッションマート
<a href="https://example.com/kobe-book">詳細はこちら</a>
</li>
<li>
25日（水）
【出版】出版流通セミナー第4回
14:30〜16:10 日本出版クラブ
</li>
</ul>
<h3>4月April</h3>
<ul>
<li>
21日（火）
【出版】全国トーハン会代表者総会
15:00〜 ホテル椿山荘
<a href="/article/schedule/99999/">詳細はこちら</a>
</li>
</ul>
</body></html>
`;

test('parseBunkaNewsSchedule extracts schedule items', () => {
  const results = _private.parseBunkaNewsSchedule(SCHEDULE_FIXTURE, 100, 'https://www.bunkanews.jp');
  assert.ok(results.length >= 3, `expected >= 3 items but got ${results.length}`);

  const first = results.find((r) => r.eventDate === '2026-03-10');
  assert.ok(first, 'should find 3/10 event');
  assert.ok(first.title.includes('三省堂書店'), `title should contain 三省堂書店: ${first.title}`);
  assert.ok(first.url.includes('/article/schedule/12345/'), `url should contain schedule link: ${first.url}`);

  const kobe = results.find((r) => r.eventDate === '2026-03-14');
  assert.ok(kobe, 'should find 3/14 event');
  assert.ok(kobe.title.includes('KOBE BOOK FAIR'), `title: ${kobe.title}`);
});

test('parseBunkaNewsSchedule handles events without links', () => {
  const results = _private.parseBunkaNewsSchedule(SCHEDULE_FIXTURE, 100, 'https://www.bunkanews.jp');
  const seminar = results.find((r) => r.eventDate === '2026-03-25');
  assert.ok(seminar, 'should find 3/25 event');
  assert.ok(seminar.url, 'should have a fallback url');
});

test('parseBunkaNewsSchedule parses across months', () => {
  const results = _private.parseBunkaNewsSchedule(SCHEDULE_FIXTURE, 100, 'https://www.bunkanews.jp');
  const april = results.find((r) => r.eventDate === '2026-04-21');
  assert.ok(april, 'should find April event');
  assert.ok(april.title.includes('トーハン'), `title: ${april.title}`);
});

test('filterScheduleByDateRange filters correctly', () => {
  const entries = [
    { eventDate: '2026-03-08', title: 'past' },
    { eventDate: '2026-03-10', title: 'today' },
    { eventDate: '2026-03-14', title: 'this week' },
    { eventDate: '2026-03-25', title: 'far future' },
  ];

  const filtered = _private.filterScheduleByDateRange(entries, '2026-03-10', '2026-03-17');
  assert.equal(filtered.length, 2);
  assert.equal(filtered[0].title, 'today');
  assert.equal(filtered[1].title, 'this week');
});
