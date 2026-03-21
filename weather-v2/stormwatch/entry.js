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

  // FIX 6 (2026-03-14): Reject expired or near-expiry markets
  // The bug: scanner entered a March 13 market at 03:13 UTC on March 14.
  // Market resolved 50 mins later → guaranteed loss.
  if (signal.date) {
    const now = Date.now();
    // Look up city timezone, default to UTC if unknown
    const cityConfig = (config.cities || []).find(c => c.name === signal.city);
    const tz = cityConfig?.tz || 'UTC';

    // Get current time in the city's local timezone
    const localDateStr = new Date(now).toLocaleDateString('en-CA', { timeZone: tz }); // YYYY-MM-DD
    const localHour = parseInt(new Date(now).toLocaleString('en-US', { timeZone: tz, hour: 'numeric', hour12: false }));

    if (signal.date < localDateStr) {
      // Market date already passed in local time → definitely expired
      return { entered: false, trade: null, reason: `Market expired: ${signal.date} is past (local: ${localDateStr} ${tz})` };
    }
    if (signal.date === localDateStr && localHour >= 22) {
      // Same day but within 2h of midnight local → too close to resolution
      return { entered: false, trade: null, reason: `Too close to expiry: ${localHour}:00 local (${tz}), market date ${signal.date}` };
    }
  }

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

  // FIX 13: Enforce maxOpenPositions (was never checked)
  if (config.risk.maxOpenPositions) {
    const totalOpen = store.getOpenPositions().length;
    if (totalOpen >= config.risk.maxOpenPositions) {
      return { entered: false, trade: null, reason: `Max open positions reached: ${totalOpen}/${config.risk.maxOpenPositions}` };
    }
  }

  // CRITICAL: Per-city trade limit
  if (config.risk.maxTradesPerCity) {
    const openInCity = store.getOpenPositions().filter(t => t.city === signal.city);
    if (openInCity.length >= config.risk.maxTradesPerCity) {
      return { entered: false, trade: null, reason: `City limit: ${openInCity.length}/${config.risk.maxTradesPerCity} open in ${signal.city}` };
    }
  }

  // Edge check (using calibrated probability)
  const edge = signal.modelProb - currentPrice;
  const edgePct = (edge / currentPrice) * 100;
  const rawProb = signal.rawModelProb || signal.modelProb;

  // High-confidence bypass: raw >= 85% AND market <= 80c → skip edge % check
  // Historical: 52 trades at raw 85%+, 76.9% WR, +$129 in V3 universe
  // At 65-80c entry: 87% WR. Above 80c: 0% WR → cap bypass at 80c.
  // Bypass edge check for high-confidence trades, but still require ≥3% edge minimum
  // Without this floor: enters negative-edge trades where model agrees with market
  const highConfBypass = rawProb >= 0.85 && currentPrice <= 0.80 && edgePct >= 3;
  if (!highConfBypass && edgePct < config.risk.minEdgePct) {
    return { entered: false, trade: null, reason: `Insufficient edge: ${edgePct.toFixed(1)}% (min: ${config.risk.minEdgePct}%)` };
  }

  // Lottery trade classification
  const lotteryConfig = config.risk.lottery || { enabled: false };
  const probRatio = signal.modelProb / currentPrice;
  const minProbRatio = lotteryConfig.minProbRatio || 1.35;
  const lotteryMinProb = lotteryConfig.minModelProb || 0.06;
  
  const isLottery = lotteryConfig.enabled && 
                    currentPrice < (lotteryConfig.maxEntryPrice || 0.15) && 
                    signal.modelProb >= lotteryMinProb &&
                    probRatio >= minProbRatio;

  // FIX 3 (2026-03-14): Normal YES trades are banned (5W/15L = -$74)
  // YES is only allowed for lottery trades (4W lottery YES = +$346)
  const sideRestriction = config.risk.normalSideRestriction || null;
  if (!isLottery && sideRestriction && signal.side !== sideRestriction) {
    return { entered: false, trade: null, reason: `Side restriction: normal trades must be ${sideRestriction} (got ${signal.side})` };
  }

  // FIX 2 (2026-03-14): Minimum entry price for normal trades
  // 20-40c bracket: 4W/16L = -$88. Death zone.
  const minEntryPrice = config.risk.minEntryPrice || 0;
  if (!isLottery && currentPrice < minEntryPrice) {
    return { entered: false, trade: null, reason: `Entry price too low: ${(currentPrice*100).toFixed(1)}c (min: ${(minEntryPrice*100).toFixed(0)}c for normal trades)` };
  }

  // Sanity check: reject extreme edges (>250%) for NON-lottery trades
  if (!isLottery && edgePct > 250) {
    return { entered: false, trade: null, reason: `Edge suspiciously high: ${edgePct.toFixed(0)}% — model likely miscalibrated` };
  }

  // V4 FIX: Block normal trades with calibrated prob < 65%
  // Data: 40-60% calibrated = 3W/13L (-$126). 60-65% calibrated = ~break-even.
  // Real edge only exists at 65%+ calibrated (70.5% WR, +$235 on 88 trades).
  // Lottery trades exempt — they have low cal probs by design (different strategy).
  if (!isLottery) {
    const calProb = signal.modelProb;
    const minCalibratedProb = config.risk.minCalibratedProb || 0.65;
    if (!isNaN(calProb) && calProb < minCalibratedProb) {
      return { entered: false, trade: null, reason: `Calibrated prob too low: ${(calProb*100).toFixed(1)}% (min: ${(minCalibratedProb*100).toFixed(0)}%)` };
    }
  }

  if (isLottery) {
    // V3: Same-day-only lottery — 1-day-out lottery was 8W/25L (-$31), same-day was 2W/22L (+$259)
    if (lotteryConfig.sameDayOnly && signal.date) {
      const cityConfig = (config.cities || []).find(c => c.name === signal.city);
      const tz = cityConfig?.tz || 'UTC';
      const localDateStr = new Date().toLocaleDateString('en-CA', { timeZone: tz });
      if (signal.date !== localDateStr) {
        return { entered: false, trade: null, reason: `Lottery same-day only: market ${signal.date} != local today ${localDateStr}` };
      }
    }

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
    // FIX 1 (2026-03-14): Raised min raw model prob to 80%
    // Below 80%: model is a coin flip (50%) or anti-informative (28%)
    // Above 80%: model hits 70.4% actual accuracy
    const minModelProb = config.risk.minModelProb || 0.80;
    const probToCheck = signal.rawModelProb || signal.modelProb;
    if (probToCheck < minModelProb) {
      return { entered: false, trade: null, reason: `Low model confidence: ${(probToCheck*100).toFixed(1)}% raw (<${(minModelProb*100).toFixed(0)}%)` };
    }
  }

  // Use ?? instead of || to allow 0 as a valid value
  const minDist = config.risk.minDistanceFromLine ?? 2;
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
  } else if (currentPrice >= 0.55 && currentPrice < 0.65) {
    // 55-65c bracket: 64% WR but EV $0.17/trade — half size to limit exposure
    sizeUSDC = Math.min(sizeUSDC, config.risk.defaultSizeUSDC * 0.5);
    console.log(`${tag} ⚖️ Half-size (55-65c bracket: thin EV)`);
  }

  const size = Math.max(1, Math.floor(sizeUSDC / currentPrice));

  // Create candidate
  let candidateTrade;
  try {
    const signalData = {
      forecastTemp: signal.forecastTemp,
      // FIX 5 (2026-03-14): Fixed multi-source detection
      // signal.forecastModels = number of Open-Meteo models
      // signal.forecastSources = count of independent API sources (open-meteo, noaa, visualcrossing, weatherapi)
      forecastSource: (signal.forecastSources || 0) > 1 ? 'multi-source' : 'open-meteo',
      sources: signal.forecastSources || 1,
      sourceDetails: signal.forecastWeights || null,
      forecastSD: signal.forecastSD || signal.sd || null,
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
