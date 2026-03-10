'use strict';

const admin = require('firebase-admin');
const { buildUsageSummary } = require('../src/usageReport');

const DEFAULT_COLLECTION_PATH = 'usageEvents';
const DEFAULT_LOOKBACK_DAYS = 28;

function parseDaysArg(argv) {
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (value === '--days' && argv[index + 1]) {
      return Number(argv[index + 1]);
    }
    if (value.startsWith('--days=')) {
      return Number(value.slice('--days='.length));
    }
  }
  return DEFAULT_LOOKBACK_DAYS;
}

function parseServiceAccountFromEnv() {
  const raw = String(
    process.env.FIREBASE_SERVICE_ACCOUNT_JSON
    || process.env.FIREBASE_SERVICE_ACCOUNT_KEY
    || '',
  ).trim();

  if (!raw) {
    throw new Error('FIREBASE_SERVICE_ACCOUNT_JSON is required.');
  }

  let parsed = null;
  try {
    parsed = JSON.parse(raw);
  } catch {
    parsed = JSON.parse(Buffer.from(raw, 'base64').toString('utf8'));
  }

  if (typeof parsed.private_key === 'string') {
    parsed.private_key = parsed.private_key.replace(/\\n/g, '\n');
  }

  return parsed;
}

async function loadUsageEvents(db, collectionPath, startAt) {
  const snapshot = await db
    .collection(collectionPath)
    .where('timestamp', '>=', startAt)
    .get();

  return snapshot.docs.map((doc) => ({
    id: doc.id,
    ...doc.data(),
  }));
}

function printSection(title) {
  console.log('');
  console.log(title);
}

function printTopList(items, formatter) {
  if (items.length === 0) {
    console.log('- none');
    return;
  }
  items.forEach((item) => {
    console.log(`- ${formatter(item)}`);
  });
}

async function main() {
  const lookbackDays = Math.max(1, parseDaysArg(process.argv.slice(2)));
  const serviceAccount = parseServiceAccountFromEnv();

  if (!admin.apps.length) {
    admin.initializeApp({
      credential: admin.credential.cert(serviceAccount),
      projectId: serviceAccount.project_id,
    });
  }

  const db = admin.firestore();
  const collectionPath = String(process.env.FIREBASE_USAGE_COLLECTION_PATH || DEFAULT_COLLECTION_PATH).trim() || DEFAULT_COLLECTION_PATH;
  const now = new Date();
  const startAt = new Date(now.getTime() - (lookbackDays * 24 * 60 * 60 * 1000));
  const events = await loadUsageEvents(db, collectionPath, startAt);
  const summary = buildUsageSummary(events, { lookbackDays, now });

  console.log(`Usage report (${lookbackDays} days)`);
  console.log(`Generated at: ${summary.generatedAt}`);
  console.log(`Events loaded: ${events.length}`);
  console.log(`Users active in ${lookbackDays} days: ${summary.uniqueUsersLookback}`);
  console.log(`Users active in 7 days: ${summary.uniqueUsers7d}`);
  console.log(`Returning users: ${summary.returningUsers}`);
  console.log(`App views: ${summary.appViews}`);
  console.log(`Engaged 30s: ${summary.engagedViews}`);
  console.log(`Content opens: ${summary.contentOpens}`);
  console.log(`Engagement rate: ${(summary.engagementRate * 100).toFixed(1)}%`);
  console.log(`Click rate: ${(summary.clickRate * 100).toFixed(1)}%`);

  printSection('Top users');
  printTopList(summary.topUsers.slice(0, 10), (item) => (
    `${item.userEmail} | appViews=${item.appViews} | engaged=${item.engagedViews} | clicks=${item.contentOpens} | activeDays=${item.activeDays} | lastSeen=${item.lastSeenAt}`
  ));

  printSection('Top clicked sources');
  printTopList(summary.topSources.slice(0, 10), (item) => `${item.name} | clicks=${item.count}`);

  printSection('Top clicked items');
  printTopList(summary.topItems.slice(0, 10), (item) => `${item.name} | clicks=${item.count}`);

  printSection('Daily activity');
  printTopList(summary.daily, (item) => (
    `${item.date} | users=${item.uniqueUsers} | appViews=${item.appViews} | engaged=${item.engagedViews} | clicks=${item.contentOpens}`
  ));
}

main().catch((error) => {
  console.error('[usage-report]', error.message || error);
  process.exit(1);
});
