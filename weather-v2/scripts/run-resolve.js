#!/usr/bin/env node
/**
 * scripts/run-resolve.js — Check all open trades for resolution
 */

const { observe } = require('../stormwatch/observer');
const { syncPrices } = require('../core/price-sync');
const { execSync } = require('child_process');
const path = require('path');

const GIT_DIR = path.join(__dirname, '..', '..'); // nyx-dashboard root

const config = require('../config.json');
const BOT_TOKEN = config.telegram?.botToken || process.env.TELEGRAM_BOT_TOKEN;
const CHAT_ID = config.telegram?.chatId || process.env.TELEGRAM_CHAT_ID;
const TOPIC_ID = config.telegram?.topicId || 2;

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
  console.log(`[run-resolve] Starting resolution check | ${new Date().toISOString()}`);

  // FIX 9: Sync prices BEFORE resolution check (enables price-inferred fallback + accurate P&L)
  try {
    await syncPrices();
  } catch (err) {
    console.warn('[run-resolve] Price sync failed (continuing):', err.message);
  }

  const result = await observe();
  console.log(`\n[run-resolve] Complete:`, JSON.stringify(result, null, 2));

  // RECONCILIATION: Check real positions against CLOB
  // Catches positions that resolved/sold externally without updating trades.json
  try {
    const store = require('../core/store');
    const { spawnSync } = require('child_process');
    const openReal = store.getOpenPositions().filter(t => t.realTrading && t.realSize > 0 && t.tokenId);
    
    if (openReal.length > 0) {
      // Get all CLOB positions for our proxy
      const config = require('../config.json');
      // Use the correct gnosis-safe proxy (Account A — visible on polymarket.com)
      // Do NOT use `wallet show` — the CLI derives the wrong proxy address (bug #14)
      const proxyAddr = '0x8dC9c96Edd3dab3E5A79f1db49Cd7764E8Ff7C94';
      
      if (proxyAddr) {
        const posResult = spawnSync('polymarket', ['data', 'positions', proxyAddr, '-o', 'json'], { encoding: 'utf8', timeout: 10000 });
        const clobPositions = posResult.status === 0 ? JSON.parse(posResult.stdout) : [];
        
        for (const trade of openReal) {
          // Check if this position exists on CLOB
          const onClob = clobPositions.some(p => 
            p.condition_id === trade.conditionId || 
            p.slug?.includes(trade.city.toLowerCase().replace(/ /g, '-'))
          );
          
          if (!onClob) {
            console.log(`[reconcile] ⚠️ ${trade.city} ${trade.bucket} — tracked as open but NOT on CLOB`);
            // Check if market is closed/resolved
            const polymarket = require('../core/polymarket');
            try {
              const resolution = await polymarket.checkResolution(trade.conditionId);
              if (resolution.resolved) {
                console.log(`[reconcile] Market resolved: ${resolution.outcome} — closing trade`);
                const isWin = (trade.side === resolution.outcome);
                const pnl = isWin ? (1 - trade.entryPrice) * trade.size : -(trade.entryPrice * trade.size);
                store.transition(trade.id, 'resolved', {
                  result: isWin ? 'win' : 'loss',
                  pnlUSDC: parseFloat(pnl.toFixed(4)),
                  resolutionPrice: isWin ? 1.0 : 0.0,
                  resolutionSource: 'reconciliation',
                  resolvedAt: new Date().toISOString()
                });
                store.transition(trade.id, 'closed');
                if (!result.resolved) result.resolved = [];
                result.resolved.push({ ...store.getById(trade.id), city: trade.city, bucket: trade.bucket });
              } else {
                console.log(`[reconcile] Market NOT resolved but position missing from CLOB — possible external sale`);
              }
            } catch (e) {
              console.warn(`[reconcile] Resolution check failed for ${trade.city}: ${e.message}`);
            }
          }
        }
      }
    }
  } catch (reconcileErr) {
    console.warn('[reconcile] Reconciliation check failed (non-fatal):', reconcileErr.message);
  }

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
      // Load real order log for proxy attribution
      let log = [];
      try { log = fs.readFileSync(path.resolve(__dirname, '..', 'real-order-log.jsonl'), 'utf8').trim().split('\n').map(l => JSON.parse(l)); } catch {};
      
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
        const isReal = t.realTrading || t.tradeSource === 'real' || t.tradeSource === 'both';
        let realTag = '';
        if (isReal) {
          // Check which proxy the order went through
          const isSDK = t.realOrderId && log.some(l => l.orderID === t.realOrderId && l.via === 'sdk');
          realTag = isSDK ? ' 💰' : ' 💰(old proxy)';
        }
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
