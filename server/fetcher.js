// 排程器：跑晒所有 adapters → 寫 DB。`node server/fetcher.js --once` 手動跑一次。
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as pchome from './adapters/tw-pchome.js';
import * as rakuten from './adapters/jp-rakuten.js';
import * as carousell from './adapters/secondhand-carousell.js';
import * as hardoff from './adapters/jp-hardoff.js';
import * as yahooAuction from './adapters/jp-yahoo-auction.js';
import * as mercari from './adapters/jp-mercari.js';
import * as ruten from './adapters/tw-ruten.js';
import * as woo from './adapters/platform-woocommerce.js';
import * as shopify from './adapters/platform-shopify.js';
import * as shopline from './adapters/platform-shopline.js';
import * as browserShop from './adapters/platform-browser.js';
import * as hobbyland from './adapters/platform-hobbyland.js';
import * as boutir from './adapters/platform-boutir.js';
import * as opencart from './adapters/platform-opencart.js';
import * as toysrus from './adapters/hk-toysrus.js';
import { runFeed } from './adapters/generic-feed.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const readJson = f => JSON.parse(fs.readFileSync(path.join(__dirname, f), 'utf8'));

const PLATFORM_RUNNERS = { woocommerce: woo.runShop, shopify: shopify.runShop, shopline: shopline.runShop, toysrus: toysrus.runShop, browser: browserShop.runShop, hobbyland: hobbyland.runShop, boutir: boutir.runShop, opencart: opencart.runShop };

// 香港舖：搶手貨（限一產品）上架到賣晒可能得半個鐘，要巡密啲
export async function runShops() {
  let total = 0;
  for (const shop of readJson('shops.json').shops) {
    if (!shop.enabled) continue;
    const runner = PLATFORM_RUNNERS[shop.platform];
    if (runner) total += await runner(shop);
    else console.warn(`[fetcher] 未支援平台 ${shop.platform}（${shop.name}）`);
  }
  return total;
}

// 電商搜尋＋社群 feed：變化冇咁快，15 分鐘夠
export async function runGlobal() {
  let total = 0;
  total += await pchome.run();
  total += await rakuten.run();
  for (const feed of readJson('feeds.json').feeds) {
    total += await runFeed(feed);
  }
  return total;
}

// 二手市場（Carousell 港台、HardOff/Yahoo拍賣/Mercari 日本）：
// 唔使快、Playwright 來源多會拖慢零售 loop，所以獨立 30 分鐘一巡。
// 二手只入 feed＋價格 chart，唔推通知（ingestItem 只通知 preorder|stock）。
export async function runSecondhand() {
  let total = 0;
  for (const src of [carousell, ruten, hardoff, yahooAuction, mercari]) {
    total += await src.run().catch(err => { console.error('[fetcher:secondhand]', err); return 0; });
  }
  console.log(`[fetcher] 二手巡完：新增 ${total} 條`);
  return total;
}

export async function runAll() {
  const t0 = Date.now();
  const total = (await runGlobal()) + (await runShops());
  console.log(`[fetcher] 完成：新增 ${total} 條情報（${((Date.now() - t0) / 1000).toFixed(1)}s）`);
  return total;
}

const GLOBAL_INTERVAL_MS = 15 * 60 * 1000; // 電商搜尋/社群 feed 15 分鐘一巡
export function startScheduler() {
  runAll().catch(err => console.error('[fetcher]', err));
  // 每間舖獨立計時器——頻率喺 shops.json 嘅 interval_s 較（唔設就 240 秒）
  for (const shop of readJson('shops.json').shops) {
    if (!shop.enabled) continue;
    const runner = PLATFORM_RUNNERS[shop.platform];
    if (!runner) continue;
    const ms = Math.max(30, shop.interval_s ?? 240) * 1000; // 最快 30 秒，防手誤填 1
    console.log(`[fetcher] ${shop.name} 每 ${ms / 1000} 秒巡一次`);
    setInterval(() => runner(shop).catch(err => console.error(`[fetcher:${shop.id}]`, err)), ms);
  }
  setInterval(() => runGlobal().catch(err => console.error('[fetcher]', err)), GLOBAL_INTERVAL_MS);
  // 二手：起動 2 分鐘後先開頭一巡（俾零售 loop 行先），之後 30 分鐘一次
  const SECONDHAND_INTERVAL_MS = 30 * 60 * 1000;
  setTimeout(() => {
    runSecondhand().catch(err => console.error('[fetcher:secondhand]', err));
    setInterval(() => runSecondhand().catch(err => console.error('[fetcher:secondhand]', err)), SECONDHAND_INTERVAL_MS);
  }, 2 * 60 * 1000);
}

if (process.argv.includes('--once')) {
  runAll().then(() => process.exit(0));
}
