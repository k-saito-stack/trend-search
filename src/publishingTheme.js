// 日本語の固定テーマ定数を一元管理するモジュール
// 文字化け発生時に「正本がどこか」を迷わないよう、ここだけを参照する

const FIXED_THEME_NAME = '出版業界と周辺業界';

const FIXED_THEME_QUERY_TERMS = [
  '出版業界',
  '周辺業界',
  '出版社',
  '書店',
  '新刊',
  '書評',
  'PR TIMES',
  '人事',
  '異動',
  'テレビ',
  'ラジオ',
  'ベストセラー',
  'Amazon',
  'Kindle',
];

const X_QUERY_INCLUDE_TERMS = [
  '出版社',
  '書店',
  '書評',
  '新刊',
  'ベストセラー',
  '重版',
  'オーディオブック',
];

const X_QUERY_EXCLUDE_TERMS = [
  '同人誌',
  'コミケ',
];

function buildFixedThemeQuery() {
  return FIXED_THEME_QUERY_TERMS.join(' ');
}

function buildPublishingXQuery(xSinceDate) {
  const include = X_QUERY_INCLUDE_TERMS.join(' OR ');
  const exclude = X_QUERY_EXCLUDE_TERMS.map((term) => `-${term}`).join(' ');
  const since = String(xSinceDate || '').trim();
  return `${include} ${exclude}${since ? ` since:${since}` : ''}`.trim();
}

function buildDisplayQueryWithSince(query, sinceDate) {
  const base = String(query || FIXED_THEME_NAME).trim();
  const since = String(sinceDate || '').trim();
  return since ? `${base} since:${since}` : base;
}

module.exports = {
  FIXED_THEME_NAME,
  FIXED_THEME_QUERY: buildFixedThemeQuery(),
  FIXED_THEME_QUERY_TERMS,
  X_QUERY_INCLUDE_TERMS,
  X_QUERY_EXCLUDE_TERMS,
  buildPublishingXQuery,
  buildDisplayQueryWithSince,
};
