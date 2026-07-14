// 匯率：frankfurter.app 免費 API，每 24 小時 cache 一次。
// 攞唔到時用 fallback 近似值，唔阻塞 pipeline。

const FALLBACK = { TWD: 0.265, JPY: 0.053, USD: 7.8, HKD: 1 }; // → HKD 近似
let cache = { rates: { ...FALLBACK }, fetchedAt: 0 };
const TTL = 24 * 60 * 60 * 1000;

export async function getRates() {
  if (Date.now() - cache.fetchedAt < TTL) return cache.rates;
  try {
    // open.er-api.com：免費、唔使 key、有 TWD（frankfurter 用 ECB 匯率係冇台幣嘅）
    const res = await fetch('https://open.er-api.com/v6/latest/HKD', { signal: AbortSignal.timeout(10000) });
    const data = await res.json();
    cache = {
      rates: {
        TWD: data.rates?.TWD ? 1 / data.rates.TWD : FALLBACK.TWD,
        JPY: data.rates?.JPY ? 1 / data.rates.JPY : FALLBACK.JPY,
        USD: data.rates?.USD ? 1 / data.rates.USD : FALLBACK.USD,
        HKD: 1,
      },
      fetchedAt: Date.now(),
    };
  } catch (err) {
    console.warn('[fx] 匯率抓取失敗，用 fallback：', err.message);
    cache.fetchedAt = Date.now(); // 失敗都等一個 TTL 先再試，免得狂 retry
  }
  return cache.rates;
}

export async function toHKD(price, currency) {
  if (price == null || !currency) return null;
  const rates = await getRates();
  const rate = rates[currency];
  return rate ? Math.round(price * rate * 10) / 10 : null;
}
