const { createId, getSinceDate } = require('./utils');
const { callResponsesApi, parseGrokResponse } = require('./xaiClient');
const { parseRssFeed, stripTags } = require('./rssParser');
const { getSourceCatalog, buildGoogleNewsRssUrl } = require('./sourceCatalog');

const DEFAULT_TIMEOUT_MS = Number(process.env.SOURCE_HTTP_TIMEOUT_MS || 12000);
const DEFAULT_CONCURRENCY = Math.max(1, Number(process.env.SOURCE_CONCURRENCY || 4));
const DEFAULT_MAX_RESPONSE_BYTES = Math.max(64 * 1024, Number(process.env.SOURCE_MAX_RESPONSE_BYTES || 2 * 1024 * 1024));
const DEFAULT_USER_AGENT = 'TodaysInSaitoCollector/0.2 (+https://localhost)';

// ボット検知を回避するためのブラウザUser-Agent一覧（ランダムで使用）
const BROWSER_USER_AGENTS = [
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:134.0) Gecko/20100101 Firefox/134.0',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.2 Safari/605.1.15',
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
];

function randomUserAgent() {
  return BROWSER_USER_AGENTS[Math.floor(Math.random() * BROWSER_USER_AGENTS.length)];
}

function truncate(text, max = 180) {
  const clean = String(text || '').replace(/\s+/g, ' ').trim();
  if (clean.length <= max) return clean;
  return `${clean.slice(0, max - 1)}…`;
}

function normalizeUrl(rawUrl) {
  const value = String(rawUrl || '').trim();
  if (!value) return '';

  try {
    const parsed = new URL(value);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return '';
    }
    parsed.hash = '';
    parsed.searchParams.delete('utm_source');
    parsed.searchParams.delete('utm_medium');
    parsed.searchParams.delete('utm_campaign');
    parsed.searchParams.delete('utm_term');
    parsed.searchParams.delete('utm_content');
    return parsed.toString();
  } catch {
    return '';
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
  const maxResponseBytes = Number(options.maxResponseBytes || DEFAULT_MAX_RESPONSE_BYTES);
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

    const contentLength = Number(response.headers.get('content-length') || 0);
    if (Number.isFinite(contentLength) && contentLength > maxResponseBytes) {
      throw new Error(`response too large: ${contentLength} bytes (max ${maxResponseBytes})`);
    }

    const text = await readResponseTextWithLimit(response, maxResponseBytes, controller);
    if (!response.ok) {
      throw new Error(`${response.status} ${response.statusText}`.trim());
    }
    return text;
  } finally {
    clearTimeout(timer);
  }
}

async function readResponseTextWithLimit(response, maxBytes, controller) {
  if (!response.body || typeof response.body.getReader !== 'function') {
    const text = await response.text();
    if (Buffer.byteLength(text, 'utf8') > maxBytes) {
      throw new Error(`response too large (max ${maxBytes} bytes)`);
    }
    return text;
  }

  const reader = response.body.getReader();
  const chunks = [];
  let total = 0;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    const chunk = value || new Uint8Array(0);
    total += chunk.byteLength;

    if (total > maxBytes) {
      controller.abort();
      throw new Error(`response too large (max ${maxBytes} bytes)`);
    }

    chunks.push(chunk);
  }

  const merged = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.byteLength;
  }

  return new TextDecoder('utf-8', { fatal: false }).decode(merged);
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
  // X検索: 長いクエリは精度が落ちるため短く絞る
  // 7日分の窓でバズった投稿を確実に捕捉（Top モードで人気順に取得）
  const xSinceDate = getSinceDate(7);
  return `出版社 OR 書評 OR 新刊 OR ベストセラー OR 重版 -同人誌 -コミケ since:${xSinceDate}`;
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
    if (!title || title.length < 2) continue;

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

  // h2.stHeading ブロックを全て取得し、各ブロックで最適なURLを選ぶ
  // 電子書籍ページと紙書籍ページの両方に対応（if/else を使わず常に全件抽出）
  const blockPattern = /<h2[^>]+class="stHeading"[^>]*>([\s\S]*?)<\/h2>/gi;
  let hit;
  while ((hit = blockPattern.exec(html)) && results.length < limit * 2) {
    const block = hit[1];
    const title = stripTags(block).trim();
    if (!title || title.length < 2) continue;
    const key = title.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);

    // ① /ebook/pd_ リンクを優先（電子書籍専用ページ）
    const ebookMatch = block.match(/href="(https?:\/\/honto\.jp\/ebook\/pd_[^"]+)"/i);
    // ② /netstore/pd_ リンク（紙書籍商品ページ）
    const netstoreMatch = block.match(/href="(https?:\/\/honto\.jp\/netstore\/pd_[^"]+)"/i);

    let url;
    if (ebookMatch) {
      url = ebookMatch[1].split('?')[0];
    } else if (netstoreMatch) {
      url = netstoreMatch[1].split('?')[0];
    } else {
      // 個別URLなし → 書名検索URLを生成
      url = `https://honto.jp/netstore/search.html?search.keyword=${encodeURIComponent(title)}`;
    }

    results.push({ url, title, summary: `${title}（hontoランキング）` });
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

function parseYahooFollow(html, limit) {
  const results = [];
  const seen = new Set();
  // Yahoo Follow (Next.js SSR): <a href="https://news.yahoo.co.jp/articles/[hex40]">...<h2...>TITLE</h2>...</a>
  const pattern = /<a[^>]+href="(https:\/\/news\.yahoo\.co\.jp\/articles\/[a-f0-9]{40})"[^>]*>[\s\S]*?<h2[^>]*>([\s\S]*?)<\/h2>/gi;
  let hit;
  while ((hit = pattern.exec(html)) && results.length < limit) {
    const url = hit[1];
    const title = stripTags(hit[2]).trim();
    if (!title || title.length < 5) continue;
    if (seen.has(url)) continue;
    seen.add(url);
    results.push({ url, title });
  }
  return results.slice(0, limit);
}

async function collectYahooFollow(source, context) {
  const html = await fetchText(source.url, {
    timeoutMs: context.timeoutMs,
    headers: {
      'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/120',
      'Accept-Language': 'ja,en-US;q=0.9',
    },
  });
  const entries = parseYahooFollow(html, Number(source.itemLimit || 10));
  return entries.map((entry) =>
    makeSignal(source, {
      title: entry.title,
      summary: entry.title,
      url: entry.url,
      metricLabel: 'mentions',
      metricValue: 1,
    }),
  );
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

async function collectRssRanking(source, context) {
  const xml = await fetchText(source.url, { timeoutMs: context.timeoutMs });
  const entries = parseRssFeed(xml);

  return entries
    .filter((entry) => entry.link)
    .slice(0, Number(source.itemLimit || 10))
    .map((entry, index) =>
      makeSignal(source, {
        title: entry.title,
        summary: entry.summary || entry.title,
        url: entry.link,
        publishedAt: entry.publishedAt || null,
        metricLabel: 'rank',
        metricValue: index + 1,
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

function isRobotCheck(html) {
  return /Robot Check|captcha|Enter the characters|文字を入力/i.test(html);
}

function isLikelyPriceText(text) {
  const normalized = String(text || '').replace(/\s+/g, ' ').trim();
  if (!normalized) return false;

  const compact = normalized
    .replace(/^価格\s*[:：]?\s*/i, '')
    .replace(/^(?:税込|税抜)\s*/i, '')
    .trim();

  return /^(?:(?:USD|US\$|JPY|JP¥|EUR|GBP|CAD|AUD|HKD|SGD|CNY|RMB|KRW)\s*)?[¥￥$€£]?\s*\d[\d,，]*(?:\.\d+)?\s*(?:円|ドル|USD|JPY|EUR|GBP)?$/i.test(compact);
}

function parseAmazonRankingPage(html, limit) {
  const results = [];
  const seen = new Set();
  const pattern = /<a[^>]+href="([^"]*\/dp\/([A-Z0-9]{10})[^"]*)"[^>]*>([\s\S]*?)<\/a>/gi;
  let hit;

  while ((hit = pattern.exec(html)) && results.length < limit * 3) {
    const asin = hit[2];
    const body = hit[3];
    const bodyText = stripTags(body).replace(/\s+/g, ' ').trim();
    const altMatch = body.match(/alt="([^"]+)"/i);
    const altText = altMatch ? stripTags(altMatch[1]).replace(/\s+/g, ' ').trim() : '';

    let titleCandidate = bodyText;
    // 価格だけを拾った場合は、画像alt（書名）を優先して救済する
    if (isLikelyPriceText(bodyText) && altText && !isLikelyPriceText(altText)) {
      titleCandidate = altText;
    } else if ((!titleCandidate || titleCandidate.length < 5) && altText) {
      titleCandidate = altText;
    }
    const title = truncate(titleCandidate, 120);

    if (!title || title.length < 3) continue;
    if (seen.has(asin)) continue;
    if (/Amazon\.co\.jp|カート|ほしい物リスト|ポイント/i.test(title)) continue;
    if (/マスターカード|クレジットカード|ギフト券|Unlimited|プライム会員|Echo|Kindle端末|Fire\s*(?:TV|タブレット)|Alexa/i.test(title)) continue;
    if (isLikelyPriceText(title)) continue;

    seen.add(asin);
    results.push({
      asin,
      title,
      url: `https://www.amazon.co.jp/dp/${asin}`,
    });
  }

  return results.slice(0, limit);
}

async function collectAmazonRanking(source, context) {
  const urls = source.urls || [source.url];
  let lastError = '';

  for (const url of urls) {
    try {
      // ランダムな待ち時間（1〜3秒）で人間らしいアクセス間隔を再現
      const delay = 1000 + Math.floor(Math.random() * 2000);
      await new Promise((r) => setTimeout(r, delay));

      const html = await fetchText(url, {
        timeoutMs: context.timeoutMs,
        headers: {
          'User-Agent': randomUserAgent(),
          'Accept-Language': 'ja-JP,ja;q=0.9,en-US;q=0.8,en;q=0.7',
          'Referer': 'https://www.amazon.co.jp/',
        },
      });

      if (isRobotCheck(html)) {
        lastError = `Robot Check detected: ${url}`;
        console.log(`[amazon_ranking] ${lastError}`);
        continue;
      }

      const entries = parseAmazonRankingPage(html, Number(source.itemLimit || 10));
      if (entries.length === 0) {
        lastError = `0件抽出: ${url}`;
        console.log(`[amazon_ranking] ${lastError}`);
        continue;
      }

      return entries.map((entry, index) =>
        makeSignal(source, {
          title: entry.title,
          summary: `${entry.title}（Amazonランキング）`,
          url: entry.url,
          metricLabel: 'rank',
          metricValue: index + 1,
        }),
      );
    } catch (err) {
      lastError = `${url}: ${err.message}`;
      console.log(`[amazon_ranking] fetch失敗: ${lastError}`);
    }
  }

  throw new Error(lastError || 'all URLs failed');
}

function parseKinseriDeals(html, limit) {
  const results = [];
  const seen = new Set();
  // <li> 内の <a href="...dp/ASIN...">タイトル</a> <span>価格円</span>
  const pattern = /<li[^>]*>[\s\S]*?<a[^>]+href="(https?:\/\/www\.amazon\.co\.jp\/dp\/[^"]+)"[^>]*>([\s\S]*?)<\/a>[\s\S]*?([\d,]+)円/gi;
  let hit;
  while ((hit = pattern.exec(html)) && results.length < limit * 2) {
    const url = hit[1].trim();
    const title = stripTags(hit[2]).trim();
    const price = hit[3];
    if (!title || title.length < 2) continue;
    if (seen.has(url)) continue;
    seen.add(url);
    results.push({
      title,
      url,
      summary: `${title}（${price}円）`,
    });
  }
  return results.slice(0, limit);
}

async function collectKinseriDeals(source, context) {
  const html = await fetchText(source.url, {
    timeoutMs: context.timeoutMs,
    headers: {
      'User-Agent': randomUserAgent(),
      'Accept-Language': 'ja,en-US;q=0.9',
    },
  });
  const entries = parseKinseriDeals(html, Number(source.itemLimit || 20));
  return entries.map((entry) =>
    makeSignal(source, {
      title: entry.title,
      summary: entry.summary,
      url: entry.url,
      metricLabel: '',
      metricValue: 0,
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

    if (source.kind === 'amazon_ranking') {
      const items = await collectAmazonRanking(source, context);
      return { source, status: 'ok', items, meta: {}, durationMs: Date.now() - startedAt };
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

    if (source.kind === 'rss_ranking') {
      const items = await collectRssRanking(source, context);
      return { source, status: 'ok', items, meta: {}, durationMs: Date.now() - startedAt };
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

    if (source.kind === 'yahoo_follow') {
      const items = await collectYahooFollow(source, context);
      return { source, status: 'ok', items, meta: {}, durationMs: Date.now() - startedAt };
    }

    if (source.kind === 'kinseri_deals') {
      const items = await collectKinseriDeals(source, context);
      return { source, status: 'ok', items, meta: {}, durationMs: Date.now() - startedAt };
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
  // ランキングアイテムは書店ごとの独立したリストを保持するため重複排除から除外
  const rankingItems = items.filter((item) => item.sourceCategory === 'ranking');
  const otherItems = items.filter((item) => item.sourceCategory !== 'ranking');

  for (const item of otherItems) {
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

  return [...Array.from(map.values()), ...rankingItems];
}

async function collectThemeSignals(theme, options = {}) {
  const sinceDate = getSinceDate(theme.periodDays);
  const sourceMode = String(options.sourceMode || 'all').trim();
  const sourceCatalog = getSourceCatalog().filter((source) => {
    if (sourceMode === 'news_social') {
      return source.kind === 'x_grok' || (source.category !== 'ranking' && source.category !== 'deals');
    }
    return true;
  });
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
  _private: {
    parseAmazonRankingPage,
    isLikelyPriceText,
  },
};
