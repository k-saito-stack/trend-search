(function attachUsageAnalytics(global) {
  const SESSION_ID_STORAGE_KEY = 'trend_atelier_usage_session_id';
  const APP_VIEW_STORAGE_KEY = 'trend_atelier_usage_app_view_sent';
  const ENGAGED_STORAGE_KEY = 'trend_atelier_usage_engaged_30s_sent';
  const ENGAGED_DELAY_MS = 30_000;
  const COLLECTION_PATH = 'usageEvents';
  const APP_NAME = 'todays-insaito';

  const state = {
    firestore: null,
    getCurrentUser: null,
    engagedTimerId: null,
  };

  function generateSessionId() {
    if (global.crypto && typeof global.crypto.randomUUID === 'function') {
      return global.crypto.randomUUID();
    }
    return `session_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
  }

  function getSessionId() {
    const existing = global.sessionStorage.getItem(SESSION_ID_STORAGE_KEY);
    if (existing) return existing;
    const created = generateSessionId();
    global.sessionStorage.setItem(SESSION_ID_STORAGE_KEY, created);
    return created;
  }

  function getDateInTokyo() {
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Tokyo',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).formatToParts(new Date());
    const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
    return `${values.year}-${values.month}-${values.day}`;
  }

  function sanitizeString(value, maxLength = 240) {
    const trimmed = String(value || '').trim();
    return trimmed.slice(0, maxLength);
  }

  function buildBaseEvent(eventName) {
    const user = typeof state.getCurrentUser === 'function' ? state.getCurrentUser() : null;
    const email = sanitizeString(user?.email, 200);
    const uid = sanitizeString(user?.uid, 128);
    if (!user || !email || !uid) {
      return null;
    }

    return {
      appName: APP_NAME,
      eventName,
      eventVersion: 1,
      eventDate: getDateInTokyo(),
      pagePath: sanitizeString(global.location?.pathname || '/', 120),
      pageTitle: sanitizeString(global.document?.title || '', 200),
      sessionId: sanitizeString(getSessionId(), 80),
      userUid: uid,
      userEmail: email,
    };
  }

  function writeEvent(payload) {
    if (!state.firestore || typeof state.firestore.collection !== 'function') {
      return Promise.resolve(false);
    }

    const FieldValue = global.firebase?.firestore?.FieldValue;
    const eventPayload = {
      ...payload,
      timestamp: FieldValue?.serverTimestamp ? FieldValue.serverTimestamp() : new Date(),
    };

    return state.firestore.collection(COLLECTION_PATH).add(eventPayload)
      .then(() => true)
      .catch((error) => {
        global.console?.warn?.('[usage]', error?.message || error);
        return false;
      });
  }

  function markSent(storageKey) {
    global.sessionStorage.setItem(storageKey, '1');
  }

  function isSent(storageKey) {
    return global.sessionStorage.getItem(storageKey) === '1';
  }

  function trackAppView() {
    if (isSent(APP_VIEW_STORAGE_KEY)) return;
    const payload = buildBaseEvent('app_view');
    if (!payload) return;
    markSent(APP_VIEW_STORAGE_KEY);
    void writeEvent(payload);
  }

  function clearEngagedTimer() {
    if (state.engagedTimerId) {
      global.clearTimeout(state.engagedTimerId);
      state.engagedTimerId = null;
    }
  }

  function scheduleEngagedView() {
    clearEngagedTimer();
    if (isSent(ENGAGED_STORAGE_KEY)) return;

    const tick = () => {
      if (global.document?.hidden) {
        state.engagedTimerId = global.setTimeout(tick, 5_000);
        return;
      }
      const payload = buildBaseEvent('engaged_30s');
      if (!payload) return;
      markSent(ENGAGED_STORAGE_KEY);
      void writeEvent(payload);
    };

    state.engagedTimerId = global.setTimeout(tick, ENGAGED_DELAY_MS);
  }

  function trackContentOpen(details = {}) {
    const payload = buildBaseEvent('content_open');
    if (!payload) return;

    const targetUrl = sanitizeString(details.targetUrl, 1200);
    let targetHost = '';
    if (targetUrl) {
      try {
        targetHost = sanitizeString(new URL(targetUrl, global.location?.href || 'https://example.com').host, 200);
      } catch {
        targetHost = '';
      }
    }

    void writeEvent({
      ...payload,
      sourceCategory: sanitizeString(details.sourceCategory, 120),
      sourceKind: sanitizeString(details.sourceKind, 120),
      sourceName: sanitizeString(details.sourceName, 200),
      itemTitle: sanitizeString(details.itemTitle, 300),
      targetHost,
      targetUrl,
    });
  }

  function reset() {
    clearEngagedTimer();
  }

  function init(options = {}) {
    state.firestore = options.firestore || null;
    state.getCurrentUser = options.getCurrentUser || null;
  }

  global.TrendUsageAnalytics = {
    init,
    reset,
    scheduleEngagedView,
    trackAppView,
    trackContentOpen,
  };
})(window);
