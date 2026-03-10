const test = require('node:test');
const assert = require('node:assert/strict');

const { buildUsageSummary } = require('../src/usageReport');

test('buildUsageSummary aggregates users, engagement, and clicks', () => {
  const events = [
    {
      eventName: 'app_view',
      userEmail: 'a@example.com',
      timestamp: '2026-03-08T01:00:00.000Z',
    },
    {
      eventName: 'engaged_30s',
      userEmail: 'a@example.com',
      timestamp: '2026-03-08T01:00:40.000Z',
    },
    {
      eventName: 'content_open',
      userEmail: 'a@example.com',
      sourceName: 'Amazon',
      itemTitle: 'Book A',
      timestamp: '2026-03-08T01:02:00.000Z',
    },
    {
      eventName: 'app_view',
      userEmail: 'b@example.com',
      timestamp: '2026-03-09T02:00:00.000Z',
    },
    {
      eventName: 'content_open',
      userEmail: 'b@example.com',
      sourceName: 'Amazon',
      itemTitle: 'Book B',
      timestamp: '2026-03-09T02:10:00.000Z',
    },
    {
      eventName: 'app_view',
      userEmail: 'a@example.com',
      timestamp: '2026-03-10T00:00:00.000Z',
    },
  ];

  const summary = buildUsageSummary(events, {
    lookbackDays: 28,
    now: '2026-03-10T12:00:00.000Z',
  });

  assert.equal(summary.uniqueUsersLookback, 2);
  assert.equal(summary.uniqueUsers7d, 2);
  assert.equal(summary.returningUsers, 1);
  assert.equal(summary.appViews, 3);
  assert.equal(summary.engagedViews, 1);
  assert.equal(summary.contentOpens, 2);
  assert.equal(summary.topUsers[0].userEmail, 'a@example.com');
  assert.equal(summary.topUsers[0].activeDays, 2);
  assert.equal(summary.topSources[0].name, 'Amazon');
  assert.equal(summary.topSources[0].count, 2);
  assert.match(summary.topItems[0].name, /Book A|Book B/);
  assert.equal(summary.daily.length, 3);
});
