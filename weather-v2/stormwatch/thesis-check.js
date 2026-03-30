/**
 * stormwatch/thesis-check.js — Thesis Invalidation Module
 * 
 * Re-evaluates open positions against FRESH forecasts every scan cycle.
 * If the edge that justified entry has evaporated or reversed, exits the position.
 * 
 * This closes the critical gap: we entered on weather models but only exited on price.
 * Now we exit on weather models too.
 * 
 * Rules:
 * - Recalculate model probability for each open position using current forecast
 * - If calibrated edge drops below exitEdgeThreshold (default: 0%) → exit
 * - If model probability flips (was YES-favored, now NO-favored) → exit
 * - Grace period: don't exit within first N minutes of entry (avoid whipsaw)
 * - Near-resolution immunity: within 4h of resolution, let it ride (too late to exit)
 */

const store = require('../core/store');
const polymarket = require('../core/polymarket');
const calibration = require('../core/calibration');
const config = require('../config.json');

// Re-use scanner's math utilities
const { normalCDF, parseBucket, bucketProbability } = require('./scanner');

// Config defaults (can be overridden in config.json under risk.thesisCheck)
// 
// exitEdgeThreshold: -10% means only exit when edge drops to -10% (model says we're 10% underwater).
// This absorbs normal forecast noise (±0.5σ moves) without false-exiting winners.
// Backtest V2 showed that 0% threshold would cause 38% false exits on wins.
// At -10%, only 11-15% of wins would be at risk (the truly fragile ones).
const DEFAULTS = {
  enabled: true,
  exitEdgeThreshold: -10,      // Exit when edge drops below -10% (absorbs normal noise)
  graceMinutes: 60,            // Don't exit within 60 min of entry (forecast noise)
  nearResolutionHours: 4,      // Don't exit within 4h of resolution (let it ride)
  logOnly: false,              // If true, log but don't actually exit (dry run mode)
};

function getConfig() {
  const tc = config.risk?.thesisCheck || {};
  return { ...DEFAULTS, ...tc };
}

/**
 * Check if a trade was entered recently enough to be in the grace period.
 */
function isInGracePeriod(trade, graceMinutes) {
  if (!trade.enteredAt) return false;
  const enteredAt = new Date(trade.enteredAt).getTime();
  const elapsed = Date.now() - enteredAt;
  return elapsed < graceMinutes * 60 * 1000;
}

/**
 * Check if the market is near resolution (within N hours of midnight local time).
 */
function isNearResolution(trade, nearResolutionHours) {
  if (!trade.date || !trade.city) return false;
  const cityConfig = (config.cities || []).find(c => c.name === trade.city);
  const tz = cityConfig?.tz || 'UTC';

  const now = new Date();
  const localDateStr = now.toLocaleDateString('en-CA', { timeZone: tz });
  const localHour = parseInt(now.toLocaleString('en-US', { timeZone: tz, hour: 'numeric', hour12: false }));

  if (trade.date < localDateStr) return true;   // Already past
  if (trade.date === localDateStr) {
    const hoursLeft = 24 - localHour;
    return hoursLeft <= nearResolutionHours;
  }
  return false;
}

/**
 * Re-evaluate a single open position against fresh forecast data.
 * 
 * @param {Object} trade - Open trade from store
 * @param {Object} forecasts - Fresh forecast data keyed by city name, 
 *                             each value keyed by date with { mean, sd, models, sources }
 * @returns {Object|null} - Exit signal or null if position should hold
 */
function evaluatePosition(trade, forecasts) {
  const tag = `[thesis] ${trade.city} ${trade.date} ${trade.bucket} ${trade.side}`;
  const tc = getConfig();

  // Skip if thesis check disabled
  if (!tc.enabled) return null;

  // Skip trades in grace period
  if (isInGracePeriod(trade, tc.graceMinutes)) {
    console.log(`${tag} ⏳ Grace period (entered ${trade.enteredAt}) — skipping`);
    return null;
  }

  // Skip trades near resolution (let them ride)
  if (isNearResolution(trade, tc.nearResolutionHours)) {
    console.log(`${tag} ⏳ Near resolution — letting it ride`);
    return null;
  }

  // Get fresh forecast for this city + date
  const cityForecasts = forecasts[trade.city];
  if (!cityForecasts) {
    console.warn(`${tag} ⚠️ No forecast data for city — skipping`);
    return null;
  }

  const dateForecast = cityForecasts[trade.date];
  if (!dateForecast) {
    console.warn(`${tag} ⚠️ No forecast for date ${trade.date} — skipping`);
    return null;
  }

  // Parse the bucket from the trade's question
  const bucket = parseBucket(trade.question);
  if (!bucket) {
    console.warn(`${tag} ⚠️ Could not parse bucket from question — skipping`);
    return null;
  }

  // Calculate current model probability for this bucket
  const rawModelProb = bucketProbability(bucket, dateForecast.mean, dateForecast.sd);
  if (rawModelProb === null) {
    console.warn(`${tag} ⚠️ Could not calculate bucket probability — skipping`);
    return null;
  }

  // Adjust for side: if we're holding NO, our effective prob is (1 - bucketProb)
  const rawSideProb = trade.side === 'YES' ? rawModelProb : (1 - rawModelProb);

  // Calibrate
  const uniqueSources = dateForecast.sources || 1;
  const calibratedProb = calibration.sourceAdjustedCalibration(rawSideProb, uniqueSources);

  // CRITICAL: Compare model prob against ENTRY price, not current market price.
  // Why? Edge can shrink two ways:
  //   1. Model prob drops (forecast shifted against us) → thesis dead → EXIT
  //   2. Market price rises (market agrees with us) → we're winning → HOLD
  // Using entry price isolates case 1: "does the model still justify what we paid?"
  const entryPrice = trade.entryPrice;
  const entryEdge = trade.signal?.edge || 0;
  const entryModelProb = trade.signal?.modelProb || 0;
  const entryEdgePct = entryPrice > 0 ? (entryEdge / entryPrice) * 100 : 0;

  // Current edge = current model prob minus what we paid
  const currentEdge = calibratedProb - entryPrice;
  const currentEdgePct = entryPrice > 0 ? (currentEdge / entryPrice) * 100 : 0;

  console.log(`${tag} | Entry: model=${(entryModelProb*100).toFixed(1)}% paid=${(entryPrice*100).toFixed(1)}¢ edge=${entryEdgePct.toFixed(1)}% | Now: model=${(calibratedProb*100).toFixed(1)}% edge=${currentEdgePct.toFixed(1)}% | Forecast: ${dateForecast.mean.toFixed(1)}° ±${dateForecast.sd.toFixed(1)}°`);

  // Decision: exit if model no longer justifies what we paid
  if (currentEdgePct < tc.exitEdgeThreshold) {
    const reason = currentEdge < 0
      ? `Thesis REVERSED: model ${(calibratedProb*100).toFixed(1)}% < entry ${(entryPrice*100).toFixed(1)}¢ (edge ${currentEdgePct.toFixed(1)}%)`
      : `Thesis DEAD: edge dropped to ${currentEdgePct.toFixed(1)}% (threshold: ${tc.exitEdgeThreshold}%)`;

    console.log(`${tag} ❌ ${reason}`);

    return {
      action: 'thesis-exit',
      trade,
      reason,
      currentEdgePct,
      entryEdgePct,
      currentModelProb: calibratedProb,
      entryModelProb,
      forecastMean: dateForecast.mean,
      forecastSD: dateForecast.sd,
      currentPrice: trade.currentPrice || entryPrice,
      logOnly: tc.logOnly,
    };
  }

  return null;
}

/**
 * Execute a thesis-based exit.
 */
async function executeThesisExit(signal) {
  const { trade, reason, currentPrice, logOnly } = signal;
  const tag = `[thesis] ${trade.city} ${trade.bucket} ${trade.side}`;

  if (logOnly) {
    console.log(`${tag} 📋 LOG-ONLY: Would exit — ${reason}`);
    return { action: 'thesis-exit-logged', ...signal };
  }

  // Fetch live price for the exit
  let exitPrice = currentPrice;
  try {
    const livePrice = await polymarket.getMidpointPrice(trade.tokenId);
    if (livePrice) exitPrice = livePrice;
  } catch (err) {
    console.warn(`${tag} ⚠️ Live price fetch failed, using tracked price: ${err.message}`);
  }

  // Real trading: sell real shares if applicable
  const realCfg = config.realTrading || {};
  const realRemaining = trade.realSize || 0;
  if (realCfg.enabled && trade.realTrading && trade.tokenId && realRemaining > 0) {
    try {
      const sellSize = Math.max(5, realRemaining); // CLOB min is 5
      if (realRemaining >= 5) {
        const realResult = await polymarket.realOrder({
          tokenId: trade.tokenId,
          side: 'SELL',
          price: exitPrice,
          size: sellSize > realRemaining ? realRemaining : sellSize,
        });
        console.log(`${tag} 💵 REAL SELL (thesis exit) | ${realRemaining} shares @ ~${exitPrice}`);
        store.update(trade.id, { realSize: 0 });
      } else {
        console.warn(`${tag} ⚠️ Cannot sell ${realRemaining} real shares (below CLOB min 5) — will resolve at expiry`);
      }
    } catch (realErr) {
      console.error(`${tag} ⚠️ REAL SELL FAILED (paper exit continues): ${realErr.message}`);
    }
  }

  // Paper exit
  const priorScalpPnl = (trade.scalps || []).reduce((s, sc) => s + (sc.pnlUSDC || 0), 0);
  const remainingPnl = (exitPrice - trade.entryPrice) * trade.size;
  const finalPnl = parseFloat((remainingPnl + priorScalpPnl).toFixed(4));
  const result = finalPnl >= 0 ? 'win' : 'loss';

  store.transition(trade.id, 'resolved', {
    result,
    pnlUSDC: finalPnl,
    resolutionPrice: exitPrice,
    resolutionSource: 'manual-exit',
    resolvedAt: new Date().toISOString(),
    notes: (trade.notes || '') + ` | THESIS EXIT: ${reason}`,
  });
  store.transition(trade.id, 'closed');

  console.log(`${tag} 🌪️ THESIS EXIT | P&L: $${finalPnl.toFixed(2)} | ${reason}`);
  return {
    action: 'thesis-exit',
    city: trade.city,
    bucket: trade.bucket,
    side: trade.side,
    pnlUSDC: finalPnl,
    exitPrice,
    reason,
    currentEdgePct: signal.currentEdgePct,
    entryEdgePct: signal.entryEdgePct,
  };
}

/**
 * Run thesis check on all open positions.
 * 
 * @param {Object} forecasts - Fresh forecast data from the scanner 
 *                             (keyed by city name, then by date)
 * @returns {Object} - { checked, exits, skipped, errors }
 */
async function checkAllPositions(forecasts) {
  const tc = getConfig();
  if (!tc.enabled) {
    console.log('[thesis] Thesis check disabled in config');
    return { checked: 0, exits: [], skipped: 0, errors: [] };
  }

  const openTrades = store.getOpenPositions();
  console.log(`[thesis] Checking ${openTrades.length} open positions against fresh forecasts...`);

  const results = { checked: openTrades.length, exits: [], skipped: 0, errors: [] };

  for (const trade of openTrades) {
    try {
      const signal = evaluatePosition(trade, forecasts);
      if (!signal) {
        results.skipped++;
        continue;
      }
      const exitResult = await executeThesisExit(signal);
      results.exits.push(exitResult);
    } catch (err) {
      console.error(`[thesis] Error checking ${trade.id}: ${err.message}`);
      results.errors.push({ id: trade.id, error: err.message });
    }
  }

  console.log(`[thesis] Done: ${results.exits.length} thesis exits, ${results.skipped} held, ${results.errors.length} errors`);
  return results;
}

module.exports = { evaluatePosition, executeThesisExit, checkAllPositions, getConfig };
