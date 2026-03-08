/**
 * stormwatch/entry.js — Entry Pipeline with Guardrails
 * 
 * Takes scanner candidates and enters valid trades.
 */

const { createCandidate } = require('../core/schema');
const lifecycle = require('../core/lifecycle');
const polymarket = require('../core/polymarket');
const config = require('../config.json');
const circuitBreaker = require("../core/circuit-breaker");
const store = require('../core/store');

async function processCandidate(signal) {
  const tag = `[entry] ${signal.city} ${signal.date} ${signal.bucket} ${signal.side}`;
  console.log(`${tag} — Processing candidate...`);

  // Circuit breaker check
  if (circuitBreaker.isTripped()) {
    return { entered: false, trade: null, reason: "Circuit breaker tripped — trading paused after 3 consecutive losses" };
  }

  // Validate conditionId
  if (!signal.conditionId || !signal.conditionId.match(/^0x[a-fA-F0-9]{64}$/)) {
    return { entered: false, trade: null, reason: `Invalid conditionId: ${signal.conditionId}` };
  }

  if (!signal.tokenId) {
    return { entered: false, trade: null, reason: 'Missing tokenId' };
  }

  // Get current price
  let currentPrice = signal.marketPrice;
  if (!currentPrice) {
    try {
      currentPrice = await polymarket.getMidpointPrice(signal.tokenId);
    } catch (err) {
      return { entered: false, trade: null, reason: `Price fetch failed: ${err.message}` };
    }
  }

  if (!currentPrice || currentPrice <= 0 || currentPrice >= 1) {
    return { entered: false, trade: null, reason: `Invalid price: ${currentPrice}` };
  }

  // Edge check
  const edge = signal.modelProb - currentPrice;
  const edgePct = (edge / currentPrice) * 100;
  if (edgePct < config.risk.minEdgePct) {
    return { entered: false, trade: null, reason: `Insufficient edge: ${edgePct.toFixed(1)}% (min: ${config.risk.minEdgePct}%)` };
  }

  // Lottery trade classification — probability-ratio approach
  // Instead of edge %, we check: cheap price + model thinks there's a real chance + model meaningfully disagrees with market
  // Lottery trade detection
  const lotteryConfig = config.risk.lottery || { enabled: false };
  const probRatio = signal.modelProb / currentPrice;  // How much does model disagree with market?
  const isLottery = lotteryConfig.enabled && 
                    currentPrice < (lotteryConfig.maxEntryPrice || 0.15) && 
                    edgePct >= (lotteryConfig.minEdgePct || 25) &&
                    signal.modelProb >= 0.05;

  // Sanity check: reject extreme edges (>250%) for NON-lottery trades
  // When model and market disagree this much, market is usually right
  // Feb 28-Mar 2: Toronto NO 7°C (263% edge) and Chicago NO 64-65°F (276% edge) both lost ~$12
  if (!isLottery && edgePct > 250) {
    return { entered: false, trade: null, reason: `Edge suspiciously high: ${edgePct.toFixed(0)}% — model likely miscalibrated` };
  }

  if (isLottery) {
    // Count lottery trades entered today
    const today = new Date().toISOString().slice(0, 10);
    const allTrades = { trades: store.getAll() };
    const lotteryToday = allTrades.trades.filter(t => 
      t.enteredAt && new Date(t.enteredAt).toISOString().slice(0, 10) === today &&
      t.entryPrice && t.entryPrice < (lotteryConfig.maxEntryPrice || 0.15)
    );

    const maxDaily = lotteryConfig.maxDailyTrades || 3;
    if (lotteryToday.length >= maxDaily) {
      return { entered: false, trade: null, reason: `Lottery quota reached: ${lotteryToday.length}/${maxDaily} today` };
    }

    console.log(`${tag} 🎰 LOTTERY TRADE (${lotteryToday.length + 1}/${maxDaily} today) | modelProb: ${(signal.modelProb*100).toFixed(1)}% | price: ${(currentPrice*100).toFixed(1)}¢ | edge: ${edgePct.toFixed(0)}%`);
  } else {
    // Normal trade: apply confidence gates
    const minModelProb = config.risk.minModelProb || 0.6;
    if (signal.modelProb < minModelProb) {
      return { entered: false, trade: null, reason: `Low model confidence: ${(signal.modelProb*100).toFixed(1)}% (<${(minModelProb*100).toFixed(0)}%)` };
    }
  }

  const minDist = config.risk.minDistanceFromLine || 2;
  if (signal.distFromLine != null && signal.distFromLine < minDist) {
    return { entered: false, trade: null, reason: `Too close to line: ${signal.distFromLine.toFixed(2)} (<${minDist})` };
  }

  // Size the position — Kelly with multiplier
  const kellyFraction = Math.max(0, Math.min(config.risk.kellyMultiplier, edge / (1 - currentPrice)));
  const maxSize = config.risk.maxPositionSizeUSDC;
  let sizeUSDC = kellyFraction * maxSize;
  if (sizeUSDC < 5) sizeUSDC = config.risk.defaultSizeUSDC;
  sizeUSDC = Math.min(sizeUSDC, maxSize);

  // Lottery sizing: cap per config (default $2)
  if (isLottery) {
    sizeUSDC = Math.min(sizeUSDC, lotteryConfig.maxSizeUSDC || 2);
  } else if (currentPrice < 0.20) {
    // Regular cheap bets get half size
    sizeUSDC = Math.min(sizeUSDC, maxSize * 0.5);
  }

  const size = Math.max(1, Math.floor(sizeUSDC / currentPrice));

  // Create candidate
  let candidateTrade;
  try {
    const signalData = {
      forecastTemp: signal.forecastTemp,
      forecastSource: 'open-meteo',
      impliedProb: currentPrice,
      modelProb: signal.modelProb,
      edge: parseFloat(edge.toFixed(4)),
      isLottery: isLottery
    };

    // Human-readable reasoning summary
    const lotteryTag = isLottery ? ' 🎰LOTTERY' : '';
    const notes = `Forecast: ${signal.forecastTemp.toFixed(1)}°F | Model: ${(signal.modelProb * 100).toFixed(0)}% vs Market: ${(currentPrice * 100).toFixed(0)}% | Edge: ${edgePct.toFixed(1)}%${lotteryTag}`;

    candidateTrade = createCandidate({
      conditionId: signal.conditionId,
      tokenId: signal.tokenId,
      tokenSide: signal.tokenSide || signal.side,
      marketSlug: signal.marketSlug || '',
      city: signal.city,
      date: signal.date,
      bucket: signal.bucket,
      question: signal.question || `${signal.city} temp ${signal.date} ${signal.bucket}`,
      side: signal.side,
      signal: signalData,
      notes: notes
    });
  } catch (err) {
    return { entered: false, trade: null, reason: `Schema validation failed: ${err.message}` };
  }

  // Register and enter
  try {
    await lifecycle.registerCandidate(candidateTrade);
    const trade = await lifecycle.enterTrade(candidateTrade.id, { price: currentPrice, size });
    const emoji = isLottery ? '🎰' : '✅';
    console.log(`${tag} ${emoji} ENTERED | ${size} shares @ ${currentPrice} | edge: ${edgePct.toFixed(1)}%`);
    return { entered: true, trade, reason: null };
  } catch (err) {
    console.error(`${tag} ❌ Entry failed: ${err.message}`);
    return { entered: false, trade: null, reason: `Entry failed: ${err.message}` };
  }
}

module.exports = { processCandidate };
