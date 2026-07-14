async function get(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`API ${res.status}`);
  return res.json();
}

export const fetchFeed = ({ region, kind } = {}) => {
  const q = new URLSearchParams();
  if (region) q.set('region', region);
  if (kind) q.set('kind', kind);
  return get(`/api/feed?${q}`);
};

export const fetchSkus = () => get('/api/skus');
export const fetchSku = code => get(`/api/skus/${encodeURIComponent(code)}`);
export const fetchSkuPrices = code => get(`/api/skus/${encodeURIComponent(code)}/prices`);

// 管理員 token（WhatsApp 設定屬敏感操作，出街後任何人都改到就中晒伏）。
// 存喺 localStorage，避免每次開 Settings 頁都要打；伺服器冇設 ADMIN_TOKEN
// 就完全唔會被 401，token 得個桔都照用。
const TOKEN_KEY = 'beyhunter_admin_token';
export const getAdminToken = () => localStorage.getItem(TOKEN_KEY) || '';
export const setAdminToken = t => localStorage.setItem(TOKEN_KEY, t);

// token 行 header（唔行 query string——query 會留喺 proxy log/瀏覽器歷史）
async function adminGet(url) {
  const t = getAdminToken();
  const res = await fetch(url, t ? { headers: { 'X-Admin-Token': t } } : undefined);
  if (res.status === 401) throw Object.assign(new Error('需要管理員密碼'), { needsAuth: true });
  if (!res.ok) throw new Error(`API ${res.status}`);
  return res.json();
}

// WhatsApp 設定 GUI
export const fetchWaStatus = () => adminGet('/api/whatsapp/status');
export const fetchWaTargets = () => adminGet('/api/whatsapp/targets');
export const fetchWaGroups = () => adminGet('/api/whatsapp/groups');
export const fetchSourceHealth = () => adminGet('/api/sources/health');
export const sendWaTest = jid => adminGet(`/api/whatsapp/test${jid ? `?jid=${encodeURIComponent(jid)}` : ''}`);
export async function saveWaTargets(targets) {
  const t = getAdminToken();
  const res = await fetch('/api/whatsapp/targets', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', ...(t ? { 'X-Admin-Token': t } : {}) },
    body: JSON.stringify({ targets }),
  });
  if (res.status === 401) throw Object.assign(new Error('需要管理員密碼'), { needsAuth: true });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `儲存失敗（${res.status}）`);
  return data;
}

export async function submitReport(payload) {
  const res = await fetch('/api/report', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `送出失敗（${res.status}）`);
  return data;
}
