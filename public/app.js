const state = {
  snapshot: null,
};

const refreshBtnEl = document.getElementById('refreshBtn');
const todaySummaryEl = document.getElementById('todaySummary');
const lastUpdatedEl = document.getElementById('lastUpdated');
const topicTagsEl = document.getElementById('topicTags');
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

  const topCluster = run.payload?.clusters?.[0]?.name || '出版トピック';
  const total = Number(run.payload?.materials?.length || 0);
  return `今日は「${topCluster}」を中心に、${total}件の話題が流入しています。`;
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

function renderTopicTags(run) {
  const tags = (run?.payload?.themes || []).slice(0, 10);
  if (tags.length === 0) {
    topicTagsEl.innerHTML = '<span class="topic-tag topic-tag-muted">signals pending</span>';
    return;
  }

  topicTagsEl.innerHTML = tags.map((tag) => `<span class="topic-tag">${escapeHtml(tag)}</span>`).join('');
}

function renderFeed(run) {
  const materials = run?.payload?.materials || [];
  if (materials.length === 0) {
    feedGridEl.innerHTML = '<article class="empty-card">まだ最新情報がありません。Refreshで収集できます。</article>';
    return;
  }

  feedGridEl.innerHTML = materials
    .map((item, index) => {
      const cardClass = `feed-card tone-${(index % 5) + 1}`;
      const title = escapeHtml(item.title || item.summary || 'Untitled');
      const summary = escapeHtml(item.summary || '');
      const source = escapeHtml(item.sourceName || 'Source');
      const metric = escapeHtml(formatMetric(item));
      const published = escapeHtml(formatDate(item.publishedAt));
      const url = escapeHtml(item.url || '');

      return `
        <article class="${cardClass}">
          <div class="card-meta">
            <span class="meta-pill">${source}</span>
            <span class="meta-pill">${metric}</span>
            <span class="meta-pill">${published}</span>
          </div>
          <h2 class="card-title">${title}</h2>
          <p class="card-summary">${summary}</p>
          <a class="card-link" href="${url}" target="_blank" rel="noreferrer">Open source</a>
        </article>
      `;
    })
    .join('');
}

function render() {
  const run = state.snapshot?.latestRun || null;

  todaySummaryEl.textContent = buildTodaySummary(run);
  const tickerText = buildHeadline(run);
  headlineAEl.textContent = tickerText;
  headlineBEl.textContent = tickerText;

  if (run) {
    lastUpdatedEl.textContent = `最終更新: ${formatDate(run.createdAt)} / 毎朝 09:00 JST 自動更新`;
  } else {
    lastUpdatedEl.textContent = '毎朝 09:00 JST 自動更新 / それ以外は Refresh 実行';
  }

  renderTopicTags(run);
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
