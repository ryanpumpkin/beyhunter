// 種子資料：SKU 目錄（Beyblade X BX/UX/CX 系列，陀螺本體 + 配件/戰鬥盤/套裝）
// ＋香港/日本示範情報
import { upsertSku, insertEvent } from './db.js';

// [code, 中文名, 日文原名, 系列, 日本定價(¥), 類別]
// 類別: bey(陀螺本體) | launcher(發射器/手柄) | stadium(戰鬥盤) | set(套裝) | tool(工具配件)
const SKUS = [
  // ── 陀螺本體 ──
  ['BX-01', '劍龍烈刃 3-60F', 'ドランソード 3-60F', 'BX', 1980, 'bey'],
  ['BX-02', '鯊鯨破斬 3-80B', 'ヘルズサイズ 4-60T', 'BX', 1980, 'bey'],
  ['BX-03', '飛鏢騎士 4-80B', 'ウィザードアロー 4-80B', 'BX', 1980, 'bey'],
  ['BX-04', '騎士護盾 3-80N', 'ナイトシールド 3-80N', 'BX', 1980, 'bey'],
  ['BX-13', '幻魔騎士 4-80B', 'ナイトランス 4-80HN', 'BX', 1100, 'bey'],
  ['BX-14', '劍龍武士 3-60F', 'シャークエッジ 3-60LF', 'BX', 1320, 'bey'],
  ['BX-15', '獅王咆哮 5-60P', 'レオンクロー 5-60P', 'BX', 1320, 'bey'],
  ['BX-19', '幻星飛龍 3-80T', 'ライノホーン 3-80S', 'BX', 1320, 'bey'],
  ['BX-23', '滅世魔龍 4-60GP', 'フェニックスウイング 9-60GF', 'BX', 2200, 'bey'],
  ['BX-26', '獨角刺心 3-60GN', 'ユニコーンスティング 5-60GP', 'BX', 1430, 'bey'],
  ['BX-33', '怒濤鯨擊 5-80GB', 'ヴァイスタイガー 3-60U', 'BX', 1650, 'bey'],
  ['BX-34', '眼鏡蛇噬咬 4-60GF', 'コバルトドラグーン 2-60C', 'BX', 1760, 'bey'],
  ['BX-35', '隨機強化組 Vol.4', 'ランダムブースターVol.4', 'BX', 990, 'bey'],
  ['BX-38', '緋紅迦樓羅 4-70TP', 'クリムゾンガルーダ 4-70TP', 'BX', 1650, 'bey'],
  ['BX-44', '三角龍壓 4-70TP', 'トリケラプレス 4-70TP', 'BX', 1430, 'bey'],
  ['UX-01', '劍龍破壞者 1-60A', 'ドランバスター 1-60A', 'UX', 2420, 'bey'],
  ['UX-02', '地獄重錘 3-70H', 'ヘルズハンマー 3-70H', 'UX', 1760, 'bey'],
  ['UX-03', '魔導神杖 9-70GN', 'ウィザードロッド 5-70DB', 'UX', 1980, 'bey'],
  ['UX-06', '巨神烈焰 5-60GF', 'レオンクレスト 7-60GN', 'UX', 1980, 'bey'],
  ['UX-08', '銀狼疾走 4-70DB', 'シルバーウルフ 3-80FB', 'UX', 2200, 'bey'],
  ['UX-09', '劍聖榮耀 3-70Q', 'サムライセイバー 2-70L', 'UX', 1980, 'bey'],
  ['UX-11', '衝擊劍龍 3-60LF', 'インパクトドレイク 9-60LR', 'UX', 1980, 'bey'],
  ['UX-15', '絞鯊狂鱗 3-80LR', 'シャークスケイル 3-80LR', 'UX', 1980, 'bey'],
  ['UX-19', '子彈獅鷲 4-80GB', 'グリフォンバレット 4-80GB', 'UX', 2420, 'bey'],
  ['CX-01', '龍勇者 S6-60V', 'ドランブレイブ S6-60V', 'CX', 1980, 'bey'],
  ['CX-02', '魔導弓 R4-55LO', 'ウィザードアークR4-55LO', 'CX', 1980, 'bey'],
  ['CX-03', '英仙幽暗 B6-80W', 'ペルセウスダーク B6-80W', 'CX', 1650, 'bey'],
  ['CX-10', '狼獵 F0-60DB', 'ウルフハント F0-60DB', 'CX', 1650, 'bey'],

  // ── 發射器/手柄 ──
  ['BX-11', '發射器手柄', 'ランチャーグリップ', 'BX', 990, 'launcher'],
  ['BX-18', '弦月發射器', 'ストリングランチャー', 'BX', 1210, 'launcher'],
  ['BX-28', '弦月發射器 白色版', 'ストリングランチャー ホワイトVer.', 'BX', 1210, 'launcher'],
  ['BX-29', '定制手柄 白色版', 'カスタムグリップ ホワイトVer.', 'BX', 990, 'launcher'],
  ['BX-30', '定制手柄 紅色版', 'カスタムグリップ レッドVer.', 'BX', 990, 'launcher'],
  ['BX-40', '繩式發射器L', 'ワインダーランチャーL', 'BX', 1650, 'launcher'],
  ['BX-41', '橡膠定制手柄 槍鐵灰版', 'ラバーカスタムグリップ ガンメタVer.', 'BX', 1210, 'launcher'],
  ['BX-42', '橡膠定制手柄 藍色版', 'ラバーカスタムグリップ ブルーVer.', 'BX', 1210, 'launcher'],
  ['BX-51', '弦月發射器', 'ストリングランチャー', 'BX', 1210, 'launcher'],

  // ── 戰鬥盤 ──
  ['BX-10', '極限衝擊戰鬥盤', 'エクストリームスタジアム', 'BX', 4950, 'stadium'],
  ['BX-32', '寬版極限衝擊戰鬥盤', 'ワイドエクストリームスタジアム', 'BX', 6600, 'stadium'],

  // ── 套裝 ──
  ['BX-07', '起步衝刺套裝', 'スタートダッシュセット', 'BX', 3300, 'set'],
  ['BX-08', '3對3對戰套裝', '3on3デッキセット', 'BX', 4950, 'set'],
  ['BX-17', '戰鬥入門套裝', 'バトルエントリーセット', 'BX', 3960, 'set'],
  ['BX-20', '劍龍匕首套裝', 'ドランダガーデッキセット', 'BX', 2750, 'set'],
  ['BX-21', '地獄鎖鏈套裝', 'ヘルズチェインデッキセット', 'BX', 2750, 'set'],
  ['BX-37', '雙重極限衝擊戰鬥盤套裝', 'ダブルエクストリームスタジアムセット', 'BX', 9900, 'set'],
  ['UX-04', '戰鬥入門套裝U', 'バトルエントリーセットU', 'UX', 3960, 'set'],
  ['UX-07', '幻影奇襲套裝', 'フェニックスラダーデッキセット', 'UX', 2750, 'set'],
  ['UX-10', '改造套裝U', 'カスタマイズセットU', 'UX', 3300, 'set'],
  ['CX-04', '戰鬥入門套裝C', 'バトルエントリーセットC', 'CX', 3960, 'set'],
  ['CX-16', '起步衝刺套裝C', 'スタートダッシュセットC', 'CX', 3300, 'set'],

  // ── 工具配件 ──
  ['BX-09', '對戰通行證', 'ベイバトルパス', 'BX', 3300, 'tool'],
  ['BX-12', '3對3收納盒', '3on3デッキケース', 'BX', 990, 'tool'],
  ['BX-25', '齒輪收納盒', 'ギアケース', 'BX', 770, 'tool'],
  ['BX-43', '齒輪收納盒 白色版', 'ギアケース ホワイトVer.', 'BX', 770, 'tool'],
];

for (const [code, name_zh, name_ja, series, msrp_jpy, category] of SKUS) {
  upsertSku.run({ code, name_zh, name_ja, series, msrp_jpy, category });
}

// 香港/日本種子情報（示範 feed 唔會空；真實 adapter 抓到嘢會排喺上面）
const now = Date.now();
const ago = h => new Date(now - h * 3600e3).toISOString();
const SEED_EVENTS = [
  {
    dedupe_key: 'seed:hk-1', region: 'hk', kind: 'field_report', source: '玩家回報',
    title: '旺角 CTMA 中心多間舖有 BX 系列現貨', summary: '旺角 CTMA 中心多間舖有 BX 系列現貨，UX 熱門款仍缺',
    original: '今日行咗一轉 CTMA，BX-26、BX-31 都有現貨，UX-15 同魔導神杖就一隻都冇，店員話落週返貨。',
    url: null, price: null, currency: null, price_hkd: null, sku_code: 'BX-26',
    trust: 'community', flags: null, published_at: ago(5),
  },
  {
    dedupe_key: 'seed:jp-1', region: 'jp', kind: 'official', source: 'Takara Tomy',
    title: 'CX 系列新作官方預告，7 月下旬發售', summary: '官方公布 CX 系列新作，日本 7 月下旬發售，台港代理日期未定',
    original: 'タカラトミー公式：ベイブレードX CXシリーズ新商品、7月下旬発売予定。',
    url: 'https://beyblade.takaratomy.co.jp/', price: null, currency: null, price_hkd: null,
    sku_code: null, trust: 'official', flags: null, published_at: ago(26),
  },
  {
    dedupe_key: 'seed:hk-2', region: 'hk', kind: 'field_report', source: '玩家回報',
    title: '⚠️ 假賣家出沒：LINE 假 7-11 賣貨便連結', summary: '有玩家收到假 7-11 賣貨便連結（my.7-11.com.bsrtd.top），切勿下單',
    original: '朋友喺 LINE 買陀螺，個賣家發咗條 https://my.7-11.com.bsrtd.top/cart 連結，話到店取貨先付款。條 link 唔係真 7-11！大家小心。',
    url: null, price: null, currency: null, price_hkd: null, sku_code: null,
    trust: 'community',
    flags: JSON.stringify([{ flag: 'fake_domain', label: '仿冒網域：my.7-11.com.bsrtd.top' }]),
    published_at: ago(49),
  },
];
for (const ev of SEED_EVENTS) insertEvent.run(ev);

console.log(`[seed] 完成：${SKUS.length} 隻 SKU、${SEED_EVENTS.length} 條種子情報`);

// ── 資料清洗：清走樂天 adapter 舊白名單放錯入嚟嘅非陀螺貨 ──
// （教訓：「ブースター」太通用，Build Divide TCG 啲卡全部叫ブースターパック，
//  試過成批入晒庫仲推咗去 WhatsApp。每次啟動用最新白名單覆核一次。）
import db from './db.js';
import { looksLikeBeyblade } from './adapters/jp-rakuten.js';
const jpRows = db.prepare(`SELECT id, title, dedupe_key FROM events WHERE dedupe_key LIKE 'jp-rakuten:%'`).all();
const bad = jpRows.filter(r => !looksLikeBeyblade(r.title));
if (bad.length) {
  const delEv = db.prepare(`DELETE FROM events WHERE id = ?`);
  const delSnap = db.prepare(`DELETE FROM snapshots WHERE adapter = 'jp-rakuten' AND item_key = ?`);
  for (const r of bad) {
    delEv.run(r.id);
    delSnap.run(r.dedupe_key.replace('jp-rakuten:', ''));
  }
  console.log(`[seed] 清走 ${bad.length} 條錯誤樂天情報（非陀螺貨）`);
}
