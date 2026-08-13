// 通知 dispatcher：格式化一條訊息 → 派去所有啟用咗嘅 channel。
// Channel 各自獨立，一個掛咗唔影響第個；全部未設定就淨係 log。
import * as telegram from './channels/telegram.js';
import * as whatsapp from './channels/whatsapp.js';
import { insertNotifyLog } from './db.js';

const CHANNELS = [telegram, whatsapp];

export { whatsapp };

// server 起動時叫，俾需要預先連線嘅 channel（WhatsApp）行登入流程
export function initChannels() {
  for (const ch of CHANNELS) ch.init?.();
}

function formatMessage(ev) {
  const emoji = { preorder: '🆕📦', stock: '✅', official: '📢', coming_soon: '🔜' }[ev.kind] || 'ℹ️';
  const region = { hk: '🇭🇰', tw: '🇹🇼', jp: '🇯🇵' }[ev.region] || '';
  const sym = { HKD: 'HK$', TWD: 'NT$', JPY: '¥', USD: 'US$' }[ev.currency] || '$';
  const price = ev.price != null
    ? `\n💰 ${sym}${ev.price}${ev.price_hkd != null && ev.currency !== 'HKD' ? ` (≈HK$${ev.price_hkd})` : ''}`
    : '';
  const limit = (ev.flags || '').includes('limit_one') ? '\n🔒 每人限購一件，手快有手慢冇' : '';
  return `${emoji} ${region} ${ev.source}\n${ev.title}${price}${limit}${ev.url ? `\n🔗 ${ev.url}` : ''}`;
}

// 全局序列隊列：唔理幾多個 adapter 並行觸發通知（尤其 scheduler 首次
// runAll() 同各舖獨立 setInterval 有機會撞埋，短時間內多個來源一齊
// call notifyNewEvent），實際發送一律逐條、相隔幾秒先送——WhatsApp
// 對啱啱連結嘅新裝置短時間內狂發訊息會靜靜雞唔畀送（唔會報錯），
// 呢個 queue 就係防呢單嘢。
const SEND_DELAY_MS = 2500;
let sendChain = Promise.resolve();

// 一條通知喺一個 channel 度試幾多次（第一次 + 下面啲 delay）。
// 短暫斷線/重連好常見，試多兩次通常就過到；試晒都唔得先當真失敗。
const RETRY_DELAYS_MS = [5_000, 20_000];

// 每次派送都寫低（成功都寫），送失敗唔可以再好似以前咁淨係 console.warn ——
// container 一重啟就查無可查。寫 DB 失敗唔可以拖冧通知流程，所以包住 try。
function logDelivery(row) {
  try { insertNotifyLog.run(row); } catch (err) { console.warn('[notify] 寫 notify_log 失敗：', err.message); }
}

// 派一條去單一 channel，失敗自動重試。回傳 true = 最終送到。
async function deliver(ch, text, ev) {
  const meta = {
    channel: ch.name,
    kind: ev?.region === 'system' ? 'system' : (ev?.kind || null),
    title: (ev?.title || text).split('\n')[0].slice(0, 120),
    url: ev?.url || null,
  };
  let lastErr;
  for (let attempt = 1; attempt <= RETRY_DELAYS_MS.length + 1; attempt++) {
    try {
      await ch.send(text, ev);
      logDelivery({ ...meta, status: 'ok', attempts: attempt, error: null });
      return true;
    } catch (err) {
      lastErr = err;
      const delay = RETRY_DELAYS_MS[attempt - 1];
      if (delay == null) break; // 試晒喇
      console.warn(`[notify:${ch.name}] 第 ${attempt} 次失敗（${err.message}），${delay / 1000}s 後再試`);
      await new Promise(r => setTimeout(r, delay));
    }
  }
  console.warn(`[notify:${ch.name}] 試晒 ${RETRY_DELAYS_MS.length + 1} 次都送唔出：`, lastErr?.message);
  logDelivery({ ...meta, status: 'failed', attempts: RETRY_DELAYS_MS.length + 1, error: lastErr?.message || String(lastErr) });
  return false;
}

// 系統警報（來源壞咗、斷線等）：region='system' 令有 region filter 嘅
// target（例如只收 hk 嘅 group）唔會收到，只推畀「全收」嘅 target（你自己）
export function alertSystem(text) {
  const active = CHANNELS.filter(ch => ch.enabled());
  if (active.length === 0) { console.warn(`[notify] (未設定通知渠道) ${text}`); return Promise.resolve(false); }
  sendChain = sendChain
    .then(async () => {
      for (const ch of active) {
        await deliver(ch, `⚠️ ${text}`, { region: 'system', title: text });
      }
      await new Promise(r => setTimeout(r, SEND_DELAY_MS));
    })
    .catch(err => console.warn('[notify] 警報隊列出錯：', err.message));
  return sendChain;
}

export function notifyNewEvent(ev) {
  const text = formatMessage(ev);
  const active = CHANNELS.filter(ch => ch.enabled());

  if (active.length === 0) {
    console.log(`[notify] (未設定通知渠道) ${text.replace(/\n/g, ' | ')}`);
    return Promise.resolve(false);
  }

  sendChain = sendChain
    .then(async () => {
      let anyOk = false;
      for (const ch of active) {
        // deliver 自己重試＋記低，唔會 throw，所以一個 channel 死唔會拖冧第個
        if (await deliver(ch, text, ev)) anyOk = true; // channel 可按 ev.region 做 per-target filter（WhatsApp）
      }
      await new Promise(r => setTimeout(r, SEND_DELAY_MS));
      return anyOk;
    })
    .catch(err => { console.warn('[notify] 隊列處理出錯：', err.message); return false; });

  return sendChain;
}
