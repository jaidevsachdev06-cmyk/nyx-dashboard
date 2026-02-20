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
  if (openPositions.length >= config.risk.maxOpenPositions) {
    throw new Error(`Risk limit: max ${config.risk.maxOpenPositions} open positions (currently ${openPositions.length})`);
  }

  const sizeUSDC = price * size;
  if (sizeUSDC > config.risk.maxPositionSizeUSDC) {
    throw new Error(`Risk limit: position size $${sizeUSDC.toFixed(2)} exceeds max $${config.risk.maxPositionSizeUSDC}`);
  }

  const cityExposure = openPositions
    .filter(t => t.city === trade.city)
    .reduce((sum, t) => sum + (t.sizeUSDC || 0), 0);
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
    console.log(`[lifecycle] ${tradeId} — market not yet resolved`);
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
