// 通知設定 store（GUI 可改，存 JSON 檔）。
// WhatsApp 收件人清單以呢度為準；檔案未有時由 WHATSAPP_TO 環境變數遷移一次。
// DATA_DIR 指定位置（Docker 掛 volume 先持久化），預設放 server/ 隔離。
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FILE = path.join(process.env.DATA_DIR || __dirname, 'notify-settings.json');

// { whatsappTargets: [{ jid, label?, regions: null | ['hk','tw'] }] }
let cache = null;

function envTargets() {
  return (process.env.WHATSAPP_TO || '')
    .split(',')
    .map(s => s.trim())
    .filter(Boolean)
    .map(entry => {
      const [jid, regionSpec] = entry.split(':');
      return {
        jid: jid.trim(),
        regions: regionSpec ? regionSpec.split('|').map(r => r.trim().toLowerCase()) : null,
      };
    });
}

export function loadSettings() {
  if (cache) return cache;
  try {
    cache = JSON.parse(fs.readFileSync(FILE, 'utf8'));
  } catch {
    cache = { whatsappTargets: envTargets() }; // 首次由 .env 遷移
    saveSettings(cache);
  }
  return cache;
}

export function saveSettings(next) {
  cache = next;
  fs.writeFileSync(FILE, JSON.stringify(next, null, 2));
}

export function getWhatsappTargets() {
  return loadSettings().whatsappTargets || [];
}

const REGIONS = new Set(['hk', 'tw', 'jp']);

// 驗證＋寫入（系統邊界，嚴格啲）。回傳清洗後嘅 list；格式錯 throw。
export function setWhatsappTargets(targets) {
  if (!Array.isArray(targets) || targets.length > 20) throw new Error('targets 要係 array（最多 20 個）');
  const clean = targets.map(t => {
    const jid = String(t.jid || '').trim();
    if (jid !== 'me' && !/^\d{5,20}@(c|g)\.us$/.test(jid)) throw new Error(`收件人格式錯：${jid}（要 xxx@c.us / xxx@g.us / me）`);
    let regions = null;
    if (Array.isArray(t.regions) && t.regions.length) {
      regions = [...new Set(t.regions.map(r => String(r).toLowerCase()))];
      if (regions.some(r => !REGIONS.has(r))) throw new Error('regions 只可以係 hk/tw/jp');
    }
    const label = t.label ? String(t.label).slice(0, 60) : undefined;
    return { jid, ...(label ? { label } : {}), regions };
  });
  saveSettings({ ...loadSettings(), whatsappTargets: clean });
  return clean;
}
