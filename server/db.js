import Database from 'better-sqlite3';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// DB_PATH 可用環境變數指定（Docker 部署時掛一個 volume 落嚟，資料先會持久化）
const db = new Database(process.env.DB_PATH || path.join(__dirname, 'beyhunter.db'));
db.pragma('journal_mode = WAL');

db.exec(`
CREATE TABLE IF NOT EXISTS skus (
  code       TEXT PRIMARY KEY,       -- e.g. BX-01, UX-15
  name_zh    TEXT NOT NULL,
  name_ja    TEXT,
  series     TEXT NOT NULL,          -- BX | UX | CX
  msrp_jpy   INTEGER,
  category   TEXT DEFAULT 'bey'      -- bey(陀螺) | launcher(發射器/手柄) | stadium(戰鬥盤) | set(套裝) | tool(工具配件)
);
CREATE TABLE IF NOT EXISTS events (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  dedupe_key   TEXT UNIQUE,          -- source+external id，防重複
  region       TEXT NOT NULL,        -- hk | tw | jp
  kind         TEXT NOT NULL,        -- stock | preorder | official | field_report
  source       TEXT NOT NULL,
  title        TEXT NOT NULL,
  summary      TEXT,
  original     TEXT,
  url          TEXT,
  price        REAL,
  currency     TEXT,                 -- HKD | TWD | JPY
  price_hkd    REAL,
  sku_code     TEXT,
  trust        TEXT DEFAULT 'community',  -- official | verified_shop | community
  flags        TEXT,                 -- JSON array of scam-warning flags
  published_at TEXT NOT NULL,
  created_at   TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_events_feed ON events (published_at DESC);
CREATE INDEX IF NOT EXISTS idx_events_sku  ON events (sku_code);
CREATE TABLE IF NOT EXISTS reports (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  region     TEXT NOT NULL,
  shop       TEXT NOT NULL,
  district   TEXT,
  sku_code   TEXT,
  price      REAL,
  note       TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS verdicts (
  adapter   TEXT NOT NULL,
  item_key  TEXT NOT NULL,
  verdict   TEXT NOT NULL,            -- ok | oos
  streak    INTEGER NOT NULL DEFAULT 1,
  PRIMARY KEY (adapter, item_key)
);
CREATE TABLE IF NOT EXISTS snapshots (
  adapter    TEXT NOT NULL,
  item_key   TEXT NOT NULL,          -- 商品喺該來源嘅唯一 key
  seen_at    TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (adapter, item_key)
);
CREATE TABLE IF NOT EXISTS price_points (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  dedupe_key TEXT NOT NULL,           -- 對應 events.dedupe_key
  price      REAL,
  price_hkd  REAL,
  seen_at    TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_price_points_key ON price_points (dedupe_key);
CREATE TABLE IF NOT EXISTS waiting_room_log (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  adapter     TEXT NOT NULL,
  got_through INTEGER NOT NULL DEFAULT 0,   -- 1 = 排到入到去抓；0 = 排唔到
  seen_at     TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_wrl ON waiting_room_log (adapter, seen_at);
CREATE TABLE IF NOT EXISTS source_health (
  adapter     TEXT PRIMARY KEY,
  last_run    TEXT,                        -- 最後一次跑（無論結果）
  last_ok     TEXT,                        -- 最後一次成功抓到 >=1 件
  zero_streak INTEGER NOT NULL DEFAULT 0,  -- 連續抓到 0 件次數
  alerted     INTEGER NOT NULL DEFAULT 0   -- 出咗警報未（復原後 reset）
);
`);

// migration：舊 DB 加欄位（已存在會 throw，照吞）
try { db.exec(`ALTER TABLE events ADD COLUMN sold_out INTEGER NOT NULL DEFAULT 0`); } catch { /* already exists */ }
try { db.exec(`ALTER TABLE skus ADD COLUMN category TEXT DEFAULT 'bey'`); } catch { /* already exists */ }
try { db.exec(`ALTER TABLE source_health ADD COLUMN last_error TEXT`); } catch { /* already exists */ }

export const insertEvent = db.prepare(`
  INSERT INTO events (dedupe_key, region, kind, source, title, summary, original, url,
                      price, currency, price_hkd, sku_code, trust, flags, published_at)
  VALUES (@dedupe_key, @region, @kind, @source, @title, @summary, @original, @url,
          @price, @currency, @price_hkd, @sku_code, @trust, @flags, @published_at)
  ON CONFLICT(dedupe_key) DO NOTHING
`);

export const feedQuery = db.prepare(`
  SELECT * FROM events
  WHERE (@region IS NULL OR region = @region)
    AND (@kind   IS NULL OR kind   = @kind)
    -- 「全部類型」唔撈二手入去（太多、太雜）——要睇二手撳個「二手」chip 先出
    AND (@kind IS NOT NULL OR kind != 'secondhand')
    -- 篩「現貨」時唔包賣晒嘅（佢哋仲會喺「全部」出現，標住「賣晒」）
    AND (COALESCE(@kind, '') != 'stock' OR sold_out = 0)
  ORDER BY published_at DESC LIMIT @limit OFFSET @offset
`);

export const skuList   = db.prepare(`SELECT * FROM skus ORDER BY series, code`);
export const skuGet    = db.prepare(`SELECT * FROM skus WHERE code = ?`);

// 自動目錄：由 events 實際見過嘅 sku_code 匯總——連手打漏咗嘅發射器、
// 手柄、戰鬥盤、BXG 特別版、CX 系列都會自動出現，同真實貨源同步。
// LEFT JOIN skus 攞返手打嘅中/日文名（有就用），冇就 fallback 用 title 猜個顯示名。
export const autoSkuList = db.prepare(`
  SELECT
    e.sku_code AS code,
    COALESCE(s.name_zh, MIN(e.title)) AS name_zh,
    s.name_ja,
    substr(e.sku_code, 1,
      CASE WHEN substr(e.sku_code, 3, 1) = 'G' THEN 3 ELSE 2 END
    ) AS series,
    s.msrp_jpy,
    COALESCE(s.category, 'bey') AS category,
    COUNT(*) AS event_count,
    -- 「最平」唔計散件（淨蓋/軸/盤），否則被扯到低到離譜、誤導「抵買」
    MIN(CASE WHEN e.sold_out = 0 AND (e.flags IS NULL OR e.flags NOT LIKE '%parts_only%')
             THEN e.price_hkd END) AS cheapest_hkd,
    MAX(e.published_at) AS last_seen_at
  FROM events e
  LEFT JOIN skus s ON s.code = e.sku_code
  WHERE e.sku_code IS NOT NULL
  GROUP BY e.sku_code
  ORDER BY series, e.sku_code
`);
export const skuEvents = db.prepare(`
  SELECT * FROM events WHERE sku_code = ? ORDER BY published_at DESC LIMIT 50
`);
export const eventById = db.prepare(`SELECT * FROM events WHERE id = ?`);
export const upsertSku = db.prepare(`
  INSERT INTO skus (code, name_zh, name_ja, series, msrp_jpy, category)
  VALUES (@code, @name_zh, @name_ja, @series, @msrp_jpy, @category)
  ON CONFLICT(code) DO UPDATE SET name_zh=@name_zh, name_ja=@name_ja, msrp_jpy=@msrp_jpy, category=@category
`);
export const insertReport = db.prepare(`
  INSERT INTO reports (region, shop, district, sku_code, price, note)
  VALUES (@region, @shop, @district, @sku_code, @price, @note)
`);

// 歷史價格：首見一點、之後價格有變就加一點＋同步返 events 現價
export const insertPricePoint = db.prepare(`
  INSERT INTO price_points (dedupe_key, price, price_hkd) VALUES (?, ?, ?)
`);
export const updateEventPrice = db.prepare(`
  UPDATE events SET price = ?, price_hkd = ? WHERE dedupe_key = ?
`);
// SKU 歷史價格（chart 用）：所有有價 events ＋ price_points 變化，一條 query 併埋
export const skuPriceHistory = db.prepare(`
  SELECT e.published_at AS t, e.price_hkd, e.kind, e.source, e.url, e.sold_out
  FROM events e WHERE e.sku_code = @code AND e.price_hkd IS NOT NULL
    AND (e.flags IS NULL OR e.flags NOT LIKE '%parts_only%')
  UNION ALL
  SELECT p.seen_at AS t, p.price_hkd, e.kind, e.source, e.url, e.sold_out
  FROM price_points p JOIN events e ON e.dedupe_key = p.dedupe_key
  WHERE e.sku_code = @code AND p.price_hkd IS NOT NULL
    AND (e.flags IS NULL OR e.flags NOT LIKE '%parts_only%')
  ORDER BY t
`);

// 售罄/補貨狀態同步
export const findByDedupe = db.prepare(`SELECT id, sold_out, price, flags, kind FROM events WHERE dedupe_key = ?`);
export const markSoldOut = db.prepare(`UPDATE events SET sold_out = 1 WHERE dedupe_key = ? AND sold_out = 0`);
export const markRestocked = db.prepare(`UPDATE events SET sold_out = 0, published_at = ? WHERE dedupe_key = ?`);
// coming_soon 開賣：升級 kind（→ stock/preorder）兼 bump published_at 排返上 feed 頂
export const updateEventKind = db.prepare(`UPDATE events SET kind = ?, published_at = ? WHERE dedupe_key = ?`);

// verdict debounce：俾讀數唔穩定嘅來源（頁面有 cache 彈來彈去嗰啲）用——
// 連續 needed 次讀到同一結果先算數，防止狀態 flip-flop 亂通知
const getVerdict = db.prepare(`SELECT verdict, streak FROM verdicts WHERE adapter=? AND item_key=?`);
const setVerdict = db.prepare(`
  INSERT INTO verdicts (adapter, item_key, verdict, streak) VALUES (?, ?, ?, ?)
  ON CONFLICT(adapter, item_key) DO UPDATE SET verdict=excluded.verdict, streak=excluded.streak
`);
export function confirmVerdict(adapter, itemKey, verdict, needed = 2) {
  const row = getVerdict.get(adapter, itemKey);
  const streak = row && row.verdict === verdict ? row.streak + 1 : 1;
  setVerdict.run(adapter, itemKey, verdict, streak);
  return streak >= needed;
}

// 來源健康：每次 fetch 完記低抓到幾多件（0 = 可疑，可能改版/被封）。
// itemsSeen 係「頁面抓到幾多件」，唔係「幾多件新」——dedupe 後 0 新係正常。
// reason：失敗時嘅死因（如 'HTTP 521'、'timeout'、'ECONNREFUSED'）——成功會清返 null。
// 只喺 adapter 確實 fetch 失敗時傳；「站正常但抓到 0 件」唔應傳 reason（唔係死機）。
const upsertHealth = db.prepare(`
  INSERT INTO source_health (adapter, last_run, last_ok, zero_streak, alerted, last_error)
  VALUES (@adapter, @now, CASE WHEN @ok THEN @now ELSE NULL END, CASE WHEN @ok THEN 0 ELSE 1 END, 0,
          CASE WHEN @ok THEN NULL ELSE @reason END)
  ON CONFLICT(adapter) DO UPDATE SET
    last_run = @now,
    last_ok = CASE WHEN @ok THEN @now ELSE last_ok END,
    zero_streak = CASE WHEN @ok THEN 0 ELSE zero_streak + 1 END,
    alerted = CASE WHEN @ok THEN 0 ELSE alerted END,
    last_error = CASE WHEN @ok THEN NULL ELSE @reason END
`);
export function reportSourceHealth(adapter, itemsSeen, reason = null) {
  upsertHealth.run({ adapter, now: new Date().toISOString(), ok: itemsSeen > 0 ? 1 : 0, reason });
}
export const healthRows = db.prepare(`SELECT * FROM source_health ORDER BY adapter`);

// 等候室事件留底：每次偵測都記一行（含排到/排唔到），俾事後查「今日幾點開過」。
// 回傳 true = 新一潮（距上次偵測 >30 分鐘）——值得推一次 alert，唔會每 180 秒轟。
// DB-based，重啟都記得，唔似之前 in-memory Set 會清。
const priorWaitingRoom = db.prepare(`SELECT 1 FROM waiting_room_log WHERE adapter = ? AND seen_at > datetime('now','-30 minutes') LIMIT 1`);
const insertWaitingRoom = db.prepare(`INSERT INTO waiting_room_log (adapter, got_through) VALUES (?, ?)`);
export function logWaitingRoom(adapter, gotThrough) {
  const isNewEpisode = !priorWaitingRoom.get(adapter);
  insertWaitingRoom.run(adapter, gotThrough ? 1 : 0);
  return isNewEpisode;
}
// 查歷史：sinceExpr 例 '-24 hours'、'-1 day'（datetime modifier）
export const waitingRoomHistory = db.prepare(`
  SELECT adapter, got_through, seen_at FROM waiting_room_log
  WHERE seen_at > datetime('now', @since) ORDER BY seen_at DESC
`);
export const markAlerted = db.prepare(`UPDATE source_health SET alerted = 1 WHERE adapter = ?`);

// snapshot diff：回傳 true = 新見到嘅 item（用嚟觸發通知）
const snapshotHas = db.prepare(`SELECT 1 FROM snapshots WHERE adapter=? AND item_key=?`);
const snapshotAdd = db.prepare(`INSERT OR IGNORE INTO snapshots (adapter, item_key) VALUES (?, ?)`);
export function isNewItem(adapter, itemKey) {
  const seen = snapshotHas.get(adapter, itemKey);
  snapshotAdd.run(adapter, itemKey);
  return !seen;
}

export default db;
