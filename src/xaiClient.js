const { ensureArray } = require('./utils');

function buildSystemPrompt() {
  return `You are an X (Twitter) analyst focused on Japanese publishing and adjacent industries.
Use the x_search tool to research posts, following the steps below.
Return ONLY valid JSON — no markdown, no explanation, no code blocks.

## Search Steps
1. Stage 1A: Search the user query in Latest mode with min_faves:0, limit:30.
   Target: posts within the last 36 hours — captures breaking news even with low engagement.
2. Stage 1B: Search the same query in Top mode with min_faves:50, limit:20.
   Target: posts with meaningful engagement (popular posts).
3. Merge Stage 1A + 1B. Identify 3-5 topic clusters.
4. Stage 2: For each cluster, run one focused search (Top mode, min_faves:50, limit:15).
5. Collect all posts from Stage 1A, 1B, and Stage 2.
   Merge into a single list. Sort by likes descending. Select top 10 as materials.

## Output schema (strict JSON only)
{
  "editorialSummary": "今日の出版業界を30字程度でキャッチーに表現した日本語の一文。書籍名・著者名・具体的なトピックを盛り込む。",
  "clusters": [
    {
      "name": "クラスター名（日本語、10字以内）",
      "keyphrases": ["フレーズ1", "フレーズ2", "フレーズ3"],
      "posts": [
        {"url": "https://x.com/i/status/...", "summary": "1-2行の日本語要約", "likes": 0},
        {"url": "https://x.com/i/status/...", "summary": "1-2行の日本語要約", "likes": 0}
      ]
    }
  ],
  "themes": ["テーマ1", "テーマ2", "テーマ3", "テーマ4", "テーマ5"],
  "materials": [
    {"url": "https://x.com/i/status/...", "summary": "1-2行の日本語要約", "likes": 0}
  ]
}

## Priority Sources（優先すべき発信元）
Actively prioritize posts from commercial publishing industry professionals:
- 商業出版社: 講談社、小学館、集英社、文藝春秋、新潮社、KADOKAWA、幻冬舎、光文社、岩波書店、中央公論新社、河出書房新社、PHP研究所、宝島社、ダイヤモンド社、東洋経済新報社、日経BP、朝日新聞出版、双葉社、早川書房、白水社
- 書店: 紀伊國屋書店、三省堂書店、丸善、ジュンク堂、有隣堂、蔦屋書店/TSUTAYA、未来屋書店、ブックファースト
- 書評家・文芸評論家・読書インフルエンサー
- 商業デビュー済みの作家（出版社から書籍を出している作家）
- 出版社・書店のPR・宣伝・編集担当者
- 業界紙・メディア記者（新文化、文化通信、HON.jp など）

## Exclude（除外すべき投稿）
Do NOT include posts that are primarily about:
- 同人誌・コミケ・コミティア・即売会への参加・頒布告知
- 二次創作・ファンアート・ファン小説
- 同人作家による自作品の宣伝や感想
- pixiv・novelなどの個人投稿プラットフォームのみで活動するアカウントのPR

## Rules
- editorialSummary は検索結果に基づいた今日ならではの一文にする（「今日は〜」「〜が話題」など）
- materials = all posts from all stages merged, sorted by likes descending, top 10 only
- summary must be Japanese and paraphrased (do not copy tweet verbatim)
- avoid unverified rumors
- prioritize official announcements, book launches, reviews, personnel updates, and media publicity`;
}

async function callResponsesApi({ apiKey, model, queryWithSince }) {
  const payload = {
    model,
    instructions: buildSystemPrompt(),
    input: [
      {
        role: 'user',
        content: queryWithSince,
      },
    ],
    tools: [{ type: 'x_search' }],
    temperature: 0.3,
  };

  const response = await fetch('https://api.x.ai/v1/responses', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(payload),
  });

  const text = await response.text();

  if (!response.ok) {
    throw new Error(`xAI API エラー ${response.status}: ${text.slice(0, 400)}`);
  }

  return text;
}

function findAssistantText(responseJson) {
  if (typeof responseJson.output_text === 'string' && responseJson.output_text.trim()) {
    return responseJson.output_text;
  }

  const output = ensureArray(responseJson.output);

  for (const item of output) {
    if (item && item.role === 'assistant' && Array.isArray(item.content)) {
      for (const contentItem of item.content) {
        if (contentItem && contentItem.type === 'output_text' && typeof contentItem.text === 'string') {
          return contentItem.text;
        }
      }
    }
  }

  return '';
}

function extractJsonText(text) {
  const trimmed = String(text || '').trim();
  if (!trimmed) return '';

  const codeBlock = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (codeBlock && codeBlock[1]) {
    return codeBlock[1].trim();
  }

  if (trimmed.startsWith('{') && trimmed.endsWith('}')) {
    return trimmed;
  }

  const firstBrace = trimmed.indexOf('{');
  const lastBrace = trimmed.lastIndexOf('}');
  if (firstBrace >= 0 && lastBrace > firstBrace) {
    return trimmed.slice(firstBrace, lastBrace + 1);
  }

  return trimmed;
}

function toNumber(value) {
  const num = Number(value);
  return Number.isFinite(num) ? num : 0;
}

function normalizeTrendData(rawData) {
  const source = rawData && typeof rawData === 'object' ? rawData : {};

  const clusters = ensureArray(source.clusters)
    .slice(0, 5)
    .map((cluster) => {
      const posts = ensureArray(cluster.posts)
        .slice(0, 2)
        .map((post) => ({
          url: String(post.url || '').trim(),
          summary: String(post.summary || '').trim(),
          likes: toNumber(post.likes),
        }))
        .filter((post) => post.url);

      return {
        name: String(cluster.name || '').trim() || '無題クラスター',
        keyphrases: ensureArray(cluster.keyphrases)
          .map((phrase) => String(phrase || '').trim())
          .filter(Boolean)
          .slice(0, 5),
        posts,
      };
    })
    .filter((cluster) => cluster.posts.length > 0 || cluster.keyphrases.length > 0);

  const themes = ensureArray(source.themes)
    .map((theme) => String(theme || '').trim())
    .filter(Boolean)
    .slice(0, 10);

  let materials = ensureArray(source.materials)
    .map((post) => ({
      url: String(post.url || '').trim(),
      summary: String(post.summary || '').trim(),
      likes: toNumber(post.likes),
    }))
    .filter((post) => post.url);

  if (materials.length === 0) {
    materials = clusters.flatMap((cluster) => cluster.posts);
  }

  materials = materials
    .sort((a, b) => b.likes - a.likes)
    .slice(0, 10);

  const editorialSummary = typeof source.editorialSummary === 'string'
    ? source.editorialSummary.trim()
    : '';

  return {
    clusters,
    themes,
    materials,
    editorialSummary,
  };
}

function parseGrokResponse(rawJsonText) {
  const responseJson = JSON.parse(rawJsonText);
  const assistantText = findAssistantText(responseJson);

  if (!assistantText) {
    throw new Error('Grok から output_text を取得できませんでした');
  }

  const jsonText = extractJsonText(assistantText);

  try {
    const parsed = JSON.parse(jsonText);
    return {
      ok: true,
      data: normalizeTrendData(parsed),
      rawText: assistantText,
    };
  } catch {
    return {
      ok: false,
      data: normalizeTrendData({
        materials: [],
        themes: [],
        clusters: [],
      }),
      rawText: assistantText,
    };
  }
}

module.exports = {
  callResponsesApi,
  parseGrokResponse,
  normalizeTrendData,
};
