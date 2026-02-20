const state = {
  snapshot: null,
  selectedThemeId: null,
  runs: [],
  health: null,
};

let twitterWidgetsPromise = null;
let twitterWidgetsFailed = false;

const healthBadgeEl = document.getElementById('healthBadge');
const themePickerEl = document.getElementById('themePicker');
const runSelectedBtn = document.getElementById('runSelectedBtn');
const runAllBtn = document.getElementById('runAllBtn');
const settingsOpenBtn = document.getElementById('settingsOpenBtn');
const settingsCloseBtn = document.getElementById('settingsCloseBtn');
const settingsPanelEl = document.getElementById('settingsPanel');
const settingsBackdropEl = document.getElementById('settingsBackdrop');
const revealEls = Array.from(document.querySelectorAll('.reveal-on-scroll'));
const heroTapeTextAEl = document.getElementById('heroTapeTextA');
const heroTapeTextBEl = document.getElementById('heroTapeTextB');

const lastRunMetaEl = document.getElementById('lastRunMeta');
const overviewSummaryEl = document.getElementById('overviewSummary');
const clustersEl = document.getElementById('clusters');
const materialsEl = document.getElementById('materials');
const historyEl = document.getElementById('history');

const themeListEl = document.getElementById('themeList');
const updateThemeForm = document.getElementById('updateThemeForm');
const createThemeForm = document.getElementById('createThemeForm');
const deleteThemeBtn = document.getElementById('deleteThemeBtn');

const editThemeTermEl = document.getElementById('editThemeTerm');
const editPeriodEl = document.getElementById('editPeriod');
const editEnabledEl = document.getElementById('editEnabled');

const toastEl = document.getElementById('toast');

let revealObserver = null;

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
  toastEl.style.background = isError ? '#a32416' : '#151515';
  toastEl.classList.add('show');
  setTimeout(() => toastEl.classList.remove('show'), 2200);
}

function setTapeText(value) {
  const text = String(value || '').trim();
  if (!text) {
    return;
  }

  if (heroTapeTextAEl) {
    heroTapeTextAEl.textContent = text;
  }
  if (heroTapeTextBEl) {
    heroTapeTextBEl.textContent = text;
  }
}

function initRevealAnimations() {
  if (revealEls.length === 0) {
    return;
  }

  const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (prefersReducedMotion || !('IntersectionObserver' in window)) {
    revealEls.forEach((el) => el.classList.add('visible'));
    return;
  }

  revealObserver = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        if (!entry.isIntersecting) {
          return;
        }
        entry.target.classList.add('visible');
        revealObserver.unobserve(entry.target);
      });
    },
    {
      threshold: 0.18,
    },
  );

  revealEls.forEach((el) => revealObserver.observe(el));
}

function initAmbientMotion() {
  const target = document.body;

  window.addEventListener('pointermove', (event) => {
    const x = (event.clientX / window.innerWidth) * 100;
    const y = (event.clientY / window.innerHeight) * 100;
    target.style.setProperty('--cursor-x', x.toFixed(2));
    target.style.setProperty('--cursor-y', y.toFixed(2));
  });
}

function openSettingsPanel() {
  settingsPanelEl.classList.remove('hidden');
  settingsBackdropEl.classList.remove('hidden');
  settingsPanelEl.setAttribute('aria-hidden', 'false');
  document.body.classList.add('settings-open');
}

function closeSettingsPanel() {
  settingsPanelEl.classList.add('hidden');
  settingsBackdropEl.classList.add('hidden');
  settingsPanelEl.setAttribute('aria-hidden', 'true');
  document.body.classList.remove('settings-open');
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

function setEditorDisabled(disabled) {
  editThemeTermEl.disabled = disabled;
  editPeriodEl.disabled = disabled;
  editEnabledEl.disabled = disabled;
  deleteThemeBtn.disabled = disabled;
  updateThemeForm.querySelector('button[type="submit"]').disabled = disabled;
}

function renderHealth() {
  if (!state.health) {
    healthBadgeEl.textContent = 'Unknown';
    return;
  }

  if (state.health.hasApiKey) {
    healthBadgeEl.textContent = `xAI key: OK / ${state.health.model}`;
    healthBadgeEl.style.borderColor = '#91d8c2';
  } else {
    healthBadgeEl.textContent = 'xAI key: 未設定';
    healthBadgeEl.style.borderColor = '#f4c3bc';
  }
}

function renderThemePicker() {
  const themes = getThemeList();

  if (themes.length === 0) {
    themePickerEl.innerHTML = '<option value="">テーマがありません</option>';
    themePickerEl.disabled = true;
    runSelectedBtn.disabled = true;
    return;
  }

  themePickerEl.disabled = false;
  runSelectedBtn.disabled = false;

  themePickerEl.innerHTML = themes
    .map((theme) => `<option value="${escapeHtml(theme.id)}">${escapeHtml(theme.query || theme.name)}</option>`)
    .join('');

  const selectedExists = themes.some((theme) => theme.id === state.selectedThemeId);
  if (!selectedExists) {
    state.selectedThemeId = themes[0].id;
  }

  themePickerEl.value = state.selectedThemeId;
}

function renderOverviewSummary() {
  const theme = getSelectedTheme();
  const run = theme ? getLatestRun(theme.id) : null;

  if (!theme) {
    overviewSummaryEl.innerHTML = '<div class="empty">まずテーマを追加してください。</div>';
    lastRunMetaEl.textContent = '未実行';
    setTapeText('STATE OF TREND WORK • TREND SEARCH BRIEFING •');
    return;
  }

  lastRunMetaEl.textContent = run ? `${formatDate(run.createdAt)} / ${run.periodLabel}` : '未実行';

  const runQuery = run?.queryWithSince || `${theme.query} since:-`;
  setTapeText(`${runQuery} • ${run?.periodLabel || `直近${theme.periodDays}日`} • TREND SEARCH BRIEFING •`);

  overviewSummaryEl.innerHTML = `
    <div class="summary-grid">
      <div class="summary-item">
        <div class="summary-label">Theme</div>
        <div class="summary-value">${escapeHtml(theme.query || theme.name)}</div>
      </div>
      <div class="summary-item">
        <div class="summary-label">Window</div>
        <div class="summary-value">直近${escapeHtml(theme.periodDays)}日</div>
      </div>
      <div class="summary-item">
        <div class="summary-label">Auto Run</div>
        <div class="summary-value">${theme.enabled ? 'Enabled' : 'Disabled'}</div>
      </div>
      <div class="summary-item">
        <div class="summary-label">Parse</div>
        <div class="summary-value">${escapeHtml(run?.parseStatus || '-')}</div>
      </div>
    </div>
    <div class="quiet-query" title="${escapeHtml(runQuery)}">
      <span class="quiet-query-label">run query</span>
      <span class="quiet-query-text mono">${escapeHtml(runQuery)}</span>
    </div>
  `;
}

function renderClustersAndMaterials() {
  const theme = getSelectedTheme();
  const run = theme ? getLatestRun(theme.id) : null;

  if (!run) {
    clustersEl.innerHTML = '<div class="empty">まだ収集結果がありません</div>';
    materialsEl.innerHTML = '<div class="empty">まだ収集結果がありません</div>';
    return;
  }

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
              <h4>${escapeHtml(cluster.name || '無題')}</h4>
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
      const statusBadge = theme.enabled
        ? '<span class="badge-ok">enabled</span>'
        : '<span class="badge-off">disabled</span>';

      return `
        <article class="theme-row ${active}" data-theme-id="${escapeHtml(theme.id)}">
          <div class="theme-row-head">
            <div class="theme-name">${escapeHtml(theme.query || theme.name)}</div>
            ${statusBadge}
          </div>
          <div class="theme-meta">期間: ${escapeHtml(theme.periodDays)}日 / 最終: ${escapeHtml(latestRun ? formatDate(latestRun.createdAt) : '未収集')}</div>
        </article>
      `;
    })
    .join('');
}

function renderThemeEditor() {
  const theme = getSelectedTheme();

  if (!theme) {
    updateThemeForm.reset();
    setEditorDisabled(true);
    return;
  }

  setEditorDisabled(false);

  editThemeTermEl.value = theme.query || theme.name || '';
  editPeriodEl.value = String(theme.periodDays);
  editEnabledEl.checked = Boolean(theme.enabled);
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
      const runQuery = run.queryWithSince || run.query || '-';
      const since = run.sinceDate || '-';

      return `
        <article class="history-item">
          <div><strong>${escapeHtml(formatDate(run.createdAt))}</strong> / ${escapeHtml(run.periodLabel || '-')}</div>
          <div class="meta mono" title="${escapeHtml(runQuery)}">since: ${escapeHtml(since)}</div>
          <div>parse: ${escapeHtml(run.parseStatus || 'unknown')}</div>
          ${firstLink}
        </article>
      `;
    })
    .join('');
}

function render() {
  renderHealth();
  renderThemePicker();
  renderOverviewSummary();
  renderClustersAndMaterials();
  renderThemeList();
  renderThemeEditor();
  renderHistory();
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
  await Promise.all([loadHealth(), loadSnapshot()]);
  await loadRuns();
  render();
}

async function withButtonBusy(button, busyText, fn) {
  const original = button.textContent;
  button.disabled = true;
  button.textContent = busyText;
  try {
    await fn();
  } finally {
    button.disabled = false;
    button.textContent = original;
  }
}

async function selectTheme(themeId) {
  state.selectedThemeId = themeId;
  await loadRuns();
  render();
}

themePickerEl.addEventListener('change', () => {
  void selectTheme(themePickerEl.value);
});

settingsOpenBtn.addEventListener('click', () => {
  openSettingsPanel();
});

settingsCloseBtn.addEventListener('click', () => {
  closeSettingsPanel();
});

settingsBackdropEl.addEventListener('click', () => {
  closeSettingsPanel();
});

window.addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && !settingsPanelEl.classList.contains('hidden')) {
    closeSettingsPanel();
  }
});

themeListEl.addEventListener('click', (event) => {
  const row = event.target.closest('[data-theme-id]');
  if (!row) return;
  void selectTheme(row.dataset.themeId);
});

runSelectedBtn.addEventListener('click', async () => {
  if (!state.selectedThemeId) {
    notify('テーマを選択してください', true);
    return;
  }

  await withButtonBusy(runSelectedBtn, '収集中...', async () => {
    try {
      await api('/api/run', {
        method: 'POST',
        body: JSON.stringify({ themeId: state.selectedThemeId }),
      });
      notify('収集が完了しました');
      await reloadAll();
    } catch (error) {
      notify(error.message, true);
    }
  });
});

runAllBtn.addEventListener('click', async () => {
  await withButtonBusy(runAllBtn, '収集中...', async () => {
    try {
      await api('/api/run', {
        method: 'POST',
        body: JSON.stringify({}),
      });
      notify('全テーマの収集が完了しました');
      await reloadAll();
    } catch (error) {
      notify(error.message, true);
    }
  });
});

updateThemeForm.addEventListener('submit', async (event) => {
  event.preventDefault();

  const theme = getSelectedTheme();
  if (!theme) {
    notify('更新対象のテーマがありません', true);
    return;
  }

  const term = editThemeTermEl.value.trim();
  const payload = {
    name: term,
    query: term,
    periodDays: Number(editPeriodEl.value),
    enabled: editEnabledEl.checked,
  };

  try {
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

createThemeForm.addEventListener('submit', async (event) => {
  event.preventDefault();

  const form = new FormData(createThemeForm);
  const term = String(form.get('themeTerm') || '').trim();

  try {
    const result = await api('/api/themes', {
      method: 'POST',
      body: JSON.stringify({
        name: term,
        query: term,
        periodDays: Number(form.get('periodDays') || 2),
      }),
    });

    createThemeForm.reset();
    createThemeForm.elements.periodDays.value = 2;

    state.selectedThemeId = result.theme?.id || state.selectedThemeId;
    notify('テーマを追加しました');
    await reloadAll();
  } catch (error) {
    notify(error.message, true);
  }
});

deleteThemeBtn.addEventListener('click', async () => {
  const theme = getSelectedTheme();
  if (!theme) {
    notify('削除対象のテーマがありません', true);
    return;
  }

  if (!window.confirm(`「${theme.query || theme.name}」を削除しますか？`)) {
    return;
  }

  try {
    await api(`/api/themes/${encodeURIComponent(theme.id)}`, {
      method: 'DELETE',
    });
    notify('テーマを削除しました');
    await reloadAll();
  } catch (error) {
    notify(error.message, true);
  }
});

(async function init() {
  try {
    initRevealAnimations();
    initAmbientMotion();
    await reloadAll();
  } catch (error) {
    notify(error.message, true);
  }
})();
