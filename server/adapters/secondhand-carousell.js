// Carousell 二手（香港）：Cloudflare 擋直接 fetch，用 Playwright。
// 注意：carousell.tw 對 headless browser 出「推薦 feed」唔出搜尋結果（soft-block），
// 所以台灣二手改用露天拍賣（tw-ruten.js），呢度淨做 HK。
// 二手 listing 只入 feed/價格 chart，唔推通知（ingestItem 只通知 preorder|stock）。
import { ingestItem, UA } from './util.js';
import { getBrowser } from './platform-browser.js';
import { reportSourceHealth } from '../db.js';
import { counterfeitVerdict } from '../trust.js';

const SITES = [
  {
    adapterId: 'carousell-hk', region: 'hk', source: 'Carousell 香港', currency: 'HKD',
    url: 'https://www.carousell.com.hk/search/beyblade%20x?sort_by=3', // 3 = 最新
    priceRe: /HK\$\s*([\d,]+(?:\.\d+)?)/,
  },
];

// 二手雜訊大（周邊/舊系列/爆甲都撈埋）——收窄到 Beyblade X 相關：
// 有 SKU code 直接收；冇 code 就要 X 系關鍵字
const SKU_RE = /\b(BX|UX|CX)G?[-‐－]?\d{1,3}\b/i;
const X_RE = /beyblade\s*x|爆旋陀螺x|戰鬥陀螺x|ベイブレードx/i;
const looksRelevant = t => SKU_RE.test(t) || X_RE.test(t);
const MAX_PER_RUN = 30;

export async function run() {
  const b = await getBrowser();
  if (!b) return 0;
  let added = 0;
  for (const site of SITES) {
    let ctx;
    let itemsSeen = 0;
    try {
      ctx = await b.newContext({ userAgent: UA, locale: site.region === 'tw' ? 'zh-TW' : 'zh-HK', viewport: { width: 1440, height: 900 } });
      const page = await ctx.newPage();
      await page.route('**/*', route => {
        const t = route.request().resourceType();
        return ['image', 'media', 'font'].includes(t) ? route.abort() : route.continue();
      });
      await page.goto(site.url, { waitUntil: 'domcontentloaded', timeout: 45000 });
      await page.waitForFunction(() => !/just a moment/i.test(document.title), { timeout: 25000 })
        .catch(() => { throw new Error('Cloudflare challenge 過唔到'); });
      // 啲卡係 scroll 先 lazy-render——碌幾下等佢出晒（最多 5 輪）
      for (let i = 0; i < 5; i++) {
        await page.mouse.wheel(0, 700);
        await page.waitForTimeout(2000);
        const n = await page.evaluate(() => document.querySelectorAll('a[href*="/p/"]').length);
        if (n > 10) break;
      }

      // 每張卡係一條 /p/ link，成張卡文字入面有 title＋價錢
      const items = await page.evaluate(() => {
        return [...document.querySelectorAll('a[href*="/p/"]')].map(a => ({
          href: a.href.split('?')[0],
          text: (a.closest('div') || a).textContent.replace(/\s+/g, ' ').trim(),
        })).filter(it => it.text);
      });
      itemsSeen = items.length;

      const seen = new Set();
      for (const it of items) {
        if (seen.has(it.href) || !looksRelevant(it.text)) continue;
        if (counterfeitVerdict(it.text)) continue; // 翻版特徵 → 唔收
        seen.add(it.href);
        if (seen.size > MAX_PER_RUN) break;
        const price = parseFloat(it.text.match(site.priceRe)?.[1]?.replace(/,/g, '') ?? '') || null;
        const ok = await ingestItem({
          adapterId: site.adapterId,
          region: site.region,
          source: site.source,
          trust: 'community',
          title: it.text.replace(/^買家保障/, '').slice(0, 120),
          url: it.href,
          price,
          currency: site.currency,
          kindHint: 'secondhand',
        });
        if (ok) added++;
      }
      if (itemsSeen === 0) console.warn(`[${site.adapterId}] 抓到 0 件，可能改咗版`);
    } catch (err) {
      console.warn(`[${site.adapterId}] 抓取失敗：`, err.message);
    } finally {
      await ctx?.close().catch(() => {});
      reportSourceHealth(site.adapterId, itemsSeen);
    }
  }
  return added;
}
