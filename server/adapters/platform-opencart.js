// 通用 OpenCart adapter（SSR HTML scrape）——maytoys 預訂站等。
// shops.json 設 listing_urls: [搜尋/分類頁 URL...]（OpenCart route=product/search 或 category）。
// 標準 .product-thumb 卡；標題喺 img[title]，價喺 .price，截止/售罄睇 .outofstock/.label-outofstock。
import * as cheerio from 'cheerio';
import { fetchWithUA, ingestItem, markUnavailable, httpReason, errReason } from './util.js';
import { reportSourceHealth } from '../db.js';

const BEY_RE = /beyblade|爆旋|戰鬥陀螺|陀螺|\b(BX|UX|CX)G?-?\d/i;
const OOS_RE = /截止預訂|停止預訂|售罄|售完|缺貨|已滿|sold\s*out|out of stock/i;

export async function runShop(shop) {
  let added = 0;
  let itemsSeen = 0;
  let reason = null;
  const adapterId = `opencart-${shop.id}`;
  for (const url of shop.listing_urls || []) {
    try {
      const res = await fetchWithUA(url);
      if (!res.ok) { console.warn(`[opencart:${shop.id}]`, res.status, url); reason = httpReason(res); continue; }
      const $ = cheerio.load(await res.text());

      const seen = new Set();
      const items = [];
      $('.product-thumb, .product-layout').each((_, el) => {
        const $c = $(el);
        const a = $c.find('.image a, a[href*="product_id"]').first();
        const title = ($c.find('img[title]').attr('title') || $c.find('.name a, .caption a, h4 a').first().text() || '').replace(/\s+/g, ' ').trim();
        if (!title || !BEY_RE.test(title)) return;
        // href 去埋 &search/&limit 尾巴，dedupe key 先穩定
        const href = new URL(a.attr('href') || '', url).href.split('&')[0];
        if (!/product_id=/.test(href) || seen.has(href)) return;
        seen.add(href);
        // 第一個 HK$ 數字（OpenCart .price 通常特價/現價喺前；訂金另計）
        const price = (($c.find('.price').text() || $c.text()).match(/(?:HK)?\$\s*([\d,]+(?:\.\d+)?)/) || [])[1];
        const soldout = $c.hasClass('outofstock') || $c.find('.outofstock, .label-outofstock').length > 0 || OOS_RE.test($c.text());
        items.push({ title, href, price: price ? parseFloat(price.replace(/,/g, '')) : null, soldout });
      });

      itemsSeen += items.length;
      for (const it of items) {
        if (it.soldout) { markUnavailable(adapterId, it.href); continue; }
        // kind 由 detectKind 睇標題判（呢站標題多數有「預售/預訂」→ preorder）
        const ok = await ingestItem({
          adapterId,
          region: shop.region,
          source: shop.name,
          trust: shop.trust,
          title: it.title,
          url: it.href,
          price: it.price,
          currency: shop.currency || 'HKD',
        });
        if (ok) added++;
      }
    } catch (err) {
      console.warn(`[opencart:${shop.id}] 抓取失敗：`, err.message);
      reason = errReason(err);
    }
  }
  // 部分搜尋頁本來就會長期冇結果；HTTP 成功時唔應當成 selector 壞咗。
  const healthItems = shop.allow_empty_results && !reason ? Math.max(itemsSeen, 1) : itemsSeen;
  reportSourceHealth(adapterId, healthItems, reason);
  return added;
}
