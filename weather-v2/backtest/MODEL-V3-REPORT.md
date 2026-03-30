# Model V3 Rebuild Report — Station-First Forecast
**Date:** 2026-03-27
**Dataset:** 7,486 resolved markets + 361 Visual Crossing verifications + Monte Carlo simulation

## The Discovery

The V1/V2 model wasn't wrong about probability math. It was wrong about the FORECAST.

### Open-Meteo Grid vs Airport Station
| Source | Type | MAE vs Polymarket Resolution |
|---|---|---|
| Visual Crossing (observed) | Airport station | 0.56°F |
| Open-Meteo (archive) | Grid point (lat/lon) | 1.84°F |

Open-Meteo returns temperature at a lat/lon grid point. Polymarket resolves using Weather Underground, which reads from the airport weather station (KLGA, KORD, etc). The systematic offset between grid and station is 1-3°F depending on city.

### Forecast Quality = Hit Rate (Monte Carlo, 361 events)
| Forecast MAE | Closest-Bucket Hit Rate | EV at 25¢ Entry |
|---|---|---|
| 0.5°F | 65.5% | +$1.62 per $1 |
| 1.0°F | 50.6% | +$1.02 |
| 1.5°F | 40.0% | +$0.60 |
| **2.0°F** | **33.6%** | **+$0.34** |
| 2.5°F | 29.4% | +$0.18 |
| 3.0°F | 26.7% | +$0.07 |
| **3.5°F** | **24.6%** | **-$0.02** |

The breakeven point is MAE ~3.3°F. Below that → profitable. Above → losing money.

### Current vs Target
- **Current system** (Open-Meteo heavy, weight 0.65): effective MAE ~3.5°F → breakeven
- **V3 target** (NOAA+VC+WA, Open-Meteo deprioritized): effective MAE ~1.7°F → +$0.55/dollar

## V3 Architecture

### Source Priority
| Source | Weight | MAE (est.) | Coverage |
|---|---|---|---|
| NOAA | 0.90 | 2.0°F | US cities only |
| Visual Crossing | 0.85 | 2.2°F | Global |
| WeatherAPI | 0.70 | 2.5°F | Global |
| Open-Meteo | 0.30 | 3.5°F | Global (fallback) |

### Trading Strategy
1. **YES-side on closest bucket** (dist < 1.5°F from forecast)
   - This is the PRIMARY strategy now (flipped from V1's NO-only)
   - At MAE 2.0: 34% hit rate vs ~25% market price = massive edge
2. **NO-side on distant buckets** (dist > 3°F) as secondary
3. **1-day-out only** (no 2-day forecasts — accuracy drops 30%)
4. **Size by forecast confidence** (more sources + station data = larger size)

### Estimated MAE by Configuration
| Config | Est. MAE | Hit Rate | Monthly EV (3 trades/day) |
|---|---|---|---|
| NOAA only | 2.0°F | 33.6% | ~$120 |
| NOAA+VC | 1.5°F | 40.0% | ~$230 |
| NOAA+VC+WA | 1.6°F | 38% | ~$200 |
| Full stack | 1.7°F | 36% | ~$180 |
| Open-Meteo only | 3.5°F | 24.6% | -$5 |

## Implementation
- `core/calibration-v3.js` — new empirical model
- `core/calibration-v2.js` — distance-based model (V2, kept for reference)
- Scanner needs to be updated to use V3
- Multi-source weights need updating in scanner

## Caveats
- MAE estimates for NOAA/VC as FORECASTS (not observed) are extrapolated
- Only 15 multi-source trades available for direct validation
- Spring/summer weather patterns may differ from winter dataset
- Need 2-4 weeks of paper trading to validate V3 before increasing size
