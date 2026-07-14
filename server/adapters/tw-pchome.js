// 台灣 PChome：公開 JSON 搜尋 API（已實測，唔使 key）
import { fetchWithUA, ingestItem } from './util.js';
import { reportSourceHealth } from '../db.js';

const QUERIES = ['戰鬥陀螺 BX', '戰鬥陀螺 UX'];

export async function run() {
  let added = 0;
  let itemsSeen = 0;
  for (const q of QUERIES) {
    try {
      const url = `https://ecshweb.pchome.com.tw/search/v4.3/all/results?q=${encodeURIComponent(q)}&page=1&sort=new/dc`;
      const res = await fetchWithUA(url);
      if (!res.ok) { console.warn('[pchome]', res.status); continue; }
      const data = await res.json();
      itemsSeen += (data.Prods || []).length;
      for (const p of data.Prods || []) {
        const ok = await ingestItem({
          adapterId: 'tw-pchome',
          region: 'tw',
          source: 'PChome 24h',
          trust: 'official',
          title: p.Name,
          original: p.Describe || null,
          url: `https://24h.pchome.com.tw/prod/${p.Id}`,
          price: p.Price,
          currency: 'TWD',
          kindHint: 'stock',
        });
        if (ok) added++;
      }
    } catch (err) {
      console.warn('[pchome] 抓取失敗：', err.message);
    }
  }
  reportSourceHealth('tw-pchome', itemsSeen);
  return added;
}
