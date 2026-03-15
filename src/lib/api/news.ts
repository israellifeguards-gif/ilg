import type { NewsItem } from '@/types';

const RSS_FEEDS = [
  { url: 'https://www.ynet.co.il/Integration/StoryRss2.xml', source: 'ynet' },           // Ynet ראשי
  { url: 'https://rss.walla.co.il/feed/1', source: 'וואלה' },                             // וואלה חדשות ראשי
  { url: 'https://www.israelhayom.co.il/rss.xml', source: 'ישראל היום' },                 // ישראל היום
  { url: 'https://www.maariv.co.il/rss/rssFeedAllNews.aspx', source: 'מעריב' },           // מעריב
];

function decodeEntities(str: string): string {
  return str
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code) => String.fromCharCode(parseInt(code, 16)));
}

function extractText(xml: string, tag: string): string {
  const cdataMatch = xml.match(new RegExp(`<${tag}[^>]*><!\\[CDATA\\[([\\s\\S]*?)\\]\\]><\\/${tag}>`));
  if (cdataMatch) return decodeEntities(cdataMatch[1].trim());
  const plainMatch = xml.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`));
  return plainMatch ? decodeEntities(plainMatch[1].trim()) : '';
}

function parseRSS(xml: string, source: string): NewsItem[] {
  const items: NewsItem[] = [];
  const matches = [...xml.matchAll(/<item>([\s\S]*?)<\/item>/g)];

  for (const match of matches) {
    const block = match[1];
    const title = extractText(block, 'title');
    const link = extractText(block, 'link') || extractText(block, 'guid');
    const pubDate = extractText(block, 'pubDate');
    if (title) items.push({ title, link, pubDate, source });
  }

  return items.slice(0, 5);
}

export async function fetchNews(): Promise<NewsItem[]> {
  const results = await Promise.allSettled(
    RSS_FEEDS.map(async ({ url, source }) => {
      const res = await fetch(url, { next: { revalidate: 900 } });
      const xml = await res.text();
      return parseRSS(xml, source);
    })
  );

  const all: NewsItem[] = [];
  for (const r of results) {
    if (r.status === 'fulfilled') all.push(...r.value);
  }

  return all.sort((a, b) =>
    new Date(b.pubDate).getTime() - new Date(a.pubDate).getTime()
  );
}
