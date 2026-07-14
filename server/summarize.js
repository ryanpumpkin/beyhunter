// 規則式摘要＋分類引擎（免費，唔使 API key）。
// 日後想升級 AI：加一個 provider function，簽名一樣 (text, ctx) => {...} 就換到。

// 包埋 BXG/UXG/CXG（限定/特典系列，例：BXG-13 神力聖劍）
const SKU_RE = /\b(BXG|UXG|CXG|BX|UX|CX)[-\s]?(\d{1,3})\b/gi;
const PRICE_RE = /(?:HK\$|NT\$|¥|￥|\$)\s?([\d,]+(?:\.\d+)?)/;
const DATE_RE = /(\d{4}年)?\s?(\d{1,2})月(\d{1,2})日?/;

const KIND_RULES = [
  { kind: 'preorder', re: /預訂|預購|預售|截訂|訂金|落訂|預約|下訂|PSL/i },
  { kind: 'stock',    re: /現貨|到貨|補貨|返貨|入荷|再販|上架|開賣/ },
  { kind: 'official', re: /公告|發售資訊|抽籤|排隊|販售方式|發售日/ },
];

export function extractSkus(text) {
  const found = new Set();
  for (const m of (text || '').matchAll(SKU_RE)) {
    const num = String(m[2]).padStart(2, '0');
    // 「-00」唔係真正嘅獨立商品編號，係官方/店家用嚟標
    // 金屬塗裝／店舖限定／活動限定版嘅萬用佔位符，同一個「BX-00」
    // 底下可以係好多完全唔同嘅貨。收埋佢，避免將唔同商品錯誤歸做同一件。
    // 如果標題仲有其他真編號（例：BXG-06），照樣會收到嗰個。
    if (num === '00') continue;
    found.add(`${m[1].toUpperCase()}-${num}`);
  }
  return [...found];
}

export function extractPrice(text) {
  const m = (text || '').match(PRICE_RE);
  if (!m) return { price: null, currency: null };
  const price = parseFloat(m[1].replace(/,/g, ''));
  const raw = m[0];
  const currency = raw.startsWith('NT') ? 'TWD' : /[¥￥]/.test(raw) ? 'JPY' : 'HKD';
  return { price, currency };
}

export function classify(text) {
  for (const { kind, re } of KIND_RULES) if (re.test(text || '')) return kind;
  return 'field_report';
}

// 一句摘要：邊間舖 + 咩 SKU + 咩事 + 價錢/日期（有先講）
export function summarize(text, { source = '' } = {}) {
  const t = text || '';
  const skus = extractSkus(t);
  const kind = classify(t);
  const { price, currency } = extractPrice(t);
  const date = t.match(DATE_RE)?.[0];

  const kindLabel = { preorder: '開放預訂', stock: '有現貨/補貨', official: '發布公告', field_report: '玩家情報' }[kind];
  const parts = [];
  if (source) parts.push(source);
  parts.push(skus.length ? `${skus.join('、')} ${kindLabel}` : kindLabel);
  if (price) parts.push(`${currency === 'TWD' ? 'NT$' : currency === 'JPY' ? '¥' : 'HK$'}${price}`);
  if (date && kind === 'preorder') parts.push(`（${date}）`);

  return { summary: parts.join(' '), kind, skus, price, currency };
}
