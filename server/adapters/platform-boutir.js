// Boutir（掌舖）storefront adapter——vymobile 等 Boutir 店，shops.json 驅動。
// 佢個前端係 SPA，靠 /apis/storefront/products?limit&page 攞貨（乾淨 JSON，plain
// fetch 就得，唔使 Playwright）。分頁 sort_order=desc = 最新貨排 page 1，所以
// 一上新貨（例：美版陀螺）即刻喺頭頁捉到。
//
// 呢類店多數 99% 唔關陀螺事（手機/生活配件），所以按關鍵字篩出目標貨——
// shop.product_filter 可覆寫（regex string），唔設就用預設陀螺關鍵字。
import { fetchWithUA, ingestItem, markUnavailable, httpReason, errReason } from './util.js';
import { reportSourceHealth } from '../db.js';

const DEFAULT_FILTER = /陀螺|beyblade|爆旋|美版|BX-?\d{1,3}|UX-?\d{1,3}|CX-?\d{1,3}|發射器|手柄/i;
const PAGE_LIMIT = 100;
const MAX_PAGES = 6; // 安全上限，防 has_more 一直 true 打爆

// variant 有貨：unlimited 或 quantity>0；quantity===0 且非 unlimited = 售罄
function isAvailable(p) {
  const v = (p.variants || [])[0] || {};
  return v.unlimited_quantity === true || (typeof v.quantity === 'number' && v.quantity > 0);
}

export async function runShop(shop) {
  const adapterId = `boutir-${shop.id}`;
  const filter = shop.product_filter ? new RegExp(shop.product_filter, 'i') : DEFAULT_FILTER;
  let added = 0;
  let seen = 0;
  try {
    for (let page = 1; page <= MAX_PAGES; page++) {
      const url = `${shop.base_url}/apis/storefront/products?limit=${PAGE_LIMIT}&page=${page}&sort_by=default&sort_order=desc&lang=zh-Hant`;
      const res = await fetchWithUA(url);
      if (!res.ok) { console.warn(`[boutir:${shop.id}]`, res.status); reportSourceHealth(adapterId, seen, httpReason(res)); return added; }
      const { products = [], has_more } = await res.json();
      seen += products.length;

      for (const p of products) {
        const hay = `${p.title || ''} ${(p.hashtags || []).join(' ')} ${(p.description || '').slice(0, 200)}`;
        if (!filter.test(hay)) continue;
        const purl = p.product_url;
        if (!isAvailable(p)) { markUnavailable(adapterId, purl); continue; }
        const v = (p.variants || [])[0] || {};
        const ok = await ingestItem({
          adapterId,
          region: shop.region,
          source: shop.name,
          trust: shop.trust,
          title: (p.title || '').replace(/\s+/g, ' ').trim(),
          original: p.description ? p.description.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 500) : null,
          url: purl,
          price: v.price != null ? Number(v.price) : null,
          currency: p.currency || shop.currency || 'HKD',
          kindHint: p.pre_order_enabled ? 'preorder' : undefined,
        });
        if (ok) added++;
      }
      if (!has_more || products.length === 0) break;
    }
    reportSourceHealth(adapterId, seen);
  } catch (err) {
    console.warn(`[boutir:${shop.id}] 抓取失敗：`, err.message);
    reportSourceHealth(adapterId, seen, errReason(err));
  }
  return added;
}
