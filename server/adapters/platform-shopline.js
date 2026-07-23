// 通用 Shopline adapter（SSR HTML scrape）——BuyMarket、DreamToys 等
// shops.json 設 listing_urls: [分類頁/搜尋頁 URL...]
import * as cheerio from 'cheerio';
import { fetchWithUA, ingestItem, markUnavailable, httpReason, errReason } from './util.js';
import { reportSourceHealth } from '../db.js';

const BEY_RE = /beyblade|爆旋|戰鬥陀螺|陀螺|\b(BX|UX|CX)G?-?\d/i;
const SOLDOUT_RE = /售完|售罄|Sold\s*Out|已售完/i;

export async function runShop(shop) {
  let added = 0;
  let itemsSeen = 0;
  let reason = null; // fetch 失敗死因（每條 listing_url 失敗都覆寫；有成功抓到 itemsSeen>0 就唔理）
  for (const url of shop.listing_urls || []) {
    try {
      const res = await fetchWithUA(url);
      if (!res.ok) { console.warn(`[shopline:${shop.id}]`, res.status, url); reason = httpReason(res); continue; }
      const $ = cheerio.load(await res.text());

      const seen = new Set();
      const seenItems = [];
      // Shopline 產品卡：成張卡係 <a href="/products/...">，或者卡入面有呢條 link
      $('a[href*="/products/"]').each((_, el) => {
        const $a = $(el);
        const $card = $a.closest('.product-item, product-item, [class*=product-block], li').length
          ? $a.closest('.product-item, product-item, [class*=product-block], li')
          : $a;
        const title = ($card.find('[class*=title]').first().text() || $a.attr('title') || '').replace(/\s+/g, ' ').trim();
        if (!title || !BEY_RE.test(title)) return;

        const href = new URL($a.attr('href'), url).href.split('?')[0];
        if (seen.has(href)) return;
        seen.add(href);

        const text = $card.text();
        // 攞最後一個非零價（Shopline 劃線原價喺前、特價喺後）
        const prices = [...text.matchAll(/HK\$\s*([\d,]+(?:\.\d+)?)/g)]
          .map(m => parseFloat(m[1].replace(/,/g, ''))).filter(p => p > 0);
        const price = prices.length ? prices[prices.length - 1] : null;

        seenItems.push({ title, href, price, soldout: SOLDOUT_RE.test(text) });
      });

      itemsSeen += seenItems.length;
      for (const it of seenItems) {
        if (it.soldout) { markUnavailable(`shopline-${shop.id}`, it.href); continue; }
        const ok = await ingestItem({
          adapterId: `shopline-${shop.id}`,
          region: shop.region,
          source: shop.name,
          trust: shop.trust,
          title: it.title,
          url: it.href,
          price: it.price,
          currency: 'HKD',
        });
        if (ok) added++;
      }
    } catch (err) {
      console.warn(`[shopline:${shop.id}] 抓取失敗：`, err.message);
      reason = errReason(err);
    }
  }
  // itemsSeen>0 = 至少一條 URL 通 → reason 唔重要（reportSourceHealth 見 ok 會清）；
  // itemsSeen==0 而 reason 有值 = 真係 fetch 失敗（死 server／被封），帶死因。
  reportSourceHealth(`shopline-${shop.id}`, itemsSeen, reason);
  return added;
}
