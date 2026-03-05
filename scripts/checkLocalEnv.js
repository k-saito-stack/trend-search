#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');

const repoRoot = process.cwd();
const targets = ['.env', '.env.example'];
const found = targets.filter((name) => fs.existsSync(path.join(repoRoot, name)));
const shouldFix = process.argv.includes('--fix');

if (found.length === 0) {
  process.exit(0);
}

process.stderr.write('\n');
process.stderr.write('[重要] このリポジトリでは .env / .env.example を使いません。\n');
process.stderr.write('GitHub Secrets を使う運用に統一しています。\n');
process.stderr.write(`検出: ${found.join(', ')}\n`);

if (shouldFix) {
  for (const name of found) {
    fs.rmSync(path.join(repoRoot, name), { force: true });
    process.stderr.write(`削除: ${name}\n`);
  }
  process.stderr.write('削除が完了しました。\n');
  process.exit(0);
}

process.stderr.write('対応: npm run doctor:local\n');
process.stderr.write('手動: rm -f .env .env.example\n');
process.stderr.write('詳細: LOCAL_ENV_POLICY.md\n');
process.exit(1);
