// Yahoo!拍賣（日本）：SSR HTML，普通 fetch＋cheerio。
// 拍賣價係「現價」會隨出價變——ingestItem 見到價變會自動記入 price_points。
import * as cheerio from 'cheerio';
import { fetchWithUA, ingestItem, httpReason, errReason } from './util.js';
import { reportSourceHealth } from '../db.js';

// s1=new&o1=d = 新着順
const SEARCH_URL = 'https://auctions.yahoo.co.jp/search/search?p=' + encodeURIComponent('ベイブレードX') + '&s1=new&o1=d';

export async function run() {
  let added = 0;
  let itemsSeen = 0;
  let reason = null;
  try {
    const res = await fetchWithUA(SEARCH_URL);
    if (!res.ok) { console.warn('[yahoo-auction]', res.status); reportSourceHealth('jp-yahoo-auction', 0, httpReason(res)); return 0; }
    const $ = cheerio.load(await res.text());

    const items = [];
    $('.Product').each((_, el) => {
      const $p = $(el);
      const $link = $p.find('.Product__titleLink').first();
      const title = $link.text().replace(/\s+/g, ' ').trim();
      const href = $link.attr('href');
      const price = parseInt(($p.find('.Product__priceValue').first().text() || '').replace(/[^\d]/g, ''), 10) || null;
      if (title && href) items.push({ title, href: href.split('?')[0], price });
    });
    itemsSeen = items.length;

    for (const it of items.slice(0, 30)) {
      const ok = await ingestItem({
        adapterId: 'jp-yahoo-auction',
        region: 'jp',
        source: 'Yahoo!拍賣',
        trust: 'community',
        title: `${it.title}（拍賣）`,
        url: it.href,
        price: it.price,
        currency: 'JPY',
        kindHint: 'secondhand',
      });
      if (ok) added++;
    }
    if (itemsSeen === 0) console.warn('[yahoo-auction] 抓到 0 件，可能改咗版');
  } catch (err) {
    console.warn('[yahoo-auction] 抓取失敗：', err.message);
    reason = errReason(err);
  }
  reportSourceHealth('jp-yahoo-auction', itemsSeen, reason);
  return added;
}
