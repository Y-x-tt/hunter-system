const cfg = require('./config');

async function sendTelegram(text) {
  if (!cfg.tgToken || !cfg.tgAdmin) return;
  try {
    await fetch(`https://api.telegram.org/bot${cfg.tgToken}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: cfg.tgAdmin, text, disable_web_page_preview: true })
    });
  } catch (e) {
    console.error('Telegram error:', e.message);
  }
}
module.exports = { sendTelegram };