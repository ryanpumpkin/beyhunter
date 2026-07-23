// 露天拍賣（台灣二手/個人賣家）：公開 JSON API，普通 fetch。
// 搜尋 API 回 id list，再用 prod API 攞名/價。
import { fetchWithUA, ingestItem, httpReason, errReason } from './util.js';
import { reportSourceHealth } from '../db.js';
import { counterfeitVerdict } from '../trust.js';

const SEARCH_URL = 'https://rtapi.ruten.com.tw/api/search/v3/index.php/core/prod?q='
  + encodeURIComponent('戰鬥陀螺X') + '&type=direct&sort=new%2Fdc&limit=30';
const PROD_URL = 'https://rtapi.ruten.com.tw/api/prod/v2/index.php/prod?id=';

// 露天大陸貨/雜貨多——要 SKU code 或者明確 X 系字眼先收
const RELEVANT_RE = /\b(BX|UX|CX)G?[-‐－]?\d{1,3}\b|戰鬥陀螺X|爆旋陀螺X|beyblade\s*x/i;

export async function run() {
  let added = 0;
  let itemsSeen = 0;
  let reason = null;
  try {
    const res = await fetchWithUA(SEARCH_URL);
    if (!res.ok) { console.warn('[ruten]', res.status); reportSourceHealth('tw-ruten', 0, httpReason(res)); return 0; }
    const { Rows = [] } = await res.json();
    itemsSeen = Rows.length;
    if (Rows.length) {
      const res2 = await fetchWithUA(PROD_URL + Rows.map(r => r.Id).join(','));
      if (res2.ok) {
        for (const p of await res2.json()) {
          const title = (p.ProdName || '').trim();
          if (!title || !RELEVANT_RE.test(title)) continue;
          if (counterfeitVerdict(title)) continue; // 翻版特徵 → 唔收
          const ok = await ingestItem({
            adapterId: 'tw-ruten',
            region: 'tw',
            source: '露天拍賣',
            trust: 'community',
            title,
            url: `https://www.ruten.com.tw/item/show?${p.ProdId || p.Id}`,
            price: p.PriceRange?.[0] ?? null,
            currency: 'TWD',
            kindHint: 'secondhand',
          });
          if (ok) added++;
        }
      }
    }
    if (itemsSeen === 0) console.warn('[ruten] 抓到 0 件，可能 API 改咗');
  } catch (err) {
    console.warn('[ruten] 抓取失敗：', err.message);
    reason = errReason(err);
  }
  reportSourceHealth('tw-ruten', itemsSeen, reason);
  return added;
}
