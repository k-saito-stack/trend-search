const path = require('node:path');
const fs = require('node:fs');
const admin = require('firebase-admin');

function isValidFirestoreDocPath(docPath) {
  const parts = String(docPath || '').split('/').filter(Boolean);
  return parts.length >= 2 && parts.length % 2 === 0;
}

function parseServiceAccountFromEnv() {
  const raw = String(
    process.env.FIREBASE_SERVICE_ACCOUNT_JSON
    || process.env.FIREBASE_SERVICE_ACCOUNT_KEY
    || '',
  ).trim();

  if (!raw) {
    throw new Error('FIREBASE_SERVICE_ACCOUNT_JSON が未設定です。');
  }

  let parsed = null;
  try {
    parsed = JSON.parse(raw);
  } catch {
    // Secretにbase64を登録した場合も受けられるようにする
    const decoded = Buffer.from(raw, 'base64').toString('utf8');
    parsed = JSON.parse(decoded);
  }

  if (!parsed || typeof parsed !== 'object') {
    throw new Error('サービスアカウントJSONの形式が不正です。');
  }

  if (typeof parsed.private_key === 'string') {
    parsed.private_key = parsed.private_key.replace(/\\n/g, '\n');
  }

  const missing = ['project_id', 'client_email', 'private_key'].filter((key) => !parsed[key]);
  if (missing.length > 0) {
    throw new Error(`サービスアカウントJSONに必須項目が不足しています: ${missing.join(', ')}`);
  }

  return parsed;
}

function readSnapshotFile() {
  const snapshotPath = path.resolve(process.cwd(), process.env.SNAPSHOT_FILE || 'public/snapshot.json');
  if (!fs.existsSync(snapshotPath)) {
    throw new Error(`snapshotファイルが見つかりません: ${snapshotPath}`);
  }
  const raw = fs.readFileSync(snapshotPath, 'utf8');
  const parsed = JSON.parse(raw);
  if (!parsed || typeof parsed !== 'object') {
    throw new Error('snapshotファイルのJSON形式が不正です。');
  }
  return parsed;
}

async function main() {
  const serviceAccount = parseServiceAccountFromEnv();
  const snapshot = readSnapshotFile();

  const docPath = String(process.env.FIREBASE_SNAPSHOT_DOC_PATH || 'snapshots/latest').trim();
  if (!isValidFirestoreDocPath(docPath)) {
    throw new Error(`FIREBASE_SNAPSHOT_DOC_PATH が不正です: ${docPath}`);
  }

  if (!admin.apps.length) {
    admin.initializeApp({
      credential: admin.credential.cert(serviceAccount),
      projectId: serviceAccount.project_id,
    });
  }

  const db = admin.firestore();
  const payload = {
    ...snapshot,
    publishedAt: new Date().toISOString(),
  };

  await db.doc(docPath).set(payload, { merge: true });
  console.log(`[firestore] snapshot を公開しました: ${docPath}`);
}

main().catch((error) => {
  console.error('[firestore] 公開失敗:', error.message || error);
  process.exit(1);
});
