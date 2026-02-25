const state = {
  snapshot: null,
  isStaticMode: false,
};
const RUN_TOKEN_STORAGE_KEY = 'trend_atelier_run_token';

const refreshBtnEl = document.getElementById('refreshBtn');
const todaySummaryEl = document.getElementById('todaySummary');
const lastUpdatedEl = document.getElementById('lastUpdated');
const feedGridEl = document.getElementById('feedGrid');
const headlineAEl = document.getElementById('headlineA');
const headlineBEl = document.getElementById('headlineB');
const toastEl = document.getElementById('toast');
const progressBarEl = document.getElementById('progressBar');
const tokenModalEl = document.getElementById('tokenModal');
const tokenModalFormEl = document.getElementById('tokenModalForm');
const tokenModalInputEl = document.getElementById('tokenModalInput');
const tokenModalShowEl = document.getElementById('tokenModalShow');
const tokenModalMessageEl = document.getElementById('tokenModalMessage');
const tokenModalErrorEl = document.getElementById('tokenModalError');
const tokenModalCancelEl = document.getElementById('tokenModalCancel');

let tokenModalResolver = null;

function isTokenModalReady() {
  return Boolean(
    tokenModalEl
    && tokenModalFormEl
    && tokenModalInputEl
    && tokenModalShowEl
    && tokenModalMessageEl
    && tokenModalErrorEl
    && tokenModalCancelEl,
  );
}

// ===== プログレスバー =====
function showProgress() {
  progressBarEl.classList.add('running');
}

function hideProgress() {
  progressBarEl.classList.remove('running');
}

// ===== スケルトンローディング =====
function makeSkeleton(widths) {
  const lines = widths.map(w => `<div class="skeleton-line" style="width:${w}"></div>`).join('');
  return `<article class="skeleton-card">${lines}</article>`;
}

function showSkeletons() {
  const skeletons = [
    makeSkeleton(['55%', '90%', '80%', '65%']),
    makeSkeleton(['45%', '85%', '70%']),
    makeSkeleton(['60%', '80%', '72%']),
  ].join('');
  feedGridEl.innerHTML = `<div class="feed-col-articles">${skeletons}</div>`;
}

// ===== スクロールフェードイン =====
function initScrollAnimation() {
  const cards = feedGridEl.querySelectorAll('.feed-card');

  // アニメーション不要設定の場合は全カードを即表示
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
    cards.forEach(el => el.classList.add('visible'));
    return;
  }

  const observer = new IntersectionObserver((entries) => {
    entries.forEach(e => {
      if (e.isIntersecting) {
        e.target.classList.add('visible');
        observer.unobserve(e.target);
      }
    });
  }, { threshold: 0.08 });

  cards.forEach((el, i) => {
    el.style.transitionDelay = `${i * 55}ms`;
    observer.observe(el);
  });
}

function escapeHtml(text) {
  return String(text)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function notify(message, isError = false) {
  toastEl.textContent = message;
  toastEl.style.background = isError ? '#9f2f1d' : '#15253f';
  toastEl.classList.add('show');
  setTimeout(() => toastEl.classList.remove('show'), 2200);
}

async function api(path, options = {}) {
  const headers = {
    'Content-Type': 'application/json',
    ...(options.headers || {}),
  };

  const response = await fetch(path, {
    ...options,
    headers,
  });

  const json = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(json.error || 'API request failed');
    error.status = response.status;
    error.code = String(json.code || '');
    error.retryInMs = Number(json.retryInMs || 0);
    throw error;
  }

  return json;
}

function buildRunRequestHeaders() {
  const token = localStorage.getItem(RUN_TOKEN_STORAGE_KEY) || '';
  const headers = {
    'X-Requested-With': 'trend-atelier-web',
  };

  if (token) {
    headers['X-Run-Token'] = token;
  }

  return headers;
}

function closeTokenModal(result) {
  if (!isTokenModalReady()) {
    return;
  }
  if (typeof tokenModalResolver !== 'function') {
    return;
  }
  const resolve = tokenModalResolver;
  tokenModalResolver = null;
  tokenModalEl.hidden = true;
  document.body.classList.remove('modal-open');
  tokenModalInputEl.value = '';
  tokenModalInputEl.type = 'password';
  tokenModalShowEl.checked = false;
  tokenModalErrorEl.hidden = true;
  tokenModalErrorEl.textContent = '';
  resolve(result);
}

function openTokenModal(message = '', errorMessage = '') {
  if (!isTokenModalReady()) {
    const fallback = window.prompt(message || 'Run API token を入力してください。');
    return Promise.resolve(fallback);
  }

  return new Promise((resolve) => {
    tokenModalResolver = resolve;
    tokenModalMessageEl.textContent = message || '実行用トークンを入力してください。';
    tokenModalErrorEl.hidden = !errorMessage;
    tokenModalErrorEl.textContent = errorMessage || '';
    tokenModalEl.hidden = false;
    document.body.classList.add('modal-open');
    setTimeout(() => tokenModalInputEl.focus(), 0);
  });
}

async function requestRunToken(errorMessage = '') {
  const provided = await openTokenModal(
    'Run API token を入力してください。',
    errorMessage,
  );

  if (!provided || !provided.trim()) {
    throw new Error('認証トークン未入力のため実行を中止しました。');
  }

  const token = provided.trim();
  localStorage.setItem(RUN_TOKEN_STORAGE_KEY, token);
  return token;
}

function isSafeHttpUrl(href) {
  try {
    const parsed = new URL(String(href || ''), window.location.href);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
}

function openExternalUrl(href) {
  if (!isSafeHttpUrl(href)) {
    notify('不正なURLをブロックしました', true);
    return;
  }
  window.open(href, '_blank', 'noreferrer');
}

function normalizeRunError(error) {
  if (error.code === 'RUN_ALREADY_RUNNING') {
    return new Error('現在収集中です。完了してから再実行してください。');
  }

  if (error.code === 'RUN_RATE_LIMITED') {
    const waitSec = Math.max(1, Math.ceil(Number(error.retryInMs || 0) / 1000));
    return new Error(`実行間隔が短すぎます。${waitSec}秒後に再試行してください。`);
  }

  return error;
}

async function triggerRunWithAuth() {
  const executeRun = () => api('/api/run', {
    method: 'POST',
    headers: buildRunRequestHeaders(),
    body: JSON.stringify({}),
  });

  try {
    return await executeRun();
  } catch (error) {
    if (error.code !== 'RUN_AUTH_REQUIRED') {
      throw normalizeRunError(error);
    }
  }

  await requestRunToken();

  try {
    return await executeRun();
  } catch (retryError) {
    if (retryError.code !== 'RUN_AUTH_REQUIRED') {
      throw normalizeRunError(retryError);
    }
  }

  localStorage.removeItem(RUN_TOKEN_STORAGE_KEY);
  await requestRunToken('認証トークンが不正です。もう一度入力してください。');

  try {
    return await executeRun();
  } catch (lastError) {
    if (lastError.code === 'RUN_AUTH_REQUIRED') {
      localStorage.removeItem(RUN_TOKEN_STORAGE_KEY);
      throw new Error('認証トークンが不正です。');
    }
    throw normalizeRunError(lastError);
  }
}

if (isTokenModalReady()) {
  tokenModalFormEl.addEventListener('submit', (event) => {
    event.preventDefault();
    const value = tokenModalInputEl.value.trim();
    if (!value) {
      tokenModalErrorEl.hidden = false;
      tokenModalErrorEl.textContent = 'トークンを入力してください。';
      tokenModalInputEl.focus();
      return;
    }
    closeTokenModal(value);
  });

  tokenModalCancelEl.addEventListener('click', () => {
    closeTokenModal(null);
  });

  tokenModalEl.addEventListener('click', (event) => {
    if (event.target === tokenModalEl) {
      closeTokenModal(null);
    }
  });

  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && !tokenModalEl.hidden) {
      closeTokenModal(null);
    }
  });

  tokenModalShowEl.addEventListener('change', () => {
    tokenModalInputEl.type = tokenModalShowEl.checked ? 'text' : 'password';
  });
}

function formatDate(isoDate) {
  if (!isoDate) return '-';
  const date = new Date(isoDate);
  if (Number.isNaN(date.getTime())) return '-';
  return date.toLocaleString('ja-JP', {
    timeZone: 'Asia/Tokyo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function formatMetric(item) {
  const label = String(item.metricLabel || '').toLowerCase();
  const value = Number(item.metricValue || 0);

  if (label === 'likes') {
    return `Likes ${value.toLocaleString('ja-JP')}`;
  }
  if (label === 'rank') {
    return `Rank #${value || '-'}`;
  }
  if (label === 'mentions') {
    return '';
  }
  return `Score ${value}`;
}

function buildTodaySummary(run) {
  if (!run) {
    return '今日の出版業界シグナルを準備しています。';
  }

  const materials = run.payload?.materials || [];

  // Amazon総合ランキング1位
  const amazonTop = materials.find(
    (m) => (m.sourceKind === 'amazon_ranking' || m.sourceKind === 'amazon_bestseller') && Number(m.metricValue) === 1,
  );

  // X投稿：いいね数最多
  const topX = materials
    .filter((m) => m.sourceKind === 'x_grok')
    .sort((a, b) => Number(b.metricValue || 0) - Number(a.metricValue || 0))[0];

  const parts = [];
  if (amazonTop?.title) {
    const t = amazonTop.title.length > 20 ? amazonTop.title.slice(0, 20) + '…' : amazonTop.title;
    parts.push(`Amazon総合1位「${t}」`);
  }
  if (topX?.title) {
    const t = topX.title.length > 22 ? topX.title.slice(0, 22) + '…' : topX.title;
    parts.push(`X話題「${t}」`);
  }

  if (parts.length > 0) {
    return parts.join('、') + 'など、今日の出版業界をまとめました。';
  }

  // フォールバック：ランキング・セール以外の最初のタイトル
  const first = materials.find(
    (m) => m.sourceCategory !== 'ranking' && m.sourceCategory !== 'deals',
  );
  if (first?.title) {
    const t = first.title.length > 30 ? first.title.slice(0, 30) + '…' : first.title;
    return `${t}など、今日の出版業界をお届けします。`;
  }

  const total = Number(materials.length || 0);
  return `今日は${total}件の出版業界シグナルを収集しました。`;
}

function buildHeadline(run) {
  const titles = (run?.payload?.materials || [])
    .slice(0, 8)
    .map((item) => item.title || item.summary || '')
    .map((text) => String(text).trim())
    .filter(Boolean);

  if (titles.length === 0) {
    return 'Publishing Signals • News / Reviews / Rankings / PR / Personnel / Broadcast •';
  }

  return `${titles.join(' • ')} •`;
}


function formatFetchedAt(isoDate) {
  if (!isoDate) return '';
  const fetched = new Date(isoDate);
  if (Number.isNaN(fetched.getTime())) return '';
  const today = new Date();
  const tokyoFetched = new Date(fetched.toLocaleString('en-US', { timeZone: 'Asia/Tokyo' }));
  const tokyoToday = new Date(today.toLocaleString('en-US', { timeZone: 'Asia/Tokyo' }));
  // 当日データなら表示しない
  if (tokyoFetched.getFullYear() === tokyoToday.getFullYear() &&
      tokyoFetched.getMonth() === tokyoToday.getMonth() &&
      tokyoFetched.getDate() === tokyoToday.getDate()) {
    return '';
  }
  const m = tokyoFetched.getMonth() + 1;
  const d = tokyoFetched.getDate();
  return `${m}/${d}取得`;
}

function buildRankingCard(rankingItems, label, sourceFetchedAt) {
  if (rankingItems.length === 0) return '';

  // ソース名ごとにグループ化してソート
  const groups = new Map();
  for (const item of rankingItems) {
    const key = item.sourceName || 'ランキング';
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(item);
  }
  const groupEntries = Array.from(groups.entries()).map(([sourceName, items]) => ({
    sourceName,
    sourceId: items[0]?.sourceId || '',
    isDigital: /kindle|電子書籍/i.test(sourceName),
    items: items.sort((a, b) => Number(a.metricValue || 0) - Number(b.metricValue || 0)).slice(0, 10),
  }));

  const maxRows = Math.max(...groupEntries.map((g) => g.items.length), 0);

  // colgroup: rank列は固定幅、title列は等幅で自動分配（table-layout:fixedと組み合わせ）
  const colgroupCols = groupEntries.flatMap((g, i) => {
    const cols = ['<col class="ranking-col-rank">', `<col class="ranking-col-title${g.isDigital ? ' ranking-col-digital' : ''}">`];
    if (i < groupEntries.length - 1) cols.push('<col class="ranking-col-divider">');
    return cols;
  }).join('');

  // ヘッダー行（Kindle列は電子書籍バッジ付き + 最終取得日）
  const headerCells = groupEntries
    .map((g) => {
      const badge = g.isDigital ? '<span class="digital-badge">電子</span>' : '';
      const fetchedLabel = formatFetchedAt((sourceFetchedAt || {})[g.sourceId]);
      const fetchedHtml = fetchedLabel ? `<span class="fetched-at">${escapeHtml(fetchedLabel)}</span>` : '';
      const cls = g.isDigital ? 'ranking-group-label ranking-group-digital' : 'ranking-group-label';
      return `<th class="${cls}" colspan="2">${escapeHtml(g.sourceName)}${badge}${fetchedHtml}</th>`;
    })
    .join('<th class="ranking-col-divider"></th>');

  // データ行：各グループを同じ<tr>に並べて行の高さを揃える
  const bodyRows = Array.from({ length: maxRows }, (_, i) => {
    const cells = groupEntries
      .map((g) => {
        const item = g.items[i];
        const titleCellClass = `rank-title-cell${g.isDigital ? ' rank-title-digital' : ''}`;
        if (!item) return `<td></td><td class="${titleCellClass}"></td>`;
        const rank = Number(item.metricValue || 0);
        const title = escapeHtml(item.title || '');
        const url = escapeHtml(item.url || '');
        const rankClass = rank === 1 ? 'rank-gold' : rank === 2 ? 'rank-silver' : rank === 3 ? 'rank-bronze' : '';
        const rankCellClass = `rank-cell ${rankClass}${g.isDigital ? ' rank-cell-digital' : ''}`.trim();
        return `<td class="${rankCellClass}" data-url="${url}">${rank}</td><td class="${titleCellClass}" data-url="${url}">${title}</td>`;
      })
      .join('<td class="ranking-col-divider"></td>');
    return `<tr class="ranking-row">${cells}</tr>`;
  }).join('');

  return `
    <article class="feed-card ranking-card">
      <div class="card-meta">
        <span class="meta-pill ranking-pill">${escapeHtml(label || 'ランキング')}</span>
      </div>
      <table class="ranking-table">
        <colgroup>${colgroupCols}</colgroup>
        <thead><tr>${headerCells}</tr></thead>
        <tbody>${bodyRows}</tbody>
      </table>
    </article>
  `;
}

function buildDealsCard(dealsItems, sourceFetchedAt) {
  if (dealsItems.length === 0) return '';

  // 最終取得日（dealsItemsの最初のアイテムのsourceIdから取得）
  const sourceId = dealsItems[0]?.sourceId || '';
  const fetchedLabel = formatFetchedAt((sourceFetchedAt || {})[sourceId]);
  const fetchedHtml = fetchedLabel ? `<span class="fetched-at">${escapeHtml(fetchedLabel)}</span>` : '';

  // 3列グリッドで表示
  const cols = 3;
  const rows = [];
  for (let i = 0; i < dealsItems.length; i += cols) {
    const cells = [];
    for (let c = 0; c < cols; c++) {
      const item = dealsItems[i + c];
      if (item) {
        const url = escapeHtml(item.url || '');
        const title = escapeHtml(item.title || '');
        cells.push(`<td class="deals-title-cell" data-url="${url}">${title}</td>`);
      } else {
        cells.push('<td class="deals-title-cell"></td>');
      }
    }
    rows.push(`<tr>${cells.join('')}</tr>`);
  }

  return `
    <article class="feed-card deals-card">
      <div class="card-meta">
        <span class="meta-pill deals-pill">Kindle 日替わりセール</span>${fetchedHtml}
      </div>
      <table class="deals-table">
        <tbody>${rows.join('')}</tbody>
      </table>
    </article>
  `;
}

function renderFeed(run) {
  const materials = run?.payload?.materials || [];
  const sourceFetchedAt = state.snapshot?.sourceFetchedAt || {};

  if (materials.length === 0) {
    feedGridEl.innerHTML = '<article class="empty-card">まだ最新情報がありません。Refreshで収集できます。</article>';
    return;
  }

  // ランキング / deals / それ以外に分類（X投稿と記事を統合）
  const rankingItems = materials.filter((item) => item.sourceCategory === 'ranking');
  const dealsItems = materials.filter((item) => item.sourceCategory === 'deals');
  const nonRankingItems = materials.filter((item) => item.sourceCategory !== 'ranking' && item.sourceCategory !== 'deals');

  // ネット書店（Amazon + 楽天）vs 書店・取次ランキングに分割
  const netStoreItems = rankingItems.filter((item) => item.sourceName && (item.sourceName.includes('Amazon') || item.sourceName.includes('楽天')));
  const bookstoreItems = rankingItems.filter((item) => !item.sourceName || (!item.sourceName.includes('Amazon') && !item.sourceName.includes('楽天')));
  const rankingCardHtml = buildRankingCard(netStoreItems, 'ネット書店ランキング', sourceFetchedAt) + buildRankingCard(bookstoreItems, '書店・取次ランキング', sourceFetchedAt);

  // X投稿・記事を統合して3列グリッドにカード化
  const allCardsHtml = nonRankingItems.map((item, index) => {
    const isX = item.sourceKind === 'x_grok';
    const cardClass = `feed-card tone-${(index % 5) + 1}`;
    const source = escapeHtml(item.sourceName || 'Source');
    const metric = escapeHtml(formatMetric(item));
    const published = !isX ? formatDate(item.publishedAt) : '-';
    const url = escapeHtml(item.url || '');
    const publishedPill = published !== '-' ? `<span class="meta-pill">${escapeHtml(published)}</span>` : '';
    const metricPill = metric ? `<span class="meta-pill">${metric}</span>` : '';
    // X投稿はタイトルなし（投稿本文をsummaryとして表示）、記事はタイトル+summary
    const title = !isX ? escapeHtml(item.title || item.summary || 'Untitled') : '';
    const summary = isX
      ? escapeHtml(item.summary || item.title || '')
      : (item.summary && item.summary !== item.title ? escapeHtml(item.summary) : '');
    return `
      <article class="${cardClass}" data-url="${url}">
        <div class="card-meta">
          <span class="meta-pill">${source}</span>
          ${metricPill}
          ${publishedPill}
        </div>
        ${title ? `<h2 class="card-title">${title}</h2>` : ''}
        ${summary ? `<p class="${isX ? 'card-title' : 'card-summary'}">${summary}</p>` : ''}
      </article>
    `;
  }).join('');

  const dealsCardHtml = buildDealsCard(dealsItems, sourceFetchedAt);

  const articlesColHtml = allCardsHtml ? `<div class="feed-col-articles">${allCardsHtml}</div>` : '';
  const rankingsColHtml = rankingCardHtml ? `<div class="feed-col-right">${rankingCardHtml}</div>` : '';
  const dealsColHtml = dealsCardHtml ? `<div class="feed-col-deals">${dealsCardHtml}</div>` : '';
  feedGridEl.innerHTML = articlesColHtml + rankingsColHtml + dealsColHtml;

  // スクロールフェードインを初期化
  initScrollAnimation();

  // カード全体クリックでURLを開く
  feedGridEl.querySelectorAll('.feed-card[data-url]').forEach((card) => {
    card.addEventListener('click', () => {
      const href = card.dataset.url;
      if (href) openExternalUrl(href);
    });
  });

  // ランキングセル（タイトル・数字）クリックでURLを開く
  feedGridEl.querySelectorAll('.rank-title-cell[data-url], .rank-cell[data-url]').forEach((cell) => {
    cell.addEventListener('click', () => {
      const href = cell.dataset.url;
      if (href) openExternalUrl(href);
    });
  });

  // deals セルクリックでURLを開く
  feedGridEl.querySelectorAll('.deals-title-cell[data-url]').forEach((cell) => {
    cell.addEventListener('click', () => {
      const href = cell.dataset.url;
      if (href) openExternalUrl(href);
    });
  });
}

function render() {
  const run = state.snapshot?.latestRun || null;

  todaySummaryEl.textContent = buildTodaySummary(run);
  const tickerText = buildHeadline(run);
  headlineAEl.textContent = tickerText;
  headlineBEl.textContent = tickerText;

  lastUpdatedEl.textContent = run ? `最終更新: ${formatDate(run.createdAt)}` : '';

  // 静的モード（GitHub Pages）ではRefreshボタンを隠す
  if (refreshBtnEl) {
    refreshBtnEl.style.display = state.isStaticMode ? 'none' : '';
  }

  renderFeed(run);
}

async function loadSnapshot() {
  // まず snapshot.json を試みる（GitHub Pages静的モード）
  try {
    const res = await fetch('snapshot.json');
    if (res.ok) {
      state.snapshot = await res.json();
      state.isStaticMode = true;
      return;
    }
  } catch (_) {
    // fallthrough to API mode
  }
  // 失敗したら /api/snapshot へ（ローカルAPIモード）
  state.snapshot = await api('/api/snapshot');
  state.isStaticMode = false;
}

async function refresh() {
  const originalText = refreshBtnEl.textContent;
  refreshBtnEl.disabled = true;
  refreshBtnEl.textContent = 'Refreshing...';
  showProgress();

  try {
    await triggerRunWithAuth();
    await loadSnapshot();
    render();
    notify('最新情報を更新しました');
  } catch (error) {
    notify(error.message, true);
  } finally {
    hideProgress();
    refreshBtnEl.disabled = false;
    refreshBtnEl.textContent = originalText;
  }
}

refreshBtnEl.addEventListener('click', () => {
  void refresh();
});

(async function init() {
  showSkeletons();
  try {
    await loadSnapshot();
    render();
  } catch (error) {
    notify(error.message, true);
  }
})();

// ディザリング共通ユーティリティ
const bayerMatrix = [
  [0, 8, 2, 10],
  [12, 4, 14, 6],
  [3, 11, 1, 9],
  [15, 7, 13, 5],
];
function ditherThreshold(x, y) {
  return (bayerMatrix[y % 4][x % 4] / 16) - 0.5;
}

// ページ背景のディザー波アニメーション
function createOneOverFNoise() {
  const bands = [
    { cutoffHz: 0.9, weight: 0.32, state: 0 },
    { cutoffHz: 0.45, weight: 0.27, state: 0 },
    { cutoffHz: 0.22, weight: 0.21, state: 0 },
    { cutoffHz: 0.11, weight: 0.14, state: 0 },
    { cutoffHz: 0.055, weight: 0.06, state: 0 },
  ];
  let normalizer = 1;

  return {
    sample(dtSec) {
      let total = 0;
      let weightSum = 0;

      for (const band of bands) {
        const alpha = 1 - Math.exp(-2 * Math.PI * band.cutoffHz * dtSec);
        const white = Math.random() * 2 - 1;
        band.state += alpha * (white - band.state);
        total += band.state * band.weight;
        weightSum += band.weight;
      }

      const combined = total / Math.max(weightSum, 0.000001);
      normalizer = Math.max(normalizer * 0.995, Math.abs(combined), 0.35);
      return Math.max(-1, Math.min(1, combined / normalizer));
    },
  };
}

// Canvas background animation
(function initBgCanvas() {
  const canvas = document.getElementById('bgCanvas');
  if (!canvas) return;
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

  const ctx = canvas.getContext('2d');
  if (!ctx) return;

  let width = 0;
  let height = 0;
  const wavePeriodSec = 10;
  const waveAngularSpeed = (Math.PI * 2) / wavePeriodSec;
  const flicker = createOneOverFNoise();
  let phase = 0;
  let lastTs = performance.now();

  function resize() {
    width = window.innerWidth;
    height = window.innerHeight;
    canvas.width = width;
    canvas.height = height;
  }

  window.addEventListener('resize', resize);
  resize();

  function draw(ts) {
    const dtSec = Math.min(0.05, Math.max(1 / 240, (ts - lastTs) / 1000));
    lastTs = ts;
    phase += waveAngularSpeed * dtSec;

    const flickerValue = flicker.sample(dtSec);
    const amplitudeScale = 1 + flickerValue * 0.18;
    const intensityOffset = flickerValue * 0.045;

    ctx.clearRect(0, 0, width, height);

    const gridSize = 10;
    const cols = Math.ceil(width / gridSize);
    const rows = Math.ceil(height / gridSize);
    const waveCenterY = rows * 0.58;
    const baseAmplitude = rows / 4;
    const waveAmplitude = baseAmplitude * amplitudeScale;
    const frequency = 0.036;
    const secondaryPhase = phase * 0.86;

    for (let y = 0; y < rows; y++) {
      for (let x = 0; x < cols; x++) {
        const wave1 = Math.sin(x * frequency + phase) * waveAmplitude;
        const wave2 = Math.cos(x * frequency * 0.5 - secondaryPhase) * (baseAmplitude * 0.42 * amplitudeScale);
        const combinedWave = wave1 + wave2;
        const distFromWave = Math.abs(y - (waveCenterY + combinedWave));
        let intensity = Math.max(0, 1 - distFromWave / 12);
        const localDrift = Math.sin((x * 0.31 + y * 0.17) + phase * 0.35) * 0.035;
        intensity += localDrift + intensityOffset;

        const threshold = ditherThreshold(x, y);
        if (intensity + threshold > 0.5) {
          ctx.fillStyle = 'rgba(195, 162, 110, 0.18)';
          ctx.fillRect(x * gridSize, y * gridSize, gridSize - 1, gridSize - 1);
        }
      }
    }

    requestAnimationFrame(draw);
  }

  requestAnimationFrame(draw);
})();
