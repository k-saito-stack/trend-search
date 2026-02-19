const state = {
  snapshot: null,
  selectedThemeId: null,
  runs: [],
  health: null,
};

let twitterWidgetsPromise = null;
let twitterWidgetsFailed = false;

const themeListEl = document.getElementById('themeList');
const themeDetailEl = document.getElementById('themeDetail');
const clustersEl = document.getElementById('clusters');
const materialsEl = document.getElementById('materials');
const historyEl = document.getElementById('history');
const healthBadgeEl = document.getElementById('healthBadge');
const lastRunMetaEl = document.getElementById('lastRunMeta');
const toastEl = document.getElementById('toast');
const createThemeForm = document.getElementById('createThemeForm');
const runAllBtn = document.getElementById('runAllBtn');

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
  toastEl.style.background = isError ? '#a32416' : '#163030';
  toastEl.classList.add('show');
  setTimeout(() => toastEl.classList.remove('show'), 2200);
}

function extractStatusId(rawUrl) {
  try {
    const parsed = new URL(String(rawUrl || ''));
    const match = parsed.pathname.match(/\/status\/(\d+)/);
    return match ? match[1] : '';
  } catch {
    return '';
  }
}

function toTweetPermalink(rawUrl) {
  const statusId = extractStatusId(rawUrl);
  if (statusId) {
    return `https://twitter.com/i/status/${statusId}`;
  }
  return String(rawUrl || '');
}

function ensureTwitterWidgets() {
  if (window.twttr?.widgets?.load) {
    return Promise.resolve(window.twttr);
  }

  if (twitterWidgetsPromise) {
    return twitterWidgetsPromise;
  }

  twitterWidgetsPromise = new Promise((resolve, reject) => {
    const existing = document.querySelector('script[data-twitter-widgets="true"]');
    if (existing) {
      existing.addEventListener('load', () => resolve(window.twttr), { once: true });
      existing.addEventListener('error', () => reject(new Error('X埋め込みスクリプトの読み込みに失敗しました')), { once: true });
      return;
    }

    const script = document.createElement('script');
    script.src = 'https://platform.twitter.com/widgets.js';
    script.async = true;
    script.charset = 'utf-8';
    script.dataset.twitterWidgets = 'true';
    script.addEventListener('load', () => resolve(window.twttr), { once: true });
    script.addEventListener('error', () => reject(new Error('X埋め込みスクリプトの読み込みに失敗しました')), { once: true });
    document.head.append(script);
  });

  return twitterWidgetsPromise;
}

async function hydrateTweetEmbeds() {
  const embeds = materialsEl.querySelectorAll('.twitter-tweet');
  if (embeds.length === 0) {
    return;
  }

  try {
    await ensureTwitterWidgets();
    if (window.twttr?.widgets?.load) {
      window.twttr.widgets.load(materialsEl);
    }
  } catch (error) {
    if (!twitterWidgetsFailed) {
      twitterWidgetsFailed = true;
      notify(error.message, true);
    }
  }
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
    throw new Error(json.error || 'API リクエストに失敗しました');
  }

  return json;
}

function getThemeList() {
  return state.snapshot?.themes || [];
}

function getSelectedTheme() {
  return getThemeList().find((theme) => theme.id === state.selectedThemeId) || null;
}

function getLatestRun(themeId) {
  const row = state.snapshot?.latestRuns?.find((item) => item.themeId === themeId);
  return row?.run || null;
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

function renderThemeList() {
  const themes = getThemeList();

  if (themes.length === 0) {
    themeListEl.innerHTML = '<div class="empty">テーマがまだありません</div>';
    return;
  }

  themeListEl.innerHTML = themes
    .map((theme) => {
      const latestRun = getLatestRun(theme.id);
      const active = theme.id === state.selectedThemeId ? 'active' : '';
      const icon = theme.enabled ? '●' : '○';
      const runTime = latestRun ? formatDate(latestRun.createdAt) : '未収集';

      return `
        <button class="theme-item ${active}" data-theme-id="${escapeHtml(theme.id)}">
          <div class="theme-item-title">${escapeHtml(icon)} ${escapeHtml(theme.name)}</div>
          <div class="theme-item-meta">${escapeHtml(theme.query)}</div>
          <div class="theme-item-meta">${escapeHtml(theme.periodDays)}日 / ${escapeHtml(runTime)}</div>
        </button>
      `;
    })
    .join('');

  for (const button of themeListEl.querySelectorAll('[data-theme-id]')) {
    button.addEventListener('click', async () => {
      state.selectedThemeId = button.dataset.themeId;
      render();
      await loadRuns();
      render();
    });
  }
}

function renderThemeDetail() {
  const theme = getSelectedTheme();

  if (!theme) {
    themeDetailEl.innerHTML = '<div class="empty">左からテーマを選択してください</div>';
    return;
  }

  themeDetailEl.innerHTML = `
    <div class="detail-card">
      <h2>Theme Settings</h2>
      <div class="detail-grid">
        <label>
          名前
          <input id="editName" value="${escapeHtml(theme.name)}" />
        </label>
        <label>
          クエリ
          <input id="editQuery" value="${escapeHtml(theme.query)}" />
        </label>
        <label>
          期間(日)
          <input id="editPeriod" type="number" min="1" max="30" value="${escapeHtml(theme.periodDays)}" />
        </label>
      </div>
      <label class="checkbox-row">
        <input id="editEnabled" type="checkbox" ${theme.enabled ? 'checked' : ''} />
        毎朝7:00 JSTの自動収集を有効
      </label>
      <div class="detail-actions">
        <button id="saveThemeBtn" class="btn">保存</button>
        <button id="runThemeBtn" class="btn btn-accent">このテーマを今すぐ収集</button>
        <button id="deleteThemeBtn" class="btn btn-danger">削除</button>
      </div>
    </div>
  `;

  document.getElementById('saveThemeBtn').addEventListener('click', async () => {
    try {
      const payload = {
        name: document.getElementById('editName').value,
        query: document.getElementById('editQuery').value,
        periodDays: Number(document.getElementById('editPeriod').value),
        enabled: document.getElementById('editEnabled').checked,
      };
      await api(`/api/themes/${encodeURIComponent(theme.id)}`, {
        method: 'PATCH',
        body: JSON.stringify(payload),
      });
      notify('テーマを更新しました');
      await reloadAll();
    } catch (error) {
      notify(error.message, true);
    }
  });

  document.getElementById('runThemeBtn').addEventListener('click', async () => {
    try {
      notify('収集中...');
      await api('/api/run', {
        method: 'POST',
        body: JSON.stringify({ themeId: theme.id }),
      });
      notify('収集が完了しました');
      await reloadAll();
    } catch (error) {
      notify(error.message, true);
    }
  });

  document.getElementById('deleteThemeBtn').addEventListener('click', async () => {
    if (!window.confirm(`「${theme.name}」を削除しますか？`)) {
      return;
    }
    try {
      await api(`/api/themes/${encodeURIComponent(theme.id)}`, {
        method: 'DELETE',
      });
      notify('テーマを削除しました');

      const remaining = getThemeList().filter((item) => item.id !== theme.id);
      state.selectedThemeId = remaining[0]?.id || null;

      await reloadAll();
    } catch (error) {
      notify(error.message, true);
    }
  });
}

function renderClustersAndMaterials() {
  const theme = getSelectedTheme();
  const run = theme ? getLatestRun(theme.id) : null;

  if (!run) {
    clustersEl.innerHTML = '<div class="empty">まだ収集結果がありません</div>';
    materialsEl.innerHTML = '<div class="empty">まだ収集結果がありません</div>';
    lastRunMetaEl.textContent = '未実行';
    return;
  }

  lastRunMetaEl.textContent = `${formatDate(run.createdAt)} / ${run.periodLabel}`;

  const clusters = run.payload?.clusters || [];
  const materials = run.payload?.materials || [];

  if (clusters.length === 0) {
    clustersEl.innerHTML = '<div class="empty">クラスターの抽出結果がありません</div>';
  } else {
    clustersEl.innerHTML = clusters
      .map((cluster) => {
        const tags = (cluster.keyphrases || [])
          .map((tag) => `<span class="tag">${escapeHtml(tag)}</span>`)
          .join('');

        const posts = (cluster.posts || [])
          .map((post) => {
            const summary = escapeHtml(post.summary || '');
            const likes = Number(post.likes || 0).toLocaleString('ja-JP');
            const url = escapeHtml(post.url || '');
            return `
              <div class="post-item">
                <div>${summary}</div>
                <div>👍 ${likes}</div>
                <a href="${url}" target="_blank" rel="noreferrer">${url}</a>
              </div>
            `;
          })
          .join('');

        return `
          <article class="cluster-card">
            <div class="cluster-title">
              <h3>${escapeHtml(cluster.name || '無題')}</h3>
            </div>
            <div class="tag-list">${tags || '<span class="meta">キーフレーズなし</span>'}</div>
            ${posts || '<div class="meta">ポストなし</div>'}
          </article>
        `;
      })
      .join('');
  }

  if (materials.length === 0) {
    materialsEl.innerHTML = '<div class="empty">materials が空です</div>';
  } else {
    materialsEl.innerHTML = materials
      .map((post, index) => {
        const likes = Number(post.likes || 0).toLocaleString('ja-JP');
        const summary = escapeHtml(post.summary || '');
        const sourceUrl = String(post.url || '');
        const url = escapeHtml(sourceUrl);
        const permalink = escapeHtml(toTweetPermalink(sourceUrl));
        return `
          <div class="material-item material-item-embed">
            <div><strong>${index + 1}.</strong> ${summary}</div>
            <div>👍 ${likes}</div>
            <a href="${url}" target="_blank" rel="noreferrer">${url}</a>
            <blockquote class="twitter-tweet" data-dnt="true" data-lang="ja">
              <a href="${permalink}">投稿を開く</a>
            </blockquote>
          </div>
        `;
      })
      .join('');

    void hydrateTweetEmbeds();
  }
}

function renderHistory() {
  if (!state.selectedThemeId) {
    historyEl.innerHTML = '<div class="empty">テーマ未選択</div>';
    return;
  }

  if (!state.runs || state.runs.length === 0) {
    historyEl.innerHTML = '<div class="empty">履歴がありません</div>';
    return;
  }

  historyEl.innerHTML = state.runs
    .map((run) => {
      const first = run.payload?.materials?.[0];
      const firstLink = first?.url
        ? `<a href="${escapeHtml(first.url)}" target="_blank" rel="noreferrer">${escapeHtml(first.url)}</a>`
        : '<span class="meta">リンクなし</span>';

      return `
        <div class="history-item">
          <div>${escapeHtml(formatDate(run.createdAt))} / ${escapeHtml(run.periodLabel || '-')}</div>
          <div class="meta">${escapeHtml(run.queryWithSince || run.query || '')}</div>
          <div class="meta">parse: ${escapeHtml(run.parseStatus || 'unknown')}</div>
          ${firstLink}
        </div>
      `;
    })
    .join('');
}

function renderHealth() {
  if (!state.health) {
    healthBadgeEl.textContent = 'Unknown';
    return;
  }

  if (state.health.hasApiKey) {
    healthBadgeEl.textContent = `xAI key: OK / ${state.health.model}`;
    healthBadgeEl.style.borderColor = '#89d5d5';
  } else {
    healthBadgeEl.textContent = 'xAI key: 未設定';
    healthBadgeEl.style.borderColor = '#ffc2b7';
  }
}

function render() {
  renderThemeList();
  renderThemeDetail();
  renderClustersAndMaterials();
  renderHistory();
  renderHealth();
}

async function loadHealth() {
  state.health = await api('/api/health');
}

async function loadSnapshot() {
  state.snapshot = await api('/api/snapshot');

  const themes = getThemeList();
  if (!themes.find((theme) => theme.id === state.selectedThemeId)) {
    state.selectedThemeId = themes[0]?.id || null;
  }
}

async function loadRuns() {
  if (!state.selectedThemeId) {
    state.runs = [];
    return;
  }

  const result = await api(`/api/runs?themeId=${encodeURIComponent(state.selectedThemeId)}&limit=10`);
  state.runs = result.runs || [];
}

async function reloadAll() {
  await loadHealth();
  await loadSnapshot();
  await loadRuns();
  render();
}

createThemeForm.addEventListener('submit', async (event) => {
  event.preventDefault();

  const form = new FormData(createThemeForm);

  try {
    await api('/api/themes', {
      method: 'POST',
      body: JSON.stringify({
        name: form.get('name'),
        query: form.get('query'),
        periodDays: Number(form.get('periodDays') || 2),
      }),
    });

    createThemeForm.reset();
    createThemeForm.elements.periodDays.value = 2;

    notify('テーマを追加しました');
    await reloadAll();
  } catch (error) {
    notify(error.message, true);
  }
});

runAllBtn.addEventListener('click', async () => {
  try {
    notify('全テーマを収集中...');
    await api('/api/run', {
      method: 'POST',
      body: JSON.stringify({}),
    });
    notify('収集が完了しました');
    await reloadAll();
  } catch (error) {
    notify(error.message, true);
  }
});

(async function init() {
  try {
    await reloadAll();
  } catch (error) {
    notify(error.message, true);
  }
})();
