const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { TextDecoder } = require('node:util');
const { FIXED_THEME_QUERY } = require('../src/publishingTheme');

const decoder = new TextDecoder('utf-8', { fatal: true });
const targets = [
  'src/sourceCollector.js',
  'src/sourceCatalog.js',
  'src/storage.js',
  'src/xaiClient.js',
  'src/signalDigest.js',
  'src/publishingTheme.js',
  'README.md',
  'MANUAL.md',
];

test('tracked text files are valid UTF-8 and contain no replacement char', () => {
  for (const relative of targets) {
    const full = path.resolve(__dirname, '..', relative);
    const buffer = fs.readFileSync(full);
    assert.doesNotThrow(() => decoder.decode(buffer), `${relative} is not valid UTF-8`);
    const text = buffer.toString('utf8');
    assert.equal(text.includes('\uFFFD'), false, `${relative} contains replacement char`);
  }
});

test('fixed theme query stays canonical', () => {
  assert.equal(
    FIXED_THEME_QUERY,
    '出版業界 周辺業界 出版社 書店 新刊 書評 PR TIMES 人事 異動 テレビ ラジオ ベストセラー Amazon Kindle',
  );
});
