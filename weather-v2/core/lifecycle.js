/**
 * core/lifecycle.js — Trade Lifecycle Manager
 * 
 * candidate → entered → open → resolved → closed
 */

const store = require('./store');
const polymarket = require('./polymarket');
const circuitBreaker = require("./circuit-breaker");
const config = require('../config.json');

/**
 * V3: Fetch actual observed high temperature for a resolved trade.
 * Uses Open-Meteo historical weather API (free, no key needed).
 * Returns temperature in the city's configured unit, or null on failure.
 */
async function fetchActualTemp(trade) {
  if (!trade.city || !trade.date) return null;
  
  const cityConfig = (config.cities || []).find(c => c.name === trade.city);
  if (!cityConfig) return null;
  
  const unit = cityConfig.unit || 'F';
  const params = new URLSearchParams({
    latitude: cityConfig.lat.toString(),
    longitude: cityConfig.lon.toString(),
    start_date: trade.date,
    end_date: trade.date,
    daily: 'temperature_2m_max',
    temperature_unit: unit === 'F' ? 'fahrenheit' : 'celsius'
  });
  
  const ctrl = new AbortController();
  const timeout = setTimeout(() => ctrl.abort(), 8000);
  try {
    const res = await fetch(`https://archive-api.open-meteo.com/v1/archive?${params}`, { signal: ctrl.signal });
    clearTimeout(timeout);
    if (!res.ok) return null;
    const data = await res.json();
    const temps = data?.daily?.temperature_2m_max;
    if (temps && temps.length > 0 && temps[0] != null) {
      return parseFloat(temps[0].toFixed(1));
    }
  } catch (err) {
    clearTimeout(timeout);
    console.warn(`[lifecycle] Archive API error: ${err.message}`);
  }
  return null;
}

async function registerCandidate(candidateTrade) {
  console.log(`[lifecycle] Registering candidate: ${candidateTrade.city} ${candidateTrade.date} ${candidateTrade.bucket} ${candidateTrade.side}`);

  // Skip Dome re-validation if conditionId is well-formed (scanner already sourced it from Dome)
  if (candidateTrade.conditionId?.match(/^0x[a-fA-F0-9]{64}$/) && candidateTrade.tokenId) {
    console.log(`[lifecycle] conditionId format valid, skipping re-validation (scanner-sourced)`);
  } else {
    const validation = await polymarket.validateConditionId(candidateTrade.conditionId);
    if (!validation.valid) {
      console.error(`[lifecycle] REJECTED candidate — conditionId validation failed: ${validation.error}`);
      throw new Error(`Candidate rejected: ${validation.error}`);
    }
    console.log(`[lifecycle] conditionId confirmed on Polymarket: ${validation.market.question || validation.market.title || candidateTrade.conditionId}`);
  }
  const trade = store.add(candidateTrade);
  return trade;
}

async function enterTrade(tradeId, { price, size }) {
  const trade = store.getById(tradeId);

  const openPositions = store.getOpenPositions();
  const sizeUSDC = price * size;
  if (sizeUSDC > config.risk.maxPositionSizeUSDC) {
    throw new Error(`Risk limit: position size $${sizeUSDC.toFixed(2)} exceeds max $${config.risk.maxPositionSizeUSDC}`);
  }

  // E027: Same city + same date = 1 position only (correlated bet protection)
  // OPTIMIZATION: allow automatic SWAP when a strictly better candidate appears.
  const sameCityDate = openPositions.filter(t => t.city === trade.city && t.date === trade.date);
  if (sameCityDate.length > 0) {
    const existing = sameCityDate[0];

    // If it's literally the same condition, it's a duplicate.
    if (existing.conditionId === trade.conditionId) {
      throw new Error(`Duplicate: already open for conditionId ${trade.conditionId}`);
    }

    const swapCfg = (config.risk && config.risk.swap) || {};
    if (!swapCfg.enabled) {
      throw new Error(`Risk limit: "${trade.city}" ${trade.date} already has a position (${existing.bucket} ${existing.side}). Same city+date = 1 position only.`);
    }

    // Compute edge (percentage points) using stored signal if available
    const newEdgePP = (trade.signal && trade.signal.modelProb != null && trade.signal.impliedProb != null)
      ? (trade.signal.modelProb - trade.signal.impliedProb)
      : null;
    const oldEdgePP = (existing.signal && existing.signal.modelProb != null && existing.signal.impliedProb != null)
      ? (existing.signal.modelProb - existing.signal.impliedProb)
      : null;

    const minImprovePP = (swapCfg.minEdgePPImprove != null ? swapCfg.minEdgePPImprove : 10) / 100; // 10pp -> 0.10

    // Minimum holding time (avoid churn)
    const minHoldMin = swapCfg.minHoldMinutes != null ? swapCfg.minHoldMinutes : 30;
    const heldMin = existing.enteredAt ? (Date.now() - new Date(existing.enteredAt).getTime()) / 60000 : 1e9;

    const canSwap = (heldMin >= minHoldMin) && (newEdgePP != null) && (oldEdgePP != null) && ((newEdgePP - oldEdgePP) >= minImprovePP);

    if (!canSwap) {
      throw new Error(`Risk limit: city+date already open; swap criteria not met (held ${heldMin.toFixed(0)}m, ΔedgePP ${(newEdgePP!=null&&oldEdgePP!=null)?((newEdgePP-oldEdgePP)*100).toFixed(1):'n/a'}pp)`);
    }

    // Execute SWAP: close existing at current midpoint price (paper exit), then proceed.
    let exitPrice = null;
    try {
      exitPrice = await polymarket.getMidpointPrice(existing.tokenId);
    } catch (e) {
      exitPrice = existing.currentPrice ?? existing.entryPrice ?? null;
    }
    if (exitPrice == null) {
      throw new Error('Swap failed: could not determine exitPrice for existing position');
    }

    const oldEntry = existing.entryPrice ?? 0;
    const oldSize = existing.size ?? 0;
    const pnlUSDC = parseFloat(((exitPrice - oldEntry) * oldSize).toFixed(4));

    // Sell real shares before swap-closing (C3 fix: prevent orphaned real shares)
    const realCfg = config.realTrading || {};
    if (realCfg.enabled && existing.realTrading && existing.realSize > 0) {
      try {
        const sellPrice = Math.round(exitPrice * 100) / 100;
        if (sellPrice >= 0.01 && sellPrice <= 0.99) {
          await polymarket.realOrder({
            tokenId: existing.tokenId,
            side: 'SELL',
            price: sellPrice,
            size: existing.realSize
          });
          console.log(`[lifecycle] 🔴 REAL SELL on swap-out | ${existing.city} | ${existing.realSize} shares @ ${sellPrice}`);
        }
      } catch (swapSellErr) {
        console.error(`[lifecycle] ⚠️ SWAP REAL SELL FAILED — aborting swap to prevent orphaned shares: ${swapSellErr.message}`);
        throw new Error(`Swap aborted: could not sell real shares of old position: ${swapSellErr.message}`);
      }
    }

    store.transition(existing.id, 'exited', {
      exitPrice,
      exitSource: 'swap',
      exitReason: `SWAP: replaced by better edge candidate (ΔedgePP ${((newEdgePP-oldEdgePP)*100).toFixed(1)}pp)`,
      pnlUSDC,
      result: pnlUSDC >= 0 ? 'win' : 'loss',
      notes: (existing.notes ? existing.notes + ' | ' : '') + `SWAP: replaced by better edge candidate (ΔedgePP ${((newEdgePP-oldEdgePP)*100).toFixed(1)}pp)`
    });
    // FIX 10: Immediately close exited trades so they appear in stats
    store.transition(existing.id, 'closed');
  }

  // Compute exposure for this city across all open positions
  const cityPositions = openPositions.filter(t => t.city === trade.city);
  const cityExposure = cityPositions.reduce((sum, t) => sum + (t.sizeUSDC || 0), 0);
  if (cityExposure + sizeUSDC > config.risk.maxExposurePerCity) {
    throw new Error(`Risk limit: city "${trade.city}" exposure exceeds max $${config.risk.maxExposurePerCity}`);
  }

  const today = new Date().toISOString().split('T')[0];
  const todayLosses = store.getAll({ status: 'closed' })
    .filter(t => t.closedAt?.startsWith(today) && t.pnlUSDC < 0)
    .reduce((sum, t) => sum + Math.abs(t.pnlUSDC), 0);
  if (todayLosses >= config.risk.maxDailyLossUSDC) {
    throw new Error(`Risk limit: daily loss $${todayLosses.toFixed(2)} at max $${config.risk.maxDailyLossUSDC}`);
  }

  store.transition(tradeId, 'entered', { entryPrice: price, size, sizeUSDC });

  try {
    const orderResult = await polymarket.paperOrder({
      tokenId: trade.tokenId,
      side: 'BUY',
      price,
      size
    });

    // Step 1: Confirm paper trade in store FIRST (before spending real money)
    const updated = store.transition(tradeId, 'open', {
      orderId: orderResult.orderID || orderResult.id,
      realTrading: false,
      realOrderId: null,
      realSize: null,
      realEntryPrice: null,
      txHash: null
    });

    console.log(`[lifecycle] Trade ${tradeId} is now OPEN | ${trade.city} ${trade.side} @ ${price} [PAPER]`);

    // Step 2: Real trading — mirror AFTER store is confirmed (no orphaned shares)
    const realCfg = config.realTrading || {};
    if (realCfg.enabled && realCfg.mirrorPaper) {
      // Daily real spend cap
      const maxDailyRealSpend = realCfg.maxDailySpendUSDC || 30;
      const today = new Date().toISOString().split('T')[0];
      const todayRealSpend = store.getAll()
        .filter(t => t.realTrading && t.enteredAt?.startsWith(today) && t.realEntryPrice && t.realSize)
        .reduce((sum, t) => sum + (t.realEntryPrice * t.realSize), 0);

      const isLottery = trade.signal?.isLottery || false;
      const maxRealUSDC = isLottery
        ? (realCfg.lotteryMaxSizeUSDC || 2)
        : (realCfg.maxSizeUSDC || 6);
      // V3 FIX: Size using ACTUAL order price (midpoint + 2 ticks for BUY), not midpoint
      // Without this, $4 lottery budget at 5¢ midpoint = 80 shares, but actual order at 7¢ = $5.60
      const adjustedPrice = Math.min(0.99, Math.round((price + 0.02) * 100) / 100);
      const realSize = Math.max(5, Math.floor(maxRealUSDC / adjustedPrice));
      const realCost = realSize * adjustedPrice;

      if (todayRealSpend + realCost > maxDailyRealSpend) {
        console.warn(`[lifecycle] Daily real spend limit hit: $${todayRealSpend.toFixed(2)} + $${realCost.toFixed(2)} > $${maxDailyRealSpend} — skipping real order`);
      } else {
        try {
          const realOrderResult = await polymarket.realOrder({
            tokenId: trade.tokenId,
            side: 'BUY',
            price,
            size: realSize
          });

          if (realOrderResult.filled === false) {
            // Order was placed but NOT filled (cancelled/expired/rejected)
            console.warn(`[lifecycle] ⚠️ REAL ORDER NOT FILLED | ${trade.city} ${trade.side} | status: ${realOrderResult.status} | paper trade continues without real position`);
            store.update(tradeId, {
              realTrading: false,
              realOrderId: realOrderResult.orderID,
              realFillStatus: realOrderResult.status || 'unfilled'
            });
          } else {
            // Filled or unverified — track the position
            const actualSize = realOrderResult.filledSize || realSize;
            const actualPrice = realOrderResult.filledAvgPrice || price;
            store.update(tradeId, {
              realTrading: true,
              realOrderId: realOrderResult.orderID,
              realSize: actualSize,
              realEntryPrice: actualPrice,
              realFillStatus: realOrderResult.filled ? 'filled' : 'unverified'
            });
            console.log(`[lifecycle] 🔴 REAL ORDER ${realOrderResult.filled ? 'FILLED' : 'UNVERIFIED'} | ${trade.city} ${trade.side} | ${actualSize} shares @ ${actualPrice} ($${(actualSize * actualPrice).toFixed(2)}) [REAL+PAPER]`);
          }
        } catch (realErr) {
          // Real order failure is non-fatal — paper trade is already safely stored
          console.error(`[lifecycle] ⚠️ REAL ORDER FAILED (paper trade continues): ${realErr.message}`);
        }
      }
    }

    return store.getById(tradeId); // return latest state
  } catch (err) {
    console.error(`[lifecycle] ❌ Order FAILED for ${tradeId}: ${err.message}`);
    console.error(`[lifecycle] ❌ Stack: ${err.stack?.slice(0, 300)}`);
    // Don't silently bury as "push" — leave as open so resolver can handle it,
    // or delete if it was never a real position
    try {
      store.transition(tradeId, 'closed', { result: 'push', pnlUSDC: 0, closedAt: new Date().toISOString(), failReason: err.message });
    } catch (e) { /* store may not have the trade */ }
    throw new Error(`Order placement failed: ${err.message}`);
  }
}

/**
 * Redeem real winning positions via CTF. Called from both normal and price-inferred resolution paths.
 */
async function redeemRealPosition(trade, tradeId, pnlResult) {
  const realCfg = config.realTrading || {};
  if (!realCfg.enabled || !trade.realTrading || pnlResult !== 'win') return;

  try {
    const { spawnSync } = require('child_process');
    const redeemResult = spawnSync('polymarket', [
      '-o', 'json', 'ctf', 'redeem',
      '--condition', trade.conditionId
    ], { timeout: 30000, encoding: 'utf8', killSignal: 'SIGKILL', env: { ...process.env, PATH: '/usr/local/bin:' + (process.env.PATH || '') } });

    if (redeemResult.status === 0) {
      console.log(`[lifecycle] ✅ REAL REDEEM successful for ${tradeId}: ${(redeemResult.stdout || '').slice(0, 200)}`);
    } else {
      console.warn(`[lifecycle] ⚠️ REAL REDEEM failed for ${tradeId}: ${(redeemResult.stderr || '').slice(0, 200)}`);
    }
  } catch (redeemErr) {
    console.warn(`[lifecycle] ⚠️ REAL REDEEM error for ${tradeId}: ${redeemErr.message}`);
  }
}

async function checkAndResolve(tradeId) {
  const trade = store.getById(tradeId);
  if (trade.status !== 'open') return null;

  const resolution = await polymarket.checkResolution(trade.conditionId, trade.tokenId, trade.tokenSide || trade.side);
  if (!resolution.resolved) {
    // Fallback: if oracle is slow, infer from price with tiered confidence thresholds:
    // - Very high confidence (>0.99 or <0.01): trigger at 6h past date
    // - High confidence   (>0.95 or <0.03): trigger at 24h past date
    const tradeDateEnd = trade.date ? new Date(trade.date + 'T23:59:59Z') : null;
    const hoursPast = tradeDateEnd ? (Date.now() - tradeDateEnd.getTime()) / 3600000 : 0;
    const price = trade.currentPrice;

    const veryHighConf = price != null && (price > 0.99 || price < 0.01);
    const highConf     = price != null && (price > 0.95 || price < 0.03);
    const shouldInfer  = (veryHighConf && hoursPast > 6) || (highConf && hoursPast > 24);

    if (shouldInfer) {
      const side = (trade.side || 'YES').toUpperCase();
      let inferredResult = null;
      if (side === 'YES' && price > 0.95) inferredResult = 'win';
      else if (side === 'YES' && price < 0.03) inferredResult = 'loss';
      else if (side === 'NO' && price > 0.95) inferredResult = 'win';
      else if (side === 'NO' && price < 0.03) inferredResult = 'loss';

      if (inferredResult) {
        // Use same formula as computePnL: (1.0 - entryPrice) * size for win, (-entryPrice * size) for loss
        const entryPrice = trade.entryPrice || 0;
        const size = trade.size || 0;
        const pnlUSDC = inferredResult === 'win'
          ? parseFloat(((1.0 - entryPrice) * size).toFixed(4))
          : parseFloat((-entryPrice * size).toFixed(4));
        console.log(`[lifecycle] ${tradeId} — PRICE-INFERRED ${inferredResult} (price ${price}, ${hoursPast.toFixed(0)}h past date)`);

        // C4 fix: redeem real winning positions even on price-inferred resolution
        await redeemRealPosition(trade, tradeId, inferredResult);

        // V3: Weather verification on price-inferred path too
        let actualTempPI = null;
        try {
          actualTempPI = await fetchActualTemp(trade);
        } catch (err) {
          console.warn(`[lifecycle] Actual temp fetch failed for ${tradeId}: ${err.message}`);
        }
        const verificationPI = {};
        if (actualTempPI != null && trade.signal?.forecastTemp != null) {
          verificationPI.actualTemp = actualTempPI;
          verificationPI.forecastError = parseFloat((actualTempPI - trade.signal.forecastTemp).toFixed(1));
          console.log(`[lifecycle] 📊 Verification: ${trade.city} ${trade.date} | forecast: ${trade.signal.forecastTemp}° actual: ${actualTempPI}° error: ${verificationPI.forecastError > 0 ? '+' : ''}${verificationPI.forecastError}°`);
        }

        store.transition(tradeId, 'resolved', {
          result: inferredResult, pnlUSDC,
          resolutionPrice: price, resolutionSource: 'price-inferred',
          resolvedAt: new Date().toISOString(),
          ...verificationPI
        });
        return store.transition(tradeId, 'closed');
      }
    }

    if (hoursPast > 0) console.log(`[lifecycle] ${tradeId} — market not yet resolved (${hoursPast.toFixed(0)}h past date)`);
    else console.log(`[lifecycle] ${tradeId} — market not yet resolved`);
    return null;
  }

  const pnl = polymarket.computePnL(trade, resolution);

  // Auto-redeem real positions on resolution
  await redeemRealPosition(trade, tradeId, pnl.result);

  // V3: Weather verification — record actual temp vs forecast for calibration tracking
  let actualTemp = null;
  try {
    actualTemp = await fetchActualTemp(trade);
  } catch (err) {
    console.warn(`[lifecycle] Actual temp fetch failed for ${tradeId}: ${err.message}`);
  }

  const verificationData = {};
  if (actualTemp != null && trade.signal?.forecastTemp != null) {
    verificationData.actualTemp = actualTemp;
    verificationData.forecastError = parseFloat((actualTemp - trade.signal.forecastTemp).toFixed(1));
    console.log(`[lifecycle] 📊 Verification: ${trade.city} ${trade.date} | forecast: ${trade.signal.forecastTemp}° actual: ${actualTemp}° error: ${verificationData.forecastError > 0 ? '+' : ''}${verificationData.forecastError}°`);
  }

  const resolved = store.transition(tradeId, 'resolved', {
    result: pnl.result,
    pnlUSDC: pnl.pnlUSDC,
    resolutionPrice: pnl.resolutionPrice,
    resolutionSource: 'polymarket',
    resolvedAt: new Date().toISOString(),
    ...verificationData
  });

  circuitBreaker.recordResult(pnl.result);
  console.log(`[lifecycle] Trade ${tradeId} RESOLVED: ${pnl.result} | P&L: $${pnl.pnlUSDC.toFixed(2)}`);
  const closed = store.transition(tradeId, 'closed');
  return closed;
}

async function resolveAll() {
  const openTrades = store.getOpenPositions();
  console.log(`[lifecycle] Checking resolution for ${openTrades.length} open trades...`);

  const results = { resolved: [], pending: [], errors: [] };

  for (const trade of openTrades) {
    try {
      const result = await checkAndResolve(trade.id);
      if (result) results.resolved.push(result);
      else results.pending.push(trade.id);
    } catch (err) {
      console.error(`[lifecycle] Error resolving ${trade.id}: ${err.message}`);
      results.errors.push({ id: trade.id, error: err.message });
    }
  }

  console.log(`[lifecycle] Resolution complete: ${results.resolved.length} resolved, ${results.pending.length} pending, ${results.errors.length} errors`);
  return results;
}

module.exports = { registerCandidate, enterTrade, checkAndResolve, resolveAll };
