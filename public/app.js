const state = {
  snapshot: null,
};

const refreshBtnEl = document.getElementById('refreshBtn');
const todaySummaryEl = document.getElementById('todaySummary');
const lastUpdatedEl = document.getElementById('lastUpdated');
const feedGridEl = document.getElementById('feedGrid');
const headlineAEl = document.getElementById('headlineA');
const headlineBEl = document.getElementById('headlineB');
const toastEl = document.getElementById('toast');

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
  const response = await fetch(path, {
    headers: {
      'Content-Type': 'application/json',
    },
    ...options,
  });

  const json = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(json.error || 'API request failed');
  }

  return json;
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
    return 'Mention';
  }
  return `Score ${value}`;
}

function buildTodaySummary(run) {
  if (!run) {
    return '今日の出版業界シグナルを準備しています。';
  }

  // GrokのeditorialSummaryがあればそれを優先して表示
  const editorial = run.payload?.editorialSummary || '';
  if (editorial) return editorial;

  // フォールバック：materialsの上位タイトルから生成
  const titles = (run.payload?.materials || [])
    .filter((item) => item.sourceCategory !== 'ranking')
    .slice(0, 2)
    .map((item) => item.title || '')
    .filter(Boolean);

  if (titles.length > 0) {
    return `${titles[0]}など、今日の出版業界の動向をお届けします。`;
  }

  const total = Number(run.payload?.materials?.length || 0);
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


function buildRankingCard(rankingItems, label) {
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

  // ヘッダー行（Kindle列は電子書籍バッジ付き）
  const headerCells = groupEntries
    .map((g) => {
      const badge = g.isDigital ? '<span class="digital-badge">電子</span>' : '';
      const cls = g.isDigital ? 'ranking-group-label ranking-group-digital' : 'ranking-group-label';
      return `<th class="${cls}" colspan="2">${escapeHtml(g.sourceName)}${badge}</th>`;
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
        return `<td class="rank-cell ${rankClass}">${rank}</td><td class="${titleCellClass}" data-url="${url}">${title}</td>`;
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

function renderFeed(run) {
  const materials = run?.payload?.materials || [];
  if (materials.length === 0) {
    feedGridEl.innerHTML = '<article class="empty-card">まだ最新情報がありません。Refreshで収集できます。</article>';
    return;
  }

  // ランキング / X投稿 / 記事に分類
  const rankingItems = materials.filter((item) => item.sourceCategory === 'ranking');
  const xItems = materials.filter((item) => item.sourceKind === 'x_grok');
  const articleItems = materials.filter((item) => item.sourceCategory !== 'ranking' && item.sourceKind !== 'x_grok');

  // ネット書店（Amazon + 楽天）vs 書店・取次ランキングに分割
  const netStoreItems = rankingItems.filter((item) => item.sourceName && (item.sourceName.includes('Amazon') || item.sourceName.includes('楽天')));
  const bookstoreItems = rankingItems.filter((item) => !item.sourceName || (!item.sourceName.includes('Amazon') && !item.sourceName.includes('楽天')));
  const rankingCardHtml = buildRankingCard(netStoreItems, 'ネット書店ランキング') + buildRankingCard(bookstoreItems, '書店・取次ランキング');

  // X投稿カード（左列）
  const xCardsHtml = xItems.map((item, index) => {
    const cardClass = `feed-card tone-${(index % 5) + 1}`;
    const source = escapeHtml(item.sourceName || 'Source');
    const metric = escapeHtml(formatMetric(item));
    const url = escapeHtml(item.url || '');
    const postText = escapeHtml(item.summary || item.title || '');
    return `
      <article class="${cardClass}" data-url="${url}">
        <div class="card-meta">
          <span class="meta-pill">${source}</span>
          <span class="meta-pill">${metric}</span>
        </div>
        <p class="card-summary">${postText}</p>
      </article>
    `;
  }).join('');

  // 記事カード（3列グリッド）
  const articleCardsHtml = articleItems.map((item, index) => {
    const cardClass = `feed-card tone-${(index % 5) + 1}`;
    const source = escapeHtml(item.sourceName || 'Source');
    const metric = escapeHtml(formatMetric(item));
    const published = formatDate(item.publishedAt);
    const url = escapeHtml(item.url || '');
    const publishedPill = published !== '-' ? `<span class="meta-pill">${escapeHtml(published)}</span>` : '';
    const title = escapeHtml(item.title || item.summary || 'Untitled');
    const summary = item.summary && item.summary !== item.title ? escapeHtml(item.summary) : '';
    return `
      <article class="${cardClass}" data-url="${url}">
        <div class="card-meta">
          <span class="meta-pill">${source}</span>
          <span class="meta-pill">${metric}</span>
          ${publishedPill}
        </div>
        <h2 class="card-title">${title}</h2>
        ${summary ? `<p class="card-summary">${summary}</p>` : ''}
      </article>
    `;
  }).join('');

  const xColHtml = xCardsHtml ? `<div class="feed-col-x">${xCardsHtml}</div>` : '';
  const articlesColHtml = articleCardsHtml ? `<div class="feed-col-articles">${articleCardsHtml}</div>` : '';
  const rankingsColHtml = rankingCardHtml ? `<div class="feed-col-right">${rankingCardHtml}</div>` : '';
  feedGridEl.innerHTML = xColHtml + articlesColHtml + rankingsColHtml;

  // カード全体クリックでURLを開く
  feedGridEl.querySelectorAll('.feed-card[data-url]').forEach((card) => {
    card.addEventListener('click', () => {
      const href = card.dataset.url;
      if (href) window.open(href, '_blank', 'noreferrer');
    });
  });

  // ランキングタイトルセルクリックでURLを開く（1行に本・Kindleが共存するためtd単位）
  feedGridEl.querySelectorAll('.rank-title-cell[data-url]').forEach((cell) => {
    cell.addEventListener('click', () => {
      const href = cell.dataset.url;
      if (href) window.open(href, '_blank', 'noreferrer');
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

  renderFeed(run);
}

async function loadSnapshot() {
  state.snapshot = await api('/api/snapshot');
}

async function refresh() {
  const originalText = refreshBtnEl.textContent;
  refreshBtnEl.disabled = true;
  refreshBtnEl.textContent = 'Refreshing...';

  try {
    await api('/api/run', {
      method: 'POST',
      body: JSON.stringify({}),
    });
    await loadSnapshot();
    render();
    notify('最新情報を更新しました');
  } catch (error) {
    notify(error.message, true);
  } finally {
    refreshBtnEl.disabled = false;
    refreshBtnEl.textContent = originalText;
  }
}

refreshBtnEl.addEventListener('click', () => {
  void refresh();
});

(async function init() {
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
(function initBgCanvas() {
  const canvas = document.getElementById('bgCanvas');
  if (!canvas) return;
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

  const ctx = canvas.getContext('2d');
  let width = 0;
  let height = 0;
  let time = 0;

  function resize() {
    width = window.innerWidth;
    height = window.innerHeight;
    canvas.width = width;
    canvas.height = height;
  }

  window.addEventListener('resize', resize);
  resize();

  function draw() {
    ctx.clearRect(0, 0, width, height);

    const gridSize = 10;
    const cols = Math.ceil(width / gridSize);
    const rows = Math.ceil(height / gridSize);
    const waveCenterY = rows * 0.58;
    const waveAmplitude = rows / 4;
    const frequency = 0.036;
    const speed = 0.011;

    for (let y = 0; y < rows; y++) {
      for (let x = 0; x < cols; x++) {
        const wave1 = Math.sin(x * frequency + time) * waveAmplitude;
        const wave2 = Math.cos(x * frequency * 0.5 - time) * (waveAmplitude * 0.4);
        const combinedWave = wave1 + wave2;
        const distFromWave = Math.abs(y - (waveCenterY + combinedWave));
        let intensity = Math.max(0, 1 - distFromWave / 12);
        intensity += (Math.random() - 0.5) * 0.07;

        const threshold = ditherThreshold(x, y);
        if (intensity + threshold > 0.5) {
          ctx.fillStyle = 'rgba(195, 162, 110, 0.18)';
          ctx.fillRect(x * gridSize, y * gridSize, gridSize - 1, gridSize - 1);
        }
      }
    }

    time += speed;
    requestAnimationFrame(draw);
  }

  draw();
})();

