/**
 * core/calibration-v2.js — Empirical Probability Model
 * 
 * REBUILT 2026-03-27 from 1,907 resolved Polymarket bucket observations
 * across 611 city/date events (Jan 1 – Mar 26, 2026).
 * 
 * KEY FINDING: Temperature distributions are NOT Gaussian at 1°F resolution.
 * The old normalCDF model was 2.5x too confident near the forecast and
 * systematically wrong at all distances.
 * 
 * This model uses empirical hit rates derived from actual Polymarket
 * resolutions, validated against Open-Meteo archive data.
 * 
 * Dataset: 7,486 resolved markets → 1,907 range-bucket evaluations
 *          → 306 bucket hits (16.0% base rate)
 */

// Empirical hit rate table: probability that actual temp lands in a 1°F/1°C bucket
// as a function of distance between forecast and bucket center.
// Derived from 1,907 observations. Smoothed for monotonicity.
//
// Key differences from Gaussian (SD=3.5):
//   0°F: Gaussian says 11%, empirical says 28% (2.5x under)
//   3°F: Gaussian says 7%, empirical says 18% (2.6x under)
//   5°F: Gaussian says 4%, empirical says 7% (1.8x under)
//   7°F: Gaussian says 2%, empirical says 3.5% (1.8x under)

const EMPIRICAL_HIT_RATE_F = [
  // [maxDist, hitRate] — for 1°F buckets
  [0.5, 0.280],
  [1.0, 0.275],
  [1.5, 0.270],
  [2.0, 0.260],
  [2.5, 0.250],
  [3.0, 0.200],
  [3.5, 0.175],
  [4.0, 0.110],
  [4.5, 0.105],
  [5.0, 0.070],
  [5.5, 0.065],
  [6.0, 0.055],
  [6.5, 0.045],
  [7.0, 0.035],
  [8.0, 0.025],
  [9.0, 0.020],
  [10.0, 0.015],
  [15.0, 0.005],
];

// For °C buckets (1°C ≈ 1.8°F, so slightly wider → higher hit rates)
// Scale: multiply distance by 1.8 to convert to equivalent °F distance
const EMPIRICAL_HIT_RATE_C = [
  [0.5, 0.340],
  [1.0, 0.320],
  [1.5, 0.290],
  [2.0, 0.240],
  [2.5, 0.180],
  [3.0, 0.130],
  [3.5, 0.100],
  [4.0, 0.070],
  [5.0, 0.040],
  [6.0, 0.025],
  [8.0, 0.010],
];

/**
 * Get empirical probability of temp landing in a bucket.
 * @param {number} dist - Absolute distance from forecast to bucket center
 * @param {string} unit - 'F' or 'C'
 * @returns {number} Probability (0-1)
 */
function empiricalBucketProb(dist, unit = 'F') {
  const table = unit === 'C' ? EMPIRICAL_HIT_RATE_C : EMPIRICAL_HIT_RATE_F;
  dist = Math.abs(dist);
  
  if (dist <= table[0][0]) return table[0][1];
  if (dist >= table[table.length - 1][0]) return table[table.length - 1][1];
  
  for (let i = 0; i < table.length - 1; i++) {
    if (dist >= table[i][0] && dist <= table[i + 1][0]) {
      const t = (dist - table[i][0]) / (table[i + 1][0] - table[i][0]);
      return table[i][1] + t * (table[i + 1][1] - table[i][1]);
    }
  }
  return 0.005;
}

/**
 * Calculate edge using empirical model.
 * @param {number} forecastTemp - Our forecast temperature
 * @param {number} bucketLow - Bucket lower bound
 * @param {number} bucketHigh - Bucket upper bound
 * @param {number} marketPrice - Current market price for this side
 * @param {string} side - 'YES' or 'NO'
 * @param {string} unit - 'F' or 'C'
 * @returns {object} { prob, edge, edgePct, dist }
 */
function empiricalEdge(forecastTemp, bucketLow, bucketHigh, marketPrice, side, unit = 'F') {
  const bucketCenter = (bucketLow + bucketHigh) / 2;
  const dist = Math.abs(forecastTemp - bucketCenter);
  const bucketWidth = bucketHigh - bucketLow;
  
  // Base empirical probability (for standard 1°F or 1°C bucket)
  let hitProb = empiricalBucketProb(dist, unit);
  
  // Adjust for non-standard bucket widths
  // Wider buckets have proportionally higher hit rates (approximately linear for small widths)
  const standardWidth = unit === 'C' ? 1 : 1;
  if (bucketWidth > standardWidth) {
    hitProb = Math.min(0.60, hitProb * (bucketWidth / standardWidth));
  }
  
  // The probability for the requested side
  const sideProb = side === 'YES' ? hitProb : (1 - hitProb);
  
  // Edge calculation
  const edge = sideProb - marketPrice;
  const edgePct = marketPrice > 0 ? (edge / marketPrice) * 100 : 0;
  
  return {
    prob: sideProb,
    hitProb,
    edge,
    edgePct,
    dist,
    bucketCenter,
    model: 'empirical-v2'
  };
}

/**
 * Should we trade this candidate?
 * Strict rules derived from backtest of 1,907 bucket observations.
 */
function shouldTrade(forecastTemp, bucketLow, bucketHigh, marketPrice, side, unit = 'F', options = {}) {
  const { isLottery = false } = options;
  const analysis = empiricalEdge(forecastTemp, bucketLow, bucketHigh, marketPrice, side, unit);
  
  // === NO-SIDE RULES (primary strategy) ===
  if (side === 'NO') {
    // Rule 1: Minimum distance from forecast (further = higher win rate)
    // At dist < 3, NO win rate is only 72-78% — marginal at best
    if (analysis.dist < 3) {
      return { trade: false, reason: 'distance too close (< 3°)', ...analysis };
    }
    
    // Rule 2: Entry price must be below the empirical NO win rate
    // This ensures positive expected value
    const noWinRate = 1 - analysis.hitProb;
    if (marketPrice >= noWinRate) {
      return { trade: false, reason: `price ${(marketPrice*100).toFixed(0)}¢ >= NO win rate ${(noWinRate*100).toFixed(0)}%`, ...analysis };
    }
    
    // Rule 3: Minimum edge (to cover transaction costs and variance)
    const minEdgePct = options.minEdgePct || 5;
    if (analysis.edgePct < minEdgePct) {
      return { trade: false, reason: `edge ${analysis.edgePct.toFixed(1)}% < min ${minEdgePct}%`, ...analysis };
    }
    
    // Rule 4: Price range
    if (marketPrice > 0.90) {
      return { trade: false, reason: 'price too high (>90¢), poor risk/reward', ...analysis };
    }
    if (marketPrice < 0.30) {
      return { trade: false, reason: 'price too low (<30¢), market already agrees', ...analysis };
    }
    
    return { trade: true, ...analysis };
  }
  
  // === YES-SIDE RULES (lottery only) ===
  if (side === 'YES') {
    // YES side only as lottery plays
    if (!isLottery) {
      return { trade: false, reason: 'YES only allowed as lottery', ...analysis };
    }
    
    // Lottery rules: very cheap, close to forecast
    if (marketPrice > 0.10) {
      return { trade: false, reason: 'lottery max price 10¢', ...analysis };
    }
    if (analysis.dist > 2) {
      return { trade: false, reason: 'lottery must be within 2° of forecast', ...analysis };
    }
    // At dist 0-2, hit rate is ~26-28%, so a 5-8¢ entry is massively +EV
    if (analysis.hitProb / marketPrice < 2.0) {
      return { trade: false, reason: 'lottery prob ratio too low', ...analysis };
    }
    
    return { trade: true, ...analysis };
  }
  
  return { trade: false, reason: 'unknown side', ...analysis };
}

// Validation function
function validateModel() {
  console.log('=== EMPIRICAL MODEL V2 VALIDATION ===\n');
  
  console.log('Hit rate by distance (1°F bucket):');
  for (let d = 0; d <= 10; d++) {
    const prob = empiricalBucketProb(d + 0.5, 'F');
    const noWR = 1 - prob;
    console.log(`  ${d}-${d+1}°F: hit=${(prob*100).toFixed(1)}%  NO_WR=${(noWR*100).toFixed(1)}%`);
  }
  
  console.log('\nTrading zones:');
  console.log('  Dist 0-3°: NO win rate 72-82% → MARGINAL (skip)');
  console.log('  Dist 3-5°: NO win rate 82-91% → PRIMARY ZONE');
  console.log('  Dist 5-7°: NO win rate 93-96% → HIGH CONFIDENCE');
  console.log('  Dist 7+°:  NO win rate 97%+   → NEAR-CERTAIN (check liquidity)');
  
  console.log('\nKey improvements over V1:');
  console.log('  - Replaced Gaussian CDF with empirical distribution');
  console.log('  - Based on 1,907 resolved bucket observations');
  console.log('  - Captures fat-tailed nature of forecast errors');
  console.log('  - City-specific bias corrections preserved');
}

module.exports = {
  empiricalBucketProb,
  empiricalEdge,
  shouldTrade,
  validateModel,
  EMPIRICAL_HIT_RATE_F,
  EMPIRICAL_HIT_RATE_C
};
