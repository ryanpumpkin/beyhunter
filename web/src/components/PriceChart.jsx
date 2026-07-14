// 歷史價格 chart：手寫 SVG scatter（唔用 chart library，慳 bundle）。
// 黃點＝全新（現貨/預訂），灰藍點＝二手；黃線＝全新價 7 日 rolling median。
// 撳一點會開返個 listing。
import { useMemo, useState } from 'react';

const W = 640, H = 240, PAD = { l: 46, r: 12, t: 12, b: 24 };
const NEW_KINDS = new Set(['stock', 'preorder']);

// 全新價 7 日 rolling median（每點以自己時刻回望 7 日）
function rollingMedian(pts) {
  const win = 7 * 86400_000;
  return pts.map(p => {
    const vals = pts.filter(q => q.t >= p.t - win && q.t <= p.t).map(q => q.y).sort((a, b) => a - b);
    const mid = Math.floor(vals.length / 2);
    return { t: p.t, y: vals.length % 2 ? vals[mid] : (vals[mid - 1] + vals[mid]) / 2 };
  });
}

export default function PriceChart({ points }) {
  const [tip, setTip] = useState(null); // { x, y, p }

  const model = useMemo(() => {
    const pts = points
      .filter(p => p.price_hkd != null)
      .map(p => ({ ...p, t: new Date(p.t).getTime(), y: p.price_hkd }))
      .filter(p => !Number.isNaN(p.t));
    if (pts.length < 3) return null;

    const ts = pts.map(p => p.t), ys = pts.map(p => p.y);
    const t0 = Math.min(...ts), t1 = Math.max(...ts) || t0 + 1;
    const y1 = Math.max(...ys);
    const sx = t => PAD.l + ((t - t0) / Math.max(t1 - t0, 1)) * (W - PAD.l - PAD.r);
    const sy = y => H - PAD.b - (y / Math.max(y1, 1)) * (H - PAD.t - PAD.b);

    const newPts = pts.filter(p => NEW_KINDS.has(p.kind)).sort((a, b) => a.t - b.t);
    const median = newPts.length >= 2 ? rollingMedian(newPts) : [];
    const path = median.map((p, i) => `${i ? 'L' : 'M'}${sx(p.t).toFixed(1)},${sy(p.y).toFixed(1)}`).join('');

    // Y 軸刻度：0 / 中 / 頂
    const yTicks = [0, y1 / 2, y1].map(v => ({ v: Math.round(v), y: sy(v) }));
    // X 軸：起訖日期
    const fmtD = t => new Date(t).toLocaleDateString('zh-HK', { month: 'numeric', day: 'numeric' });
    return { pts, sx, sy, path, yTicks, x0: fmtD(t0), x1: fmtD(t1) };
  }, [points]);

  if (!model) return null;
  const { pts, sx, sy, path, yTicks, x0, x1 } = model;

  return (
    <div className="mt-5 rounded-xl border border-white/10 bg-navy-800 p-4">
      <h3 className="text-sm font-bold text-white/70">歷史價格（HK$）</h3>
      <div className="mt-1 flex gap-4 text-xs text-white/50">
        <span><span className="inline-block h-2 w-2 rounded-full bg-bey-yellow align-middle" /> 全新</span>
        <span><span className="inline-block h-2 w-2 rounded-full bg-slate-400 align-middle" /> 二手</span>
        {path && <span><span className="inline-block h-0.5 w-4 bg-bey-yellow/60 align-middle" /> 全新 7 日中位價</span>}
      </div>
      <div className="relative">
        <svg viewBox={`0 0 ${W} ${H}`} className="mt-2 w-full" onMouseLeave={() => setTip(null)}>
          {yTicks.map(t => (
            <g key={t.v}>
              <line x1={PAD.l} x2={W - PAD.r} y1={t.y} y2={t.y} stroke="rgba(255,255,255,0.08)" />
              <text x={PAD.l - 6} y={t.y + 3} textAnchor="end" fontSize="10" fill="rgba(255,255,255,0.4)">{t.v}</text>
            </g>
          ))}
          <text x={PAD.l} y={H - 6} fontSize="10" fill="rgba(255,255,255,0.4)">{x0}</text>
          <text x={W - PAD.r} y={H - 6} textAnchor="end" fontSize="10" fill="rgba(255,255,255,0.4)">{x1}</text>
          {path && <path d={path} fill="none" stroke="#F4C430" strokeOpacity="0.5" strokeWidth="1.5" />}
          {pts.map((p, i) => (
            <circle key={i} cx={sx(p.t)} cy={sy(p.y)} r="4"
              fill={NEW_KINDS.has(p.kind) ? '#F4C430' : '#94a3b8'} fillOpacity={p.sold_out ? 0.3 : 0.85}
              className="cursor-pointer"
              onMouseEnter={() => setTip({ x: sx(p.t), y: sy(p.y), p })}
              onClick={() => p.url && window.open(p.url, '_blank')} />
          ))}
        </svg>
        {tip && (
          <div className="pointer-events-none absolute rounded bg-black/85 px-2 py-1 text-xs"
            style={{ left: `${(tip.x / W) * 100}%`, top: `${(tip.y / H) * 100}%`, transform: 'translate(-50%, -120%)' }}>
            <div className="font-bold text-bey-yellow">HK${Math.round(tip.p.y).toLocaleString()}</div>
            <div className="text-white/70">{tip.p.source} · {NEW_KINDS.has(tip.p.kind) ? '全新' : '二手'}{tip.p.sold_out ? '（賣咗）' : ''}</div>
            <div className="text-white/40">{new Date(tip.p.t).toLocaleDateString('zh-HK')}</div>
          </div>
        )}
      </div>
      <p className="mt-1 text-xs text-white/30">撳一點可以開返個 listing。二手包括 Carousell 港台、HardOff/Yahoo拍賣/Mercari（日本）。</p>
    </div>
  );
}
