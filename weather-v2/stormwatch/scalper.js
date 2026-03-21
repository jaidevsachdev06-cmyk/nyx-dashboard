/**
 * stormwatch/scalper.js — Early Exit / Scalp Module
 * 
 * Checks open positions and paper-exits when profit/loss targets hit.
 * 
 * Rules:
 * - Lottery (entry <15¢) up 200%+: sell half, let rest ride
 * - Lottery up 500%+: sell remaining
 * - Normal trades up 50%+: sell half
 * - Normal trades up 100%+: sell remaining  
 * - Any trade down 60%+: stop-loss exit
 */

const store = require('../core/store');
const polymarket = require('../core/polymarket');
const circuitBreaker = require('../core/circuit-breaker');
const config = require('../config.json');

const LOTTERY_THRESHOLD = 0.15;

// Don't scalp if market resolves within this many hours (let it ride to resolution)
const NEAR_RESOLUTION_HOURS = 4;

const RULES = {
  lottery: [
    { name: 'lottery-half', gainPct: 200, targetScalped: 0.5 },
    { name: 'lottery-full', gainPct: 500, targetScalped: 1.0 },
  ],
  normal: [
    { name: 'normal-half', gainPct: 50, targetScalped: 0.5 },
    { name: 'normal-full', gainPct: 100, targetScalped: 1.0 },
  ],
  stopLoss: { name: 'stop-loss', lossPct: 60 }
};

function classifyTrade(trade) {
  return (trade.entryPrice && trade.entryPrice < LOTTERY_THRESHOLD) ? 'lottery' : 'normal';
}

function totalScalpedFraction(trade) {
  return (trade.scalps || []).reduce((sum, s) => sum + (s.fraction || 0), 0);
}

function isNearResolution(trade) {
  if (!trade.date || !trade.city) return false;
  const cityConfig = (config.cities || []).find(c => c.name === trade.city);
  const tz = cityConfig?.tz || 'UTC';

  // Market resolves at end of day in the city's local timezone (midnight)
  // Calculate hours until midnight local time on the market date
  const now = new Date();
  const localDateStr = now.toLocaleDateString('en-CA', { timeZone: tz }); // YYYY-MM-DD
  const localHour = parseInt(now.toLocaleString('en-US', { timeZone: tz, hour: 'numeric', hour12: false }));

  if (trade.date < localDateStr) return true;  // Already past — definitely near resolution
  if (trade.date === localDateStr) {
    const hoursLeft = 24 - localHour;
    return hoursLeft <= NEAR_RESOLUTION_HOURS;
  }
  return false;
}

async function checkPosition(trade) {
  const tag = `[scalper] ${trade.city} ${trade.bucket} ${trade.side}`;
  if (trade.status !== 'open') return null;
  if (!trade.entryPrice) return null;

  let currentPrice;
  try {
    currentPrice = await polymarket.getMidpointPrice(trade.tokenId);
  } catch (err) {
    currentPrice = trade.currentPrice;
  }
  if (!currentPrice) return null;

  const gainPct = ((currentPrice - trade.entryPrice) / trade.entryPrice) * 100;
  const type = classifyTrade(trade);
  const scalpedSoFar = totalScalpedFraction(trade);
  const remainingFraction = 1 - scalpedSoFar;

  if (remainingFraction <= 0.01) return null;

  // Skip profit-taking if market resolves soon (let it ride to full payout)
  // Stop-loss still active — protect downside even near resolution
  if (isNearResolution(trade) && gainPct > 0) {
    console.log(`${tag} ⏳ Near resolution (${trade.date}) — skipping scalp, letting it ride`);
    return null;
  }

  // Stop-loss check
  if (gainPct <= -RULES.stopLoss.lossPct) {
    const sharesToSell = Math.floor(trade.size * remainingFraction);
    if (sharesToSell < 1) return null;
    console.log(`${tag} 🛑 STOP-LOSS | ${gainPct.toFixed(0)}% loss`);
    return { action: 'exit', rule: RULES.stopLoss.name, trade, currentPrice, gainPct, sellFraction: remainingFraction, sharesToSell };
  }

  // Profit-take rules (highest threshold first)
  const rules = RULES[type].slice().reverse();
  for (const rule of rules) {
    if (gainPct >= rule.gainPct) {
      const additionalToSell = rule.targetScalped - scalpedSoFar;
      if (additionalToSell <= 0.01) continue;
      const sharesToSell = Math.floor(trade.size * additionalToSell);
      if (sharesToSell < 1) continue;

      const isFullExit = (rule.targetScalped >= 1.0);
      console.log(`${tag} 💰 ${rule.name} | +${gainPct.toFixed(0)}% | ${isFullExit ? 'Full exit' : `Selling ${(additionalToSell * 100).toFixed(0)}%`}`);
      return {
        action: isFullExit ? 'exit' : 'partial-exit',
        rule: rule.name, trade, currentPrice, gainPct, sellFraction: additionalToSell, sharesToSell
      };
    }
  }

  return null;
}

async function executeScalp(signal) {
  const { trade, currentPrice, sharesToSell, sellFraction, rule, gainPct } = signal;
  const tag = `[scalper] ${trade.city} ${trade.bucket} ${trade.side}`;
  const pnlOnSold = (currentPrice - trade.entryPrice) * sharesToSell;

  // Real trading: sell real shares if this trade has a real order
  const realCfg = config.realTrading || {};
  const realRemaining = trade.realSize || 0;
  if (realCfg.enabled && trade.realTrading && trade.tokenId && realRemaining > 0) {
    try {
      let realSellSize;
      if (signal.action === 'exit') {
        // Full exit: sell all remaining real shares
        realSellSize = realRemaining;
      } else {
        // Partial exit: use sellFraction of REAL position (not paper)
        realSellSize = Math.max(1, Math.floor(realRemaining * sellFraction));
      }

      // Clamp: never sell more than we actually have
      if (realSellSize > realRemaining) {
        console.warn(`${tag} ⚠️ Clamping real sell ${realSellSize} → ${realRemaining} (tracked realSize)`);
        realSellSize = realRemaining;
      }

      // CLOB minimum order size is 5. If we'd sell < 5, sell all remaining instead.
      if (realSellSize < 5 && realRemaining >= 5) {
        console.log(`${tag} ⚠️ Partial sell ${realSellSize} < CLOB min 5 — selling all ${realRemaining} instead`);
        realSellSize = realRemaining;
      }

      if (realSellSize >= 5) {
        // Use currentPrice as basis — realOrder() will discount 2 ticks for sells
        const realResult = await polymarket.realOrder({
          tokenId: trade.tokenId,
          side: 'SELL',
          price: currentPrice,
          size: realSellSize
        });
        console.log(`${tag} 💵 REAL SELL placed | ${realSellSize} shares @ ~${currentPrice}`);

        // Update realSize tracker
        const newRealSize = realRemaining - realSellSize;
        store.update(trade.id, { realSize: newRealSize });
      } else if (realSellSize > 0) {
        console.warn(`${tag} ⚠️ Cannot sell ${realSellSize} real shares (below CLOB min 5, only ${realRemaining} remaining) — will resolve at expiry`);
      }
    } catch (realErr) {
      console.error(`${tag} ⚠️ REAL SELL FAILED (paper exit continues): ${realErr.message}`);
    }
  }

  if (signal.action === 'exit') {
    const priorScalpPnl = (trade.scalps || []).reduce((s, sc) => s + (sc.pnlUSDC || 0), 0);
    const remainingPnl = (currentPrice - trade.entryPrice) * trade.size;
    const finalPnl = parseFloat((remainingPnl + priorScalpPnl).toFixed(4));
    const result = finalPnl >= 0 ? 'win' : 'loss';

    store.transition(trade.id, 'resolved', {
      result, pnlUSDC: finalPnl, resolutionPrice: currentPrice,
      resolutionSource: 'manual-exit', resolvedAt: new Date().toISOString(),
    });
    store.transition(trade.id, 'closed');
    // Record to circuit breaker (stop-loss streaks must trip the breaker too)
    circuitBreaker.recordResult(result);
    console.log(`${tag} ✅ EXITED | ${rule} | P&L: $${finalPnl.toFixed(2)}`);
    return { action: 'exit', rule, pnlUSDC: finalPnl, currentPrice, gainPct, city: trade.city, bucket: trade.bucket, side: trade.side };
  }

  // Partial exit
  const scalps = trade.scalps || [];
  scalps.push({
    rule, fraction: sellFraction, shares: sharesToSell,
    price: currentPrice, pnlUSDC: parseFloat(pnlOnSold.toFixed(4)),
    timestamp: new Date().toISOString(),
  });

  const remainingShares = trade.size - sharesToSell;
  store.update(trade.id, {
    scalps, size: remainingShares,
    sizeUSDC: parseFloat((remainingShares * trade.entryPrice).toFixed(4)),
    currentPrice,
    notes: (trade.notes || '') + ` | SCALP ${rule}: sold ${sharesToSell}@${currentPrice.toFixed(3)} (+$${pnlOnSold.toFixed(2)})`,
  });

  console.log(`${tag} 💰 PARTIAL | ${rule} | Sold ${sharesToSell}@${currentPrice} | +$${pnlOnSold.toFixed(2)} | ${remainingShares} remaining`);
  return {
    action: 'partial-exit', rule, sharesSold: sharesToSell, sharesRemaining: remainingShares,
    pnlOnSold, currentPrice, gainPct, city: trade.city, bucket: trade.bucket, side: trade.side
  };
}

async function scanAll() {
  const openTrades = store.getOpenPositions();
  console.log(`[scalper] Checking ${openTrades.length} open positions...`);
  const results = { scalps: [], exits: [], skipped: 0, errors: [] };

  for (const trade of openTrades) {
    try {
      const signal = await checkPosition(trade);
      if (!signal) { results.skipped++; continue; }
      const result = await executeScalp(signal);
      if (result.action === 'exit') results.exits.push(result);
      else results.scalps.push(result);
    } catch (err) {
      console.error(`[scalper] Error on ${trade.id}: ${err.message}`);
      results.errors.push({ id: trade.id, error: err.message });
    }
  }

  console.log(`[scalper] Done: ${results.scalps.length} partial, ${results.exits.length} full exits, ${results.skipped} no action, ${results.errors.length} errors`);
  return results;
}

module.exports = { checkPosition, executeScalp, scanAll, RULES };
