const { createId, getSinceDate } = require('./utils');
const { callResponsesApi, parseGrokResponse } = require('./xaiClient');
const { parseRssFeed, stripTags } = require('./rssParser');
const { getSourceCatalog, buildGoogleNewsRssUrl } = require('./sourceCatalog');

const DEFAULT_TIMEOUT_MS = Number(process.env.SOURCE_HTTP_TIMEOUT_MS || 12000);
const DEFAULT_CONCURRENCY = Math.max(1, Number(process.env.SOURCE_CONCURRENCY || 4));
const DEFAULT_USER_AGENT = 'TrendAtelierCollector/0.2 (+https://localhost)';

function truncate(text, max = 180) {
  const clean = String(text || '').replace(/\s+/g, ' ').trim();
  if (clean.length <= max) return clean;
  return `${clean.slice(0, max - 1)}…`;
}

function toAbsoluteUrl(baseUrl, href) {
  try {
    return new URL(String(href || ''), baseUrl).toString();
  } catch {
    return String(href || '').trim();
  }
}

function normalizeUrl(rawUrl) {
  const fallback = String(rawUrl || '').trim();
  if (!fallback) return '';

  try {
    const parsed = new URL(fallback);
    parsed.hash = '';
    parsed.searchParams.delete('utm_source');
    parsed.searchParams.delete('utm_medium');
    parsed.searchParams.delete('utm_campaign');
    parsed.searchParams.delete('utm_term');
    parsed.searchParams.delete('utm_content');
    return parsed.toString();
  } catch {
    return fallback;
  }
}

function isRecentEnough(publishedAt, sinceDate) {
  const dateValue = Date.parse(String(publishedAt || ''));
  if (Number.isNaN(dateValue)) {
    return true;
  }

  const threshold = Date.parse(`${sinceDate}T00:00:00+09:00`);
  if (Number.isNaN(threshold)) {
    return true;
  }

  return dateValue >= threshold;
}

async function fetchText(url, options = {}) {
  const timeoutMs = Number(options.timeoutMs || DEFAULT_TIMEOUT_MS);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, {
      method: 'GET',
      redirect: 'follow',
      headers: {
        'User-Agent': DEFAULT_USER_AGENT,
        Accept: 'text/html,application/xhtml+xml,application/xml,text/xml;q=0.9,*/*;q=0.8',
        ...options.headers,
      },
      signal: controller.signal,
    });

    const text = await response.text();
    if (!response.ok) {
      throw new Error(`${response.status} ${response.statusText}`.trim());
    }
    return text;
  } finally {
    clearTimeout(timer);
  }
}

function fillTemplate(template, theme, sinceDate) {
  return String(template || '')
    .replaceAll('{theme}', String(theme.query || theme.name || '').trim())
    .replaceAll('{periodDays}', String(theme.periodDays || 2))
    .replaceAll('{sinceDate}', String(sinceDate || ''));
}

function makeSignal(source, payload) {
  const url = normalizeUrl(payload.url);
  const title = truncate(payload.title || payload.summary || '');
  const summary = truncate(payload.summary || payload.title || '');

  return {
    id: createId('sig'),
    sourceId: source.id,
    sourceName: source.name,
    sourceCategory: source.category,
    sourceKind: source.kind,
    sourcePriority: Number(source.priority || 1),
    title,
    summary,
    url,
    publishedAt: payload.publishedAt || null,
    metricLabel: payload.metricLabel || 'score',
    metricValue: Number(payload.metricValue || 0),
    likes: payload.metricLabel === 'likes' ? Number(payload.metricValue || 0) : 0,
    coverImageUrl: payload.coverImageUrl || null,
  };
}

function buildXQuery(theme, sinceDate) {
  const core = String(theme.query || theme.name || '').trim();
  return `${core} 出版 OR 書籍 OR 書店 OR 書評 OR 重版 OR PR TIMES since:${sinceDate}`;
}

function parseAmazonRanking(html, source, limit) {
  const results = [];
  const seen = new Set();
  const pattern = /<a[^>]+href="([^"]*(?:\/dp\/|\/gp\/product\/)[^"]*)"[^>]*>([\s\S]*?)<\/a>/gi;
  let hit;

  while ((hit = pattern.exec(html)) && results.length < limit * 3) {
    const url = toAbsoluteUrl(source.url, hit[1]);
    const body = hit[2];
    // 複数スペースを1つに正規化してから使う（価格フィルタを確実にするため）
    const bodyText = stripTags(body).replace(/\s+/g, ' ').trim();
    const altMatch = body.match(/alt="([^"]+)"/i);
    const altText = altMatch ? stripTags(altMatch[1]).replace(/\s+/g, ' ').trim() : '';
    const title = truncate(bodyText.length >= 6 ? bodyText : altText, 120);

    if (!title) continue;
    if (/Amazon\.co\.jp|カート|ほしい物リスト|ポイント/i.test(title)) continue;
    // 非書籍アイテム・クレジットカード等を除外
    if (/マスターカード|クレジットカード|ギフト券|Unlimited|プライム会員|Echo|Kindle端末|Fire\s*(?:TV|タブレット)|Alexa/i.test(title)) continue;
    // 価格のみのテキストを除外（¥1,980 や ¥ 1,980 など）
    if (/^[\s¥￥\d,，.]+円?$/.test(title)) continue;
    if (title.length < 5) continue;

    const key = `${url}__${title}`.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);

    // Amazon CDN画像URLを抽出してカバー画像として使用
    const imgMatch = body.match(/src="(https?:\/\/m\.media-amazon\.com\/images\/I\/[^"]+)"/i);
    const coverImageUrl = imgMatch
      ? imgMatch[1].replace(/\._[A-Z_]{2,20}_(?=\.)/, '._SL200_')
      : null;

    results.push({
      url,
      title,
      summary: `${title}（Amazonランキング監視）`,
      coverImageUrl,
    });
  }

  return results.slice(0, limit).map((entry, index) => ({
    ...entry,
    metricLabel: 'rank',
    metricValue: index + 1,
  }));
}

function parseTohanRanking(html, limit) {
  const results = [];
  const seen = new Set();
  // <li class="item rank-Xst/nd/rd/th"> ブロックごとにh3タイトルと最初のe-honリンクを取得
  const itemPattern = /<li[^>]+class="item rank-[^"]*"[^>]*>([\s\S]*?)<\/li>/gi;
  let hit;

  while ((hit = itemPattern.exec(html)) && results.length < limit) {
    const block = hit[1];
    const h3Match = block.match(/<h3[^>]*>([\s\S]*?)<\/h3>/i);
    if (!h3Match) continue;
    const title = stripTags(h3Match[1]).trim();
    if (!title || title.length < 3) continue;

    const key = title.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);

    // 最初のrefISBNリンク（カバー画像リンク）
    const linkMatch = block.match(/href="(https?:\/\/www\.e-hon\.ne\.jp[^"]+refISBN=[^"]+)"/i);
    const url = linkMatch ? linkMatch[1].trim() : '';
    results.push({ url, title, summary: `${title}（トーハン週間ランキング）` });
  }

  return results.slice(0, limit).map((entry, index) => ({
    ...entry,
    metricLabel: 'rank',
    metricValue: index + 1,
  }));
}

function parseHontoRanking(html, limit) {
  const results = [];
  const seen = new Set();
  let hit;

  // まず電子書籍ページ（/ebook/pd_ リンクあり）を試みる
  const ebookPattern = /<h2[^>]+class="stHeading"[^>]*>[\s\S]*?<a[^>]+href="(https?:\/\/honto\.jp\/ebook\/pd_[^"]+)"[^>]*>([\s\S]*?)<\/a>/gi;
  while ((hit = ebookPattern.exec(html)) && results.length < limit * 2) {
    const url = hit[1].split('?')[0]; // cid等のトラッキングパラメータを除去
    const title = stripTags(hit[2]).trim();
    if (!title || title.length < 2) continue;
    const key = title.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    results.push({ url, title, summary: `${title}（hontoランキング）` });
  }

  // 電子書籍リンクが見つからない場合は実店舗・紙書籍ページとして処理
  if (results.length === 0) {
    const physicalPattern = /<h2[^>]+class="stHeading"[^>]*>([\s\S]*?)<\/h2>/gi;
    while ((hit = physicalPattern.exec(html)) && results.length < limit * 2) {
      const title = stripTags(hit[1]).trim();
      if (!title || title.length < 2) continue;
      const key = title.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      // 個別商品URLがないため、書名でhonto内検索URLを生成
      const url = `https://honto.jp/netstore/search.html?search.keyword=${encodeURIComponent(title)}`;
      results.push({ url, title, summary: `${title}（hontoランキング）` });
    }
  }

  return results.slice(0, limit).map((entry, index) => ({
    ...entry,
    metricLabel: 'rank',
    metricValue: index + 1,
  }));
}

function parseYurindoRanking(html, limit) {
  const results = [];
  const seen = new Set();
  let hit;

  // book-detailのh3からタイトルを抽出
  const titlePattern = /<div[^>]+class="book-detail"[^>]*>[\s\S]*?<h3>([\s\S]*?)<\/h3>/gi;
  const titles = [];
  while ((hit = titlePattern.exec(html))) {
    const title = stripTags(hit[1]).trim();
    if (title && title.length >= 2) titles.push(title);
  }

  // 有隣堂在庫検索URL（search.yurindo.bscentral.jp/item?ic=ISBN）を抽出
  const urlPattern = /<a[^>]+href="(https?:\/\/search\.yurindo\.bscentral\.jp\/item\?ic=[^"]+)"/gi;
  const urls = [];
  while ((hit = urlPattern.exec(html))) {
    urls.push(hit[1].trim());
  }

  for (let i = 0; i < Math.min(titles.length, limit); i++) {
    const title = titles[i];
    const key = title.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    const url = urls[i] || `https://search.yurindo.bscentral.jp/search/?keyword=${encodeURIComponent(title)}`;
    results.push({ url, title, summary: `${title}（有隣堂ランキング）` });
  }

  return results.slice(0, limit).map((entry, index) => ({
    ...entry,
    metricLabel: 'rank',
    metricValue: index + 1,
  }));
}

async function collectGoogleNews(source, context) {
  const queryBase = fillTemplate(source.queryTemplate, context.theme, context.sinceDate);
  const query = `${queryBase} when:${Math.min(30, Math.max(1, context.theme.periodDays || 2))}d`;
  const feedUrl = buildGoogleNewsRssUrl(query);
  const xml = await fetchText(feedUrl, { timeoutMs: context.timeoutMs });
  const entries = parseRssFeed(xml);

  return entries
    .filter((entry) => entry.link)
    .filter((entry) => isRecentEnough(entry.publishedAt, context.sinceDate))
    .slice(0, Number(source.itemLimit || 8))
    .map((entry) =>
      makeSignal(source, {
        title: entry.title,
        summary: entry.summary || entry.title,
        url: entry.link,
        publishedAt: entry.publishedAt || null,
        metricLabel: 'mentions',
        metricValue: 1,
      }),
    );
}

async function collectDirectRss(source, context) {
  const xml = await fetchText(source.url, { timeoutMs: context.timeoutMs });
  const entries = parseRssFeed(xml);
  // source.maxAgeDays が設定されていればそちらを優先（週刊更新の媒体など向け）
  const effectiveSinceDate = source.maxAgeDays
    ? getSinceDate(source.maxAgeDays)
    : context.sinceDate;

  return entries
    .filter((entry) => entry.link)
    .filter((entry) => isRecentEnough(entry.publishedAt, effectiveSinceDate))
    .slice(0, Number(source.itemLimit || 8))
    .map((entry) =>
      makeSignal(source, {
        title: entry.title,
        summary: entry.summary || entry.title,
        url: entry.link,
        publishedAt: entry.publishedAt || null,
        metricLabel: 'mentions',
        metricValue: 1,
      }),
    );
}

async function collectAmazonBestseller(source, context) {
  const html = await fetchText(source.url, {
    timeoutMs: context.timeoutMs,
    headers: {
      'Accept-Language': 'ja,en-US;q=0.9,en;q=0.8',
    },
  });

  const entries = parseAmazonRanking(html, source, Number(source.itemLimit || 15));
  return entries.map((entry) =>
    makeSignal(source, {
      title: entry.title,
      summary: entry.summary,
      url: entry.url,
      metricLabel: entry.metricLabel,
      metricValue: entry.metricValue,
      coverImageUrl: entry.coverImageUrl,
    }),
  );
}

async function collectTohanRanking(source, context) {
  const html = await fetchText(source.url, {
    timeoutMs: context.timeoutMs,
    headers: { 'Accept-Language': 'ja,en-US;q=0.9' },
  });
  const entries = parseTohanRanking(html, Number(source.itemLimit || 10));
  return entries.map((entry) =>
    makeSignal(source, {
      title: entry.title,
      summary: entry.summary,
      url: entry.url,
      metricLabel: entry.metricLabel,
      metricValue: entry.metricValue,
    }),
  );
}

async function collectHontoRanking(source, context) {
  const html = await fetchText(source.url, {
    timeoutMs: context.timeoutMs,
    headers: { 'Accept-Language': 'ja,en-US;q=0.9' },
  });
  const entries = parseHontoRanking(html, Number(source.itemLimit || 10));
  return entries.map((entry) =>
    makeSignal(source, {
      title: entry.title,
      summary: entry.summary,
      url: entry.url,
      metricLabel: entry.metricLabel,
      metricValue: entry.metricValue,
    }),
  );
}

async function collectRakutenRanking(source, context) {
  const limit = Number(source.itemLimit || 10);
  const apiUrl = `https://rdc-api-catalog-gateway-api.rakuten.co.jp/books/rank/001/hourly.json?hits=${limit}&page=1&period=0&sid=10`;
  const text = await fetchText(apiUrl, { timeoutMs: context.timeoutMs });
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    return [];
  }
  return (data.data || []).slice(0, limit).map((item, index) =>
    makeSignal(source, {
      title: item.title || '',
      summary: `${item.title || ''}（楽天ブックスランキング）`,
      url: item.url || '',
      metricLabel: 'rank',
      metricValue: index + 1,
    }),
  );
}

async function collectYurindoRanking(source, context) {
  const html = await fetchText(source.url, {
    timeoutMs: context.timeoutMs,
    headers: { 'Accept-Language': 'ja,en-US;q=0.9' },
  });
  const entries = parseYurindoRanking(html, Number(source.itemLimit || 10));
  return entries.map((entry) =>
    makeSignal(source, {
      title: entry.title,
      summary: entry.summary,
      url: entry.url,
      metricLabel: entry.metricLabel,
      metricValue: entry.metricValue,
    }),
  );
}

async function collectXGrok(source, context) {
  if (!context.apiKey) {
    return {
      status: 'skipped',
      items: [],
      meta: {
        reason: 'XAI_API_KEY が未設定',
      },
    };
  }

  const queryWithSince = buildXQuery(context.theme, context.sinceDate);
  const raw = await callResponsesApi({
    apiKey: context.apiKey,
    model: context.model,
    queryWithSince,
  });

  const parsed = parseGrokResponse(raw);

  const items = (parsed.data.materials || [])
    .filter((post) => post.url)
    .slice(0, Number(source.itemLimit || 14))
    .map((post) => {
      const fullText = post.summary || '';
      // タイトルは最初の42文字、サマリーは全文（同じ文章の繰り返しを防ぐ）
      const shortTitle = fullText.length > 42 ? `${fullText.slice(0, 42)}…` : fullText || 'X上の投稿';
      return makeSignal(source, {
        title: shortTitle,
        summary: fullText,
        url: post.url,
        metricLabel: 'likes',
        metricValue: Number(post.likes || 0),
      });
    });

  return {
    status: 'ok',
    items,
    meta: {
      queryWithSince,
      parseStatus: parsed.ok ? 'ok' : 'fallback_text',
      clusters: parsed.data.clusters || [],
      themes: parsed.data.themes || [],
      editorialSummary: parsed.data.editorialSummary || '',
      rawText: parsed.rawText || '',
    },
  };
}

async function collectSingleSource(source, context) {
  const startedAt = Date.now();

  try {
    if (source.kind === 'x_grok') {
      const xResult = await collectXGrok(source, context);
      return {
        source,
        status: xResult.status,
        items: xResult.items,
        meta: xResult.meta || {},
        durationMs: Date.now() - startedAt,
      };
    }

    if (source.kind === 'google_news') {
      const items = await collectGoogleNews(source, context);
      return {
        source,
        status: 'ok',
        items,
        meta: {},
        durationMs: Date.now() - startedAt,
      };
    }

    if (source.kind === 'amazon_bestseller') {
      const items = await collectAmazonBestseller(source, context);
      return {
        source,
        status: 'ok',
        items,
        meta: {},
        durationMs: Date.now() - startedAt,
      };
    }

    if (source.kind === 'rss_direct') {
      const items = await collectDirectRss(source, context);
      return {
        source,
        status: 'ok',
        items,
        meta: {},
        durationMs: Date.now() - startedAt,
      };
    }

    if (source.kind === 'tohan_bestseller') {
      const items = await collectTohanRanking(source, context);
      return {
        source,
        status: 'ok',
        items,
        meta: {},
        durationMs: Date.now() - startedAt,
      };
    }

    if (source.kind === 'rakuten_bestseller') {
      const items = await collectRakutenRanking(source, context);
      return { source, status: 'ok', items, meta: {}, durationMs: Date.now() - startedAt };
    }

    if (source.kind === 'honto_bestseller') {
      const items = await collectHontoRanking(source, context);
      return {
        source,
        status: 'ok',
        items,
        meta: {},
        durationMs: Date.now() - startedAt,
      };
    }

    if (source.kind === 'yurindo_bestseller') {
      const items = await collectYurindoRanking(source, context);
      return {
        source,
        status: 'ok',
        items,
        meta: {},
        durationMs: Date.now() - startedAt,
      };
    }

    return {
      source,
      status: 'skipped',
      items: [],
      meta: {
        reason: `未対応 source kind: ${source.kind}`,
      },
      durationMs: Date.now() - startedAt,
    };
  } catch (error) {
    return {
      source,
      status: 'error',
      items: [],
      meta: {
        reason: error.message || 'unknown error',
      },
      durationMs: Date.now() - startedAt,
    };
  }
}

async function mapWithConcurrency(items, concurrency, mapper) {
  const list = Array.isArray(items) ? items : [];
  if (list.length === 0) {
    return [];
  }

  const limit = Math.max(1, Math.min(Number(concurrency || 1), list.length));
  const results = new Array(list.length);
  let next = 0;

  async function worker() {
    while (next < list.length) {
      const index = next;
      next += 1;
      results[index] = await mapper(list[index], index);
    }
  }

  await Promise.all(Array.from({ length: limit }, () => worker()));
  return results;
}

function dedupeSignals(items) {
  const map = new Map();

  for (const item of items) {
    const keyBase = item.url ? `u:${item.url}` : `t:${String(item.title || '').toLowerCase()}`;
    const key = keyBase.trim();
    if (!key) continue;

    const current = map.get(key);
    if (!current) {
      map.set(key, item);
      continue;
    }

    const currentWeight = Number(current.metricValue || 0) + Number(current.sourcePriority || 0) * 3;
    const nextWeight = Number(item.metricValue || 0) + Number(item.sourcePriority || 0) * 3;
    if (nextWeight > currentWeight) {
      map.set(key, item);
    }
  }

  return Array.from(map.values());
}

async function collectThemeSignals(theme, options = {}) {
  const sinceDate = getSinceDate(theme.periodDays);
  const sourceCatalog = getSourceCatalog();
  const context = {
    theme,
    sinceDate,
    apiKey: options.apiKey || process.env.XAI_API_KEY || '',
    model: options.model || process.env.XAI_MODEL || 'grok-4-1-fast',
    timeoutMs: Number(options.timeoutMs || DEFAULT_TIMEOUT_MS),
  };

  const sourceResults = await mapWithConcurrency(
    sourceCatalog,
    Number(options.concurrency || DEFAULT_CONCURRENCY),
    (source) => collectSingleSource(source, context),
  );

  const rawItems = sourceResults.flatMap((result) => result.items || []);
  const deduped = dedupeSignals(rawItems);
  const xResult = sourceResults.find((result) => result.source.kind === 'x_grok') || null;

  const sourceStats = sourceResults.map((result) => ({
    sourceId: result.source.id,
    sourceName: result.source.name,
    category: result.source.category,
    status: result.status,
    costTier: result.source.costTier,
    count: Array.isArray(result.items) ? result.items.length : 0,
    durationMs: result.durationMs,
    error: result.meta?.reason || '',
  }));

  return {
    sinceDate,
    sourceStats,
    signals: deduped,
    sourceResultsCount: sourceResults.length,
    totalSignalsBeforeDedupe: rawItems.length,
    xMeta: xResult?.meta || null,
  };
}

module.exports = {
  collectThemeSignals,
};
