#!/usr/bin/env node
/**
 * scripts/run-scan.js — Full scan cycle
 * Fetches forecasts, finds markets, evaluates candidates, enters trades.
 * Sends Telegram notification on completion.
 */

const { scan } = require('../stormwatch/scanner');
const { processCandidate } = require('../stormwatch/entry');
const config = require('../config.json');

const BOT_TOKEN = '8550919932:AAEJrh5TX03LP7gXq_WiRnMNBUlPA6K1zC4';
const CHAT_ID = '-1003762193481';
const TOPIC_ID = 2;

async function sendTelegram(text) {
  try {
    const url = `https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`;
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: CHAT_ID,
        message_thread_id: TOPIC_ID,
        text,
        parse_mode: 'HTML'
      })
    });
    if (!res.ok) {
      const err = await res.text();
      console.error('[notify] Telegram error:', res.status, err);
    } else {
      console.log('[notify] Telegram notification sent');
    }
  } catch (err) {
    console.error('[notify] Failed:', err.message);
  }
}

async function main() {
  console.log(`[run-scan] Starting weather v2 scan | paper=${config.paper} | ${new Date().toISOString()}`);

  const result = await scan();

  console.log(`\n[run-scan] Found ${result.candidates.length} candidates, ${result.passing.length} pass threshold`);

  if (result.passing.length === 0) {
    console.log('[run-scan] No actionable candidates. Done.');
    return { scanned: result.candidates.length, passing: 0, entered: 0 };
  }

  // Sort by edge descending
  result.passing.sort((a, b) => (b.edge || 0) - (a.edge || 0));

  // Cap max edge to filter illiquid garbage (>500% usually means 3¢ market)
  result.passing = result.passing.filter(c => (c.edge || 0) <= 5.0);

  console.log(`[run-scan] After sorting & filtering: ${result.passing.length} candidates`);

  // Enter trades
  let entered = 0;
  const enteredTrades = [];
  const skipped = [];
  
  for (const candidate of result.passing) {
    try {
      const res = await processCandidate(candidate);
      if (res.entered) {
        entered++;
        enteredTrades.push(candidate);
      } else {
        console.log(`[run-scan] Skipped: ${res.reason}`);
        skipped.push({ candidate, reason: res.reason });
      }
    } catch (err) {
      console.error(`[run-scan] Error: ${err.message}`);
      skipped.push({ candidate, reason: err.message });
    }
  }

  console.log(`\n[run-scan] Complete: ${entered} trades entered out of ${result.passing.length} candidates`);
  
  const scanResult = { scanned: result.candidates.length, passing: result.passing.length, entered };
  console.log('\n' + JSON.stringify(scanResult, null, 2));
  
  // Build notification
  let msg = `🌪️ Weather Scan Complete\n\n`;
  
  if (entered > 0) {
    msg += `${entered} trade${entered > 1 ? 's' : ''} entered.\n\n`;
    msg += `Positions:\n`;
    for (const t of enteredTrades) {
      msg += `• ${t.city} ${t.bucket} ${t.side} @ ${(t.marketPrice*100).toFixed(0)}¢ (edge: ${t.edgePct.toFixed(0)}%)\n`;
    }
  } else {
    msg += `No trades entered this cycle.\n`;
  }
  
  msg += `\nMarket conditions:\n`;
  msg += `• ${scanResult.scanned} markets scanned\n`;
  msg += `• ${scanResult.passing} met entry criteria (≥25% edge)\n`;
  
  // Get open positions count from journal
  const fs = require('fs');
  const journalPath = '/docker/openclaw-uwzq/data/.openclaw/workspace/projects/nyx-dashboard/_data/trading-journal.json';
  let openCount = 0;
  try {
    const journal = JSON.parse(fs.readFileSync(journalPath, 'utf8'));
    openCount = journal.filter(p => p.status === 'open').length;
  } catch (err) {
    console.error('[run-scan] Failed to read journal for open count:', err.message);
  }
  msg += `• ${openCount} positions currently open\n`;
  
  msg += `\nNext scan: ~2h`;
  
  await sendTelegram(msg);
  return scanResult;
}

main().catch(err => {
  console.error('[run-scan] Fatal:', err);
  process.exit(1);
});
