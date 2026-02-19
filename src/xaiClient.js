const { ensureArray } = require('./utils');

function buildSystemPrompt() {
  return `You are an X (Twitter) trend analysis AI for the Japanese community.
Use the x_search tool to research posts, following the steps below.
Return ONLY valid JSON — no markdown, no explanation, no code blocks.

## Search Steps
1. Stage 1A: Search the user query in Latest mode with min_faves:0, limit:30.
2. Stage 1B: Search the same query in Top mode with min_faves:50, limit:20.
3. Identify 3-5 clusters from Stage 1A + 1B combined results.
4. Stage 2: For each cluster, search representative keywords with min_faves:50 in Top mode.
5. Select top 2 posts per cluster by likes.

## Output schema (strict JSON only)
{
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

## Rules
- materials = all cluster posts merged, sorted by likes descending, top 10 only
- summary must be Japanese and paraphrased
- avoid unverified rumors
- prioritize official announcements and first-person reports`;
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

  return {
    clusters,
    themes,
    materials,
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
