// 日本 樂天：搜尋結果頁 scrape。樂天有官方 API 但要 app ID。
// 2026-07 起樂天用 Akamai 擋直接 fetch（無論咩 UA 都淨回 41 byte reference 頁），
// 改用 Playwright 真 browser 載頁；DOM 結構不變（.searchresultitem 照用）。
import { ingestItem, UA } from './util.js';
import { getBrowser } from './platform-browser.js';
import { reportSourceHealth } from '../db.js';

const SEARCH_URLS = [
  'https://search.rakuten.co.jp/search/mall/%E3%83%99%E3%82%A4%E3%83%96%E3%83%AC%E3%83%BC%E3%83%89X/?s=13', // 新著順（捉新品）
  'https://search.rakuten.co.jp/search/mall/%E3%83%99%E3%82%A4%E3%83%96%E3%83%AC%E3%83%BC%E3%83%89X/',      // 標準排序（相關度，多數係陀螺本體）
];

// 樂天搜尋結果好雜（漫畫/電子書/附錄/周邊/其他 TCG 都出）——用白名單制。
// 教訓：「ブースター」呢類字太通用（Build Divide TCG 啲卡都叫ブースターパック，
// 試過成批card入晒庫），單獨出現唔可信——配件字眼一定要連埋「ベイブレード」
// 一齊出現先收。SKU code（BX/UX/CX-xx）本身夠獨特，可以單獨收。
const SKU_CODE_RE = /\b(BX|UX|CX)G?[-‐－]?\d{1,3}\b/i;
const ACCESSORY_RE = /ランチャー|スタジアム|エントリー(セット|パック)|改造セット|ベイバトルパス|スターター|ブースター/i;
const BEYBLADE_RE = /ベイブレード|beyblade/i;
export const looksLikeBeyblade = t => SKU_CODE_RE.test(t) || (BEYBLADE_RE.test(t) && ACCESSORY_RE.test(t));
// 白名單都中咗但其實係附錄/二手/周邊嘅，再踢走
const EXCLUDE_RE = /付録|コロコロ|雑誌|ポスター|カード(のみ|セット|単品)|シール|【中古】|中古品|電子書籍|ピンズ|フィギュア|ぬいぐるみ|Tシャツ|コミック|ブック/;

export async function run() {
  const b = await getBrowser();
  if (!b) return 0;
  let added = 0;
  let ctx;
  try {
    ctx = await b.newContext({ userAgent: UA, locale: 'ja-JP', viewport: { width: 1440, height: 900 } });
    let totalSeen = 0;
    for (const url of SEARCH_URLS) {
      const { added: a, seen } = await runOne(ctx, url);
      added += a;
      totalSeen += seen;
    }
    reportSourceHealth('jp-rakuten', totalSeen);
  } catch (err) {
    console.warn('[rakuten]', err.message);
  } finally {
    await ctx?.close().catch(() => {});
  }
  return added;
}

async function runOne(ctx, searchUrl) {
  let added = 0;
  let seen = 0;
  let page;
  try {
    page = await ctx.newPage();
    // 唔載圖片/字型/影片，快好多
    await page.route('**/*', route => {
      const t = route.request().resourceType();
      return ['image', 'media', 'font'].includes(t) ? route.abort() : route.continue();
    });
    await page.goto(searchUrl, { waitUntil: 'domcontentloaded', timeout: 45000 });
    await page.waitForSelector('.searchresultitem', { timeout: 15000 }).catch(() => {});

    // 每件商品一個 .searchresultitem
    const items = await page.evaluate(() => {
      return [...document.querySelectorAll('.searchresultitem')].map(el => {
        const title = (el.querySelector('.title, h2')?.textContent || '').trim();
        const url = el.querySelector('a[href*="item.rakuten.co.jp"]')?.href || '';
        const priceText = el.querySelector('.important, [class*=price]')?.textContent || '';
        const price = parseInt(priceText.replace(/[^\d]/g, ''), 10) || null;
        return { title, url, price };
      }).filter(it => it.title && it.url);
    });
    seen = items.length;

    const filtered = items.filter(it => looksLikeBeyblade(it.title) && !EXCLUDE_RE.test(it.title));
    for (const it of filtered.slice(0, 20)) {
      const ok = await ingestItem({
        adapterId: 'jp-rakuten',
        region: 'jp',
        source: '樂天市場',
        trust: 'official',
        title: it.title,
        url: it.url,
        price: it.price,
        currency: 'JPY',
        kindHint: /予約/.test(it.title) ? 'preorder' : 'stock',
      });
      if (ok) added++;
    }
    if (items.length === 0) console.warn('[rakuten] 頁面結構可能改咗，抓到 0 件');
  } catch (err) {
    console.warn('[rakuten] 抓取失敗：', err.message);
  } finally {
    await page?.close().catch(() => {});
  }
  return { added, seen };
}
