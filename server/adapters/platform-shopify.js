// 通用 Shopify products.json adapter——T CLUB＋所有 Shopify 舖（shops.json 驅動）
import { fetchWithUA, ingestItem, markUnavailable, httpReason, errReason } from './util.js';
import { reportSourceHealth } from '../db.js';

export async function runShop(shop) {
  let added = 0;
  try {
    const url = `${shop.base_url}/collections/${shop.collection}/products.json?limit=50`;
    const res = await fetchWithUA(url);
    if (!res.ok) { console.warn(`[shopify:${shop.id}]`, res.status); reportSourceHealth(`shopify-${shop.id}`, 0, httpReason(res)); return 0; }
    const { products = [] } = await res.json();
    reportSourceHealth(`shopify-${shop.id}`, products.length);
    for (const p of products) {
      // 賣晒嘅唔收做新情報——T CLUB 有啲標題寫「【現貨】」但其實冇貨，只信 available 欄位；
      // 如果之前有入庫，同步標返「已售完」
      const url = `${shop.base_url}/products/${p.handle}`;
      if (!p.variants?.some(v => v.available)) { markUnavailable(`shopify-${shop.id}`, url); continue; }
      const v = p.variants.find(v => v.available) || p.variants[0];
      const ok = await ingestItem({
        adapterId: `shopify-${shop.id}`,
        region: shop.region,
        source: shop.name,
        trust: shop.trust,
        title: p.title.replace(/\s+/g, ' ').trim(),
        original: p.body_html ? p.body_html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 500) : null,
        url: `${shop.base_url}/products/${p.handle}`,
        price: v ? parseFloat(v.price) : null,
        currency: 'HKD',
        published_at: p.published_at || undefined,
      });
      if (ok) added++;
    }
  } catch (err) {
    console.warn(`[shopify:${shop.id}] 抓取失敗：`, err.message);
    reportSourceHealth(`shopify-${shop.id}`, 0, errReason(err)); // 死 server：DNS/連線/timeout
  }
  return added;
}
