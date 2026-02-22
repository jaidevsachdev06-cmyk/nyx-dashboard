/**
 * stormwatch/entry.js — Entry Pipeline with Guardrails
 * 
 * Takes scanner candidates and enters valid trades.
 */

const { createCandidate } = require('../core/schema');
const lifecycle = require('../core/lifecycle');
const polymarket = require('../core/polymarket');
const config = require('../config.json');

async function processCandidate(signal) {
  const tag = `[entry] ${signal.city} ${signal.date} ${signal.bucket} ${signal.side}`;
  console.log(`${tag} — Processing candidate...`);

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

  // Size the position — Kelly with multiplier
  const kellyFraction = Math.max(0, Math.min(config.risk.kellyMultiplier, edge / (1 - currentPrice)));
  const maxSize = config.risk.maxPositionSizeUSDC;
  let sizeUSDC = kellyFraction * maxSize;
  if (sizeUSDC < 5) sizeUSDC = config.risk.defaultSizeUSDC;
  sizeUSDC = Math.min(sizeUSDC, maxSize);
  const size = Math.max(1, Math.floor(sizeUSDC / currentPrice));

  // Create candidate
  let candidateTrade;
  try {
    const signalData = {
      forecastTemp: signal.forecastTemp,
      forecastSource: 'open-meteo',
      impliedProb: currentPrice,
      modelProb: signal.modelProb,
      edge: parseFloat(edge.toFixed(4))
    };

    // Human-readable reasoning summary
    const notes = `Forecast: ${signal.forecastTemp.toFixed(1)}°F | Model: ${(signal.modelProb * 100).toFixed(0)}% vs Market: ${(currentPrice * 100).toFixed(0)}% | Edge: ${edgePct.toFixed(1)}%`;

    candidateTrade = createCandidate({
      conditionId: signal.conditionId,
      tokenId: signal.tokenId,
      tokenSide: signal.tokenSide || signal.side, // which side the tokenId belongs to
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
    console.log(`${tag} ✅ ENTERED | ${size} shares @ ${currentPrice} | edge: ${edgePct.toFixed(1)}%`);
    return { entered: true, trade, reason: null };
  } catch (err) {
    console.error(`${tag} ❌ Entry failed: ${err.message}`);
    return { entered: false, trade: null, reason: `Entry failed: ${err.message}` };
  }
}

module.exports = { processCandidate };
