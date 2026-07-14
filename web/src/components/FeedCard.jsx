import { useState } from 'react';

const REGION = { hk: '🇭🇰 香港', tw: '🇹🇼 台灣', jp: '🇯🇵 日本' };
const KIND = {
  stock: { label: '現貨', cls: 'bg-emerald-500/20 text-emerald-300' },
  preorder: { label: '預訂', cls: 'bg-sky-500/20 text-sky-300' },
  official: { label: '公告', cls: 'bg-violet-500/20 text-violet-300' },
  field_report: { label: '目擊', cls: 'bg-white/10 text-white/70' },
  secondhand: { label: '二手', cls: 'bg-slate-500/25 text-slate-300' },
  coming_soon: { label: '🔜 即將上架', cls: 'bg-amber-500/20 text-amber-300' },
};
const TRUST = {
  official: { label: 'OFFICIAL', cls: 'bg-bey-yellow text-navy-900' },
  verified_shop: { label: '已驗證舖', cls: 'bg-emerald-600 text-white' },
  community: { label: '社群', cls: 'bg-white/15 text-white/60' },
};

function timeAgo(iso) {
  const mins = Math.max(1, Math.round((Date.now() - new Date(iso)) / 60000));
  if (mins < 60) return `${mins} 分鐘前`;
  if (mins < 1440) return `${Math.round(mins / 60)} 小時前`;
  return `${Math.round(mins / 1440)} 日前`;
}

function fmtPrice(ev) {
  if (ev.price == null) return null;
  const sym = { HKD: 'HK$', TWD: 'NT$', JPY: '¥', USD: 'US$' }[ev.currency] || '$';
  const hkd = ev.currency !== 'HKD' && ev.price_hkd ? ` ≈ HK$${ev.price_hkd}` : '';
  return `${sym}${ev.price.toLocaleString()}${hkd}`;
}

export default function FeedCard({ ev, nav }) {
  const [open, setOpen] = useState(false);
  // coming_soon 內部標 sold_out（等開賣時行 restock 通知），但唔可以顯示做「賣晒」。
  const dimmed = ev.sold_out && ev.kind !== 'coming_soon';
  // 賣晒嘅貨：個 kind chip 直接顯示「賣晒」，唔好again 話「現貨」
  const kind = ev.kind === 'coming_soon'
    ? KIND.coming_soon
    : ev.sold_out
      ? { label: '賣晒', cls: 'bg-red-500/15 text-red-300/80' }
      : (KIND[ev.kind] || KIND.field_report);
  const trust = TRUST[ev.trust] || TRUST.community;
  const flags = ev.flags || [];
  const price = fmtPrice(ev);

  return (
    <article className={`rounded-xl border p-4 ${flags.length ? 'border-amber-400/40 bg-amber-500/10' : 'border-white/10 bg-navy-800'}`}>
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <span className={`rounded px-1.5 py-0.5 font-bold ${trust.cls}`}>{trust.label}</span>
        <span className="text-white/70">{ev.source}</span>
        <span className="text-white/40">· {REGION[ev.region]}</span>
        <span className={`rounded px-1.5 py-0.5 ${kind.cls}`}>{kind.label}</span>
        <span className="ml-auto text-white/40">{timeAgo(ev.published_at)}</span>
      </div>

      <h3 className={`mt-2 font-medium leading-snug ${dimmed ? 'text-white/40' : ''}`}>{ev.title}</h3>
      {price && (
        <div className={`mt-1 text-sm font-bold ${dimmed ? 'text-white/30 line-through' : 'text-bey-yellow'}`}>{price}</div>
      )}

      {flags.map((f, i) => (
        <div key={i} className="mt-2 rounded-md bg-amber-500/15 px-2 py-1 text-xs text-amber-200">
          {f.flag === 'parts_only' ? '⚠️' : '🔒'} {f.label}
        </div>
      ))}

      <div className="mt-3 flex flex-wrap items-center gap-3 text-xs">
        {ev.sku_code && (
          <button onClick={() => nav({ name: 'sku', code: ev.sku_code })}
            className="rounded bg-white/10 px-2 py-1 font-mono text-bey-yellow hover:bg-white/20">
            {ev.sku_code}
          </button>
        )}
        {ev.original && (
          <button onClick={() => setOpen(!open)} className="text-white/50 hover:text-white">
            {open ? '收合原文 ▲' : '展開原文 ▼'}
          </button>
        )}
        {ev.url && (
          <a href={ev.url} target="_blank" rel="noreferrer"
            className="ml-auto rounded border border-bey-yellow/60 px-2 py-1 text-bey-yellow hover:bg-bey-yellow hover:text-navy-900">
            查看原文 ↗
          </a>
        )}
      </div>

      {open && ev.original && (
        <blockquote className="mt-3 whitespace-pre-wrap rounded-md bg-black/30 p-3 text-sm text-white/70">
          {ev.original}
        </blockquote>
      )}
    </article>
  );
}
