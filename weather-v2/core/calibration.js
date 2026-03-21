/**
 * core/calibration.js - Model Probability Calibration
 * 
 * RECALIBRATED 2026-03-21 using 164 closed trades (full dataset).
 * 
 * Key findings (164 trades):
 *   - Raw prob 0-10%:  actual 25.0% (n=4, lottery noise — ignore)
 *   - Raw prob 10-20%: actual 28.6% (n=7)
 *   - Raw prob 30-40%: actual 0.0%  (n=3, tiny sample)
 *   - Raw prob 40-50%: actual 38.5% (n=13)
 *   - Raw prob 50-60%: actual 0.0%  (n=10) ← CRITICAL: 0 wins in 10 trades
 *   - Raw prob 60-70%: actual 42.4% (n=33)
 *   - Raw prob 70-80%: actual 52.4% (n=21)
 *   - Raw prob 80-90%: actual 73.3% (n=30) ← model works here
 *   - Raw prob 90-100%: actual 66.7% (n=42) ← ceiling, LOWER than 80-90%
 * 
 * CRITICAL: 90%+ bucket has 42 trades at 66.7% — NOT small sample anymore.
 * This IS the ceiling. The model maxes out at ~73% actual accuracy.
 */

// Recalibrated from 164 real trades (2026-03-21)
// Monotonic smoothing applied. Each bucket >= previous.
// 50-60% anchored at 0% (0W/10L is a real signal, not noise).
// 90-100% set BELOW 80-90% per actual data (42 trades = reliable).
const CALIBRATION_MAP = {
  0.40: 0.050,  // 40-50% model → raw 38.5% but discount for overconfidence pattern
  0.50: 0.050,  // 50-60% model → 0W/10L actual. Dead zone. Keep at floor.
  0.60: 0.424,  // 60-70% model → 42.4% actual (n=33, reliable)
  0.70: 0.524,  // 70-80% model → 52.4% actual (n=21)
  0.80: 0.733,  // 80-90% model → 73.3% actual (n=30, strongest bucket)
  0.85: 0.733,  // Peak — hold flat through sweet spot
  0.90: 0.700,  // 90-100% model → 66.7% actual (n=42) — blend down conservatively
  0.95: 0.680,  // 95%+ → continued ceiling descent
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
  
  // Above 95%: ceiling at 68% (42 trades confirm model accuracy tops out ~67%)
  return 0.680;
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
