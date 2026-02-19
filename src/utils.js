const crypto = require('node:crypto');

function createId(prefix) {
  return `${prefix}_${Date.now().toString(36)}_${crypto.randomBytes(4).toString('hex')}`;
}

function getJstParts(date = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Tokyo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).formatToParts(date);

  const map = {};
  for (const part of parts) {
    map[part.type] = part.value;
  }

  return {
    year: map.year,
    month: map.month,
    day: map.day,
    hour: map.hour,
    minute: map.minute,
    second: map.second,
    date: `${map.year}-${map.month}-${map.day}`,
    time: `${map.hour}:${map.minute}:${map.second}`,
  };
}

function getSinceDate(days) {
  const safeDays = Number.isFinite(days) ? Math.max(1, Math.floor(days)) : 2;
  const ms = safeDays * 24 * 60 * 60 * 1000;
  return getJstParts(new Date(Date.now() - ms)).date;
}

function getPeriodLabel(days) {
  if (days === 1) return '直近1日';
  if (days === 7) return '直近1週間';
  if (days === 30) return '直近1ヶ月';
  if (days === 365) return '直近1年';
  return `直近${days}日`;
}

function ensureArray(value) {
  return Array.isArray(value) ? value : [];
}

module.exports = {
  createId,
  getJstParts,
  getSinceDate,
  getPeriodLabel,
  ensureArray,
};
