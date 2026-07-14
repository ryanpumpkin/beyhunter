// adapter 共用：normalize 一件商品 → event object，處理 diff＋通知
import { insertEvent, isNewItem, findByDedupe, markSoldOut, markRestocked, insertPricePoint, updateEventPrice, confirmVerdict } from '../db.js';
import { toHKD } from '../fx.js';
import { extractSkus } from '../summarize.js';
import { notifyNewEvent } from '../notify.js';

export const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36';

export async function fetchWithUA(url, opts = {}) {
  return fetch(url, {
    headers: { 'User-Agent': UA, ...(opts.headers || {}) },
    signal: AbortSignal.timeout(20000),
    ...opts,
  });
}

const PREORDER_RE = /預訂|預購|預售|截訂|網店預購|預約|訂金|落訂|\bPSL\b|\d{1,2}月(到貨|發貨|出貨)/i;

// 分類優先次序：標題有預售字眼 > 標題明寫現貨 > 說明有預售字眼 > 當現貨
function detectKind(title, original) {
  if (PREORDER_RE.test(title)) return 'preorder';
  if (/現貨/.test(title)) return 'stock';
  if (PREORDER_RE.test(original || '')) return 'preorder';
  return 'stock';
}
// 限購商品（每人限一）——搶手貨信號，標出嚟兼通知時提醒
const LIMIT_RE = /限一|每人限|限購|一人一件|同一帳戶.{0,12}(取消|限)|limited\s*1\s*pc|limit(ed)?\s*(to\s*)?one\b/i;

// 散件偵測（主要二手）——賣家淨賣個蓋/軸/盤，唔係成隻，個價信唔過，
// 要標出嚟＋SKU 頁「最平」同價格 chart 都要剔走佢（見 db.js）。
// 先排除「完整/齊件」訊號（避免「パーツ完備」＝零件齊全 被誤判做散件），
// 再捉散件關鍵字。呢個係 regex 快篩版，日後可加 local AI 判曖昧 case。
// 完整品訊號：套裝/starter/booster/齊件——中咗就當成隻，唔算散件。
// （唔放「新品/未開封」入嚟，因為「新品 ブレード単品」呢類散件都會有呢啲字。）
const COMPLETE_RE = /パーツ完備|パーツ全|完備|全套|一套|整套|套裝|套装|フルセット|full\s*set|連(軸|發射器|handle)|收納|セット(?!.{0,3}のみ)|スターター|starter|ブースター|booster/i;
// 散件訊號：淨蓋/軸/盤、無軸心、ブレードのみ、ジャンク、bare「上蓋」等。
// 「ブレード/blade」bare 唔用得（日文 model 名個個都含，會爆誤傷）；bare「上蓋」中文就準。
// 「不散賣」＝唔分開賣（其實整套），用 (?<!不) 擋住。
const PARTS_ONLY_RE = /淨(賣|得|係)?\s*(上蓋|蓋|刃|軸|齒)|二手淨|淨上蓋|(?<!不)(單|只|散)(賣|件)|拆(賣|件)|無軸心?|缺軸|刃擊面|(blade|ratchet|bit|ブレード|ラチェット|ビット|上蓋|軸心|中軸)\s*(のみ|only|單品|单品)|(のみ|単品)$|ジャンク|ばら売り|バラ売り|パーツのみ|パーツ単品|上蓋/i;
export function isPartsOnly(text) {
  return PARTS_ONLY_RE.test(text) && !COMPLETE_RE.test(text);
}

// dedupe key 用 URL 做底，但 tracking 參數（utm、fbclid 呢啲）會令同一件貨
// 睇落係新 URL → 重複通知。淨係剷已知 tracking 參數＋hash，唔郁其他 query
// （有啲站件貨 id 就係喺 query 度，全剷會炒車）。非 URL（title fallback）原樣回。
const TRACKING_PARAMS = /^(utm_|fbclid$|gclid$|yclid$|msclkid$|ref$|ref_|srsltid$)/i;
export function normalizeKey(key) {
  if (!key || !/^https?:\/\//i.test(key)) return key;
  try {
    const u = new URL(key);
    for (const p of [...u.searchParams.keys()]) {
      if (TRACKING_PARAMS.test(p)) u.searchParams.delete(p);
    }
    u.hash = '';
    return u.toString();
  } catch {
    return key;
  }
}

// 件貨而家冇貨：如果之前有入庫，標「已售完」（feed 卡會顯示灰 badge）
export function markUnavailable(adapterId, key) {
  markSoldOut.run(`${adapterId}:${normalizeKey(key)}`);
}

// item: { adapterId, region, source, trust, title, url, price, currency, original?, kindHint? }
// 回傳 true = 呢件係新見到嘅（已寫 DB＋已通知）
export async function ingestItem(item) {
  const key = normalizeKey(item.url || item.title);
  const dedupe_key = `${item.adapterId}:${key}`;
  const isNew = isNewItem(item.adapterId, key);
  if (!isNew) {
    const existing = findByDedupe.get(dedupe_key);
    // 見過嘅貨：價格變咗 → 記一點歷史（chart 用）＋同步 events 現價
    if (existing && item.price != null && existing.price != null && item.price !== existing.price) {
      const newHkd = await toHKD(item.price, item.currency);
      insertPricePoint.run(dedupe_key, item.price, newHkd);
      updateEventPrice.run(item.price, newHkd, dedupe_key);
    }
    // 如果之前標咗售罄而家有返 → 補貨！更新狀態＋推通知。
    // 售罄方向有 confirmVerdict 防抖，補貨方向都要：要連續兩次 run 都見到
    // 有貨先信，否則 scrape 失手一次就售罄↔補貨咁輪流轟炸。
    if (existing?.sold_out) {
      if (!confirmVerdict(item.adapterId, key, 'instock')) return false;
      const now = new Date().toISOString();
      markRestocked.run(now, dedupe_key);
      // 唔 await：notify 隊列每條隔幾秒，await 會拖住成個 adapter loop
      notifyNewEvent({
        region: item.region, kind: 'stock', source: item.source,
        title: `🔄 補貨返嚟喇！${item.title}`,
        price: item.price ?? null, currency: item.currency || null,
        price_hkd: await toHKD(item.price, item.currency),
        url: item.url || null, flags: existing.flags || '',
      });
      return true;
    }
    return false;
  }

  const kind = item.kindHint || detectKind(item.title, item.original);
  const skus = extractSkus(item.title + ' ' + (item.original || ''));
  const price_hkd = await toHKD(item.price, item.currency);

  const flags = [...(item.flags || [])];
  const haystack = item.title + ' ' + (item.original || '');
  if (LIMIT_RE.test(haystack)) {
    flags.push({ flag: 'limit_one', label: '每人限購一件' });
  }
  if (isPartsOnly(haystack)) {
    flags.push({ flag: 'parts_only', label: '可能係散件（淨蓋/軸/盤，唔係成隻）— 價錢僅供參考' });
  }

  const ev = {
    dedupe_key: `${item.adapterId}:${key}`,
    region: item.region,
    kind,
    source: item.source,
    title: item.title,
    summary: item.summary || null,
    original: item.original || null,
    url: item.url || null,
    price: item.price ?? null,
    currency: item.currency || null,
    price_hkd,
    sku_code: skus[0] || null,
    trust: item.trust || 'community',
    flags: flags.length ? JSON.stringify(flags) : null,
    published_at: item.published_at || new Date().toISOString(),
  };
  const res = insertEvent.run(ev);
  // 只通知 preorder/stock/coming_soon——secondhand、field_report（kindHint 傳入）唔推
  if (res.changes > 0 && (kind === 'preorder' || kind === 'stock' || kind === 'coming_soon')) {
    // 唔 await：同上，通知隊列自己慢慢送，唔好拖住抓取
    notifyNewEvent(ev);
  }
  return res.changes > 0;
}
