// Telegram 推播 channel。設 TELEGRAM_BOT_TOKEN + TELEGRAM_CHAT_ID（BotFather 免費開）。
const TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const CHAT_ID = process.env.TELEGRAM_CHAT_ID;

export const name = 'telegram';
export const enabled = () => !!(TOKEN && CHAT_ID);

export async function send(text) {
  const res = await fetch(`https://api.telegram.org/bot${TOKEN}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: CHAT_ID, text, disable_web_page_preview: false }),
    signal: AbortSignal.timeout(10000),
  });
  if (!res.ok) throw new Error(`Telegram ${res.status} ${await res.text()}`);
}
