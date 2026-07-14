// 玩具模型倉 Hobbyland：自家 Quasar SPA，冇公開 REST，但前端有內部 JSON API。
// backend.hobbylandeshop.com/api/products (POST) → {code:0, data:{list,total,size,total_pages}}
// list 每件：{ title, link(相對路徑), sku, price, regular_price, stock, sell_type, sale_limit, style }
//   sell_type：'預訂' | '現貨'    stock===0 = 賣晒    sale_limit>0 = 每人限購
//
// 重要：用 category（分類）query，唔用 search。search endpoint 係 full-text、冇 cache，
// 熱門補貨時成班人一齊 hammer 會 429/hang；category 係 index lookup（多數 edge-cache），
// 秒回、就算搶爆都抓到。category 參數 = 分類頁 URL 嘅路徑段陣列，例如
// /product-category/takaratomy/beyblade陀螺 → ["takaratomy","beyblade陀螺"]。
// 仍保留溫和 retry 應付偶發 busy，但唔再需要 aggressive punch（用啱 endpoint 就冇 429）。
import { fetchWithUA, ingestItem, markUnavailable } from './util.js';
import { reportSourceHealth } from '../db.js';

const API = 'https://backend.hobbylandeshop.com/api/products';
const DEFAULT_CATEGORIES = [['takaratomy', 'beyblade陀螺']];

const sleep = ms => new Promise(r => setTimeout(r, ms));

// 單次 request（指定 category + page）。回：
//   {data}            成功（data = {list, total, size, total_pages}）
//   {busy:true}       可重試（429/ResourceExhausted/timeout/網絡錯）——佢 server 頂唔順
//   null              硬錯（其他 HTTP status、app code 錯）——結構問題，唔好 retry
async function fetchOnce(shop, category, page) {
  let res;
  try {
    res = await fetchWithUA(API, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Origin': shop.base_url,
        'Referer': `${shop.base_url}/`,
      },
      // fetchWithUA 個 signal 排喺 ...opts 前，呢個 signal override 到佢 20 秒 default
      signal: AbortSignal.timeout(shop.timeout_ms ?? 15000),
      // page 由 1 起（傳 0 會 code:51「頁碼必須大於0」）
      body: JSON.stringify({ page, category }),
    });
  } catch {
    return { busy: true }; // timeout / 連唔上 → 當忙，可重試
  }
  if (res.status === 429) return { busy: true };
  if (!res.ok) { console.warn(`[hobbyland:${shop.id}]`, res.status); return null; }
  let json;
  try { json = await res.json(); } catch { return { busy: true }; }
  if (json?.Code === 'ResourceExhausted') return { busy: true };
  if (json?.code !== 0) { console.warn(`[hobbyland:${shop.id}] code=${json?.code} ${json?.message || ''}`); return null; }
  return { data: json.data || {} };
}

// 溫和 retry：撞 busy 等 backoff 再試，最多 max_retries 次，受成個 run 共用嘅
// deadline 封頂（唔會 overrun poll interval）。硬錯（null）即刻收。
async function fetchPage(shop, category, page, deadline) {
  const maxRetries = shop.max_retries ?? 3;
  const backoffMs = shop.retry_backoff_ms ?? 1000;
  let r;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    if (attempt > 0) {
      if (Date.now() >= deadline) break;
      await sleep(backoffMs);
    }
    r = await fetchOnce(shop, category, page);
    if (!r || !r.busy) return r;
    if (Date.now() >= deadline) break;
  }
  return r;
}

// 消化一頁 list：回 {added, seen}
async function ingestList(shop, list, seen) {
  let added = 0;
  for (const p of list) {
    const key = p.link || p.sku;
    if (!key || seen.has(key)) continue;
    seen.add(key);
    // link 有時帶原始空格/CJK（例 "/product/Takara Tomy BeybladeX BX-50..."），
    // encode 咗先喺通知度 click 得；encodeURI 唔郁 :/?# 等，只 encode 空格/非 ASCII
    const rawUrl = /^https?:\/\//i.test(p.link) ? p.link : `${shop.base_url}${p.link || ''}`;
    const url = encodeURI(rawUrl);
    // 賣晒唔收做新情報（標題可能寫「現貨」但實際 stock:0，只信 stock 欄）；之前有入庫就標返售罄
    if (Number(p.stock) === 0) { markUnavailable(`hobbyland-${shop.id}`, url); continue; }
    const price = p.price != null && p.price !== '' ? Number(p.price) : null;
    const flags = Number(p.sale_limit) > 0
      ? [{ flag: 'limit_one', label: `每人限購${p.sale_limit}件` }]
      : [];
    const ok = await ingestItem({
      adapterId: `hobbyland-${shop.id}`,
      region: shop.region,
      source: shop.name,
      trust: shop.trust,
      title: `${p.title || ''}${p.style ? ` ${p.style}` : ''}`.replace(/\s+/g, ' ').trim(),
      url,
      price: Number.isFinite(price) ? price : null,
      currency: 'HKD', // Hobbyland 係港舖，價錢一律 HK$
      kindHint: p.sell_type === '預訂' ? 'preorder' : (p.sell_type === '現貨' ? 'stock' : undefined),
      flags,
    });
    if (ok) added++;
  }
  return added;
}

export async function runShop(shop) {
  let added = 0;
  let itemsSeen = 0;
  let apiOk = false;
  let busy = false;
  const categories = shop.categories || DEFAULT_CATEGORIES;
  const maxPages = shop.max_pages ?? 5; // 分類貨少（~2 版），封頂防手誤/分類爆量
  // 成個 run 一份時間預算，所有分類/分頁夾住用，保證唔 overrun poll interval
  const deadline = Date.now() + (shop.retry_budget_ms ?? 25000);
  try {
    const seen = new Set();
    for (const category of categories) {
      // 第一頁攞埋 total_pages，再逐頁抓（分類 endpoint 平，抓齊先睇到晒所有現貨）
      const first = await fetchPage(shop, category, 1, deadline);
      if (!first) continue;
      if (first.busy) { busy = true; continue; }
      apiOk = true;
      const list1 = Array.isArray(first.data.list) ? first.data.list : [];
      itemsSeen += list1.length;
      added += await ingestList(shop, list1, seen);
      const totalPages = Math.min(Number(first.data.total_pages) || 1, maxPages);
      for (let page = 2; page <= totalPages; page++) {
        if (Date.now() >= deadline) break;
        const r = await fetchPage(shop, category, page, deadline);
        if (!r || r.busy) { if (r?.busy) busy = true; continue; }
        const list = Array.isArray(r.data.list) ? r.data.list : [];
        itemsSeen += list.length;
        added += await ingestList(shop, list, seen);
      }
    }
  } catch (err) {
    console.warn(`[hobbyland:${shop.id}] 抓取失敗：`, err.message);
  }
  // busy 唔當來源壞（係佢 server 忙，唔係我哋斷）：有 apiOk 就照常報健康，
  // 純粹全程 busy（apiOk=false, busy=true）就 skip 唔報，唔好誤觸「來源壞咗」警報
  if (apiOk) reportSourceHealth(`hobbyland-${shop.id}`, Math.max(itemsSeen, 1));
  else if (!busy) reportSourceHealth(`hobbyland-${shop.id}`, 0);
  return added;
}
