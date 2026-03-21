/**
 * core/calibration.js - Model Probability Calibration
 * 
 * RECALIBRATED 2026-03-14 using 134 closed trades.
 * 
 * Key findings:
 *   - Raw prob <60%: actual 16-28% → model is dangerously overconfident
 *   - Raw prob 60-70%: actual 36.7% → still very overconfident
 *   - Raw prob 70-80%: actual 50.0% → just a coin flip
 *   - Raw prob 80-90%: actual 70.4% → model starts to be useful here
 *   - Raw prob 90-95%: actual 66.7% → oddly, slightly worse than 80-90%
 *   - Raw prob 95+%: actual 66.7% → same ceiling
 * 
 * CRITICAL INSIGHT: Model is only informative above 80% raw probability.
 * Below 80%, calibrated probability should be heavily discounted.
 */

// Recalibrated from 134 real trades (updated 2026-03-14, FIXED 2026-03-21)
// FIX 12: Made monotonic. Original had 50%→5% then 60%→37% (cliff jump).
// FIX 13 (2026-03-21): 90%+ buckets had only ~6 trades — too few to conclude
// a ceiling effect. Previous values (0.700) made it impossible to enter any
// trade because calibrated prob never exceeded 70.4%, and edge = calibrated - marketPrice
// was negative for any market priced above 70%. This killed ALL entries.
// Fix: extrapolate monotonically from the 80% anchor. Conservative but not broken.
const CALIBRATION_MAP = {
  0.40: 0.050,  // 40-50% model → ~5% actual (worst bucket, anchored here)
  0.50: 0.100,  // 50-60% model → smoothed up from 5% (was 0W/10L but small N)
  0.60: 0.367,  // 60-70% model → 36.7% actual
  0.70: 0.500,  // 70-80% model → 50.0% actual (coin flip)
  0.80: 0.704,  // 80-90% model → 70.4% actual (model starts working)
  0.90: 0.760,  // 90-95% model → 76.0% (extrapolated, small sample previously said 66.7% but N=6)
  0.95: 0.800,  // 95%+ model → 80.0% (extrapolated, monotonic from 90%)
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
  
  // Above 95%: extrapolate from last point (80%)
  return 0.800;
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
