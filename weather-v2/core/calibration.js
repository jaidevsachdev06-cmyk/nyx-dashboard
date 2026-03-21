/**
 * core/calibration.js - Model Probability Calibration
 * 
 * RECALIBRATED 2026-03-21 using V3-filtered universe (83 trades).
 * 
 * IMPORTANT: Calibration must use the SAME filter universe as live trading.
 * Previous calibration used all 164 trades including blacklisted cities
 * (London 25% WR, Toronto 31% WR) and bad bucket types — these poisoned
 * the 90%+ bucket from 76.2% down to 66.7%, making the model look worse
 * than it actually is in the tradeable universe.
 * 
 * V3-filtered findings (83 trades):
 *   - Raw prob 40-50%: actual 33.3% (n=9)
 *   - Raw prob 50-60%: actual 0.0%  (n=4) ← dead zone
 *   - Raw prob 60-70%: actual 50.0% (n=18)
 *   - Raw prob 70-80%: actual 64.3% (n=14)
 *   - Raw prob 80-90%: actual 76.9% (n=26) ← model works
 *   - Raw prob 90-100%: actual 76.2% (n=21) ← holds strong, no ceiling
 */

// Recalibrated from 164 real trades (2026-03-21)
// Monotonic smoothing applied. Each bucket >= previous.
// 50-60% anchored at 0% (0W/10L is a real signal, not noise).
// 90-100% set BELOW 80-90% per actual data (42 trades = reliable).
// RECALIBRATED using V3-filtered universe (83 trades, bad cities/buckets excluded).
// Unfiltered calibration was poisoned by London/Toronto/Miami/Tokyo + below buckets,
// making 90%+ look like 66.7% when it's actually 76.2% in the tradeable universe.
const CALIBRATION_MAP = {
  0.40: 0.050,  // 40-50% model → 33.3% actual (n=9) but heavily discounted
  0.50: 0.050,  // 50-60% model → 0.0% actual (n=4). Dead zone.
  0.60: 0.500,  // 60-70% model → 50.0% actual (n=18, reliable)
  0.70: 0.643,  // 70-80% model → 64.3% actual (n=14)
  0.80: 0.769,  // 80-90% model → 76.9% actual (n=26, strongest bucket)
  0.90: 0.769,  // 90-100% model → 76.2% actual (n=21), FLOORED to 76.9% for monotonicity
  0.95: 0.769,  // 95%+ → plateau at 76.9% (model confidence ceiling with 83 V3 trades)
};

/**
 * Calibrate a raw model probability to account for overconfidence.
 * Uses piecewise linear interpolation between calibration points.
 * 
 * @param {number} rawProb - Raw model probability (0-1)
 * @returns {number} Calibrated probability (0-1)
 */
function calibrateProb(rawProb) {
  if (rawProb < 0.40) {
    // Below 40%: scale linearly to 5% (first calibration point)
    return rawProb * (0.050 / 0.40);
  }
  
  const points = Object.entries(CALIBRATION_MAP)
    .map(([k, v]) => [parseFloat(k), v])
    .sort((a, b) => a[0] - b[0]);
  
  for (let i = 0; i < points.length - 1; i++) {
    const [x1, y1] = points[i];
    const [x2, y2] = points[i + 1];
    
    if (rawProb >= x1 && rawProb <= x2) {
      const t = (rawProb - x1) / (x2 - x1);
      return y1 + t * (y2 - y1);
    }
  }
  
  // Above 95%: hold at V3-calibrated ceiling of 76.9%
  return 0.769;
}

/**
 * Calculate edge with calibrated probabilities.
 */
function calibratedEdge(rawModelProb, marketPrice) {
  const calibratedProb = calibrateProb(rawModelProb);
  const edge = calibratedProb - marketPrice;
  const edgePct = marketPrice > 0 ? (edge / marketPrice) * 100 : 0;
  
  return {
    edge,
    edgePct,
    calibratedProb,
    rawProb: rawModelProb
  };
}

/**
 * Ensemble aggregation with quality weighting.
 */
function weightedEnsemble(forecasts) {
  if (!forecasts || forecasts.length === 0) {
    return { mean: null, sd: null, models: 0, weights: {} };
  }
  
  const MODEL_WEIGHTS = {
    'ecmwf_ifs025': 1.3,
    'meteofrance_seamless': 1.2,
    'icon_seamless': 1.1,
    'gfs_seamless': 1.0,
    'gem_global': 0.9,
    'jma_seamless': 0.9
  };
  
  let weightedSum = 0;
  let totalWeight = 0;
  const modelCounts = {};
  
  forecasts.forEach(f => {
    const weight = MODEL_WEIGHTS[f.model] || 1.0;
    weightedSum += f.highTemp * weight;
    totalWeight += weight;
    modelCounts[f.model] = (modelCounts[f.model] || 0) + 1;
  });
  
  const mean = weightedSum / totalWeight;
  
  let varianceSum = 0;
  forecasts.forEach(f => {
    const weight = MODEL_WEIGHTS[f.model] || 1.0;
    varianceSum += weight * Math.pow(f.highTemp - mean, 2);
  });
  
  const variance = varianceSum / totalWeight;
  const sd = Math.sqrt(variance);
  
  return {
    mean,
    sd,
    models: forecasts.length,
    weights: modelCounts
  };
}

function validateCalibration() {
  console.log('CALIBRATION VALIDATION (2026-03-14 recalibration):\n');
  
  const testPoints = [0.45, 0.55, 0.65, 0.75, 0.85, 0.92, 0.98];
  testPoints.forEach(raw => {
    const calibrated = calibrateProb(raw);
    const adjustment = ((calibrated - raw) * 100).toFixed(1);
    console.log(`  ${(raw*100).toFixed(0)}% raw → ${(calibrated*100).toFixed(1)}% calibrated (${adjustment}pp)`);
  });
  
  console.log('\nKey insight: Model is only useful above 80% raw probability.');
  console.log('Below 60%: model is anti-informative (worse than random).');
}

module.exports = {
  calibrateProb,
  calibratedEdge,
  weightedEnsemble,
  validateCalibration,
  CALIBRATION_MAP
};
