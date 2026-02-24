const { ensureArray } = require('./utils');

function buildSystemPrompt() {
  return `You are a Japanese publishing industry analyst. Use the x_search tool to find popular X posts.
Return ONLY valid JSON — no markdown, no explanation, no code blocks.

## Search Instructions
1. Search the user's query in Top mode with min_faves:10, limit:30. Find the most-liked posts.
2. If fewer than 5 posts are found, also search in Latest mode with min_faves:5, limit:20.
3. Merge results. Sort by likes descending. Select top 10 as materials.

## Output schema (strict JSON only)
{
  "editorialSummary": "30字以内の日本語一文（書籍名・著者名・具体的トピックを盛り込む）",
  "clusters": [
    {
      "name": "クラスター名（10字以内）",
      "keyphrases": ["フレーズ1", "フレーズ2", "フレーズ3"],
      "posts": [
        {"url": "https://x.com/i/status/...", "summary": "1-2行の日本語要約", "likes": 0}
      ]
    }
  ],
  "themes": ["テーマ1", "テーマ2", "テーマ3"],
  "materials": [
    {"url": "https://x.com/i/status/...", "summary": "1-2行の日本語要約", "likes": 0}
  ]
}

## Priority Sources（優先すべき発信元）
- 商業出版社: 講談社、小学館、集英社、文藝春秋、新潮社、KADOKAWA、幻冬舎、光文社、岩波書店、中央公論新社、河出書房新社、宝島社、ダイヤモンド社、東洋経済新報社、日経BP、朝日新聞出版、早川書房
- 書店: 紀伊國屋書店、三省堂書店、丸善、ジュンク堂、有隣堂、蔦屋書店/TSUTAYA
- 書評家・著者・編集者・出版PR担当者・業界メディア（新文化、文化通信、HON.jp）

## Exclude（除外）
- 同人誌・コミケ・コミティア・二次創作・ファンアート・ファン小説
- pixiv・novelなどの個人投稿プラットフォームのみで活動するアカウント

## Rules
- materials: いいね数降順、上位10件のみ
- summary は日本語で要約（投稿をそのままコピーしない）
- 結果が0件でも必ず上記のJSON構造を返す（空配列可）`;
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
  // トップレベルの output_text（最も確実）
  if (typeof responseJson.output_text === 'string' && responseJson.output_text.trim()) {
    return responseJson.output_text;
  }

  const output = ensureArray(responseJson.output);

  for (const item of output) {
    if (!item || !Array.isArray(item.content)) continue;

    // 通常モデル: role=assistant
    // 推論モデル（grok-*-reasoning）: type=message で role がない場合もある
    const isAssistantMsg = item.role === 'assistant' || item.type === 'message';
    if (!isAssistantMsg) continue;

    for (const contentItem of item.content) {
      if (!contentItem || typeof contentItem.text !== 'string') continue;
      // output_text（標準）と text（推論モデルの代替フォーマット）の両方に対応
      if (contentItem.type === 'output_text' || contentItem.type === 'text') {
        const text = contentItem.text.trim();
        if (text) return text;
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
