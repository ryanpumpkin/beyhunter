// Headless browser adapter（Playwright）——俾 Cloudflare JS challenge 擋住嘅舖用
// （hobbydigi 等）。selectors 喺 shops.json 較，預設係 Magento 2 標準版面。
//
// 重要：Toys Zone 個列表頁有 server-side cache，庫存標記會滯後（試過話有貨
// 但詳情頁已經 OUT OF STOCK）。所以列表頁只用嚟「發現」商品；
// 每件疑似有貨嘅，都去詳情頁核實真庫存＋攞準確價錢。
import { ingestItem, markUnavailable, normalizeKey, UA } from './util.js';
import { confirmVerdict, reportSourceHealth, markAlerted, findByDedupe, updateEventKind, logWaitingRoom } from '../db.js';
import { alertSystem, notifyNewEvent } from '../notify.js';
import { toHKD } from '../fx.js';

let chromiumMod = null;
let browser = null;

// 共用畀其他要過 bot 防護嘅 adapter（jp-rakuten 等）
export async function getBrowser() {
  if (!chromiumMod) {
    try {
      ({ chromium: chromiumMod } = await import('playwright'));
    } catch {
      console.warn('[browser] playwright 未安裝——跳過 browser 類舖（npm install playwright && npx playwright install chromium）');
      return null;
    }
  }
  if (!browser) {
    browser = await chromiumMod.launch({
      headless: true,
      channel: 'chromium', // 完整 Chromium new headless mode，過 Cloudflare 較穩
      args: ['--disable-blink-features=AutomationControlled'],
    });
    browser.on('disconnected', () => { browser = null; });
  }
  return browser;
}

const DEFAULT_SELECTORS = { // Magento 2 Luma
  item: 'li.product-item',
  title: 'a.product-item-link',
  soldout: '.stock.unavailable',
};

const OOS_RE = /out of stock|售完|售罄|缺貨|sold out/i;
const BEY_RE = /beyblade|爆旋|戰鬥陀螺|陀螺|\b(BX|UX|CX)G?-?\d|ベイブレード/i;

async function newPage(ctx) {
  const page = await ctx.newPage();
  // 唔載圖片/字型/影片，詳情頁核實快好多
  await page.route('**/*', route => {
    const t = route.request().resourceType();
    return ['image', 'media', 'font'].includes(t) ? route.abort() : route.continue();
  });
  return page;
}

async function gotoReady(page, url) {
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45000 });
  await page.waitForFunction(() => !/just a moment/i.test(document.title), { timeout: 25000 })
    .catch(() => { throw new Error('Cloudflare challenge 過唔到'); });
}

// 詳情頁核實：回傳 { soldout, price }；load 失敗回傳 null（唔好亂改狀態）
async function verifyDetail(ctx, url) {
  let page;
  try {
    page = await newPage(ctx);
    // 注意：唔好加 cache-bust 參數（會觸發 WAF 403）。詳情頁本身係 DYNAMIC 冇 cache。
    await gotoReady(page, url);
    await page.waitForSelector('.product-info-main', { timeout: 10000 }).catch(() => {});
    // 關鍵一：初始 HTML 有個「Add to Cart」掣，Magento JS 遲啲先按庫存狀態收埋佢。
    // 太早讀會誤判做有貨——所以等埋「Inventory Status」render 完先讀。
    // 關鍵二：一定要收窄喺 .product-info-main 入面讀——頁面其他位（相關商品卡）
    // 會有「IN STOCK」字樣，用寬鬆 selector 會讀錯人哋嘅庫存（教訓：UX-20 假有貨）
    await page.waitForFunction(
      () => /inventory status|in stock|out of stock|coming soon/i.test(document.querySelector('.product-info-main')?.innerText || ''),
      { timeout: 12000 }
    ).catch(() => {});
    await page.waitForTimeout(2000);
    return await page.evaluate(() => {
      const info = document.querySelector('.product-info-main') || document.body;
      const text = info.innerText || '';
      // 「即將上架」——未買得，但係預告信號，值得推 heads-up（同單純冇貨分開）
      const comingSoon = /coming soon|即將(上架|發售|推出|開賣)/i.test(text);
      // 買唔到嘅狀態（文字最穩定，三次 load 都一致）：
      // 「Pre-Order Cutoff」預訂已截、Coming soon、Out of stock。
      const unavailable = comingSoon || /pre-?order\s*cutoff|預訂已?截|截單|out of stock|sold out|售完|售罄|缺貨/i.test(text);
      // 開放預訂（買得，但要等到貨）
      const preorderOpen = /pre-?order\s*(available|while|:|\d)|開放預訂|接受預訂|預訂中|預售中/i.test(text);
      // 淨用最準嗰個掣 ID（唔好用 .box-tocart 闊 selector，嗰度有隱藏 template 掣）
      const cartBtn = document.querySelector('#product-addtocart-button');
      const btnBuyable = !!cartBtn && !cartBtn.disabled && cartBtn.offsetParent !== null;

      let soldout, preorder = false;
      if (unavailable) soldout = true;
      else if (preorderOpen) { soldout = false; preorder = true; }
      else soldout = !btnBuyable;

      const priceAttr = info.querySelector('[data-price-amount]')?.getAttribute('data-price-amount');
      const price = priceAttr ? parseFloat(priceAttr)
        : parseFloat((info.querySelector('.price')?.textContent || '').replace(/[^\d.]/g, '')) || null;
      return { soldout, price, preorder, comingSoon };
    });
  } catch {
    return null;
  } finally {
    await page?.close().catch(() => {});
  }
}

export async function runShop(shop) {
  const b = await getBrowser();
  if (!b) return 0;
  let added = 0;
  let itemsSeen = 0;
  const sel = { ...DEFAULT_SELECTORS, ...(shop.selectors || {}) };

  let ctx;
  try {
    ctx = await b.newContext({ userAgent: UA, locale: 'zh-HK', viewport: { width: 1440, height: 900 } });

    for (const url of shop.listing_urls || []) {
      const page = await newPage(ctx);
      try {
        await gotoReady(page, url);

        // 虛擬等候室偵測：舖頭喺搶手 drop 時會開排隊系統，我哋會俾擺入隊 →
        // 抓 0 件。呢個唔係「改版/被封」，反而通常代表而家有 drop。認得就推
        // 一次清晰提示，兼 markAlerted 壓住 health monitor 嗰條誤導警報。
        const waiting = await page.evaluate(() =>
          /waiting-?room|queue/i.test(location.pathname + location.search) ||
          /虛擬等候室|virtual waiting room|等候中|waiting room|排隊|in the queue|請稍候/i.test(
            (document.title || '') + ' ' + (document.body?.innerText || '').slice(0, 400)
          )
        );
        if (waiting) {
          const adapterId = `browser-${shop.id}`;
          // 排隊入去睇：等候室輪到會自動 redirect 返產品頁。喺 loop 容許範圍內
          // 老實排（唔係打尖），排到就照抓；等唔切先 bail + 提示。queue_wait_s 可較。
          const waitMs = Math.max(0, shop.queue_wait_s ?? 75) * 1000;
          console.warn(`[browser:${shop.id}] 喺虛擬等候室，排隊等最多 ${waitMs / 1000}s…`);
          const through = waitMs > 0 && await page.waitForFunction(
            () => !/waiting-?room|queue/i.test(location.pathname + location.search) &&
              !/虛擬等候室|virtual waiting room|等候中|waiting room|排隊|in the queue|請稍候/i.test(
                (document.title || '') + ' ' + (document.body?.innerText || '').slice(0, 400)
              ),
            { timeout: waitMs, polling: 3000 }
          ).then(() => true).catch(() => false);
          // 每次偵測都入 DB（留底俾事後查「幾點開過」）；回傳 true = 新一潮（>30min
          // gap）先 alert，唔會每 180 秒轟。DB-based，重啟都記得。
          const newEpisode = logWaitingRoom(adapterId, through);
          if (!through) {
            console.warn(`[browser:${shop.id}] 排 ${waitMs / 1000}s 都未到，暫時放棄（通常代表有搶手 drop）`);
            if (newEpisode) {
              alertSystem(`⏳ ${shop.name} 開咗虛擬等候室（排隊系統）——通常代表而家有搶手貨 drop！我哋排咗 ${waitMs / 1000}s 都未到，你可以自己開網店睇：${url}`);
            }
            markAlerted.run(adapterId); // 壓住「改版/被封」誤報；復原後 reportSourceHealth 會 reset
            continue;
          }
          console.warn(`[browser:${shop.id}] 排到喇，開始抓`);
          // 排到 = 有搶手活動，都通知一次（新一潮先），但講明我哋入到去、有貨會再彈
          if (newEpisode) {
            alertSystem(`⏳ ${shop.name} 開咗虛擬等候室（有搶手活動）——我哋已排到入去抓，有現貨/即將上架會再通知你。想自己睇：${url}`);
          }
          await page.waitForTimeout(1500); // 俾 redirect 後個產品頁 render
        }

        await page.waitForSelector(sel.item, { timeout: 15000 })
          .catch(() => { throw new Error(`搵唔到產品卡（selector: ${sel.item}）`); });
        await page.waitForTimeout(1500);

        const items = await page.evaluate(({ sel }) => {
          return [...document.querySelectorAll(sel.item)].map(card => {
            const a = card.querySelector(sel.title);
            return {
              title: a?.textContent.replace(/\s+/g, ' ').trim() || '',
              href: a?.href || '',
              soldout: !!card.querySelector(sel.soldout) || /out of stock|售完|售罄|缺貨|sold out/i.test(card.innerText || ''),
              preorder: /pre-?order/i.test(card.innerText || ''),
            };
          }).filter(it => it.title && it.href);
        }, { sel });

        itemsSeen += items.length;
        const adapterId = `browser-${shop.id}`;
        const CONFIRM = shop.confirm_polls ?? 2; // 呢類站讀數會彈，連續 N 次一致先算數
        for (const it of items) {
          if (!BEY_RE.test(it.title)) continue;

          // 列表話冇貨 → 都要 debounce（listing 會喺新舊 cache 版本之間彈）
          if (it.soldout) {
            if (confirmVerdict(adapterId, it.href, 'oos', CONFIRM)) markUnavailable(adapterId, it.href);
            continue;
          }

          // 列表話有貨 → 唔信住，去詳情頁核實
          const detail = await verifyDetail(ctx, it.href);
          if (!detail) continue; // 核實唔到，唔好亂郁
          // 即將上架（coming soon）：未買得，但係預告信號 → 入 coming_soon event
          // 兼推一次 heads-up 通知（debounce 防讀數彈跳）。唔標 sold_out，所以喺
          // feed 度以「🔜 即將上架」正常顯示。isNewItem 令 heads-up 只彈一次。
          if (detail.comingSoon) {
            if (confirmVerdict(adapterId, it.href, 'soon', CONFIRM)) {
              const ok = await ingestItem({
                adapterId, region: shop.region, source: shop.name, trust: shop.trust,
                title: it.title, url: it.href, price: detail.price,
                currency: shop.currency || 'HKD', kindHint: 'coming_soon',
              });
              if (ok) added++;
            }
            continue;
          }
          if (detail.soldout) {
            if (confirmVerdict(adapterId, it.href, 'oos', CONFIRM)) markUnavailable(adapterId, it.href);
            continue;
          }
          // 詳情頁話買得 → 一樣要連續兩次先入庫/當補貨
          if (!confirmVerdict(adapterId, it.href, 'ok', CONFIRM)) continue;

          // coming_soon → 開賣：如果呢件之前係「即將上架」而家買得到，就係開賣咗，
          // 升級 kind + 推一次「✅ 開賣喇」通知（用 adapter 自己判，唔行有 confirmVerdict
          // 撞 key 問題嘅 restock 路）。之後 kind 唔再係 coming_soon，唔會重複彈。
          const dedupeKey = `${adapterId}:${normalizeKey(it.href)}`;
          const existing = findByDedupe.get(dedupeKey);
          if (existing && existing.kind === 'coming_soon') {
            const newKind = (detail.preorder || it.preorder) ? 'preorder' : 'stock';
            updateEventKind.run(newKind, new Date().toISOString(), dedupeKey);
            notifyNewEvent({
              region: shop.region, kind: newKind, source: shop.name,
              title: `✅ 開賣喇！${it.title}`,
              price: detail.price ?? null, currency: shop.currency || 'HKD',
              price_hkd: await toHKD(detail.price, shop.currency || 'HKD'),
              url: it.href, flags: existing.flags || '',
            });
            added++;
            continue;
          }

          const ok = await ingestItem({
            adapterId: `browser-${shop.id}`,
            region: shop.region,
            source: shop.name,
            trust: shop.trust,
            title: it.title,
            url: it.href,
            price: detail.price,
            currency: shop.currency || 'HKD',
            // 詳情頁講嘅 preorder 為準（列表卡通常唔會標）
            kindHint: (detail.preorder || it.preorder) ? 'preorder' : undefined,
          });
          if (ok) added++;
        }
      } catch (err) {
        console.warn(`[browser:${shop.id}] ${err.message}`);
      } finally {
        await page.close().catch(() => {});
      }
    }
  } catch (err) {
    console.warn(`[browser:${shop.id}] ${err.message}`);
  } finally {
    await ctx?.close().catch(() => {});
  }
  // 等候室新一潮嘅去重而家喺 DB（logWaitingRoom 30min gap），唔使 in-memory flag。
  // reportSourceHealth 見 itemsSeen>0 會自動 reset zero_streak + alerted（復原）。
  reportSourceHealth(`browser-${shop.id}`, itemsSeen);
  return added;
}
