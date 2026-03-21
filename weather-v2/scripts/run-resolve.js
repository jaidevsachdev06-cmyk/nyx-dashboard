#!/usr/bin/env node
/**
 * scripts/run-resolve.js — Check all open trades for resolution
 */

const { observe } = require('../stormwatch/observer');
const { syncPrices } = require('../core/price-sync');
const { execSync } = require('child_process');
const path = require('path');

const GIT_DIR = path.join(__dirname, '..', '..'); // nyx-dashboard root

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
  console.log(`[run-resolve] Starting resolution check | ${new Date().toISOString()}`);

  // FIX 9: Sync prices BEFORE resolution check (enables price-inferred fallback + accurate P&L)
  try {
    await syncPrices();
  } catch (err) {
    console.warn('[run-resolve] Price sync failed (continuing):', err.message);
  }

  const result = await observe();
  console.log(`\n[run-resolve] Complete:`, JSON.stringify(result, null, 2));

  // Auto-push if any trades resolved
  if (result.resolved && result.resolved.length > 0) {
    try {
      execSync(`git -C ${GIT_DIR} add weather-v2/trades.json`, { stdio: 'pipe' });
      try { execSync(`git -C ${GIT_DIR} commit -m "auto: ${result.resolved.length} weather trade(s) resolved"`, { stdio: 'pipe' }); } catch(e) { /* nothing to commit */ }
      // E028: Robust push with retry + verification
      let pushOk = false;
      for (let attempt = 1; attempt <= 3; attempt++) {
        try {
          execSync(`git -C ${GIT_DIR} pull --rebase origin main`, { stdio: 'pipe' });
          execSync(`git -C ${GIT_DIR} push origin main`, { stdio: 'pipe' });
          const local = execSync(`git -C ${GIT_DIR} rev-parse HEAD`, { encoding: 'utf8' }).trim();
          const remote = execSync(`git -C ${GIT_DIR} ls-remote origin HEAD`, { encoding: 'utf8' }).split(/\s/)[0];
          if (local === remote) { pushOk = true; console.log(`[run-resolve] Git push verified (attempt ${attempt})`); break; }
        } catch(e) {
          console.log(`[run-resolve] Git push attempt ${attempt} failed: ${e.message}`);
          // Abort any broken rebase to prevent corrupted repo state
          try { execSync(`git -C ${GIT_DIR} rebase --abort`, { stdio: 'pipe' }); } catch(_) {}
        }
      }
      if (!pushOk) console.error('[run-resolve] 🚨 CRITICAL: Git push failed after 3 attempts');
      console.log(`[run-resolve] Pushed ${result.resolved.length} resolved trade(s) to GitHub`);
    } catch (e) {
      console.warn(`[run-resolve] Git push failed: ${e.message?.slice(0, 80)}`);
    }
    
    // Send notification
    console.log('\n[run-resolve] Sending notification...');
    try {
      const winners = result.resolved.filter(t => (t.pnlUSDC || 0) > 0).length;
      const losers = result.resolved.filter(t => (t.pnlUSDC || 0) <= 0).length;
      const totalPnL = result.resolved.reduce((sum, t) => sum + (t.pnlUSDC || 0), 0).toFixed(2);
      const winRate = winners + losers > 0 ? ((winners / (winners + losers)) * 100).toFixed(1) : '0.0';
      
      // Compute real money impact
      const realTrades = result.resolved.filter(t => t.realTrading || t.tradeSource === 'real' || t.tradeSource === 'both');
      const realPnL = realTrades.reduce((sum, t) => sum + (t.realPnlUSDC || 0), 0);
      
      let msg = `🌪️ Weather Positions Resolved\n\n`;
      msg += `${result.resolved.length} position${result.resolved.length > 1 ? 's' : ''} closed.\n\n`;
      msg += `Results:\n`;
      msg += `• ${winners}W / ${losers}L (${winRate}% win rate)\n`;
      msg += `• Paper P&L: ${totalPnL >= 0 ? '+' : ''}$${totalPnL}\n`;
      if (realTrades.length > 0) {
        msg += `• 💰 Real P&L: ${realPnL >= 0 ? '+' : ''}$${realPnL.toFixed(2)} (${realTrades.length} real trade${realTrades.length > 1 ? 's' : ''})\n`;
      }
      msg += `\n`;
      
      msg += `Positions:\n`;
      result.resolved.forEach(t => {
        const pnl = t.pnlUSDC || 0;
        const sign = pnl >= 0 ? '+' : '';
        const realTag = (t.realTrading || t.tradeSource === 'real' || t.tradeSource === 'both') ? ' 💰' : '';
        msg += `• ${t.city || 'Unknown'} ${t.bucket || ''} ${sign}$${pnl.toFixed(2)}${realTag}\n`;
      });
      
      await sendTelegram(msg);
    } catch (err) {
      console.error('[run-resolve] Notification failed (non-fatal):', err.message);
    }
  }
  return result;
}

main().catch(err => {
  console.error('[run-resolve] Fatal:', err);
  process.exit(1);
});
