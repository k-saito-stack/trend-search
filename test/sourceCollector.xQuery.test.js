const test = require('node:test');
const assert = require('node:assert/strict');

const { _private } = require('../src/sourceCollector');

test('buildXQuery contains required terms', () => {
  const query = _private.buildXQuery();

  assert.ok(query.includes('書店'), 'missing 書店');
  assert.ok(query.includes('オーディオブック'), 'missing オーディオブック');
  assert.ok(query.includes('Audible'), 'missing Audible');
  assert.ok(query.includes('audiobook.jp'), 'missing audiobook.jp');
  assert.ok(query.includes('-同人誌'), 'missing -同人誌');
  assert.ok(query.includes('-コミケ'), 'missing -コミケ');
  assert.ok(query.includes('since:'), 'missing since:');
});

test('buildXQuery uses OR syntax', () => {
  const query = _private.buildXQuery();
  assert.ok(query.includes(' OR '), 'missing OR syntax');
});
