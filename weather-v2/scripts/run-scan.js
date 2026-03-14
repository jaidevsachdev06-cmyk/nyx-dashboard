#!/usr/bin/env node
/**
 * scripts/run-scan.js — Full scan cycle
 * Fetches forecasts, finds markets, evaluates candidates, enters trades.
 * Sends Telegram notification on completion.
 */

const { scan } = require('../stormwatch/scanner');
const { processCandidate } = require('../stormwatch/entry');
const { scanAll: runScalper } = require('../stormwatch/scalper');
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
        parse_mode: 'Markdown'
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

  // Step 0: Run scalper before scanning for new trades
  console.log('[run-scan] Running scalper on open positions...');
  let scalperResults = { scalps: [], exits: [], checked: 0 };
  try {
    scalperResults = await runScalper();
    const actions = scalperResults.scalps.length + scalperResults.exits.length;
    console.log(`[run-scan] Scalper: checked ${scalperResults.checked} positions, ${actions} actions taken`);
  } catch (err) {
    console.error('[run-scan] Scalper error (continuing to scan):', err.message);
  }

  const result = await scan();

  console.log(`\n[run-scan] Found ${result.candidates.length} candidates, ${result.passing.length} pass threshold`);

  // Initialize entry tracking
  let entered = 0;
  const enteredTrades = [];
  const skipped = [];

  // Only process candidates if there are any
  if (result.passing.length > 0) {
    // Sort by edge descending
    result.passing.sort((a, b) => (b.edge || 0) - (a.edge || 0));

    // Cap max edge to filter illiquid garbage (>500% usually means 3¢ market)
    result.passing = result.passing.filter(c => (c.edge || 0) <= 5.0);

    // Separate lottery vs normal trades
    const lotteryTrades = result.passing.filter(c => c.marketPrice < 0.15 && c.modelProb >= 0.07);
    const normalTrades = result.passing.filter(c => !(c.marketPrice < 0.15 && c.modelProb >= 0.07));

    // Sort lottery trades by probability ratio (quality), take top 3
    lotteryTrades.sort((a, b) => {
      const ratioA = a.modelProb / a.marketPrice;
      const ratioB = b.modelProb / b.marketPrice;
      return ratioB - ratioA;
    });
    const topLottery = lotteryTrades.slice(0, 3);

    // Recombine: normal trades + top 3 lottery trades
    result.passing = [...normalTrades, ...topLottery];

    console.log(`[run-scan] After sorting & filtering: ${result.passing.length} candidates (${normalTrades.length} normal, ${topLottery.length} lottery)`);

    // Enter trades
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
  }

  // Build scan result
  const passingCount = result.passing ? result.passing.length : 0;
  const scanResult = { scanned: result.candidates.length, passing: passingCount, entered };
  console.log('\n' + JSON.stringify(scanResult, null, 2));
  
  // Build notification
  let msg = `🌪️ Weather Scan Complete\n\n`;
  
  // Scalper results first
  if (scalperResults.scalps.length > 0 || scalperResults.exits.length > 0) {
    msg += `Scalper actions:\n`;
    for (const s of scalperResults.scalps) {
      msg += `• Partial exit: ${s.city} ${s.bucket} ${s.side}, sold ${s.sharesSold} @ ${(s.currentPrice*100).toFixed(0)}¢ (+$${s.pnlOnSold.toFixed(2)})\n`;
    }
    for (const e of scalperResults.exits) {
      msg += `• Full exit: ${e.city} ${e.bucket} ${e.side}, ${e.rule} ($${e.pnlUSDC.toFixed(2)})\n`;
    }
    msg += `\n`;
  }
  
  if (entered > 0) {
    msg += `${entered} trade${entered > 1 ? 's' : ''} entered.\n\n`;
    msg += `Positions:\n`;
    for (const t of enteredTrades) {
      const lottery = t.modelProb < 0.6 && t.edgePct > 100 ? ' 🎰' : '';
      msg += `• ${t.city} ${t.bucket} ${t.side} @ ${(t.marketPrice*100).toFixed(0)}¢ (edge: ${t.edgePct.toFixed(0)}%)${lottery}\n`;
    }
  } else {
    msg += `No trades entered this cycle.\n`;
  }
  
  msg += `\n`;
  
  // Always include full P&L table
  const fs = require('fs');
  const path = require('path');
  const tradesPath = path.resolve(__dirname, '..', 'trades.json');
  
  try {
    const data = JSON.parse(fs.readFileSync(tradesPath, 'utf8'));
    const openTrades = (data.trades || []).filter(t => t.status === 'open');
    const closedTrades = (data.trades || []).filter(t => t.status === 'closed');
    
    const totalRealized = closedTrades.reduce((sum, t) => sum + (t.pnlUSDC || 0), 0);
    const wins = closedTrades.filter(t => t.pnlUSDC > 0).length;
    const losses = closedTrades.filter(t => t.pnlUSDC <= 0).length;
    
    let totalUnrealized = 0;
    
    if (openTrades.length > 0) {
      msg += `Open Positions:\n\n\`\`\`\n`;
      msg += `+------+----------+----------+-------+---------+---------+----------+\n`;
      msg += `|      | City     | Market   | Side  | Entry   | Now     | P&L      |\n`;
      msg += `+------+----------+----------+-------+---------+---------+----------+\n`;
      
      for (const t of openTrades) {
        // FIX 7 (2026-03-14): Guard against NaN prices in notification
        // Near-resolution markets can return undefined/null currentPrice
        const safeCurrentPrice = (t.currentPrice != null && !isNaN(t.currentPrice)) ? t.currentPrice : t.entryPrice;
        const safeEntryPrice = (t.entryPrice != null && !isNaN(t.entryPrice)) ? t.entryPrice : 0;
        const unrealized = (safeCurrentPrice - safeEntryPrice) * (t.size || 0);
        totalUnrealized += isNaN(unrealized) ? 0 : unrealized;
        const indicator = unrealized >= 0 ? '🟢' : '🔴';
        const entry = (safeEntryPrice * 100).toFixed(1) + '¢';
        const now = (t.currentPrice != null && !isNaN(t.currentPrice)) ? (t.currentPrice * 100).toFixed(1) + '¢' : '—';
        const pnl = isNaN(unrealized) ? '$0.00' : ((unrealized >= 0 ? '+$' : '-$') + Math.abs(unrealized).toFixed(2));
        
        msg += `| ${indicator}  | ${t.city.padEnd(8)} | ${t.bucket.padEnd(8)} | ${t.side.padEnd(5)} | ${entry.padEnd(7)} | ${now.padEnd(7)} | ${pnl.padEnd(8)} |\n`;
        msg += `+------+----------+----------+-------+---------+---------+----------+\n`;
      }
      
      msg += `\`\`\`\n\n`;
    } else {
      msg += `No open positions.\n\n`;
    }
    
    // Summary line
    const urSign = totalUnrealized >= 0 ? '+' : '';
    const rSign = totalRealized >= 0 ? '+' : '';
    const total = totalRealized + totalUnrealized;
    const tSign = total >= 0 ? '+' : '';
    
    msg += `Unrealized: ${urSign}$${totalUnrealized.toFixed(2)} | Realized: ${rSign}$${totalRealized.toFixed(2)} | ${wins}W/${losses}L\n`;
    msg += `Total: ${tSign}$${total.toFixed(2)}\n\n`;
    
    // Scan stats
    msg += `Scan: ${scanResult.scanned} markets, ${scanResult.passing} passed edge threshold\n`;
    
    // Candidate details if any were skipped
    if (skipped.length > 0) {
      const skipReasons = {};
      skipped.forEach(s => {
        const reason = s.reason.split(':')[0];
        skipReasons[reason] = (skipReasons[reason] || 0) + 1;
      });
      msg += `Skipped: `;
      msg += Object.entries(skipReasons).map(([r, c]) => `${r} (${c})`).join(', ');
      msg += `\n`;
    }
    
    msg += `\nNext scan: ~2h`;
  } catch (err) {
    console.error('[run-scan] Failed to build P&L table:', err.message);
    msg += `\nMarket conditions:\n`;
    msg += `• ${scanResult.scanned} markets scanned\n`;
    msg += `• ${scanResult.passing} met entry criteria\n`;
    msg += `\nNext scan: ~2h`;
  }
  
  await sendTelegram(msg);
  
  // Auto-push if any trades were entered
  if (entered > 0) {
    try {
      const { execSync } = require('child_process');
      const path = require('path');
      const GIT_DIR = path.resolve(__dirname, '..', '..');
      execSync(`git -C ${GIT_DIR} add weather-v2/trades.json`, { stdio: 'pipe' });
      try { execSync(`git -C ${GIT_DIR} commit -m "auto: ${entered} weather trade(s) entered"`, { stdio: 'pipe' }); } catch(e) { /* nothing to commit */ }
      execSync(`git -C ${GIT_DIR} pull --rebase origin main`, { stdio: 'pipe' });
      execSync(`git -C ${GIT_DIR} push origin main`, { stdio: 'pipe' });
      console.log(`[run-scan] Pushed ${entered} new trade(s) to GitHub`);
    } catch (e) {
      console.warn(`[run-scan] Git push failed: ${e.message?.slice(0, 80)}`);
    }
  }
  
  return scanResult;
}

main().catch(err => {
  console.error('[run-scan] Fatal:', err);
  process.exit(1);
});
