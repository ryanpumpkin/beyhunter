import { useEffect, useState } from 'react';
import { fetchFeed } from '../api.js';
import FeedCard from '../components/FeedCard.jsx';

const REGIONS = [
  { key: null, label: '全部' },
  { key: 'hk', label: '🇭🇰 香港' },
  { key: 'tw', label: '🇹🇼 台灣' },
  { key: 'jp', label: '🇯🇵 日本' },
];
const KINDS = [
  { key: null, label: '全部類型' },
  { key: 'coming_soon', label: '🔜 即將上架' },
  { key: 'preorder', label: '預訂' },
  { key: 'stock', label: '現貨' },
  { key: 'official', label: '公告' },
  { key: 'field_report', label: '目擊' },
  { key: 'secondhand', label: '二手' },
];

export default function FeedPage({ nav }) {
  const [region, setRegion] = useState(null);
  const [kind, setKind] = useState(null);
  const [items, setItems] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    let alive = true;
    setItems(null);
    fetchFeed({ region, kind })
      .then(d => alive && setItems(d.items))
      .catch(e => alive && setError(e.message));
    const timer = setInterval(() => {
      fetchFeed({ region, kind }).then(d => alive && setItems(d.items)).catch(() => {});
    }, 60000);
    return () => { alive = false; clearInterval(timer); };
  }, [region, kind]);

  return (
    <div>
      <div className="flex flex-wrap gap-2">
        {REGIONS.map(r => (
          <button key={r.label} onClick={() => setRegion(r.key)}
            className={`rounded-full px-3 py-1 text-sm ${region === r.key ? 'bg-bey-yellow font-bold text-navy-900' : 'bg-white/10 text-white/70 hover:bg-white/20'}`}>
            {r.label}
          </button>
        ))}
        <span className="mx-1 border-l border-white/10" />
        {KINDS.map(k => (
          <button key={k.label} onClick={() => setKind(k.key)}
            className={`rounded-full px-3 py-1 text-sm ${kind === k.key ? 'bg-white/90 font-bold text-navy-900' : 'bg-white/10 text-white/70 hover:bg-white/20'}`}>
            {k.label}
          </button>
        ))}
      </div>

      <div className="mt-4 space-y-3">
        {error && <p className="text-red-400">載入失敗：{error}</p>}
        {items === null && !error && <p className="text-white/50">載入緊情報…</p>}
        {items?.length === 0 && <p className="text-white/50">呢個篩選暫時冇情報。</p>}
        {items?.map(ev => <FeedCard key={ev.id} ev={ev} nav={nav} />)}
      </div>
    </div>
  );
}
