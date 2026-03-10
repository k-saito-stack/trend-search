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
