// 設定頁：WhatsApp 通知管理（連線狀態、收件人＋地區分流、測試）＋來源健康
import { useEffect, useState } from 'react';
import {
  fetchWaStatus, fetchWaTargets, fetchWaGroups, fetchSourceHealth,
  sendWaTest, saveWaTargets, getAdminToken, setAdminToken,
} from '../api.js';

const REGIONS = [
  { key: 'hk', label: '🇭🇰 香港' },
  { key: 'tw', label: '🇹🇼 台灣' },
  { key: 'jp', label: '🇯🇵 日本' },
];

function TargetRow({ t, i, groups, onChange, onRemove, onTest, testing }) {
  const groupName = groups.find(g => g.jid === t.jid)?.name;
  const display = t.jid === 'me' ? '我自己（傳訊息給自己）' : groupName ? `${groupName}（群組）` : t.jid;
  const toggleRegion = key => {
    const cur = t.regions;
    let next;
    if (!cur) next = [key]; // 由「全收」轉做只收一個
    else if (cur.includes(key)) next = cur.filter(r => r !== key);
    else next = [...cur, key];
    if (next && next.length === 0) next = null; // 冇揀 = 全收
    if (next && next.length === REGIONS.length) next = null;
    onChange(i, { ...t, regions: next });
  };
  return (
    <div className="rounded-lg border border-white/10 bg-white/5 p-3">
      <div className="flex items-center gap-2">
        <span className="flex-1 truncate text-sm">{display}</span>
        <button onClick={() => onTest(t.jid)} disabled={testing}
          className="rounded bg-white/10 px-2 py-1 text-xs hover:bg-white/20 disabled:opacity-50">
          {testing ? '發送中…' : '測試'}
        </button>
        <button onClick={() => onRemove(i)} className="rounded bg-red-500/20 px-2 py-1 text-xs text-red-300 hover:bg-red-500/30">移除</button>
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-1.5 text-xs">
        <span className="text-white/50">收邊區：</span>
        <button onClick={() => onChange(i, { ...t, regions: null })}
          className={`rounded-full px-2.5 py-1 ${!t.regions ? 'bg-bey-yellow text-navy-900 font-medium' : 'bg-white/10 text-white/70'}`}>
          全部
        </button>
        {REGIONS.map(r => (
          <button key={r.key} onClick={() => toggleRegion(r.key)}
            className={`rounded-full px-2.5 py-1 ${t.regions?.includes(r.key) ? 'bg-bey-yellow text-navy-900 font-medium' : 'bg-white/10 text-white/70'}`}>
            {r.label}
          </button>
        ))}
      </div>
    </div>
  );
}

export default function SettingsPage() {
  const [status, setStatus] = useState(null);
  const [targets, setTargets] = useState(null);
  const [groups, setGroups] = useState([]);
  const [health, setHealth] = useState([]);
  const [dirty, setDirty] = useState(false);
  const [msg, setMsg] = useState(null); // { ok, text }
  const [testingJid, setTestingJid] = useState(null);
  const [pickGroup, setPickGroup] = useState('');
  const [needsAuth, setNeedsAuth] = useState(false);
  const [tokenInput, setTokenInput] = useState('');

  const guard = err => { if (err.needsAuth) setNeedsAuth(true); };

  const refresh = () => {
    fetchWaStatus().then(d => { setStatus(d); setNeedsAuth(false); }).catch(guard);
    fetchSourceHealth().then(d => setHealth(d.sources)).catch(guard);
  };

  useEffect(() => {
    refresh();
    fetchWaTargets().then(d => setTargets(d.targets)).catch(guard);
    fetchWaGroups().then(d => setGroups(d.groups)).catch(() => {}); // 未連線就冇，冇所謂
    const id = setInterval(refresh, 15000);
    return () => clearInterval(id);
  }, []);

  if (needsAuth) {
    return (
      <div className="space-y-4">
        <h1 className="font-display text-xl text-bey-yellow">設定</h1>
        <section className="rounded-xl border border-white/10 bg-white/5 p-4">
          <p className="mb-3 text-sm text-white/70">呢頁涉及 WhatsApp 通知同收件人，需要管理員密碼先睇到。</p>
          <div className="flex gap-2">
            <input type="password" value={tokenInput} onChange={e => setTokenInput(e.target.value)}
              placeholder="管理員密碼" className="flex-1 rounded bg-white/10 px-3 py-2 text-sm"
              onKeyDown={e => e.key === 'Enter' && (setAdminToken(tokenInput), window.location.reload())} />
            <button onClick={() => { setAdminToken(tokenInput); window.location.reload(); }}
              className="rounded bg-bey-yellow px-4 py-2 text-sm font-medium text-navy-900">確認</button>
          </div>
        </section>
      </div>
    );
  }

  const flash = (ok, text) => { setMsg({ ok, text }); setTimeout(() => setMsg(null), 4000); };

  const changeTarget = (i, t) => { setTargets(ts => ts.map((x, j) => (j === i ? t : x))); setDirty(true); };
  const removeTarget = i => { setTargets(ts => ts.filter((_, j) => j !== i)); setDirty(true); };
  const addTarget = jid => {
    if (!jid || targets.some(t => t.jid === jid)) return;
    setTargets(ts => [...ts, { jid, regions: null }]);
    setDirty(true);
  };

  const save = async () => {
    try {
      const d = await saveWaTargets(targets);
      setTargets(d.targets);
      setDirty(false);
      flash(true, '已儲存 ✅');
    } catch (err) {
      guard(err);
      flash(false, err.message);
    }
  };

  const test = async jid => {
    setTestingJid(jid);
    try { await sendWaTest(jid); flash(true, '測試訊息已發送 ✅'); }
    catch (err) { guard(err); flash(false, `發送失敗：${err.message}`); }
    finally { setTestingJid(null); }
  };

  const staleSources = health.filter(h => h.zero_streak >= 4 || h.alerted);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="font-display text-xl text-bey-yellow">設定</h1>
        {getAdminToken() && (
          <button onClick={() => { setAdminToken(''); window.location.href = '/'; }}
            className="rounded bg-white/10 px-3 py-1.5 text-xs text-white/60 hover:bg-white/20">
            登出管理
          </button>
        )}
      </div>

      {/* 連線狀態 */}
      <section className="rounded-xl border border-white/10 bg-white/5 p-4">
        <h2 className="mb-2 text-sm font-semibold text-white/80">WhatsApp 連線</h2>
        {!status ? <p className="text-sm text-white/50">載入中…</p> : status.ready ? (
          <p className="text-sm text-green-400">🟢 已連結{status.self ? `（${status.self.replace('@c.us', '')}）` : ''}</p>
        ) : (
          <div className="text-sm">
            <p className="text-red-400">🔴 未連結{status.lastDisconnect ? `——${new Date(status.lastDisconnect.at).toLocaleString()} 斷咗（${status.lastDisconnect.reason}），重連緊` : ''}</p>
            {status.hasQr && (
              <a href={`/api/whatsapp/qr?token=${encodeURIComponent(getAdminToken())}`} target="_blank" rel="noreferrer"
                className="mt-2 inline-block rounded bg-bey-yellow px-3 py-1.5 font-medium text-navy-900">
                開 QR 登入頁
              </a>
            )}
          </div>
        )}
      </section>

      {/* 收件人管理 */}
      <section className="rounded-xl border border-white/10 bg-white/5 p-4">
        <h2 className="mb-1 text-sm font-semibold text-white/80">通知收件人</h2>
        <p className="mb-3 text-xs text-white/50">每個收件人可以自己揀收邊區嘅貨——例如 group 只收香港、自己收全部。</p>
        {targets === null ? <p className="text-sm text-white/50">載入中…</p> : (
          <div className="space-y-2">
            {targets.map((t, i) => (
              <TargetRow key={t.jid + i} t={t} i={i} groups={groups}
                onChange={changeTarget} onRemove={removeTarget}
                onTest={test} testing={testingJid === t.jid} />
            ))}
            {targets.length === 0 && <p className="text-sm text-white/40">未有收件人。</p>}

            <div className="flex flex-wrap gap-2 pt-2">
              {!targets.some(t => t.jid === 'me') && (
                <button onClick={() => addTarget('me')}
                  className="rounded bg-white/10 px-3 py-1.5 text-xs hover:bg-white/20">＋ 我自己</button>
              )}
              {groups.length > 0 && (
                <span className="flex gap-1">
                  <select value={pickGroup} onChange={e => setPickGroup(e.target.value)}
                    className="rounded bg-white/10 px-2 py-1.5 text-xs">
                    <option value="">＋ 加群組…</option>
                    {groups.filter(g => !targets.some(t => t.jid === g.jid)).map(g => (
                      <option key={g.jid} value={g.jid}>{g.name}</option>
                    ))}
                  </select>
                  {pickGroup && (
                    <button onClick={() => { addTarget(pickGroup); setPickGroup(''); }}
                      className="rounded bg-white/10 px-2 py-1.5 text-xs hover:bg-white/20">加</button>
                  )}
                </span>
              )}
            </div>

            {dirty && (
              <button onClick={save}
                className="mt-2 w-full rounded-lg bg-bey-yellow py-2 font-medium text-navy-900 hover:brightness-110">
                儲存設定
              </button>
            )}
          </div>
        )}
        {msg && <p className={`mt-2 text-sm ${msg.ok ? 'text-green-400' : 'text-red-400'}`}>{msg.text}</p>}
      </section>

      {/* 來源健康 */}
      <section className="rounded-xl border border-white/10 bg-white/5 p-4">
        <h2 className="mb-2 text-sm font-semibold text-white/80">情報來源健康</h2>
        {health.length === 0 ? <p className="text-sm text-white/50">未有紀錄。</p> : (
          <ul className="space-y-1 text-sm">
            {health.map(h => {
              const bad = h.zero_streak >= 4 || h.alerted;
              return (
                <li key={h.adapter} className="flex items-center justify-between">
                  <span className={bad ? 'text-red-400' : 'text-white/70'}>
                    {bad ? '🔴' : '🟢'} {h.adapter}
                  </span>
                  <span className="text-xs text-white/40">
                    {bad ? `連續 ${h.zero_streak} 次 0 件` : h.last_ok ? `最後成功 ${new Date(h.last_ok).toLocaleString()}` : '未跑過'}
                  </span>
                </li>
              );
            })}
          </ul>
        )}
        {staleSources.length > 0 && (
          <p className="mt-2 text-xs text-red-300">⚠️ 有來源可能改咗版或者被封，得閒 check 下。</p>
        )}
      </section>
    </div>
  );
}
