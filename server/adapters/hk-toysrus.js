// 反斗城（Salesforce Commerce）：香港＋台灣同一個平台，shops.json 驅動。
// HK 預設監住預購頁（a[title] SSR 版面）；TW 用分類/搜尋頁（.product 卡，
// 標題喺 img[title]，價錢喺 .price .value[content]）。兩種版面都試。
import * as cheerio from 'cheerio';
import { fetchWithUA, ingestItem } from './util.js';
import { reportSourceHealth } from '../db.js';

const HK_PREORDER_URL = 'https://www.toysrus.com.hk/zh-hk/pre-order/';
const BEY_RE = /beyblade|爆旋陀螺|戰鬥陀螺|陀螺/i;

function parsePage($, baseUrl) {
  const found = new Map();
  // 健康指標用「頁面解析到幾多件產品」（唔係幾多件陀螺）——HK 預購頁
  // 可以合法地一件陀螺都冇，但頁面本身冇產品就多數係改咗版
  const candidates = $('.product').length + $('a[title]').length;

  // 版面一：產品卡 grid（TW 分類頁；標題喺 img 嘅 title attr）
  $('.product').each((_, el) => {
    const $card = $(el);
    const title = ($card.find('img[title]').attr('title') || $card.find('a[title]').attr('title') || '').trim();
    const href = $card.find('a[href*=".html"]').first().attr('href');
    if (!title || !BEY_RE.test(title) || found.has(title)) return;
    const price = parseFloat($card.find('.price .value').first().attr('content') ?? '')
      || parseFloat(($card.find('.price').text().match(/[\d,]+(?:\.\d+)?/)?.[0] || '').replace(/,/g, '')) || null;
    const preorder = /預購|預訂|pre-?order/i.test($card.text());
    found.set(title, { title, href, price, preorder });
  });

  // 版面二：a[title] SSR list（HK 預購頁）
  if (found.size === 0) {
    $('a[title]').each((_, el) => {
      const title = $(el).attr('title')?.trim();
      const href = $(el).attr('href');
      if (!title || !BEY_RE.test(title) || found.has(title)) return;
      const priceText = $(el).closest('[class*=product], li, article').find(':contains("$")').last().text();
      const price = parseFloat(priceText.match(/(?:HK|NT)?\$\s?([\d,]+(?:\.\d+)?)/)?.[1]?.replace(/,/g, '') ?? '') || null;
      found.set(title, { title, href, price, preorder: /pre-order|預購|預訂/i.test(baseUrl) });
    });
  }
  return { found, candidates };
}

export async function runShop(shop) {
  let added = 0;
  let itemsSeen = 0;
  const adapterId = shop?.id ? `toysrus-${shop.id.replace(/^toysrus-?/, '') || 'hk'}` : 'hk-toysrus';
  const urls = shop?.listing_urls?.length ? shop.listing_urls : [HK_PREORDER_URL];

  for (const listUrl of urls) {
    try {
      const res = await fetchWithUA(listUrl);
      if (!res.ok) { console.warn(`[toysrus:${shop?.id || 'hk'}]`, res.status); continue; }
      const $ = cheerio.load(await res.text());
      const { found, candidates } = parsePage($, listUrl);
      itemsSeen += candidates;

      for (const it of found.values()) {
        const ok = await ingestItem({
          // 注意：HK 沿用歷史 id 'hk-toysrus'（dedupe key 靠佢，改咗會成批當新貨重推）
          adapterId: shop?.id === 'toysrus-hk' || !shop?.id ? 'hk-toysrus' : adapterId,
          region: shop?.region || 'hk',
          source: shop?.name || '玩具反斗城 香港',
          trust: shop?.trust || 'official',
          title: it.title,
          url: it.href ? new URL(it.href, listUrl).href : listUrl,
          price: it.price,
          currency: shop?.currency || (shop?.region === 'tw' ? 'TWD' : 'HKD'),
          kindHint: it.preorder ? 'preorder' : undefined,
        });
        if (ok) added++;
      }
    } catch (err) {
      console.warn(`[toysrus:${shop?.id || 'hk'}] 抓取失敗：`, err.message);
    }
  }
  reportSourceHealth(shop?.id === 'toysrus-hk' || !shop?.id ? 'hk-toysrus' : adapterId, itemsSeen);
  return added;
}
