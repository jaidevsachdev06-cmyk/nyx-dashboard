# Model V2 Rebuild Report
**Date:** 2026-03-27
**Dataset:** 7,486 resolved Polymarket markets → 1,907 range-bucket observations across 611 city/date events

## Root Cause Analysis

### Why V1 Failed
1. **Gaussian CDF was wrong for this problem.** At 1°F bucket resolution, actual temp distributions have fat cores — hit rates at 0-3° distance are 2.5x what Gaussian predicts.
2. **Early trades had a bug:** stored model probs implied SD=0.7-1.5°F when actual SD was 3.5°F. The probability calculation was broken.
3. **Calibration table couldn't fix it.** A lookup table on top of a wrong distribution is still wrong.
4. **Edge was inverted:** higher "edge" = more disagreement with market = more wrong (since the model was overconfident).

### V1 Performance (205 trades)
- Win rate: 46%
- P&L: +$314 (but $437 from ONE Paris lottery hit)
- Without lottery: -$8
- Model said 72% avg probability, reality was 46%

## The Empirical Model

### Data Foundation
- 611 resolved city/date events (Jan 1 – Mar 26, 2026)
- 1,907 range-bucket evaluations with known outcomes
- 306 bucket hits (16.0% base rate)

### Empirical Hit Rate Table (1°F buckets)
| Dist from Forecast | Gaussian (SD=3.5) | Empirical | Ratio |
|---|---|---|---|
| 0-1°F | 11% | 28% | 2.5x |
| 1-2°F | 10% | 27% | 2.7x |
| 2-3°F | 9% | 25% | 2.8x |
| 3-4°F | 7% | 18% | 2.6x |
| 4-5°F | 5% | 11% | 2.2x |
| 5-7°F | 3% | 7% | 2.3x |
| 7-10°F | 1% | 3% | 3x |

### NO-Side Win Rates
| Distance | NO Win Rate | Notes |
|---|---|---|
| 0-1° | 72% | Marginal — skip |
| 1-2° | 74% | Marginal — skip |
| 2-3° | 75% | Marginal — skip |
| 3-4° | 82% | Primary zone |
| 4-5° | 89% | Strong |
| 5-7° | 94% | High confidence |
| 7+° | 97% | Near-certain |

## Recommended V2 Config
- **Model:** empirical-v2 (replaces normalCDF)
- **Side:** NO only (primary), YES lottery (secondary)
- **Min distance:** 3° (4° preferred)
- **Min edge:** 5% (empirical)
- **Entry price range:** 30-85¢
- **Size by confidence:** $4 (dist 3-4), $6 (dist 4-5), $8 (dist 5+)
- **Lottery:** YES <8¢, dist <3°, max $2

## Backtest on Real Trades
| Metric | V1 (Old) | V2 (New) dist≥3 | V2 dist≥4 |
|---|---|---|---|
| Trades | 205 | 65 | 27 |
| Win Rate | 46% | 62% | 70% |
| P&L | $314 | $57 | $49 |
| P&L/trade | $1.53* | $0.88 | $1.83 |

*V1 P&L inflated by single $437 lottery hit. Without it: -$8 total.

## Implementation
- `core/calibration-v2.js` — empirical probability model
- Scanner to be updated to use `empiricalEdge()` instead of `normalCDF()`
