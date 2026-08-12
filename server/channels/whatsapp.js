// WhatsApp 推播 channel（非官方 whatsapp-web.js）。
// 啟用：WHATSAPP_ENABLED=1。收件人清單而家由 settings store 管理
//（server/notify-settings.json，GUI「設定」頁可改）；舊 WHATSAPP_TO
// 環境變數會喺首次啟動自動遷移過去。
//   收件人格式：個人 "85298765432@c.us"；群組 "xxxxxxxxxx@g.us"；
//   "me" ＝ 登入嗰個號碼自己（「傳訊息給自己」）。
//   每個收件人可設 regions（['hk'] 等）＝只收嗰啲地區；null ＝ 全收。
// 首次啟動要登入一次：掃 QR（/api/whatsapp/qr）或 pairing code
//（/api/whatsapp/pair?phone=...）。session 存喺 server/.wwebjs_auth/。
//
// 注意：呢個係非官方方案，等於掛住個 WhatsApp Web，個人用途 OK，
// 唔好攞去大規模商用（可能封號）。用 Playwright 已裝好嘅 Chromium，慳返一個下載。
import fs from 'node:fs';
import path from 'node:path';
import { getWhatsappTargets } from '../settings.js';

const ENABLED = process.env.WHATSAPP_ENABLED === '1';

// Docker rebuild/重啟有時會強制斬斷舊 Chromium process，嚟唔切自己清走
// SingletonLock 就死咗，搞到新 Chromium 見到個 lock 唔敢開（以為第個
// process 仲用緊個 profile）。起動前主動掃走呢啲殘留 lock file 防呆。
function cleanStaleLocks(dir) {
  let entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
  for (const e of entries) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) cleanStaleLocks(p);
    else if (/^Singleton(Lock|Cookie|Socket)$/.test(e.name)) {
      try { fs.rmSync(p, { force: true }); console.log('[whatsapp] 清咗殘留 lock:', p); } catch { /* 冇所謂 */ }
    }
  }
}

export const name = 'whatsapp';
export const enabled = () => ENABLED && getWhatsappTargets().length > 0;

let clientReady = false;
let client = null;
let initErr = null;
// 等 client ready 嘅 waiter——重連/startup 窗口啲通知唔會即刻失敗，
// 而係 hold 住等連線返，ready 一到就全部放行（防 startup 期間漏 alert）。
let readyWaiters = [];
function markReady() { clientReady = true; readyWaiters.splice(0).forEach(fn => fn()); }
function waitForReady(timeoutMs = 60_000) {
  if (clientReady) return Promise.resolve(true);
  return new Promise(resolve => {
    const done = () => { clearTimeout(timer); resolve(true); };
    const timer = setTimeout(() => { readyWaiters = readyWaiters.filter(f => f !== done); resolve(false); }, timeoutMs);
    readyWaiters.push(done);
  });
}
let lastQr = null; // 最新 QR 字串，俾 /api/whatsapp/qr 網頁版用
let selfJid = null; // 登入號碼（"me" 解析用）
let lastDisconnect = null; // { at, reason }——GUI 顯示斷線警告用

// "me" → 實際 jid；未 ready 前照回傳 'me'（send 嗰陣會再解一次）
function resolveJid(jid) {
  return jid === 'me' && selfJid ? selfJid : jid;
}

// 俾 server 出 status/QR 頁＋設定 GUI
export function status() {
  return {
    enabled: enabled(),
    ready: clientReady,
    qr: clientReady ? null : lastQr,
    targets: getWhatsappTargets(),
    self: selfJid,
    error: initErr,
    lastDisconnect,
  };
}

async function chromiumPath() {
  try {
    const { chromium } = await import('playwright');
    return chromium.executablePath();
  } catch {
    return undefined; // 冇 playwright 就俾 puppeteer 自己搵
  }
}

const RECONNECT_BASE_MS = 10_000;
let reconnectAttempt = 0;

async function ensureClient() {
  if (client || initErr) return;
  try {
    const [{ default: pkg }, { default: qrcode }] = await Promise.all([
      import('whatsapp-web.js'),
      import('qrcode-terminal'),
    ]);
    const { Client, LocalAuth } = pkg;
    // WWEBJS_AUTH_PATH 可用環境變數指定（Docker 部署時掛 volume，session 先會持久化）
    const authPath = process.env.WWEBJS_AUTH_PATH || new URL('../.wwebjs_auth/', import.meta.url).pathname;
    cleanStaleLocks(authPath);
    client = new Client({
      authStrategy: new LocalAuth({ dataPath: authPath }),
      puppeteer: {
        headless: true,
        executablePath: await chromiumPath(),
        args: ['--no-sandbox', '--disable-blink-features=AutomationControlled'],
      },
    });
    client.on('qr', qr => {
      lastQr = qr;
      console.log('\n[whatsapp] 掃 QR 登入：終端機睇下面，或開 http://localhost:3000/api/whatsapp/qr（更清晰）\n');
      qrcode.generate(qr, { small: true });
    });
    client.on('ready', () => {
      markReady(); lastQr = null; lastDisconnect = null; reconnectAttempt = 0;
      selfJid = client.info?.wid?._serialized || null;
      const desc = getWhatsappTargets()
        .map(t => resolveJid(t.jid) + (t.regions ? `（只 ${t.regions.join('/')}）` : '（全部地區）'))
        .join(', ');
      console.log('[whatsapp] 已就緒，通知會推去', desc);
    });
    client.on('auth_failure', m => { initErr = m; console.warn('[whatsapp] 登入失敗：', m); });
    // 斷線：記低狀態俾 GUI 顯示，並且 backoff 自動重連（唔使人手重啟 server）
    client.on('disconnected', reason => {
      clientReady = false;
      lastDisconnect = { at: new Date().toISOString(), reason: String(reason) };
      console.warn('[whatsapp] 已斷線：', reason);
      // 經 Telegram（如有設定）通知——WhatsApp 自己斷咗就推唔到自己
      import('../notify.js').then(({ alertSystem }) =>
        alertSystem(`WhatsApp 通知channel斷咗線（${reason}），重連緊；如果一直斷，開 /api/whatsapp/qr 重新登入。`)).catch(() => {});
      const delay = Math.min(RECONNECT_BASE_MS * 2 ** reconnectAttempt++, 10 * 60_000);
      console.log(`[whatsapp] ${Math.round(delay / 1000)} 秒後自動重連（第 ${reconnectAttempt} 次）`);
      setTimeout(async () => {
        try {
          await client?.destroy().catch(() => {});
          client = null;
          await ensureClient();
        } catch (err) {
          console.warn('[whatsapp] 重連失敗：', err.message);
        }
      }, delay);
    });
    await client.initialize();
  } catch (err) {
    initErr = err.message;
    console.warn('[whatsapp] 初始化失敗：', err.message);
  }
}

// server 起動時叫一次，觸發登入/QR 流程
export function init() {
  if (ENABLED) ensureClient(); // 就算未設收件人都連定，等 GUI 可以列 group
}

// Pairing code 登入（唔使掃 QR）：入電話號碼 → 攞 8 位 code →
// 手機 WhatsApp「已連結的裝置 → 改用電話號碼連結」入 code
export async function requestPairingCode(phone) {
  if (!client) await ensureClient();
  if (!client) throw new Error(initErr || 'WhatsApp client 未初始化');
  if (clientReady) throw new Error('已經連結咗，唔使再配對');
  return client.requestPairingCode(phone.replace(/[^\d]/g, ''));
}

// 列出所有已入嘅群組，俾設定 GUI 揀（唔使自己周圍搵 group jid）
export async function listGroups() {
  if (!clientReady) throw new Error('WhatsApp 未就緒');
  const chats = await client.getChats();
  return chats
    .filter(c => c.isGroup)
    .map(c => ({ jid: c.id._serialized, name: c.name }));
}

// 指定收件人發一條（測試用）；jid 可以係 'me'
export async function sendTo(jid, text) {
  if (!clientReady) throw new Error('WhatsApp 未就緒（可能仲未登入）');
  await client.sendMessage(resolveJid(jid), text);
}

// sendMessage 一定要有 timeout。教訓：Chromium 喺 memory 壓力下會「唔死但吊住」，
// puppeteer 個 promise 就永遠唔 resolve 又唔 reject——而 notify.js 個 sendChain 係
// 串行嘅，一條吊住就成條隊永久塞死，之後所有補貨通知全部靜靜雞冇咗，重啟先發現。
//（2026-08-12 就係咁漏咗 BX-25 補貨通知，前一條仲要遲咗 3 個鐘先送到。）
const SEND_TIMEOUT_MS = 45_000;
function withTimeout(promise, ms, label) {
  let timer;
  return Promise.race([
    promise.finally(() => clearTimeout(timer)),
    new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(`${label} 等咗 ${ms / 1000}s 都冇反應（Chromium 可能吊咗）`)), ms);
    }),
  ]);
}

// sendMessage 吊死＝隻 Chromium 已經唔可靠，淨係 throw 唔夠——下一條會照樣吊。
// 拆咗佢等下次 ensureClient() 開返隻新嘅（同 'disconnected' handler 一樣做法）。
async function recycleClient(why) {
  console.warn('[whatsapp] 回收 client：', why);
  clientReady = false;
  const dead = client;
  client = null;
  await dead?.destroy().catch(() => { /* 本身已經吊咗，destroy 失敗好正常 */ });
}

// ev（可選）用嚟做 per-target region filter；冇 ev（例如系統訊息）就派晒。
// ev.region 唔喺某 target 嘅 regions 入面 → 嗰個 target 唔收
//（所以 region='system' 嘅警報只有「全收」嘅 target 先會收到）。
export async function send(text, ev) {
  if (!client) await ensureClient();
  // 未 ready（重連/startup 窗口）→ 等最多 60s，唔好即刻 throw 掉咗條通知。
  // notify.js 個 sendChain 係序列，等呢度連線返就會逐條放行、唔會漏。
  if (!clientReady && !(await waitForReady(60_000))) {
    throw new Error('WhatsApp 未就緒（等咗 60s 都未 ready，可能仲未掃 QR）');
  }
  const matched = getWhatsappTargets().filter(t => !t.regions || !ev?.region || t.regions.includes(ev.region));
  for (const t of matched) {
    try {
      await withTimeout(client.sendMessage(resolveJid(t.jid), text), SEND_TIMEOUT_MS, `send 去 ${resolveJid(t.jid)}`);
    } catch (err) {
      // timeout 先回收；一般錯誤（例如 jid 唔啱）唔使拆客戶端
      if (/冇反應/.test(err.message)) await recycleClient(err.message);
      throw err; // 交返俾 notify.js 決定重試定記低
    }
  }
}
