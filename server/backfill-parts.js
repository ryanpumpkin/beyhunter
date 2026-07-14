// 一次性 backfill：用而家嘅 isPartsOnly() regex 掃全部 events，補返/移除 parts_only flag。
// 部署新版散件偵測後，喺 NAS 跑一次先會令舊貨都標到（新貨 ingestItem 會自動標，
// 但舊貨 dedupe 擋住唔會重入，唔 backfill 就漏）。
//   docker exec beyhunter node server/backfill-parts.js
// 用 DB_PATH（container 已設 /app/data/beyhunter.db），所以會打中 volume 個 DB。
// idempotent：跑幾多次都一樣，可安全重跑。
import db from './db.js';
import { isPartsOnly } from './adapters/util.js';

const LABEL = '可能係散件（淨蓋/軸/盤，唔係成隻）— 價錢僅供參考';
const rows = db.prepare('SELECT id, title, original, flags FROM events').all();
const upd = db.prepare('UPDATE events SET flags = ? WHERE id = ?');

let added = 0, removed = 0;
const tx = db.transaction(() => {
  for (const r of rows) {
    let arr = r.flags ? JSON.parse(r.flags) : [];
    const had = arr.some(f => f.flag === 'parts_only');
    const now = isPartsOnly((r.title || '') + ' ' + (r.original || ''));
    if (had === now) continue;
    if (now) { arr.push({ flag: 'parts_only', label: LABEL }); added++; }
    else { arr = arr.filter(f => f.flag !== 'parts_only'); removed++; }
    upd.run(arr.length ? JSON.stringify(arr) : null, r.id);
  }
});
tx();

const total = db.prepare("SELECT COUNT(*) n FROM events WHERE flags LIKE '%parts_only%'").get().n;
console.log(`[backfill-parts] 新增 ${added}、移除 ${removed}；DB 現有 ${total} 條 parts_only`);
