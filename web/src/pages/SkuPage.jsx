import { useEffect, useState } from 'react';
import { fetchSku, fetchSkuPrices } from '../api.js';
import FeedCard from '../components/FeedCard.jsx';
import PriceChart from '../components/PriceChart.jsx';

const REGION_NAME = { hk: '🇭🇰 香港', tw: '🇹🇼 台灣', jp: '🇯🇵 日本' };

// 每區攞最新一個有價 event 嚟比價
function latestPrices(events) {
  const by = {};
  for (const ev of events) {
    if (ev.price != null && ev.price_hkd != null && !by[ev.region]) by[ev.region] = ev;
  }
  return Object.entries(by);
}

export default function SkuPage({ code, nav }) {
  const [data, setData] = useState(null);
  const [pricePoints, setPricePoints] = useState([]);
  const [error, setError] = useState(null);

  useEffect(() => {
    setData(null);
    setPricePoints([]);
    fetchSku(code).then(setData).catch(e => setError(e.message));
    fetchSkuPrices(code).then(d => setPricePoints(d.points)).catch(() => {}); // chart 冇都唔阻礙頁面
  }, [code]);

  if (error) return <p className="text-red-400">載入失敗：{error}</p>;
  if (!data) return <p className="text-white/50">載入緊…</p>;

  const { sku, events } = data;
  const prices = latestPrices(events);
  const cheapest = prices.length ? Math.min(...prices.map(([, ev]) => ev.price_hkd)) : null;

  return (
    <div>
      <button onClick={() => nav({ name: 'catalog' })} className="text-sm text-white/50 hover:text-white">← 返回目錄</button>
      <div className="mt-3 flex items-baseline gap-3">
        <h2 className="font-mono text-3xl font-bold text-bey-yellow">{sku.code}</h2>
        <div>
          <div className="text-lg font-medium">{sku.name_zh || '（目錄未收錄，以下係相關情報）'}</div>
          {sku.name_ja && <div className="text-sm text-white/50">{sku.name_ja}</div>}
        </div>
      </div>
      {sku.msrp_jpy && <p className="mt-1 text-sm text-white/50">日本定價 ¥{sku.msrp_jpy.toLocaleString()}</p>}

      {prices.length > 0 && (
        <div className="mt-5 rounded-xl border border-white/10 bg-navy-800 p-4">
          <h3 className="text-sm font-bold text-white/70">三地最新價格</h3>
          <div className="mt-2 grid gap-2 sm:grid-cols-3">
            {prices.map(([region, ev]) => (
              <div key={region} className={`rounded-lg p-3 ${ev.price_hkd === cheapest ? 'bg-bey-yellow/15 ring-1 ring-bey-yellow' : 'bg-white/5'}`}>
                <div className="text-xs text-white/60">{REGION_NAME[region]} · {ev.source}</div>
                <div className="mt-1 font-bold">
                  {{ HKD: 'HK$', TWD: 'NT$', JPY: '¥' }[ev.currency]}{ev.price.toLocaleString()}
                </div>
                {ev.currency !== 'HKD' && <div className="text-xs text-white/50">≈ HK${ev.price_hkd}</div>}
                {ev.price_hkd === cheapest && <div className="mt-1 text-xs font-bold text-bey-yellow">最平 ✓</div>}
              </div>
            ))}
          </div>
        </div>
      )}

      <PriceChart points={pricePoints} />

      <h3 className="mt-6 text-sm font-bold text-white/70">相關情報（{events.length}）</h3>
      <div className="mt-2 space-y-3">
        {events.length === 0 && <p className="text-white/50">暫時未有呢隻嘅情報。</p>}
        {events.map(ev => <FeedCard key={ev.id} ev={ev} nav={nav} />)}
      </div>
    </div>
  );
}
