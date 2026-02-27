const test = require('node:test');
const assert = require('node:assert/strict');

const { _private } = require('../src/sourceCollector');

test('parseAmazonRankingPage excludes USD price-only text and keeps title from alt', () => {
  const html = [
    '<a href="/dp/B000000001"><span>Book Alpha</span></a>',
    '<a href="/dp/B000000002"><span>Book Beta</span></a>',
    '<a href="/dp/B000000003"><span>USD 12.98</span></a>',
    '<a href="/dp/B000000003"><img alt="Book Gamma" src="https://m.media-amazon.com/images/I/example.jpg"></a>',
    '<a href="/dp/B000000004"><span>Book Delta</span></a>',
  ].join('');

  const entries = _private.parseAmazonRankingPage(html, 5);
  const titles = entries.map((entry) => entry.title);

  assert.equal(titles.includes('USD 12.98'), false);
  assert.equal(titles.includes('Book Gamma'), true);
  assert.deepEqual(titles.slice(0, 4), ['Book Alpha', 'Book Beta', 'Book Gamma', 'Book Delta']);
});

test('isLikelyPriceText detects common price formats', () => {
  assert.equal(_private.isLikelyPriceText('¥1,980'), true);
  assert.equal(_private.isLikelyPriceText('USD 12.98'), true);
  assert.equal(_private.isLikelyPriceText('10C Vol.7【表紙：MILK】'), false);
});
