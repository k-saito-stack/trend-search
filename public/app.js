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


function buildRankingCard(rankingItems) {
  if (rankingItems.length === 0) return '';

  // ソース名ごとにグループ化
  const groups = new Map();
  for (const item of rankingItems) {
    const key = item.sourceName || 'Amazonランキング';
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(item);
  }

  const tables = Array.from(groups.entries())
    .map(([sourceName, items]) => {
      const rows = items
        .sort((a, b) => Number(a.metricValue || 0) - Number(b.metricValue || 0))
        .slice(0, 10)
        .map((item) => {
          const rank = Number(item.metricValue || 0);
          const title = escapeHtml(item.title || '');
          const url = escapeHtml(item.url || '');
          const rankClass = rank === 1 ? 'rank-gold' : rank === 2 ? 'rank-silver' : rank === 3 ? 'rank-bronze' : '';
          return `
            <tr>
              <td class="rank-cell ${rankClass}">${rank}</td>
              <td class="rank-title-cell"><a href="${url}" target="_blank" rel="noreferrer">${title}</a></td>
            </tr>
          `;
        })
        .join('');

      return `
        <div class="ranking-group">
          <p class="ranking-group-label">${escapeHtml(sourceName)}</p>
          <table class="ranking-table">
            <tbody>${rows}</tbody>
          </table>
        </div>
      `;
    })
    .join('');

  return `
    <article class="feed-card ranking-card">
      <div class="card-meta">
        <span class="meta-pill ranking-pill">Amazonランキング</span>
      </div>
      <h2 class="card-title ranking-card-title">本のベストセラー</h2>
      ${tables}
    </article>
  `;
}

function renderFeed(run) {
  const materials = run?.payload?.materials || [];
  if (materials.length === 0) {
    feedGridEl.innerHTML = '<article class="empty-card">まだ最新情報がありません。Refreshで収集できます。</article>';
    return;
  }

  // ランキングアイテムと通常アイテムを分離
  const rankingItems = materials.filter((item) => item.sourceCategory === 'ranking');
  const normalItems = materials.filter((item) => item.sourceCategory !== 'ranking');

  const rankingCardHtml = buildRankingCard(rankingItems);

  const normalCardsHtml = normalItems
    .map((item, index) => {
      const cardClass = `feed-card tone-${(index % 5) + 1}`;
      const title = escapeHtml(item.title || item.summary || 'Untitled');
      // タイトルとサマリーが同じ場合はサマリーを非表示
      const summary = item.summary && item.summary !== item.title ? escapeHtml(item.summary) : '';
      const source = escapeHtml(item.sourceName || 'Source');
      const metric = escapeHtml(formatMetric(item));
      const published = formatDate(item.publishedAt);
      const url = escapeHtml(item.url || '');
      // 日付が取れた場合のみ表示（「-」を表示しない）
      const publishedPill = published !== '-' ? `<span class="meta-pill">${escapeHtml(published)}</span>` : '';

      return `
        <article class="${cardClass}">
          <div class="card-meta">
            <span class="meta-pill">${source}</span>
            <span class="meta-pill">${metric}</span>
            ${publishedPill}
          </div>
          <h2 class="card-title">${title}</h2>
          ${summary ? `<p class="card-summary">${summary}</p>` : ''}
          <a class="card-link" href="${url}" target="_blank" rel="noreferrer">Open source</a>
        </article>
      `;
    })
    .join('');

  feedGridEl.innerHTML = rankingCardHtml + normalCardsHtml;
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
