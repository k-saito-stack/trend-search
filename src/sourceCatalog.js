const GOOGLE_NEWS_BASE = 'https://news.google.com/rss/search';

const SOURCE_CATALOG = [
  {
    id: 'x_grok_social',
    kind: 'x_grok',
    name: 'X / Grok x_search',
    category: 'social',
    costTier: 'api',
    priority: 5,
    itemLimit: 14,
  },
  {
    id: 'news_publish_general',
    kind: 'google_news',
    name: 'Google News / 出版業界全般',
    category: 'industry_news',
    costTier: 'free',
    priority: 4,
    itemLimit: 8,
    queryTemplate: '{theme} 出版 業界 OR 書籍 OR 書店 OR 電子書籍',
  },
  {
    id: 'news_pr_times',
    kind: 'google_news',
    name: 'Google News / PR TIMES',
    category: 'press_release',
    costTier: 'free',
    priority: 4,
    itemLimit: 8,
    queryTemplate: '{theme} PR TIMES OR プレスリリース 出版',
  },
  {
    id: 'news_book_review',
    kind: 'google_news',
    name: 'Google News / 書評・レビュー',
    category: 'book_review',
    costTier: 'free',
    priority: 4,
    itemLimit: 8,
    queryTemplate: '{theme} 書評 OR レビュー OR 読了 OR 感想',
  },
  {
    id: 'news_new_release',
    kind: 'google_news',
    name: 'Google News / 新刊・発売情報',
    category: 'new_release',
    costTier: 'free',
    priority: 4,
    itemLimit: 8,
    queryTemplate: '{theme} 新刊 OR 発売 OR 刊行 OR 重版',
  },
  {
    id: 'news_personnel',
    kind: 'google_news',
    name: 'Google News / 人事・組織変更',
    category: 'personnel',
    costTier: 'free',
    priority: 3,
    itemLimit: 8,
    queryTemplate: '{theme} 出版 人事 OR 異動 OR 就任 OR 退任',
  },
  {
    id: 'news_tv_publicity',
    kind: 'google_news',
    name: 'Google News / テレビ露出',
    category: 'publicity_tv',
    costTier: 'free',
    priority: 3,
    itemLimit: 8,
    queryTemplate: '{theme} 出版 テレビ OR 番組 出演 OR 特集',
  },
  {
    id: 'news_radio_publicity',
    kind: 'google_news',
    name: 'Google News / ラジオ露出',
    category: 'publicity_radio',
    costTier: 'free',
    priority: 3,
    itemLimit: 8,
    queryTemplate: '{theme} 出版 ラジオ OR 放送 OR 出演',
  },
  {
    id: 'news_bookstore',
    kind: 'google_news',
    name: 'Google News / 書店・小売',
    category: 'retail',
    costTier: 'free',
    priority: 3,
    itemLimit: 8,
    queryTemplate: '{theme} 書店 OR 取次 OR フェア OR 売場',
  },
  {
    id: 'news_ebook',
    kind: 'google_news',
    name: 'Google News / 電子書籍・配信',
    category: 'digital',
    costTier: 'free',
    priority: 3,
    itemLimit: 8,
    queryTemplate: '{theme} 電子書籍 OR Kindle OR Kobo OR 配信',
  },
  {
    id: 'news_printing',
    kind: 'google_news',
    name: 'Google News / 印刷・紙・製本',
    category: 'supply_chain',
    costTier: 'free',
    priority: 3,
    itemLimit: 8,
    queryTemplate: '{theme} 印刷 OR 用紙 OR 製本 OR 値上げ',
  },
  {
    id: 'news_distribution',
    kind: 'google_news',
    name: 'Google News / 流通・物流',
    category: 'supply_chain',
    costTier: 'free',
    priority: 3,
    itemLimit: 8,
    queryTemplate: '{theme} 書籍 物流 OR 配本 OR 流通 OR 在庫',
  },
  {
    id: 'news_library_education',
    kind: 'google_news',
    name: 'Google News / 図書館・教育連携',
    category: 'education',
    costTier: 'free',
    priority: 2,
    itemLimit: 8,
    queryTemplate: '{theme} 図書館 OR 学校 図書 OR 教育 出版',
  },
  {
    id: 'news_media_mix',
    kind: 'google_news',
    name: 'Google News / 映像化・メディアミックス',
    category: 'ip',
    costTier: 'free',
    priority: 2,
    itemLimit: 8,
    queryTemplate: '{theme} 映像化 OR ドラマ化 OR アニメ化 OR メディアミックス',
  },
  {
    id: 'news_awards',
    kind: 'google_news',
    name: 'Google News / 受賞・ランキング',
    category: 'awards',
    costTier: 'free',
    priority: 2,
    itemLimit: 8,
    queryTemplate: '{theme} 受賞 OR ランキング OR ベストセラー',
  },
  {
    id: 'ranking_amazon_books',
    kind: 'amazon_bestseller',
    name: 'Amazonランキング / 本',
    category: 'ranking',
    costTier: 'free',
    priority: 4,
    itemLimit: 15,
    url: 'https://www.amazon.co.jp/gp/bestsellers/books',
  },
  {
    id: 'ranking_amazon_kindle',
    kind: 'amazon_bestseller',
    name: 'Amazonランキング / Kindle',
    category: 'ranking',
    costTier: 'free',
    priority: 4,
    itemLimit: 15,
    url: 'https://www.amazon.co.jp/gp/bestsellers/digital-text',
  },
  {
    id: 'ranking_tohan_weekly',
    kind: 'tohan_bestseller',
    name: 'トーハン週間 / 総合',
    category: 'ranking',
    costTier: 'free',
    priority: 4,
    itemLimit: 10,
    url: 'https://www.tohan.jp/bestsellers/',
  },
  {
    id: 'ranking_honto_ebook',
    kind: 'honto_bestseller',
    name: 'hontoランキング / 電子書籍',
    category: 'ranking',
    costTier: 'free',
    priority: 4,
    itemLimit: 10,
    url: 'https://honto.jp/ranking/gr/bestseller_1101_1204_012.html',
  },
  {
    id: 'ranking_maruzen',
    kind: 'honto_bestseller',
    name: '丸善ランキング',
    category: 'ranking',
    costTier: 'free',
    priority: 4,
    itemLimit: 10,
    url: 'https://honto.jp/ranking/gr/bestseller_1101_1206_011.html?shgcd=HB310',
  },
  {
    id: 'ranking_junkudo',
    kind: 'honto_bestseller',
    name: 'ジュンク堂ランキング',
    category: 'ranking',
    costTier: 'free',
    priority: 4,
    itemLimit: 10,
    url: 'https://honto.jp/ranking/gr/bestseller_1101_1206_011.html?shgcd=HB320',
  },
  {
    id: 'hatenabookmark_books',
    kind: 'rss_direct',
    name: 'はてブ / 本',
    category: 'book_review',
    costTier: 'free',
    priority: 3,
    itemLimit: 8,
    url: 'https://b.hatena.ne.jp/q/%E8%AA%AD%E6%9B%B8?mode=rss&sort=recent&users=3',
  },
  {
    id: 'news_bunshun_online',
    kind: 'rss_direct',
    name: '文藝春秋オンライン',
    category: 'industry_news',
    costTier: 'free',
    priority: 3,
    itemLimit: 6,
    url: 'https://bunshun.jp/list/feed/rss',
  },
  {
    id: 'news_gendai_media',
    kind: 'google_news',
    name: 'Google News / 現代ビジネス',
    category: 'industry_news',
    costTier: 'free',
    priority: 3,
    itemLimit: 6,
    queryTemplate: '現代ビジネス 講談社 出版 OR 書籍 OR 新刊',
  },
  {
    id: 'news_shinbunka',
    kind: 'rss_direct',
    name: '新文化オンライン',
    category: 'industry_news',
    costTier: 'free',
    priority: 4,
    itemLimit: 8,
    maxAgeDays: 7,
    url: 'https://www.shinbunka.co.jp/feed',
  },
  {
    id: 'news_hon_jp',
    kind: 'rss_direct',
    name: 'HON.jp News Blog',
    category: 'digital',
    costTier: 'free',
    priority: 3,
    itemLimit: 6,
    url: 'https://hon.jp/news/feed',
  },
];

function buildGoogleNewsRssUrl(query) {
  const params = new URLSearchParams({
    q: query,
    hl: 'ja',
    gl: 'JP',
    ceid: 'JP:ja',
  });
  return `${GOOGLE_NEWS_BASE}?${params.toString()}`;
}

function parseSourceFilter() {
  const text = String(process.env.ENABLED_SOURCE_IDS || '').trim();
  if (!text) {
    return null;
  }

  return new Set(
    text
      .split(',')
      .map((id) => id.trim())
      .filter(Boolean),
  );
}

function getSourceCatalog() {
  const includeX = process.env.SOURCE_ENABLE_X !== '0';
  const explicitFilter = parseSourceFilter();

  return SOURCE_CATALOG.filter((source) => {
    if (!includeX && source.kind === 'x_grok') {
      return false;
    }

    if (explicitFilter && !explicitFilter.has(source.id)) {
      return false;
    }

    return true;
  });
}

function summarizeSourceCost(catalog = getSourceCatalog()) {
  let free = 0;
  let api = 0;

  for (const source of catalog) {
    if (source.costTier === 'api') {
      api += 1;
    } else {
      free += 1;
    }
  }

  return {
    total: catalog.length,
    free,
    api,
  };
}

module.exports = {
  getSourceCatalog,
  summarizeSourceCost,
  buildGoogleNewsRssUrl,
};
