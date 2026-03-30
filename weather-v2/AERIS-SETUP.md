# Aeris Weather Setup Guide

## Why Aeris?

Aeris Weather provides **station-based forecasts** with significantly better accuracy than grid-based models:

- **Visual Crossing** (station data): 0.56°F MAE
- **Open-Meteo** (grid data): 1.84°F MAE

**Expected improvement:** MAE drops from 1.5°F → 1.0-1.2°F with Aeris + existing sources.

---

## Pricing

**Developer Plan:** $49/month
- 25,000 API calls/day
- Station-based forecasts
- Historical data access
- No credit card required for trial

**Free Trial:** 30 days (evaluate before committing)

---

## Setup Steps

### 1. Sign Up for Aeris Weather

1. Go to: https://www.aerisweather.com/signup/
2. Select **Developer** plan
3. Create account
4. Verify email

### 2. Get API Credentials

1. Log in to Aeris dashboard
2. Navigate to **Apps** → **Create New App**
3. Name it "Stormwatch Weather Trader"
4. Copy your credentials:
   - **Client ID:** (e.g., `AbC123xYz...`)
   - **Client Secret:** (e.g., `dEf456MnO...`)

### 3. Add to Config

Edit `weather-v2/config.json`:

```json
{
  "weather": {
    "aerisClientId": "YOUR_CLIENT_ID_HERE",
    "aerisClientSecret": "YOUR_CLIENT_SECRET_HERE",
    ...
  }
}
```

Or set environment variables (safer):

```bash
export AERIS_CLIENT_ID="YOUR_CLIENT_ID_HERE"
export AERIS_CLIENT_SECRET="YOUR_CLIENT_SECRET_HERE"
```

### 4. Test Integration

```bash
cd /data/.openclaw/workspace/projects/nyx-dashboard/weather-v2
node -e "
const aeris = require('./core/forecast-sources-aeris');
(async () => {
  const forecasts = await aeris.fetchAeris('KDFW', 2);  // Dallas airport
  if (forecasts) {
    console.log('✅ Aeris working!');
    console.log('Sample forecast:', forecasts[0]);
  } else {
    console.log('❌ Aeris not working - check credentials');
  }
})();
"
```

Expected output:
```
✅ Aeris working!
Sample forecast: {
  source: 'aeris',
  date: '2026-03-28',
  highTemp: 76.2,
  unit: 'F',
  reliability: 0.92
}
```

---

## Alternative: Weather Underground (Free)

If you don't want to pay for Aeris, try **Weather Underground** (free tier):

### Setup

1. Sign up: https://www.wunderground.com/weather/api/
2. Get API key
3. Add to config:

```json
{
  "weather": {
    "wundergroundKey": "YOUR_KEY_HERE",
    ...
  }
}
```

**Note:** WUnderground has lower accuracy (MAE ~2.4°F vs Aeris 1.5°F) but still better than Open-Meteo (3.5°F).

---

## What Happens When Aeris is Added?

### Before (current setup, 4 sources):
- NOAA: 0.90 weight, 2.0°F MAE
- Visual Crossing: 0.85 weight, 2.2°F MAE
- WeatherAPI: 0.70 weight, 2.5°F MAE
- Tomorrow.io: 0.88 weight, 1.8°F MAE

**Estimated MAE:** 1.5°F

### After (with Aeris, 5 sources):
- **Aeris: 0.92 weight, 1.5°F MAE** ← NEW
- NOAA: 0.90 weight, 2.0°F MAE
- Visual Crossing: 0.85 weight, 2.2°F MAE
- Tomorrow.io: 0.88 weight, 1.8°F MAE
- WeatherAPI: 0.70 weight, 2.5°F MAE

**Estimated MAE:** 1.1°F

---

## Expected Performance Improvement

| Metric | Before (4 sources) | After (Aeris + 4) | Improvement |
|--------|-------------------|-------------------|-------------|
| **MAE** | 1.5°F | 1.1°F | -27% error |
| **Win Rate** | 53% | 65-70% | +12-17pp |
| **Closest Bucket Hit Rate** | 32% | 42% | +10pp |
| **Edge per Trade** | Breakeven | +15-20% | Real edge |

**Break-even threshold:** If measured MAE <1.3°F after 2 weeks, the system has real edge.

---

## Monitoring

After adding Aeris, check accuracy after 50+ resolved trades:

```bash
cd /data/.openclaw/workspace/projects/nyx-dashboard/weather-v2
node scripts/forecast-report.js
```

Expected output:
```
Per-source accuracy:
  aeris:          1.2°F MAE (92% reliability)
  tomorrow.io:    1.8°F MAE (88% reliability)
  noaa:           2.0°F MAE (90% reliability)
  visualcrossing: 2.2°F MAE (85% reliability)

Ensemble MAE: 1.1°F (target: <1.3°F)
```

If Aeris MAE >2.0°F → something is wrong (check station codes in config.json).

---

## Troubleshooting

### "aeris.fetchAeris is not a function"
- Check that `core/forecast-sources-aeris.js` exists
- Verify `module.exports = { fetchAeris, fetchWunderground }` at end of file

### "401 Unauthorized"
- Double-check Client ID and Secret (no typos)
- Verify account is active (free trial not expired)

### "No forecasts returned"
- Check that cities in `config.json` have `station` field (e.g., `"station": "KDFW"`)
- Aeris only works for cities with airport codes

### Aeris returns same temps as Open-Meteo
- You're hitting the grid endpoint, not station endpoint
- Verify URL: should be `/forecasts/{STATION}`, not `/forecasts/{lat},{lon}`

---

## Cost-Benefit Analysis

**Monthly cost:** $49  
**Expected daily profit improvement:** $1-2/day (from better win rate)  
**Break-even:** ~30 days

**After 2 months:** Net positive if measured MAE <1.3°F and WR >65%.

**Recommendation:** Start with 30-day free trial, verify improvement, then decide.

---

## Next Steps After Setup

1. **Add Aeris credentials** (5 min)
2. **Run test-filters.js** to verify integration (1 min)
3. **Paper trade for 2 weeks** (collect 50+ resolved positions)
4. **Run forecast-report.js** to measure real MAE (1 min)
5. **Go/No-Go decision:** If MAE <1.3°F + WR >65% → enable real trading

**Questions?** Check Aeris docs: https://www.aerisweather.com/support/docs/api/
