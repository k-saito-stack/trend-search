function stripCdata(value) {
  const text = String(value || '');
  const cdata = text.match(/^<!\[CDATA\[([\s\S]*)\]\]>$/i);
  return cdata ? cdata[1] : text;
}

function decodeHtmlEntities(text) {
  return String(text || '')
    .replaceAll('&amp;', '&')
    .replaceAll('&lt;', '<')
    .replaceAll('&gt;', '>')
    .replaceAll('&quot;', '"')
    .replaceAll('&#39;', "'")
    .replaceAll('&nbsp;', ' ')
    .replaceAll('&#x2F;', '/');
}

function stripTags(text) {
  return decodeHtmlEntities(
    String(text || '')
      .replace(/<script[\s\S]*?<\/script>/gi, ' ')
      .replace(/<style[\s\S]*?<\/style>/gi, ' ')
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim(),
  );
}

function findTagValue(block, tagName) {
  const regex = new RegExp(`<${tagName}[^>]*>([\\s\\S]*?)<\\/${tagName}>`, 'i');
  const hit = String(block || '').match(regex);
  return hit ? stripCdata(hit[1]).trim() : '';
}

function findAtomLink(block) {
  const hit = String(block || '').match(/<link[^>]*href="([^"]+)"[^>]*\/?>/i);
  return hit ? hit[1].trim() : '';
}

function normalizeItem(raw, mode) {
  if (mode === 'atom') {
    const title = stripTags(findTagValue(raw, 'title'));
    const summary = stripTags(findTagValue(raw, 'summary') || findTagValue(raw, 'content'));
    const link = findAtomLink(raw) || stripTags(findTagValue(raw, 'link'));
    const publishedAt =
      stripTags(findTagValue(raw, 'published')) ||
      stripTags(findTagValue(raw, 'updated')) ||
      stripTags(findTagValue(raw, 'dc:date'));

    return {
      title,
      link,
      summary,
      publishedAt,
    };
  }

  const title = stripTags(findTagValue(raw, 'title'));
  const link =
    stripTags(findTagValue(raw, 'link')) ||
    stripTags(findTagValue(raw, 'guid'));
  const summary =
    stripTags(findTagValue(raw, 'description')) ||
    stripTags(findTagValue(raw, 'content:encoded'));
  const publishedAt =
    stripTags(findTagValue(raw, 'pubDate')) ||
    stripTags(findTagValue(raw, 'dc:date'));

  return {
    title,
    link,
    summary,
    publishedAt,
  };
}

function parseRssFeed(xmlText) {
  const xml = String(xmlText || '');
  if (!xml.trim()) {
    return [];
  }

  const isAtom = /<feed[\s>]/i.test(xml) && /<entry[\s>]/i.test(xml);
  const pattern = isAtom ? /<entry\b[\s\S]*?<\/entry>/gi : /<item\b[\s\S]*?<\/item>/gi;
  const blocks = xml.match(pattern) || [];

  return blocks
    .map((block) => normalizeItem(block, isAtom ? 'atom' : 'rss'))
    .filter((item) => item.title || item.link);
}

module.exports = {
  parseRssFeed,
  stripTags,
};
