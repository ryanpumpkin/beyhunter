// 通用 WooCommerce Store API adapter——福利模型＋所有 Woo 舖（shops.json 驅動）
import { fetchWithUA, ingestItem, markUnavailable } from './util.js';
import { reportSourceHealth } from '../db.js';

// 舊版 WooCommerce 嘅 Store API 路徑冇 /v1/（easybuy.hk 就係）——
// 首次成功嘅路徑記低，之後唔使次次試兩個
const apiPathCache = new Map(); // shop.id -> 'v1' | 'legacy'

async function fetchProducts(shop, search) {
  const paths = { v1: '/wp-json/wc/store/v1/products', legacy: '/wp-json/wc/store/products' };
  const order = apiPathCache.get(shop.id) === 'legacy' ? ['legacy', 'v1'] : ['v1', 'legacy'];
  for (const key of order) {
    const url = `${shop.base_url}${paths[key]}?search=${encodeURIComponent(search)}&per_page=30&orderby=date`;
    const res = await fetchWithUA(url);
    if (res.ok) { apiPathCache.set(shop.id, key); return res.json(); }
    if (res.status !== 404) { console.warn(`[woo:${shop.id}]`, res.status); return null; }
  }
  console.warn(`[woo:${shop.id}] Store API 兩個路徑都 404`);
  return null;
}

export async function runShop(shop) {
  let added = 0;
  let itemsSeen = 0;
  let apiOk = false; // API 有 200 回應（就算空 array）——JSON API 空結果係可信嘅「冇貨」，唔係壞
  // searches: 多組關鍵字（中英文名可能唔同）；冇設就用 search / 'beyblade'
  const searches = shop.searches || [shop.search || 'beyblade'];
  try {
    const seen = new Set();
    for (const q of searches) {
      const products = await fetchProducts(shop, q);
      if (!products) continue;
      apiOk = true;
      itemsSeen += products.length;
      for (const p of products) {
        if (seen.has(p.permalink)) continue;
        seen.add(p.permalink);
        // 賣晒嘅唔收做新情報（標題都可能寫「現貨」，只信庫存欄位）；
        // 如果之前有入庫，同步標返「已售完」
        if (!p.is_in_stock) { markUnavailable(`woo-${shop.id}`, p.permalink); continue; }
        const priceRaw = p.prices?.price;
        const minorUnit = p.prices?.currency_minor_unit ?? 2;
        const price = priceRaw ? Number(priceRaw) / 10 ** minorUnit : null;
        const ok = await ingestItem({
          adapterId: `woo-${shop.id}`,
          region: shop.region,
          source: shop.name,
          trust: shop.trust,
          title: p.name.replace(/\s+/g, ' ').trim(),
          url: p.permalink,
          price,
          currency: p.prices?.currency_code || 'HKD',
        });
        if (ok) added++;
      }
    }
  } catch (err) {
    console.warn(`[woo:${shop.id}] 抓取失敗：`, err.message);
  }
  // API 通就算健康（搜尋 0 件可以係真冇貨，例如 easybuy 未上架陀螺）
  reportSourceHealth(`woo-${shop.id}`, apiOk ? Math.max(itemsSeen, 1) : 0);
  return added;
}
