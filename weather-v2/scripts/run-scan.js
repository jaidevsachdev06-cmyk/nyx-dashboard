#!/usr/bin/env node
/**
 * scripts/run-scan.js — Full scan cycle
 * Fetches forecasts, finds markets, evaluates candidates, enters trades.
 * Sends Telegram notification on completion.
 */

const { scan } = require('../stormwatch/scanner');
const { processCandidate } = require('../stormwatch/entry');
const { scanAll: runScalper } = require('../stormwatch/scalper');
const { syncPrices } = require('../core/price-sync');
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

  // Step 0a: Sync prices for open positions (FIX 9)
  try {
    await syncPrices();
  } catch (err) {
    console.warn('[run-scan] Price sync failed (continuing):', err.message);
  }

  // Step 0b: Run scalper before scanning for new trades
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

    // FIX 14: edge is a decimal (0.50 = 50pp), not percentage. Cap at 0.90 (90pp).
    // Old cap of 5.0 never fired since max possible edge is ~0.93.
    result.passing = result.passing.filter(c => (c.edge || 0) <= 0.90);

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
  
  // === HEALTH MONITORS (added 2026-03-21) ===
  
  // MONITOR 1: Zero-entry alert — if no trades entered for 24h+, something is broken
  try {
    const tradesPath2 = path.resolve(__dirname, '..', 'trades.json');
    const data2 = JSON.parse(fs.readFileSync(tradesPath2, 'utf8'));
    const now = Date.now();
    const h24 = 24 * 3600000;
    const recentEntries = (data2.trades || []).filter(t => 
      t.status !== 'candidate' && t.result !== 'push' && t.enteredAt && (now - new Date(t.enteredAt).getTime()) < h24
    );
    // Count consecutive zero-entry scans (rough: if 0 entries in 24h AND this scan had 0)
    if (recentEntries.length === 0 && entered === 0) {
      const lastEntry = (data2.trades || [])
        .filter(t => t.enteredAt && t.status !== 'candidate')
        .sort((a, b) => new Date(b.enteredAt) - new Date(a.enteredAt))[0];
      const hoursSinceEntry = lastEntry ? ((now - new Date(lastEntry.enteredAt).getTime()) / 3600000).toFixed(1) : 'never';
      console.error(`[HEALTH] ⚠️ ZERO-ENTRY ALERT: No trades entered in ${hoursSinceEntry}h`);
      await sendTelegram(`⚠️ *HEALTH ALERT: Zero Entries*\n\nNo trades entered in ${hoursSinceEntry}h.\nThis scan: ${scanResult.scanned} markets evaluated, 0 passed threshold.\n\nPossible causes:\n• Calibration too aggressive\n• Edge threshold too high\n• Market conditions genuinely poor\n\nCheck calibration.js and scanner output.`);
    }
  } catch (err) {
    console.warn('[HEALTH] Zero-entry check failed:', err.message);
  }
  
  // MONITOR 2: Push-rate alert — if >2 pushes in 24h, order placement is broken
  try {
    const tradesPath3 = path.resolve(__dirname, '..', 'trades.json');
    const data3 = JSON.parse(fs.readFileSync(tradesPath3, 'utf8'));
    const now = Date.now();
    const h24 = 24 * 3600000;
    const recentPushes = (data3.trades || []).filter(t =>
      t.result === 'push' && t.closedAt && (now - new Date(t.closedAt).getTime()) < h24
    );
    if (recentPushes.length > 2) {
      console.error(`[HEALTH] ⚠️ PUSH-RATE ALERT: ${recentPushes.length} trades instantly closed as 'push' in last 24h`);
      const cities = recentPushes.map(t => `${t.city} ${t.bucket}`).slice(0, 5).join(', ');
      const reasons = recentPushes.map(t => t.failReason).filter(Boolean).slice(0, 3);
      let alertMsg = `⚠️ *HEALTH ALERT: ${recentPushes.length} Push Trades in 24h*\n\nTrades opened then instantly closed as 'push' ($0 P&L). Order placement is failing.\n\nRecent: ${cities}`;
      if (reasons.length > 0) alertMsg += `\n\nErrors:\n${reasons.map(r => '• ' + r.slice(0, 100)).join('\n')}`;
      await sendTelegram(alertMsg);
    }
  } catch (err) {
    console.warn('[HEALTH] Push-rate check failed:', err.message);
  }
  
  // MONITOR 3: Entry smoke test — verify calibration produces at least some passable candidates
  try {
    const { calibrateProb } = require('../core/calibration');
    const testProb = calibrateProb(0.92); // Typical high-confidence trade
    if (testProb < 0.72) {
      console.error(`[HEALTH] ⚠️ CALIBRATION ALERT: 92% raw → ${(testProb*100).toFixed(1)}% calibrated — may be too aggressive`);
      await sendTelegram(`⚠️ *HEALTH ALERT: Calibration Too Aggressive*\n\n92% raw model prob → ${(testProb*100).toFixed(1)}% calibrated.\nThis makes it nearly impossible to find positive edge vs markets priced >70¢.\n\nCheck calibration.js CALIBRATION_MAP.`);
    }
  } catch (err) {
    console.warn('[HEALTH] Calibration smoke test failed:', err.message);
  }

  // FIX 11: Purge stale candidates (>48h old) to prevent trades.json bloat
  try {
    const store = require('../core/store');
    const allTrades = store.getAll();
    const cutoff = Date.now() - 48 * 3600000;
    const staleCandidates = allTrades.filter(t =>
      t.status === 'candidate' && t.createdAt && new Date(t.createdAt).getTime() < cutoff
    );
    if (staleCandidates.length > 0) {
      const tradesPath = path.resolve(__dirname, '..', 'trades.json');
      const data = JSON.parse(fs.readFileSync(tradesPath, 'utf8'));
      const staleIds = new Set(staleCandidates.map(t => t.id));
      data.trades = data.trades.filter(t => !staleIds.has(t.id));
      data.meta.lastUpdated = new Date().toISOString();
      fs.writeFileSync(tradesPath, JSON.stringify(data, null, 2));
      console.log(`[run-scan] Purged ${staleCandidates.length} stale candidates (>48h old)`);
    }
  } catch (err) {
    console.warn('[run-scan] Candidate cleanup failed (non-fatal):', err.message);
  }

  return scanResult;
}

main().catch(err => {
  console.error('[run-scan] Fatal:', err);
  process.exit(1);
});
