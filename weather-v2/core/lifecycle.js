/**
 * core/lifecycle.js — Trade Lifecycle Manager
 * 
 * candidate → entered → open → resolved → closed
 */

const store = require('./store');
const polymarket = require('./polymarket');
const config = require('../config.json');

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
  const sameCityDate = openPositions.filter(t => t.city === trade.city && t.date === trade.date);
  if (sameCityDate.length > 0) {
    throw new Error(`Risk limit: "${trade.city}" ${trade.date} already has a position (${sameCityDate[0].bucket} ${sameCityDate[0].side}). Same city+date = 1 position only.`);
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

    const updated = store.transition(tradeId, 'open', {
      orderId: orderResult.orderID || orderResult.id,
      txHash: null
    });

    console.log(`[lifecycle] Trade ${tradeId} is now OPEN | ${trade.city} ${trade.side} @ ${price}`);
    return updated;
  } catch (err) {
    console.error(`[lifecycle] Order failed for ${tradeId}: ${err.message}`);
    store.transition(tradeId, 'closed', { result: 'push', pnlUSDC: 0, closedAt: new Date().toISOString() });
    throw new Error(`Order placement failed: ${err.message}`);
  }
}

async function checkAndResolve(tradeId) {
  const trade = store.getById(tradeId);
  if (trade.status !== 'open') return null;

  const resolution = await polymarket.checkResolution(trade.conditionId);
  if (!resolution.resolved) {
    // Fallback: if date is >24h past and price is near 0 or 1, infer resolution from price
    const tradeDateEnd = trade.date ? new Date(trade.date + 'T23:59:59Z') : null;
    const hoursPast = tradeDateEnd ? (Date.now() - tradeDateEnd.getTime()) / 3600000 : 0;
    const price = trade.currentPrice;

    if (hoursPast > 24 && price != null) {
      const side = (trade.side || 'YES').toUpperCase();
      let inferredResult = null;
      if (side === 'YES' && price > 0.95) inferredResult = 'win';
      else if (side === 'YES' && price < 0.03) inferredResult = 'loss';
      else if (side === 'NO' && price > 0.95) inferredResult = 'win';
      else if (side === 'NO' && price < 0.03) inferredResult = 'loss';

      if (inferredResult) {
        const sizeUSDC = trade.sizeUSDC || 0;
        const pnlUSDC = inferredResult === 'win'
          ? Math.round(sizeUSDC / price * (1 - price) * 100) / 100
          : -Math.round(sizeUSDC * 100) / 100;
        console.log(`[lifecycle] ${tradeId} — PRICE-INFERRED ${inferredResult} (price ${price}, ${hoursPast.toFixed(0)}h past date)`);
        store.transition(tradeId, 'resolved', {
          result: inferredResult, pnlUSDC,
          resolutionPrice: price, resolutionSource: 'price-inferred',
          resolvedAt: new Date().toISOString()
        });
        return store.transition(tradeId, 'closed');
      }
    }

    if (hoursPast > 0) console.log(`[lifecycle] ${tradeId} — market not yet resolved (${hoursPast.toFixed(0)}h past date)`);
    else console.log(`[lifecycle] ${tradeId} — market not yet resolved`);
    return null;
  }

  const pnl = polymarket.computePnL(trade, resolution);

  const resolved = store.transition(tradeId, 'resolved', {
    result: pnl.result,
    pnlUSDC: pnl.pnlUSDC,
    resolutionPrice: pnl.resolutionPrice,
    resolutionSource: 'polymarket',
    resolvedAt: new Date().toISOString()
  });

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
