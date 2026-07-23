// Mercari 煤爐（日本最大二手平台）：SPA＋反爬蟲勁，用 Playwright。
// 呢個來源最易斷——壞咗由 health monitor 警報，唔影響其他 adapter。
import { ingestItem, UA, errReason } from './util.js';
import { getBrowser } from './platform-browser.js';
import { reportSourceHealth } from '../db.js';

const SEARCH_URL = 'https://jp.mercari.com/search?keyword=' + encodeURIComponent('ベイブレードX') + '&status=on_sale&sort=created_time&order=desc';

export async function run() {
  const b = await getBrowser();
  if (!b) return 0;
  let added = 0;
  let itemsSeen = 0;
  let reason = null;
  let ctx;
  try {
    ctx = await b.newContext({ userAgent: UA, locale: 'ja-JP', viewport: { width: 1440, height: 900 } });
    const page = await ctx.newPage();
    await page.route('**/*', route => {
      const t = route.request().resourceType();
      return ['image', 'media', 'font'].includes(t) ? route.abort() : route.continue();
    });
    await page.goto(SEARCH_URL, { waitUntil: 'domcontentloaded', timeout: 45000 });
    await page.waitForSelector('li[data-testid="item-cell"]', { timeout: 20000 }).catch(() => {});
    await page.waitForTimeout(2000);

    const items = await page.evaluate(() => {
      return [...document.querySelectorAll('li[data-testid="item-cell"]')].map(li => {
        const a = li.querySelector('a[href*="/item/"]');
        const text = li.textContent.replace(/\s+/g, ' ').trim();
        return {
          href: a ? a.href.split('?')[0] : '',
          title: text.slice(0, 120),
          price: parseInt((text.match(/([\d,]+)\s*円|¥\s*([\d,]+)/) || []).slice(1).find(Boolean)?.replace(/,/g, '') ?? '', 10) || null,
        };
      }).filter(it => it.href && it.title);
    });
    itemsSeen = items.length;

    for (const it of items.slice(0, 30)) {
      const ok = await ingestItem({
        adapterId: 'jp-mercari',
        region: 'jp',
        source: 'Mercari',
        trust: 'community',
        title: it.title,
        url: it.href,
        price: it.price,
        currency: 'JPY',
        kindHint: 'secondhand',
      });
      if (ok) added++;
    }
    if (itemsSeen === 0) console.warn('[mercari] 抓到 0 件——可能俾反爬蟲擋咗或者改版');
  } catch (err) {
    console.warn('[mercari] 抓取失敗：', err.message);
    reason = errReason(err);
  } finally {
    await ctx?.close().catch(() => {});
  }
  reportSourceHealth('jp-mercari', itemsSeen, reason);
  return added;
}
