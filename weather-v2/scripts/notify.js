#!/usr/bin/env node
// Simple notification helper for weather system
const message = process.argv[2];
if (!message) {
  console.error('Usage: notify.js "message text"');
  process.exit(1);
}

const BOT_TOKEN = '8550919932:AAEJrh5TX03LP7gXq_WiRnMNBUlPA6K1zC4';
const CHAT_ID = '6693508993';

(async () => {
  try {
    const url = `https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`;
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: CHAT_ID,
        text: message,
        parse_mode: 'HTML'
      })
    });
    
    if (!response.ok) {
      const err = await response.text();
      throw new Error(`Telegram API error: ${response.status} ${err}`);
    }
    
    console.log('[notify] Message sent to Telegram');
  } catch (err) {
    console.error('[notify] Failed:', err.message);
    process.exit(1);
  }
})();
