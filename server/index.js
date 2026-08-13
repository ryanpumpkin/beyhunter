import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { feedQuery, autoSkuList, skuGet, skuEvents, eventById, insertReport, skuPriceHistory } from './db.js';
import { ingestItem } from './adapters/util.js';
import { scan } from './trust.js';
import { getRates } from './fx.js';
import { startScheduler } from './fetcher.js';
import { initChannels, whatsapp, notifyNewEvent } from './notify.js';
import { getWhatsappTargets, setWhatsappTargets } from './settings.js';
import { healthRows } from './db.js';
import { startHealthMonitor } from './health.js';
import QRCode from 'qrcode';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
app.use(express.json({ limit: '32kb' }));

const REGIONS = new Set(['hk', 'tw', 'jp']);
const KINDS = new Set(['stock', 'preorder', 'official', 'field_report', 'secondhand']);

// 管理員保護：WhatsApp 設定/測試/配對/QR 呢啲 endpoint 一出街任何人都改到
// 你嘅收件人、亂 send 訊息、甚至偷你嘅配對流程，所以要有 ADMIN_TOKEN
// 先用得（.env 未設就完全唔限制——本機開發方便，部署前記得設）。
// Token 經 X-Admin-Token header 傳（query ?token= 都收，俾 QR 頁瀏覽器直開用）。
import { timingSafeEqual } from 'node:crypto';
const ADMIN_TOKEN = process.env.ADMIN_TOKEN;

// 簡單 in-memory rate limit（防暴力試 token／洗回報）。每 IP 每分鐘一個額度。
const rateBuckets = new Map(); // key -> { count, resetAt }
function rateLimit(key, max) {
  const now = Date.now();
  const b = rateBuckets.get(key);
  if (!b || now > b.resetAt) { rateBuckets.set(key, { count: 1, resetAt: now + 60_000 }); return true; }
  return ++b.count <= max;
}
setInterval(() => { // 唔好俾個 Map 無限膨脹
  const now = Date.now();
  for (const [k, b] of rateBuckets) if (now > b.resetAt) rateBuckets.delete(k);
}, 5 * 60_000).unref();

function tokenMatches(got) {
  if (typeof got !== 'string' || !got) return false;
  const a = Buffer.from(got);
  const b = Buffer.from(ADMIN_TOKEN);
  // timingSafeEqual 要同長度；長度唔同直接 false（長度本身唔算秘密）
  return a.length === b.length && timingSafeEqual(a, b);
}

function requireAdmin(req, res, next) {
  if (!ADMIN_TOKEN) return next(); // 未設 token＝本機開發模式，唔限制
  if (!rateLimit(`admin:${req.ip}`, 30)) return res.status(429).json({ ok: false, error: '太密，遲下再試' });
  const got = req.get('X-Admin-Token') || req.query.token;
  if (!tokenMatches(got)) return res.status(401).json({ ok: false, error: '需要管理員 token' });
  next();
}

app.get('/api/feed', (req, res) => {
  const region = REGIONS.has(req.query.region) ? req.query.region : null;
  const kind = KINDS.has(req.query.kind) ? req.query.kind : null;
  const limit = Math.min(parseInt(req.query.limit, 10) || 50, 100);
  const offset = Math.max(parseInt(req.query.offset, 10) || 0, 0);
  const rows = feedQuery.all({ region, kind, limit, offset });
  res.json({ items: rows.map(r => ({ ...r, flags: r.flags ? JSON.parse(r.flags) : [] })) });
});

// 目錄：由 events 實際見過嘅 SKU 自動匯總（連發射器/手柄/戰鬥盤/BXG 特別版/
// CX 系列都會自動出現），手打嘅 skus 表淨係用嚟補中日文名，冇再靠佢做目錄主體
app.get('/api/skus', (_req, res) => res.json({ skus: autoSkuList.all() }));

app.get('/api/skus/:code', (req, res) => {
  const code = String(req.params.code).toUpperCase();
  if (!/^(BXG|UXG|CXG|BX|UX|CX)-\d{1,3}$/.test(code)) return res.status(400).json({ error: 'SKU 格式無效' });
  // 目錄未收錄嘅 SKU（例如新出嘅 CX 系列）都照俾睇相關情報
  const sku = skuGet.get(code) || { code, name_zh: null, name_ja: null, series: code.split('-')[0], msrp_jpy: null };
  const events = skuEvents.all(code).map(r => ({ ...r, flags: r.flags ? JSON.parse(r.flags) : [] }));
  res.json({ sku, events });
});

// SKU 歷史價格（chart 用）：全部有價 events（全新＋二手）＋同一件貨嘅價格變化
app.get('/api/skus/:code/prices', (req, res) => {
  const code = String(req.params.code).toUpperCase();
  if (!/^(BXG|UXG|CXG|BX|UX|CX)-\d{1,3}$/.test(code)) return res.status(400).json({ error: 'SKU 格式無效' });
  res.json({ points: skuPriceHistory.all({ code }) });
});

app.get('/api/fx', async (_req, res) => res.json({ toHKD: await getRates() }));

// 用一條真實 event 重新觸發通知（唔限「新貨」，方便手動測試某條情報實際會點顯示）
app.get('/api/notify/resend/:id', requireAdmin, async (req, res) => {
  const ev = eventById.get(req.params.id);
  if (!ev) return res.status(404).json({ error: '搵唔到呢條情報' });
  try {
    const ok = await notifyNewEvent({ ...ev, flags: ev.flags ? JSON.parse(ev.flags) : [] });
    res.json({ ok, event: { id: ev.id, title: ev.title, kind: ev.kind, url: ev.url } });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// 發一條測試通知。?jid=xxx@g.us / me → 只發嗰個收件人；唔俾 jid → 全部
app.get('/api/whatsapp/test', requireAdmin, async (req, res) => {
  const text = '🧪 BeyHunter 測試訊息——WhatsApp 補貨通知已駁通！之後有貨/預訂會即刻推到呢度。';
  try {
    if (req.query.jid) await whatsapp.sendTo(String(req.query.jid), text);
    else await whatsapp.send(text);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// WhatsApp 狀態（設定 GUI 用）：連線情況＋收件人＋斷線紀錄
app.get('/api/whatsapp/status', requireAdmin, (_req, res) => {
  const s = whatsapp.status();
  res.json({ ...s, qr: undefined, hasQr: !!s.qr }); // QR 字串唔經 JSON 出（用 /qr 頁）
});

// 收件人管理（設定 GUI）
app.get('/api/whatsapp/targets', requireAdmin, (_req, res) => res.json({ targets: getWhatsappTargets() }));
app.put('/api/whatsapp/targets', requireAdmin, (req, res) => {
  try {
    const targets = setWhatsappTargets(req.body?.targets);
    res.json({ ok: true, targets });
  } catch (err) {
    res.status(400).json({ ok: false, error: err.message });
  }
});

// 已入嘅 WhatsApp 群組清單（設定 GUI 揀 group 用，唔使自己搵 jid）
app.get('/api/whatsapp/groups', requireAdmin, async (_req, res) => {
  try {
    res.json({ groups: await whatsapp.listGroups() });
  } catch (err) {
    res.status(503).json({ ok: false, error: err.message });
  }
});

// 各來源健康狀態（設定 GUI 顯示）
app.get('/api/sources/health', requireAdmin, (_req, res) => res.json({ sources: healthRows.all() }));

// Pairing code 登入（免掃 QR）：GET /api/whatsapp/pair?phone=85298765432&token=...
// 回傳 8 位 code，手機 WhatsApp「已連結的裝置 → 改用電話號碼連結」入
app.get('/api/whatsapp/pair', requireAdmin, async (req, res) => {
  const phone = String(req.query.phone || '').replace(/[^\d]/g, '');
  if (!/^\d{8,15}$/.test(phone)) return res.status(400).json({ ok: false, error: 'phone 要連國碼純數字，例如 85298765432' });
  try {
    const code = await whatsapp.requestPairingCode(phone);
    res.json({ ok: true, code });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// WhatsApp 登入 QR 頁：連結你個 WhatsApp 帳號嘅入口，一定要保護——
// 冇 requireAdmin 嘅話任何人都可以連自己部電話上你個 bot，變成用你個號碼發訊息。
// 頁面本身要求 ?token=，之後嘅 fetch 都帶埋佢（用 URL query，唔用 header，方便瀏覽器直接開）。
app.get('/api/whatsapp/qr', requireAdmin, async (req, res) => {
  const tokenQs = ADMIN_TOKEN ? `token=${encodeURIComponent(req.query.token || '')}&` : '';
  res.set('Content-Type', 'text/html; charset=utf-8');
  res.send(`<!doctype html><meta charset=utf-8><title>WhatsApp 登入</title>
<body style="font-family:sans-serif;text-align:center;padding:32px;background:#0B1F3A;color:#e5edf8">
<div id="app">載入中…</div>
<script>
const qs = '?${tokenQs}';
async function tick() {
  const s = await fetch('/api/whatsapp/status' + qs).then(r => r.json());
  const app = document.getElementById('app');
  if (!s.configured) { app.innerHTML = '<p>WhatsApp 未啟用。喺 .env 設 WHATSAPP_ENABLED=1，再重啟。</p>'; return; }
  if (s.ready) {
    app.innerHTML = '<p style="font-size:20px">✅ 已連結，補貨通知會推去 <b>' +
      (s.targets || []).map(t => t.label || t.jid).join('、') + '</b></p>';
    return;
  }
  let qrHtml = '<p>啟動緊…（等幾秒）</p>';
  if (s.hasQr) {
    const img = await fetch('/api/whatsapp/qr-image' + qs).then(r => r.text());
    qrHtml = '<p>方法一：WhatsApp App → 設定 → 已連結的裝置 → 連結裝置，掃描：</p>' + img;
  }
  app.innerHTML = qrHtml +
    '<hr style="margin:24px 0;border-color:#ffffff22">' +
    '<p>方法二：入電話號碼（連國碼，例如 85298765432）攞配對碼：</p>' +
    '<input id="phone" placeholder="85298765432" style="padding:8px;border-radius:6px;border:none;text-align:center">' +
    '<button onclick="pair()" style="padding:8px 16px;margin-left:8px;border-radius:6px;border:none;background:#F4C430;font-weight:bold">攞配對碼</button>' +
    '<p id="pairResult" style="font-size:24px;letter-spacing:2px;margin-top:12px"></p>';
}
async function pair() {
  const phone = document.getElementById('phone').value;
  const r = await fetch('/api/whatsapp/pair' + qs + '&phone=' + encodeURIComponent(phone)).then(r => r.json());
  document.getElementById('pairResult').textContent = r.ok
    ? '配對碼：' + r.code + '（去手機入呢個碼）'
    : '錯誤：' + r.error;
}
tick();
setInterval(tick, 5000);
</script>
</body>`);
});

// 純 QR image tag，俾上面個頁 fetch 落嚟塞入去（避免每次 tick 成個表格一齊被替換）
app.get('/api/whatsapp/qr-image', requireAdmin, async (_req, res) => {
  const s = whatsapp.status();
  res.set('Content-Type', 'text/html; charset=utf-8');
  if (!s.qr) return res.send('');
  const img = await QRCode.toDataURL(s.qr, { width: 280, margin: 2 });
  res.send(`<img src="${img}" width="280" height="280"/>`);
});

// 玩家回報——系統邊界，嚴格驗證輸入＋rate limit（公開 endpoint，防灌水）
app.post('/api/report', async (req, res) => {
  if (!rateLimit(`report:${req.ip}`, 5)) return res.status(429).json({ error: '回報太密，一分鐘後再試' });
  const { region, shop, district, sku_code, price, note } = req.body || {};
  if (!REGIONS.has(region)) return res.status(400).json({ error: 'region 必須係 hk/tw/jp' });
  if (typeof shop !== 'string' || !shop.trim() || shop.length > 100) return res.status(400).json({ error: '舖名必填（100 字內）' });
  if (note != null && (typeof note !== 'string' || note.length > 500)) return res.status(400).json({ error: '備註限 500 字' });
  if (price != null && (typeof price !== 'number' || price < 0 || price > 100000)) return res.status(400).json({ error: '價錢無效' });
  if (sku_code != null && !/^(BX|UX|CX)-\d{1,3}$/i.test(sku_code)) return res.status(400).json({ error: 'SKU 格式：BX-01' });

  const clean = {
    region,
    shop: shop.trim(),
    district: typeof district === 'string' ? district.trim().slice(0, 50) : null,
    sku_code: sku_code ? sku_code.toUpperCase() : null,
    price: price ?? null,
    note: note?.trim() || null,
  };
  insertReport.run(clean);

  const text = `${clean.shop}${clean.district ? `（${clean.district}）` : ''}${clean.sku_code ? ` ${clean.sku_code}` : ''} ${clean.note || '有現貨情報'}`;
  await ingestItem({
    adapterId: 'hk-reports',
    region: clean.region,
    source: '玩家回報',
    trust: 'community',
    title: text.slice(0, 120),
    original: clean.note,
    price: clean.price,
    currency: clean.region === 'tw' ? 'TWD' : clean.region === 'jp' ? 'JPY' : 'HKD',
    kindHint: 'field_report',
    flags: scan(clean.note || '') || null,
  });
  res.json({ ok: true });
});

// production：serve 埋 build 好嘅前端
const dist = path.join(__dirname, '..', 'web', 'dist');
app.use(express.static(dist));
app.get(/^\/(?!api\/).*/, (_req, res, next) => {
  res.sendFile(path.join(dist, 'index.html'), err => err && next());
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`[server] BeyHunter API 起咗喺 http://localhost:${PORT}`);
  initChannels();
  startScheduler();
  startHealthMonitor();
});
