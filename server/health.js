// 來源健康監察：adapter 每次 fetch 完會 reportSourceHealth(itemsSeen)。
// 呢度定時掃 source_health，發現來源「連續 N 次抓到 0 件」或者
// 「太耐冇成功過」就推一條系統警報（只去「全收」target，唔嘈 group）。
// 每個來源只警一次（alerted flag），復原（再抓到嘢）會自動 reset。
import { healthRows, markAlerted } from './db.js';
import { alertSystem } from './notify.js';

const ZERO_STREAK_THRESHOLD = 4;          // 連續 4 次 0 件 → 警報
const STALE_MS = 6 * 60 * 60 * 1000;      // 6 個鐘冇成功過 → 警報
const CHECK_INTERVAL_MS = 30 * 60 * 1000; // 半個鐘檢查一次

export function checkSourceHealth() {
  const now = Date.now();
  for (const row of healthRows.all()) {
    if (row.alerted) continue;
    const lastOkAge = row.last_ok ? now - Date.parse(row.last_ok) : Infinity;
    let msg = null;
    if (row.zero_streak >= ZERO_STREAK_THRESHOLD) {
      msg = `來源「${row.adapter}」連續 ${row.zero_streak} 次抓到 0 件——可能改咗版或者被封，去 check 下。`;
    } else if (row.last_run && lastOkAge > STALE_MS) {
      const hrs = Math.round(lastOkAge / 3600000);
      msg = `來源「${row.adapter}」已經 ${hrs} 小時冇成功抓到嘢（最後成功：${row.last_ok || '從未'}）。`;
    }
    if (msg) {
      console.warn('[health]', msg);
      markAlerted.run(row.adapter);
      alertSystem(msg);
    }
  }
}

export function startHealthMonitor() {
  // 開機唔即刻查（俾 adapters 先跑一輪），半個鐘後開始
  setInterval(checkSourceHealth, CHECK_INTERVAL_MS);
}
