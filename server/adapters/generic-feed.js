// 通用 RSS/JSON Feed adapter：FB/Threads/IG 經 rss.app 或 RSSHub 轉 feed 後接入。
// feeds.json 加 {url, region, source_name, trust} 即生效。
import { ingestItem, fetchWithUA } from './util.js';
import { summarize } from '../summarize.js';
import { scan } from '../trust.js';

export async function runFeed(feed) {
  let added = 0;
  try {
    const res = await fetchWithUA(feed.url);
    if (!res.ok) { console.warn(`[feed:${feed.source_name}]`, res.status); return 0; }
    const text = await res.text();
    const items = text.trimStart().startsWith('{') ? parseJsonFeed(text) : parseRss(text);

    for (const it of items.slice(0, 20)) {
      const content = it.content || it.title || '';
      const { summary, kind, price, currency } = summarize(content, { source: feed.source_name });
      const flags = scan(content);
      const ok = await ingestItem({
        adapterId: `feed-${feed.source_name}`,
        region: feed.region,
        source: feed.source_name,
        trust: feed.trust || 'community',
        title: summary,
        summary,
        original: content.slice(0, 1000),
        url: it.url,
        price, currency,
        kindHint: kind,
        flags: flags.length ? flags : null,
        published_at: it.published_at,
      });
      if (ok) added++;
    }
  } catch (err) {
    console.warn(`[feed:${feed.source_name}] 抓取失敗：`, err.message);
  }
  return added;
}

function parseJsonFeed(text) {
  const data = JSON.parse(text);
  return (data.items || []).map(i => ({
    title: i.title,
    content: i.content_text || i.content_html?.replace(/<[^>]+>/g, ' ') || i.title,
    url: i.url,
    published_at: i.date_published,
  }));
}

// 極簡 RSS parser（夠用於 rss.app/RSSHub 輸出；唔另外加 XML 依賴）
function parseRss(text) {
  const items = [];
  for (const m of text.matchAll(/<item>([\s\S]*?)<\/item>/g)) {
    const block = m[1];
    const pick = tag => block.match(new RegExp(`<${tag}[^>]*>(?:<!\\[CDATA\\[)?([\\s\\S]*?)(?:\\]\\]>)?<\\/${tag}>`))?.[1]?.trim();
    items.push({
      title: pick('title'),
      content: (pick('description') || pick('title') || '').replace(/<[^>]+>/g, ' '),
      url: pick('link'),
      published_at: pick('pubDate') ? new Date(pick('pubDate')).toISOString() : undefined,
    });
  }
  return items;
}
