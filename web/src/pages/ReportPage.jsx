import { useState } from 'react';
import { submitReport } from '../api.js';

export default function ReportPage({ nav }) {
  const [form, setForm] = useState({ region: 'hk', shop: '', district: '', sku_code: '', price: '', note: '' });
  const [status, setStatus] = useState(null); // {ok} | {error}
  const [busy, setBusy] = useState(false);
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));

  async function onSubmit(e) {
    e.preventDefault();
    setBusy(true); setStatus(null);
    try {
      await submitReport({
        region: form.region,
        shop: form.shop,
        district: form.district || null,
        sku_code: form.sku_code || null,
        price: form.price ? Number(form.price) : null,
        note: form.note || null,
      });
      setStatus({ ok: true });
      setForm({ region: form.region, shop: '', district: '', sku_code: '', price: '', note: '' });
    } catch (err) {
      setStatus({ error: err.message });
    } finally {
      setBusy(false);
    }
  }

  const input = 'w-full rounded-lg border border-white/15 bg-navy-800 px-3 py-2 outline-none placeholder:text-white/30 focus:border-bey-yellow';

  return (
    <div className="max-w-lg">
      <h2 className="text-xl font-bold">玩家現貨回報</h2>
      <p className="mt-1 text-sm text-white/50">見到現貨/預訂就報料，幫其他玩家一把。回報會以「社群」標籤顯示。</p>

      <form onSubmit={onSubmit} className="mt-5 space-y-4">
        <div>
          <label className="text-sm text-white/70">地區 *</label>
          <div className="mt-1 flex gap-2">
            {[['hk', '🇭🇰 香港'], ['tw', '🇹🇼 台灣'], ['jp', '🇯🇵 日本']].map(([v, l]) => (
              <button type="button" key={v} onClick={() => set('region', v)}
                className={`rounded-full px-3 py-1 text-sm ${form.region === v ? 'bg-bey-yellow font-bold text-navy-900' : 'bg-white/10 text-white/70'}`}>
                {l}
              </button>
            ))}
          </div>
        </div>
        <div>
          <label className="text-sm text-white/70">舖名 *</label>
          <input required maxLength={100} className={input} value={form.shop} onChange={e => set('shop', e.target.value)} placeholder="例：福利模型（深水埗）" />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="text-sm text-white/70">地區/門市</label>
            <input maxLength={50} className={input} value={form.district} onChange={e => set('district', e.target.value)} placeholder="例：旺角 CTMA" />
          </div>
          <div>
            <label className="text-sm text-white/70">SKU</label>
            <input pattern="(BX|UX|CX|bx|ux|cx)-\d{1,3}" className={input} value={form.sku_code} onChange={e => set('sku_code', e.target.value)} placeholder="例：UX-15" />
          </div>
        </div>
        <div>
          <label className="text-sm text-white/70">價錢（當地貨幣）</label>
          <input type="number" min="0" max="100000" step="0.1" className={input} value={form.price} onChange={e => set('price', e.target.value)} placeholder="例：148" />
        </div>
        <div>
          <label className="text-sm text-white/70">詳情</label>
          <textarea maxLength={500} rows={3} className={input} value={form.note} onChange={e => set('note', e.target.value)} placeholder="例：仲有 5 盒左右，每人限購一盒" />
        </div>
        <button disabled={busy} className="w-full rounded-lg bg-bey-yellow py-2.5 font-bold text-navy-900 hover:brightness-110 disabled:opacity-50">
          {busy ? '送出緊…' : '送出回報'}
        </button>
        {status?.ok && (
          <p className="text-sm text-emerald-400">
            ✓ 已收到，多謝報料！<button type="button" className="underline" onClick={() => nav({ name: 'feed' })}>去情報頁睇</button>
          </p>
        )}
        {status?.error && <p className="text-sm text-red-400">✗ {status.error}</p>}
      </form>
    </div>
  );
}
