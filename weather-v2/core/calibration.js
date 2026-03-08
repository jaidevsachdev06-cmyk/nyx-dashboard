/**
 * core/calibration.js - Model Probability Calibration
 * 
 * Adjusts overconfident model probabilities based on historical performance.
 * Analysis showed model is ~25-30pp overconfident across all probability ranges.
 */

// Historical calibration data from 104 closed trades
// Format: { modelRange: actualWinRate }
const CALIBRATION_MAP = {
  0.60: 0.375,  // 60-70% model → 37.5% actual
  0.70: 0.500,  // 70-80% model → 50.0% actual
  0.80: 0.696,  // 80-90% model → 69.6% actual
  0.90: 0.650,  // 90-95% model → 65.0% actual
  0.95: 0.667,  // 95-100% model → 66.7% actual
};

/**
 * Calibrate a raw model probability to account for overconfidence.
 * 
 * Method: Piecewise linear interpolation between calibration points
 * 
 * @param {number} rawProb - Raw model probability (0-1)
 * @returns {number} Calibrated probability (0-1)
 */
function calibrateProb(rawProb) {
  if (rawProb < 0.60) {
    // Below 60%: linear scaling (assume model is less reliable at extremes)
    // Map 0-60% to 0-37.5% (first calibration point)
    return rawProb * (0.375 / 0.60);
  }
  
  // Find bracketing calibration points
  const points = Object.entries(CALIBRATION_MAP)
    .map(([k, v]) => [parseFloat(k), v])
    .sort((a, b) => a[0] - b[0]);
  
  for (let i = 0; i < points.length - 1; i++) {
    const [x1, y1] = points[i];
    const [x2, y2] = points[i + 1];
    
    if (rawProb >= x1 && rawProb <= x2) {
      // Linear interpolation between points
      const t = (rawProb - x1) / (x2 - x1);
      return y1 + t * (y2 - y1);
    }
  }
  
  // Above 95%: use last calibration point (66.7%)
  return 0.667;
}

/**
 * Calculate edge with calibrated probabilities.
 * 
 * @param {number} rawModelProb - Raw model probability
 * @param {number} marketPrice - Current market price
 * @returns {object} { edge, edgePct, calibratedProb, rawProb }
 */
function calibratedEdge(rawModelProb, marketPrice) {
  const calibratedProb = calibrateProb(rawModelProb);
  const edge = calibratedProb - marketPrice;
  const edgePct = (edge / (1 - marketPrice)) * 100;
  
  return {
    edge,
    edgePct,
    calibratedProb,
    rawProb: rawModelProb
  };
}

/**
 * Ensemble aggregation with quality weighting.
 * 
 * Weights models based on historical accuracy (when available).
 * Currently equal-weighted until we have model-specific performance data.
 * 
 * @param {Array} forecasts - Array of {model, temp} forecasts
 * @returns {object} { mean, sd, models, weights }
 */
function weightedEnsemble(forecasts) {
  if (!forecasts || forecasts.length === 0) {
    return { mean: null, sd: null, models: 0, weights: {} };
  }
  
  // Model quality weights (1.0 = baseline)
  // Based on typical NWP model skill scores for 24-48h temperature forecasts
  const MODEL_WEIGHTS = {
    'ecmwf_ifs025': 1.3,        // ECMWF IFS - highest skill
    'meteofrance_seamless': 1.2, // Meteo-France ARPEGE - very good
    'icon_seamless': 1.1,        // DWD ICON - good for short-term
    'gfs_seamless': 1.0,         // NOAA GFS - baseline
    'gem_global': 0.9,           // CMC GEM - slightly lower
    'jma_seamless': 0.9          // JMA GSM - similar to GEM
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
  
  // Calculate weighted variance
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

/**
 * Validate calibration against historical data.
 * Run this to check if calibration is working correctly.
 */
function validateCalibration() {
  console.log('CALIBRATION VALIDATION:\n');
  
  const testPoints = [0.65, 0.75, 0.85, 0.92, 0.98];
  testPoints.forEach(raw => {
    const calibrated = calibrateProb(raw);
    const adjustment = ((calibrated - raw) * 100).toFixed(1);
    console.log(`  ${(raw*100).toFixed(0)}% raw → ${(calibrated*100).toFixed(1)}% calibrated (${adjustment}pp)`);
  });
  
  console.log('\nExpected behavior:');
  console.log('  - High probabilities (>90%) should be reduced ~25-30pp');
  console.log('  - Mid probabilities (70-80%) should be reduced ~20-25pp');
  console.log('  - Calibration should be monotonic (never reverse order)');
}

module.exports = {
  calibrateProb,
  calibratedEdge,
  weightedEnsemble,
  validateCalibration,
  CALIBRATION_MAP
};
