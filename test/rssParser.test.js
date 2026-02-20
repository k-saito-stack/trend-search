const test = require('node:test');
const assert = require('node:assert/strict');

const { parseRssFeed } = require('../src/rssParser');

test('parseRssFeed parses RSS item blocks', () => {
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
    <rss version="2.0">
      <channel>
        <item>
          <title><![CDATA[出版ニュース]]></title>
          <link>https://example.com/news/1</link>
          <description><![CDATA[<p>新刊情報です</p>]]></description>
          <pubDate>Fri, 20 Feb 2026 09:00:00 GMT</pubDate>
        </item>
      </channel>
    </rss>`;

  const items = parseRssFeed(xml);
  assert.equal(items.length, 1);
  assert.equal(items[0].title, '出版ニュース');
  assert.equal(items[0].link, 'https://example.com/news/1');
  assert.equal(items[0].summary, '新刊情報です');
});

test('parseRssFeed parses Atom entry blocks', () => {
  const xml = `<?xml version="1.0" encoding="utf-8"?>
    <feed xmlns="http://www.w3.org/2005/Atom">
      <entry>
        <title>書評まとめ</title>
        <link href="https://example.com/review/2"/>
        <summary>注目の書評</summary>
        <updated>2026-02-20T10:00:00Z</updated>
      </entry>
    </feed>`;

  const items = parseRssFeed(xml);
  assert.equal(items.length, 1);
  assert.equal(items[0].title, '書評まとめ');
  assert.equal(items[0].link, 'https://example.com/review/2');
  assert.equal(items[0].summary, '注目の書評');
});
