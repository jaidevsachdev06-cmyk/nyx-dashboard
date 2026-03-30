/**
 * core/calibration-v3.js — Empirical Probability Model V3
 * 
 * REBUILT 2026-03-27 from:
 * - 7,486 resolved Polymarket markets (Jan-Mar 2026)
 * - 1,907 range-bucket evaluations (Open-Meteo baseline)
 * - 361 Visual Crossing observed verifications (MAE 0.56F vs Polymarket)
 * - Monte Carlo simulation of forecast-quality vs hit-rate curve
 * 
 * KEY INSIGHT: Forecast accuracy is EVERYTHING. The probability model is not
 * broken — the forecast feeding it was broken. Station-based forecasts 
 * (NOAA, VC) have 3-5x better resolution than Open-Meteo grid.
 * 
 * With station-quality forecasts (MAE ~2F):
 *   - Closest bucket hit rate: ~34%
 *   - At 25c market price: +34% edge
 * 
 * With grid-only forecasts (MAE ~3.5F):  
 *   - Closest bucket hit rate: ~25%
 *   - At 25c market price: breakeven
 */

// === SIMULATED HIT RATE TABLE ===
// Derived from Monte Carlo simulation: VC observed temps + Gaussian noise 
// at various MAE levels, checked against 361 actual Polymarket resolutions.
const HIT_RATE_BY_MAE = {
  5:  0.655,  // MAE 0.5F — near-perfect forecast
  10: 0.506,  // MAE 1.0F — excellent station forecast
  15: 0.400,  // MAE 1.5F — good station forecast
  20: 0.336,  // MAE 2.0F — target: NOAA/VC weighted
  25: 0.294,  // MAE 2.5F — decent multi-source
  30: 0.267,  // MAE 3.0F — current Open-Meteo observed
  35: 0.246,  // MAE 3.5F — current multi-source forecast
  40: 0.224,  // MAE 4.0F — poor forecast
  50: 0.204,  // MAE 5.0F — bad forecast
};

function hitRateByDistance(dist, forecastMAE) {
  const maeKey = Math.round(forecastMAE * 10);
  const closestHR = HIT_RATE_BY_MAE[maeKey] || HIT_RATE_BY_MAE[35];
  const decayRate = 0.5 / Math.max(forecastMAE, 0.5);
  const rate = closestHR * Math.exp(-decayRate * dist * dist);
  const floor = 0.01;
  return Math.max(rate, floor);
}

// === SOURCE RELIABILITY WEIGHTS ===
const SOURCE_WEIGHTS = {
  'aeris':          0.92,  // Premium station-based (added 2026-03-27)
  'noaa':           0.90,  // US only, station-based
  'tomorrow.io':    0.88,  // Premium station-based
  'visualcrossing': 0.85,  // Station-based
  'openweathermap': 0.82,  // Station-based
  'wunderground':   0.80,  // Free station network (added 2026-03-27)
  'weatherapi':     0.70,  // Mixed quality
  'open-meteo':     0.30,  // Grid-based, low resolution
};

// === FORECAST QUALITY ESTIMATION ===
function estimateForecastMAE(sources, unit) {
  unit = unit || 'F';
  if (!sources || sources.length === 0) return unit === 'F' ? 3.5 : 2.0;
  
  const SOURCE_MAE = {
    'aeris':          { F: 1.5, C: 0.8 },  // Premium station-based (added 2026-03-27)
    'noaa':           { F: 2.0, C: 1.1 },
    'tomorrow.io':    { F: 1.8, C: 1.0 },  // Premium, best expected
    'visualcrossing': { F: 2.2, C: 1.2 },
    'openweathermap': { F: 2.3, C: 1.3 },
    'wunderground':   { F: 2.4, C: 1.3 },  // Free station network (added 2026-03-27)
    'weatherapi':     { F: 2.5, C: 1.4 },
    'open-meteo':     { F: 3.5, C: 2.0 },
  };
  
  let totalWeight = 0, weightedMAE = 0, hasStation = false;
  
  for (const src of sources) {
    const srcName = src.source || src.name || 'open-meteo';
    const weight = SOURCE_WEIGHTS[srcName] || 0.50;
    const mae = (SOURCE_MAE[srcName] && SOURCE_MAE[srcName][unit]) || (unit === 'F' ? 3.5 : 2.0);
    totalWeight += weight;
    weightedMAE += mae * weight;
    if (['noaa', 'tomorrow.io', 'visualcrossing', 'openweathermap'].includes(srcName)) {
      hasStation = true;
    }
  }
  
  let estimatedMAE = totalWeight > 0 ? weightedMAE / totalWeight : (unit === 'F' ? 3.5 : 2.0);
  
  if (sources.length >= 2) {
    const ensembleBonus = Math.max(0.8, 1 / Math.sqrt(sources.length));
    estimatedMAE *= ensembleBonus;
  }
  
  if (hasStation && sources.length >= 2) {
    estimatedMAE *= 0.9;
  }
  
  return Math.round(estimatedMAE * 10) / 10;
}

// === TRADE EVALUATION ===
function evaluateTrade(forecastTemp, bucketLow, bucketHigh, marketPrice, side, options) {
  options = options || {};
  const unit = options.unit || 'F';
  const sources = options.sources || [];
  const daysToEvent = options.daysToEvent != null ? options.daysToEvent : 1;
  
  const bucketCenter = (bucketLow + bucketHigh) / 2;
  const dist = Math.abs(forecastTemp - bucketCenter);
  const forecastMAE = estimateForecastMAE(sources, unit);
  
  const horizonMultiplier = daysToEvent <= 0 ? 0.7 : daysToEvent === 1 ? 1.0 : 1.3;
  const effectiveMAE = forecastMAE * horizonMultiplier;
  
  const hitProb = hitRateByDistance(dist, effectiveMAE);
  const sideProb = side === 'YES' ? hitProb : (1 - hitProb);
  const edge = sideProb - marketPrice;
  const edgePct = marketPrice > 0 ? (edge / marketPrice) * 100 : 0;
  
  return {
    trade: false,
    prob: sideProb,
    hitProb,
    edge,
    edgePct,
    dist,
    forecastMAE: effectiveMAE,
    bucketCenter,
    model: 'empirical-v3',
    daysToEvent
  };
}

/**
 * Calculate ensemble diversity score (added 2026-03-27)
 * Tight consensus = higher confidence, wide spread = lower confidence
 * @param {number} diversitySD - Standard deviation of raw forecast temps
 */
function calculateDiversityScore(diversitySD) {
  if (diversitySD == null || diversitySD === 0) return 1.0;
  
  // Diversity bonus/penalty:
  // SD < 1°F → tight consensus → 1.3x confidence
  // SD < 2°F → normal spread → 1.0x
  // SD ≥ 2°F → high disagreement → 0.7x confidence
  if (diversitySD < 1.0) return 1.3;
  if (diversitySD < 2.0) return 1.0;
  return 0.7;
}

// === SHOULD WE TRADE? ===
function shouldTrade(forecastTemp, bucketLow, bucketHigh, marketPrice, side, options) {
  options = options || {};
  var analysis = evaluateTrade(forecastTemp, bucketLow, bucketHigh, marketPrice, side, options);
  
  // FILTER 1: High forecast uncertainty (added 2026-03-27)
  const unit = options.unit || 'F';
  const diversityThreshold = unit === 'F' ? 3.0 : 1.5;
  if (options.diversitySD != null && options.diversitySD > diversityThreshold) {
    return Object.assign(analysis, { 
      trade: false, 
      reason: 'high forecast uncertainty (diversitySD: ' + options.diversitySD.toFixed(1) + '°' + unit + ' > ' + diversityThreshold + '°' + unit + ')' 
    });
  }
  
  // FILTER 2: Insufficient sources (added 2026-03-27)
  const sourceCount = Array.isArray(options.sources) ? options.sources.length : options.sources;
  if (sourceCount != null && sourceCount < 3) {
    return Object.assign(analysis, { 
      trade: false, 
      reason: 'insufficient sources (' + sourceCount + ' < 3)' 
    });
  }
  
  // Apply diversity score adjustment
  if (options.diversitySD != null) {
    const diversityScore = calculateDiversityScore(options.diversitySD);
    analysis.diversityScore = diversityScore;
    analysis.prob = Math.min(0.99, Math.max(0.01, analysis.prob * diversityScore));
    analysis.edge = analysis.prob - marketPrice;
    analysis.edgePct = marketPrice > 0 ? (analysis.edge / marketPrice) * 100 : 0;
  }
  
  if (side === 'YES') {
    if (analysis.dist > 1.5) {
      return Object.assign(analysis, { reason: 'YES only on closest bucket (dist > 1.5)' });
    }
    if (analysis.edgePct < 5) {
      return Object.assign(analysis, { reason: 'edge ' + analysis.edgePct.toFixed(1) + '% < 5%' });
    }
    if (marketPrice > analysis.hitProb * 0.9) {
      return Object.assign(analysis, { reason: 'price already near fair value' });
    }
    if (marketPrice < 0.03) {
      return Object.assign(analysis, { reason: 'market too thin (< 3c)' });
    }
    return Object.assign(analysis, { trade: true });
  }
  
  if (side === 'NO') {
    if (analysis.dist < 3) {
      return Object.assign(analysis, { reason: 'NO needs dist >= 3' });
    }
    if (analysis.edgePct < 3) {
      return Object.assign(analysis, { reason: 'edge ' + analysis.edgePct.toFixed(1) + '% < 3%' });
    }
    if (marketPrice > 0.92) {
      return Object.assign(analysis, { reason: 'NO price too high (> 92c)' });
    }
    return Object.assign(analysis, { trade: true });
  }
  
  return Object.assign(analysis, { reason: 'unknown side' });
}

// === SIZE BY CONFIDENCE ===
function recommendSize(analysis, defaultSize, maxSize) {
  defaultSize = defaultSize || 6;
  maxSize = maxSize || 50;
  var size = defaultSize;
  
  if (analysis.forecastMAE <= 2.0 && analysis.dist <= 1.0) size *= 1.5;
  if (analysis.forecastMAE <= 1.5) size *= 1.3;
  if (analysis.edgePct > 30) size *= 1.2;
  if (analysis.forecastMAE > 3.0) size *= 0.7;
  if (analysis.dist > 1.0 && analysis.prob < 0.3) size *= 0.5;
  
  var kellyFraction = Math.max(0, analysis.edge) / (1 - analysis.prob);
  var kellySize = defaultSize * kellyFraction * 4;
  
  size = Math.min(size, kellySize || size);
  return Math.min(Math.max(Math.round(size * 100) / 100, 2), maxSize);
}

function validateModel() {
  console.log('=== EMPIRICAL MODEL V3 ===\n');
  
  console.log('Hit rate by forecast quality (closest bucket):');
  var keys = Object.keys(HIT_RATE_BY_MAE).sort(function(a,b) { return parseInt(a) - parseInt(b); });
  keys.forEach(function(k) {
    var mae = parseInt(k) / 10;
    var v = HIT_RATE_BY_MAE[k];
    var ev25 = v * 3 - (1-v);
    console.log('  MAE ' + mae.toFixed(1) + 'F: ' + (v*100).toFixed(1) + '% hit rate -> EV at 25c: ' + (ev25 > 0 ? '+' : '') + ev25.toFixed(2));
  });
  
  console.log('\nSource weights:');
  Object.keys(SOURCE_WEIGHTS).forEach(function(s) {
    console.log('  ' + s + ': ' + SOURCE_WEIGHTS[s]);
  });
  
  console.log('\nForecast MAE estimates:');
  console.log('  NOAA only:', estimateForecastMAE([{source:'noaa'}], 'F').toFixed(1));
  console.log('  VC only:', estimateForecastMAE([{source:'visualcrossing'}], 'F').toFixed(1));
  console.log('  NOAA+VC:', estimateForecastMAE([{source:'noaa'},{source:'visualcrossing'}], 'F').toFixed(1));
  console.log('  NOAA+VC+WA:', estimateForecastMAE([{source:'noaa'},{source:'visualcrossing'},{source:'weatherapi'}], 'F').toFixed(1));
  console.log('  Full stack:', estimateForecastMAE([{source:'noaa'},{source:'visualcrossing'},{source:'weatherapi'},{source:'open-meteo'}], 'F').toFixed(1));
  console.log('  Open-Meteo only:', estimateForecastMAE([{source:'open-meteo'}], 'F').toFixed(1));
}

module.exports = {
  hitRateByDistance: hitRateByDistance,
  estimateForecastMAE: estimateForecastMAE,
  evaluateTrade: evaluateTrade,
  shouldTrade: shouldTrade,
  recommendSize: recommendSize,
  validateModel: validateModel,
  calculateDiversityScore: calculateDiversityScore,
  SOURCE_WEIGHTS: SOURCE_WEIGHTS,
  HIT_RATE_BY_MAE: HIT_RATE_BY_MAE
};
