# Model Calibration & Ensemble Expansion

**Implemented:** 2026-03-08 02:25 UTC  
**Status:** ✅ Live in production

## Problem

Analysis of 104 historical trades revealed the forecast model was severely overconfident:

| Model Says | Actually Happens | Error |
|-----------|------------------|-------|
| 60-70% | 37.5% | -22.5pp |
| 70-80% | 50.0% | -25.0pp |
| 80-90% | 69.6% | -15.4pp |
| 90-95% | 65.0% | -27.5pp |
| 95-100% | 66.7% | -30.8pp |

**The model was 25-30 percentage points overconfident across all ranges.**

Additionally, only **1 forecast model** was contributing data (should be 4+).

## Solutions Implemented

### 1. Probability Calibration

**Module:** `core/calibration.js`

Maps raw model probabilities to calibrated probabilities using historical performance:

```javascript
const calibratedProb = calibrateProb(rawProb);
// Example: 94% raw → 66% calibrated (-28pp adjustment)
```

**Method:** Piecewise linear interpolation between calibration points

**Application:** 
- Calibrated probabilities used for **edge calculation**
- Raw probabilities still used for **filtering** (maintains strategy continuity)
- Both values tracked for transparency

### 2. Weighted Ensemble Expansion

**From 4 to 6 models:**

| Model | Weight | Rationale |
|-------|--------|-----------|
| ECMWF IFS | 1.3x | Highest skill for 24-48h temp forecasts |
| Meteo-France ARPEGE | 1.2x | Very good European model |
| ICON Seamless | 1.1x | Excellent short-term (DWD) |
| GFS Seamless | 1.0x | Baseline (NOAA) |
| GEM Global | 0.9x | Slightly lower skill (CMC) |
| JMA GSM | 0.9x | Similar to GEM (Japan) |

**Aggregation:**
- Weighted mean: `Σ(weight × temp) / Σ(weight)`
- Weighted variance: accounts for model disagreement
- Base forecast error added: ±1.5°F / ±0.8°C

**Verification:**
Before: Only 1 model returning data (`models: 1` in trades.json)  
After: All 6 models contributing (`models: 6` + weight breakdown)

## Technical Details

### Calibration Function

```javascript
function calibrateProb(rawProb) {
  // Below 60%: linear scaling
  if (rawProb < 0.60) {
    return rawProb * (0.375 / 0.60);
  }
  
  // 60-95%: piecewise linear interpolation
  // Uses historical calibration map
  
  // Above 95%: cap at 66.7%
  return 0.667;
}
```

### Integration Point

In `stormwatch/scanner.js`:

```javascript
// 1. Calculate raw model probability
const rawModelProb = side === 'YES' ? modelProb : (1 - modelProb);

// 2. Apply calibration
const calibratedModelProb = calibration.calibrateProb(rawModelProb);

// 3. Calculate edge with calibrated value
const edge = calibratedModelProb - effectivePrice;
const edgePct = (edge / effectivePrice) * 100;

// 4. Track both for transparency
candidate.modelProb = calibratedModelProb;
candidate.rawModelProb = rawModelProb;
```

## Expected Impact

### Immediate Effects

**Better Edge Estimates:**
- Old: 90% model → 90% prob → overstated edge
- New: 90% model → 65% calibrated → realistic edge
- Filters remain unchanged (continuity)

**More Reliable Forecasts:**
- 6 models vs 1 = better consensus
- Quality weighting (ECMWF 1.3x) = skill-based aggregation
- Model disagreement → higher uncertainty (larger SD)

### Performance Predictions

**Conservative estimate:**
- Win rate: should align closer to calibrated probs (not raw)
- 10-25% edge zone: still optimal (now based on calibrated edge)
- High-edge trades (>50%): reduced false signals

**Optimistic estimate:**
- Better edge accuracy → better position sizing
- Weighted ensemble → fewer forecast busts
- Calibration → strategy adapts as model improves

### Monitoring Metrics

Track these to validate calibration:

1. **Calibration drift:**
   - Compare actual outcomes to calibrated probs
   - If diverges >10pp, recalibrate

2. **Model contribution:**
   - Check `forecastWeights` in trades.json
   - All 6 models should contribute regularly

3. **Edge accuracy:**
   - Calibrated edge vs raw edge vs actual P&L
   - Calibrated should predict outcomes better

4. **Win rate by calibrated prob:**
   - 60-70% calibrated → should actually be ~60-70%
   - NOT 37.5% like before

## Transparency

Every candidate now includes:

```json
{
  "modelProb": 0.665,        // Calibrated (used for edge)
  "rawModelProb": 0.945,     // Raw (used for filters)
  "edge": -0.05,             // Calibrated edge
  "rawEdge": 0.24,           // Raw edge (for comparison)
  "forecastWeights": {       // Which models contributed
    "ecmwf_ifs025": 1,
    "icon_seamless": 1,
    "gfs_seamless": 1,
    ...
  }
}
```

Console logs show both:
```
[scanner] ✅ Chicago 60-61°F NO | model: 66.5% (raw 94.5%) mkt: 70.0% edge: -5.0%
```

## Validation

**Pre-deployment tests:**
- ✅ Calibration function monotonic (no reversals)
- ✅ All 6 models fetching data successfully
- ✅ Weighted ensemble math verified
- ✅ Scanner integration tested on live markets
- ✅ Backward compatibility (old trades still readable)

**Post-deployment monitoring:**
- Track calibration accuracy over next 50 trades
- Compare raw vs calibrated edge predictive power
- Verify all 6 models contributing consistently

## Rollback Plan

If calibration causes issues:

1. **Quick fix:** Set all model weights to 1.0 (equal weighting)
2. **Disable calibration:** Replace `calibrateProb()` with identity function
3. **Revert models:** Remove meteofrance_seamless and jma_seamless from config

Location: `core/calibration.js` + `stormwatch/scanner.js` lines 7, 116-140, 345-360

## Future Improvements

1. **Adaptive calibration:** Update calibration map monthly based on recent trades
2. **Model-specific calibration:** Different adjustment per forecast model
3. **Uncertainty-aware sizing:** Use forecast SD for dynamic position sizing
4. **Temporal calibration:** Different adjustments for 24h vs 48h forecasts

---

**Summary:** Model now acknowledges its overconfidence and uses 6 ensemble sources. Edge calculations are more realistic. Strategy filters unchanged for continuity. Fully transparent with raw vs calibrated values tracked.
