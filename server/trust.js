// 防詐規則引擎：掃內容入面嘅連結同高危字眼，回傳 flags（JSON array）。
// 靈感來自真實案例：假賣家用 my.7-11.com.bsrtd.top 冒充 7-11 賣貨便。

// 香港/台灣/日本 正規購物網域（結尾 match）
const LEGIT_DOMAINS = [
  '7-11.com.tw', 'myship.7-11.com.tw', 'shopee.tw', 'shopee.hk',
  'momoshop.com.tw', 'pchome.com.tw', 'toysrus.com.hk', 'toysrus.com.tw',
  'hktvmall.com', 'takaratomy.co.jp', 'takaratomy-asia.com',
  'rakuten.co.jp', 'amazon.co.jp', 'fooklemodel.com', 'tclub.com.hk',
];

// 品牌關鍵字：如果 hostname 包含佢但唔係正規網域 → 仿冒
const BRAND_TOKENS = ['7-11', '7eleven', 'toysrus', 'takaratomy', 'shopee', 'momo', 'pchome'];

const RISK_PATTERNS = [
  { flag: 'dm_order',   re: /私訊下單|私下交易|直接匯款|先付款|WhatsApp\s*落單/i, label: '要求私下交易/先付款' },
  { flag: 'line_pay',   re: /加\s*LINE.{0,8}(付款|匯款|下單)/i, label: '引導加 LINE 付款' },
  { flag: 'urgency',    re: /最後.{0,4}(機會|一天)|限時.{0,4}(優惠|特價).{0,6}(今|即)/i, label: '製造急迫感' },
];

const URL_RE = /https?:\/\/[^\s"'<>）)]+/gi;

function hostnameOf(url) {
  try { return new URL(url).hostname.toLowerCase(); } catch { return null; }
}

export function checkLinks(text) {
  const flags = [];
  for (const url of (text || '').match(URL_RE) || []) {
    const host = hostnameOf(url);
    if (!host) continue;
    const legit = LEGIT_DOMAINS.some(d => host === d || host.endsWith('.' + d));
    if (legit) continue;
    // 真品牌名出現喺一個唔正規嘅網域 → 高危仿冒（例：my.7-11.com.bsrtd.top）
    const impersonating = BRAND_TOKENS.some(t => host.includes(t));
    if (impersonating) {
      flags.push({ flag: 'fake_domain', label: `仿冒網域：${host}`, url });
    } else if (/\.(top|shop|icu|xyz|club|buzz)$/.test(host)) {
      flags.push({ flag: 'risky_tld', label: `可疑網域：${host}`, url });
    }
  }
  return flags;
}

export function checkContent(text) {
  const flags = [];
  for (const { flag, re, label } of RISK_PATTERNS) {
    if (re.test(text || '')) flags.push({ flag, label });
  }
  return flags;
}

// 主入口：回傳 flags array（空 array = 冇發現問題）
export function scan(text) {
  return [...checkLinks(text), ...checkContent(text)];
}

// ── 翻版/仿冒品偵測（二手/拍賣平台用）──
// 真實案例：露天「爆旋陀螺爆裂爆旋戰鬥陀螺X世代BX-00異界聖劍復刻版男孩完據禮物」
// 特徵：(1) 翻版賣家慣用詞（復刻版/完據/副廠/兼容…）
//      (2) 港台譯名堆砌（爆旋陀螺＋戰鬥陀螺塞埋一齊 SEO）——正常賣家唔會咁寫
// 強特徵 → 直接唔收（block）；避免誤殺，冇中就照收。
// 強特徵：翻版賣家慣用詞，中一個即 block
const COUNTERFEIT_BLOCK_RE = /復刻版|完[據据]|副廠|非原[廠装裝]|兼容|相容款|散[件裝]|拆賣|批發|廠家直|國產.{0,6}陀螺/;
// 淘寶式 spam 詞：單獨唔算，但配埋「譯名堆砌」就好可疑
const SPAM_MARKER_RE = /男孩|兒童.{0,6}禮物|跨境|禮物盒|玩具批|多美卡/;
const NAME_STUFFING_RE = /爆旋陀螺[^,，。]{0,10}戰鬥陀螺|戰鬥陀螺[^,，。]{0,10}爆旋陀螺|爆裂.{0,6}(爆旋|戰鬥)陀螺/;

// 回傳 'block'（唔好收）或 null（照收）。
// 注意：唔少正常跨區賣家會兩個譯名都寫（方便搜尋），所以「堆砌」單獨唔 block，
// 要同時有淘寶式 spam 詞先算翻版。
export function counterfeitVerdict(title) {
  const t = title || '';
  if (COUNTERFEIT_BLOCK_RE.test(t)) return 'block';
  if (NAME_STUFFING_RE.test(t) && SPAM_MARKER_RE.test(t)) return 'block';
  return null;
}
