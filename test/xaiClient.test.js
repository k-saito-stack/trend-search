const test = require('node:test');
const assert = require('node:assert/strict');

const { parseGrokResponse, normalizeTrendData } = require('../src/xaiClient');

test('normalizeTrendData sorts materials by likes and limits to 10', () => {
  const data = normalizeTrendData({
    materials: Array.from({ length: 12 }).map((_, i) => ({
      url: `https://x.com/i/status/${i + 1}`,
      summary: `post ${i + 1}`,
      likes: i,
    })),
  });

  assert.equal(data.materials.length, 10);
  assert.equal(data.materials[0].likes, 11);
  assert.equal(data.materials[9].likes, 2);
});

test('parseGrokResponse parses assistant output_text JSON payload', () => {
  const raw = JSON.stringify({
    output: [
      {
        role: 'assistant',
        content: [
          {
            type: 'output_text',
            text: JSON.stringify({
              clusters: [
                {
                  name: 'Claude連携',
                  keyphrases: ['Claude Code', 'Figma連携'],
                  posts: [
                    {
                      url: 'https://x.com/i/status/123',
                      summary: '連携機能が話題',
                      likes: 120,
                    },
                  ],
                },
              ],
              themes: ['開発', 'AI'],
              materials: [
                {
                  url: 'https://x.com/i/status/123',
                  summary: '連携機能が話題',
                  likes: 120,
                },
              ],
            }),
          },
        ],
      },
    ],
  });

  const result = parseGrokResponse(raw);
  assert.equal(result.ok, true);
  assert.equal(result.data.clusters.length, 1);
  assert.equal(result.data.materials[0].likes, 120);
});

test('parseGrokResponse returns fallback when assistant text is not JSON', () => {
  const raw = JSON.stringify({
    output: [
      {
        role: 'assistant',
        content: [
          {
            type: 'output_text',
            text: 'これはJSONではありません',
          },
        ],
      },
    ],
  });

  const result = parseGrokResponse(raw);
  assert.equal(result.ok, false);
  assert.equal(result.data.clusters.length, 0);
  assert.match(result.rawText, /JSON/);
});
