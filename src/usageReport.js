'use strict';

function toDate(value) {
  if (!value) return null;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
  if (typeof value?.toDate === 'function') {
    const converted = value.toDate();
    return converted instanceof Date && !Number.isNaN(converted.getTime()) ? converted : null;
  }
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function toTokyoDateKey(value) {
  const date = toDate(value);
  if (!date) return '';
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Tokyo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

function increment(map, key, count = 1) {
  map.set(key, (map.get(key) || 0) + count);
}

function sortByCountThenName(entries) {
  return entries.sort((left, right) => {
    if (right.count !== left.count) return right.count - left.count;
    return String(left.name).localeCompare(String(right.name), 'ja');
  });
}

function buildUsageSummary(events, options = {}) {
  const lookbackDays = Math.max(1, Number(options.lookbackDays || 28));
  const now = toDate(options.now || new Date()) || new Date();
  const sevenDaysAgo = new Date(now.getTime() - (7 * 24 * 60 * 60 * 1000));

  const dailyStats = new Map();
  const users = new Map();
  const sourceClicks = new Map();
  const itemClicks = new Map();
  const activeUsers7d = new Set();
  const activeUsersLookback = new Set();

  let appViews = 0;
  let engagedViews = 0;
  let contentOpens = 0;

  for (const event of events) {
    const timestamp = toDate(event.timestamp);
    if (!timestamp) continue;

    const eventName = String(event.eventName || '').trim();
    const userEmail = String(event.userEmail || '').trim().toLowerCase();
    if (!eventName || !userEmail) continue;

    const dateKey = toTokyoDateKey(timestamp);
    if (!dateKey) continue;

    if (!dailyStats.has(dateKey)) {
      dailyStats.set(dateKey, {
        date: dateKey,
        appViews: 0,
        engagedViews: 0,
        contentOpens: 0,
        users: new Set(),
      });
    }
    const day = dailyStats.get(dateKey);
    day.users.add(userEmail);

    if (!users.has(userEmail)) {
      users.set(userEmail, {
        userEmail,
        activeDays: new Set(),
        appViews: 0,
        engagedViews: 0,
        contentOpens: 0,
        lastSeenAt: timestamp,
      });
    }
    const user = users.get(userEmail);
    user.activeDays.add(dateKey);
    if (timestamp > user.lastSeenAt) {
      user.lastSeenAt = timestamp;
    }

    activeUsersLookback.add(userEmail);
    if (timestamp >= sevenDaysAgo) {
      activeUsers7d.add(userEmail);
    }

    if (eventName === 'app_view') {
      appViews += 1;
      day.appViews += 1;
      user.appViews += 1;
    } else if (eventName === 'engaged_30s') {
      engagedViews += 1;
      day.engagedViews += 1;
      user.engagedViews += 1;
    } else if (eventName === 'content_open') {
      contentOpens += 1;
      day.contentOpens += 1;
      user.contentOpens += 1;

      const sourceName = String(event.sourceName || event.sourceCategory || 'Unknown').trim();
      if (sourceName) {
        increment(sourceClicks, sourceName);
      }

      const itemName = String(event.itemTitle || event.targetHost || event.targetUrl || 'Unknown').trim();
      if (itemName) {
        const itemKey = sourceName ? `${itemName} (${sourceName})` : itemName;
        increment(itemClicks, itemKey);
      }
    }
  }

  const topUsers = Array.from(users.values())
    .map((user) => ({
      userEmail: user.userEmail,
      activeDays: user.activeDays.size,
      appViews: user.appViews,
      engagedViews: user.engagedViews,
      contentOpens: user.contentOpens,
      lastSeenAt: user.lastSeenAt.toISOString(),
    }))
    .sort((left, right) => {
      if (right.appViews !== left.appViews) return right.appViews - left.appViews;
      if (right.contentOpens !== left.contentOpens) return right.contentOpens - left.contentOpens;
      return left.userEmail.localeCompare(right.userEmail, 'ja');
    });

  const topSources = sortByCountThenName(
    Array.from(sourceClicks.entries()).map(([name, count]) => ({ name, count })),
  );
  const topItems = sortByCountThenName(
    Array.from(itemClicks.entries()).map(([name, count]) => ({ name, count })),
  );

  const daily = Array.from(dailyStats.values())
    .map((day) => ({
      date: day.date,
      uniqueUsers: day.users.size,
      appViews: day.appViews,
      engagedViews: day.engagedViews,
      contentOpens: day.contentOpens,
    }))
    .sort((left, right) => left.date.localeCompare(right.date, 'ja'));

  const returningUsers = topUsers.filter((user) => user.activeDays >= 2).length;

  return {
    generatedAt: now.toISOString(),
    lookbackDays,
    totalEvents: appViews + engagedViews + contentOpens,
    uniqueUsersLookback: activeUsersLookback.size,
    uniqueUsers7d: activeUsers7d.size,
    returningUsers,
    appViews,
    engagedViews,
    contentOpens,
    engagementRate: appViews > 0 ? Number((engagedViews / appViews).toFixed(3)) : 0,
    clickRate: appViews > 0 ? Number((contentOpens / appViews).toFixed(3)) : 0,
    daily,
    topUsers,
    topSources,
    topItems,
  };
}

module.exports = {
  buildUsageSummary,
  toTokyoDateKey,
};
