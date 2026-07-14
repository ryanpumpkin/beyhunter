// HardOff netmall（日本二手連鎖）：SSR HTML，普通 fetch＋cheerio 就得。
import * as cheerio from 'cheerio';
import { fetchWithUA, ingestItem } from './util.js';
import { reportSourceHealth } from '../db.js';

const SEARCH_URL = 'https://netmall.hardoff.co.jp/search/?q=' + encodeURIComponent('ベイブレードX');

export async function run() {
  let added = 0;
  let itemsSeen = 0;
  try {
    const res = await fetchWithUA(SEARCH_URL);
    if (!res.ok) { console.warn('[hardoff]', res.status); reportSourceHealth('jp-hardoff', 0); return 0; }
    const $ = cheerio.load(await res.text());

    const items = [];
    const seen = new Set();
    $('a[href*="/product/"]').each((_, el) => {
      const $a = $(el);
      const href = new URL($a.attr('href'), SEARCH_URL).href.split('?')[0];
      if (seen.has(href)) return;
      seen.add(href);
      const text = $a.closest('div').text().replace(/\s+/g, ' ').trim();
      if (!text) return;
      const price = parseInt(text.match(/([\d,]+)\s*円/)?.[1]?.replace(/,/g, '') ?? '', 10) || null;
      items.push({ href, text, price });
    });
    itemsSeen = items.length;

    for (const it of items.slice(0, 30)) {
      const ok = await ingestItem({
        adapterId: 'jp-hardoff',
        region: 'jp',
        source: 'HardOff',
        trust: 'community',
        title: it.text.slice(0, 120),
        url: it.href,
        price: it.price,
        currency: 'JPY',
        kindHint: 'secondhand',
      });
      if (ok) added++;
    }
    if (itemsSeen === 0) console.warn('[hardoff] 抓到 0 件，可能改咗版');
  } catch (err) {
    console.warn('[hardoff] 抓取失敗：', err.message);
  }
  reportSourceHealth('jp-hardoff', itemsSeen);
  return added;
}
