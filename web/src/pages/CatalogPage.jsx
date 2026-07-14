import { useEffect, useMemo, useState } from 'react';
import { fetchSkus } from '../api.js';

const CATEGORIES = [
  { key: null, label: '全部' },
  { key: 'bey', label: '陀螺' },
  { key: 'launcher', label: '發射器/手柄' },
  { key: 'stadium', label: '戰鬥盤' },
  { key: 'set', label: '套裝' },
  { key: 'tool', label: '工具配件' },
];
const CAT_BADGE = {
  bey: { label: '陀螺', cls: 'bg-bey-yellow/20 text-bey-yellow' },
  launcher: { label: '發射器', cls: 'bg-sky-500/20 text-sky-300' },
  stadium: { label: '戰鬥盤', cls: 'bg-violet-500/20 text-violet-300' },
  set: { label: '套裝', cls: 'bg-emerald-500/20 text-emerald-300' },
  tool: { label: '工具', cls: 'bg-white/15 text-white/60' },
};

export default function CatalogPage({ nav }) {
  const [skus, setSkus] = useState([]);
  const [q, setQ] = useState('');
  const [cat, setCat] = useState(null);

  useEffect(() => { fetchSkus().then(d => setSkus(d.skus)).catch(() => {}); }, []);

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return skus.filter(s => {
      if (cat && (s.category || 'bey') !== cat) return false;
      if (!needle) return true;
      return s.code.toLowerCase().includes(needle) ||
        s.name_zh?.toLowerCase().includes(needle) ||
        s.name_ja?.toLowerCase().includes(needle);
    });
  }, [skus, q, cat]);

  return (
    <div>
      <input
        value={q}
        onChange={e => setQ(e.target.value)}
        placeholder="搜尋 SKU（如 UX-15 / 魔導神杖）"
        className="w-full rounded-lg border border-white/15 bg-navy-800 px-4 py-2.5 outline-none placeholder:text-white/30 focus:border-bey-yellow"
      />
      <div className="mt-3 flex flex-wrap gap-2">
        {CATEGORIES.map(c => (
          <button key={c.label} onClick={() => setCat(c.key)}
            className={`rounded-full px-3 py-1 text-sm ${cat === c.key ? 'bg-bey-yellow font-bold text-navy-900' : 'bg-white/10 text-white/70 hover:bg-white/20'}`}>
            {c.label}
          </button>
        ))}
      </div>
      <p className="mt-2 text-xs text-white/40">目錄由各舖實際貨品自動歸納，涵蓋陀螺、發射器、手柄、戰鬥盤、套裝同工具配件。</p>
      <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3">
        {filtered.map(s => {
          const badge = CAT_BADGE[s.category] || CAT_BADGE.bey;
          return (
            <button key={s.code} onClick={() => nav({ name: 'sku', code: s.code })}
              className="rounded-xl border border-white/10 bg-navy-800 p-3 text-left hover:border-bey-yellow/60">
              <div className="flex items-center justify-between gap-1">
                <span className="font-mono text-sm font-bold text-bey-yellow">{s.code}</span>
                <span className={`rounded px-1.5 py-0.5 text-[10px] font-bold ${badge.cls}`}>{badge.label}</span>
              </div>
              <div className="mt-1 text-sm leading-tight">{s.name_zh}</div>
              {s.cheapest_hkd != null && <div className="mt-1 text-xs text-emerald-400">最平 HK${s.cheapest_hkd}</div>}
              {s.msrp_jpy && <div className="mt-1 text-xs text-white/40">日本定價 ¥{s.msrp_jpy.toLocaleString()}</div>}
              <div className="mt-1 text-xs text-white/30">{s.event_count ?? 0} 條情報</div>
            </button>
          );
        })}
      </div>
      {filtered.length === 0 && <p className="mt-6 text-white/50">搵唔到相符嘅 SKU。</p>}
    </div>
  );
}
