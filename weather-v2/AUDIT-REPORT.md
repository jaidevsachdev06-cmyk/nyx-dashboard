# COMPREHENSIVE SYSTEM AUDIT REPORT
**Date:** 2026-03-13 02:30 UTC  
**Auditor:** Stormwatch (self-audit)  
**Context:** Post-catastrophic failure on 2026-03-12 (-$42.82, 0% win rate)

---

## 🔴 CRITICAL ISSUES (Fix Immediately)

### C1: Multi-Source Count Still Not Being Recorded
**Location:** `stormwatch/scanner.js:474`, `stormwatch/entry.js:133`

**Problem:**
Scanner creates candidate object but does NOT include `forecast.sources` (the count):
```javascript
// scanner.js - candidate object missing sources field
forecastTemp: forecast.mean,     // ✓ Included
forecastSD: forecast.sd,          // ✓ Included  
forecastModels: forecast.models,  // ⚠️  Might be undefined
forecastWeights: forecast.weights,// ✓ Included
// ❌ MISSING: sources: forecast.sources
```

Then entry.js tries to access it:
```javascript
// entry.js:133 - references non-existent field
forecastSource: signal.sources && signal.sources.length > 1 ? 'multi-source' : 'open-meteo',
sources: signal.sources || 1,  // Will always be 1!
```

**Impact:** 
- Multi-source data is being fetched correctly
- But trades still record `sources: 1` for ALL trades
- Cannot verify multi-source consensus is actually working
- Same bug that caused the original -$42.82 loss

**Fix:**
```javascript
// In scanner.js, add to candidate object:
forecastSources: forecast.sources,  // Add this line

// In entry.js, fix the check:
forecastSource: signal.forecastSources >= 2 ? 'multi-source' : 'open-meteo',
sources: signal.forecastSources || 1,
```

---

### C2: Config Has Cities in BOTH Blacklist AND Cities Array
**Location:** `config.json:76-90, 104-106`

**Problem:**
Miami, Toronto, London are in `cityBlacklist` but also in `cities` array.

**Impact:**
- Scanner wastes time fetching forecasts for these cities
- Then rejects them in filters
- Unnecessary API calls to weather services
- Could hit rate limits faster

**Fix:**
Remove Miami, Toronto, London from `cities` array entirely, OR remove them from blacklist if you want to trade them.

---

### C3: Lottery Trades Can Bypass Critical Safety Filters
**Location:** `stormwatch/scanner.js:431-435`

**Problem:**
```javascript
const cityOk = isLotteryCandidate || !cityBlacklist.includes(city.name);
const bucketTypeOk = isLotteryCandidate || !(...);
const specificTempNOOk = isLotteryCandidate || !(...);
```

Lottery trades can bypass:
- City blacklist
- Bucket type blacklist (including specific-temp-NO ban)
- Boundary trade filters

**Impact:**
- Lottery trades can enter the EXACT death-trap positions (specific-temp-NO) that caused -$42.82 loss
- Example: "Tokyo 12°C NO" at 5¢ entry would qualify as lottery and bypass the specific-temp-NO ban

**Fix:**
Remove lottery bypass for `specificTempNOOk`:
```javascript
const specificTempNOOk = !isSpecificTempNO || !bucketTypeBlacklist.includes('specific-temp-NO');
// Don't allow lottery to bypass this - it's a death trap at any price
```

---

## 🟡 HIGH PRIORITY ISSUES

### H1: minEdgePct Too Restrictive (75%)
**Location:** `config.json:14`

**Problem:**
`minEdgePct: 75` means you need 75% edge to trade. In the test scan, only 1 trade showed 113% edge and still didn't enter.

**Impact:**
- May block all trades
- Test scan on 2026-03-12 showed ZERO trades passing filters
- System essentially offline

**Recommendation:**
Lower to 40-50% for normal trades:
```json
"minEdgePct": 45,
```

Keep lottery separate with its own criteria (prob ratio).

---

### H2: No Validation That Multi-Source Actually Ran
**Location:** `stormwatch/scanner.js:249-256`

**Problem:**
```javascript
if (config.weather?.multiSource) {
  try {
    multiSourceForecasts = await multiSource.fetchAllSources(city, config);
  } catch (err) {
    console.warn(`[scanner] Multi-source fetch error for ${city.name}:`, err.message);
  }
}
```

If `fetchAllSources` fails silently or returns empty array, we proceed with ONLY Open-Meteo.

**Impact:**
- Could trade with single source when multi-source is required
- No alert if all external APIs are down

**Fix:**
Add validation after fetch:
```javascript
const multiSourceForecasts = await multiSource.fetchAllSources(city, config);
if (config.risk.minForecastSources > 1 && multiSourceForecasts.length === 0) {
  console.error(`[scanner] CRITICAL: No multi-source data for ${city.name}, but minForecastSources=${config.risk.minForecastSources}. Skipping city.`);
  continue; // Skip this city entirely
}
```

---

### H3: forecast.models May Be Undefined
**Location:** `stormwatch/scanner.js:474`

**Problem:**
```javascript
forecastModels: forecast.models,  // What if this doesn't exist?
```

The `aggregateWithWeighting` function doesn't set a `models` field. Only Open-Meteo has models.

**Impact:**
- forecastModels will be undefined for multi-source forecasts
- Not causing crashes but data is incomplete

**Fix:**
Either:
1. Remove this field (not needed since we have weights)
2. Or set it properly in aggregateWithWeighting

---

### H4: No Timeout on Dome API Calls
**Location:** `core/polymarket.js` (not reviewed in detail)

**Problem:**
If Dome API hangs, scanner could get stuck.

**Recommendation:**
Review all Dome API calls and ensure they have timeouts (10-30 seconds).

---

### H5: Circuit Breaker State Not Logged
**Location:** `core/circuit-breaker.js` (not reviewed)

**Problem:**
Circuit breaker trips after 3 consecutive losses, but there's no visibility into when it tripped or when it reset.

**Recommendation:**
Add logging when circuit breaker trips/resets:
```javascript
console.error('[CIRCUIT BREAKER] TRIPPED after 3 consecutive losses - trading paused');
console.log('[CIRCUIT BREAKER] RESET after successful trade');
```

---

## 🟢 IMPROVEMENTS (Nice-to-Have)

### I1: Add Pre-Trade Verification Checklist
**Location:** New file needed

**Recommendation:**
Create `stormwatch/pre-trade-check.js` that validates:
- Multi-source data exists
- forecast.sources >= minForecastSources  
- All required config fields present
- No conflicting settings

Run this before entering ANY trade.

---

### I2: Add Integration Tests
**Location:** New directory `tests/`

**Recommendation:**
Create tests that would have caught the multi-source bug:
```javascript
// tests/multi-source.test.js
test('trades record actual source count', async () => {
  const candidate = await scanner.scan();
  const trade = await entry.processCandidate(candidate.passing[0]);
  expect(trade.signal.sources).toBeGreaterThan(1);
  expect(trade.signal.forecastSource).toBe('multi-source');
});
```

---

### I3: Add Forecast Accuracy Tracking Dashboard
**Location:** New file or dashboard update

**Recommendation:**
Track per-source, per-city accuracy over time:
- Which sources are most accurate?
- Which cities have systematic bias?
- Are weights being adjusted correctly?

---

### I4: Separate Lottery and Normal Trade Configs
**Location:** `config.json:18-24`

**Current Problem:**
Lottery bypasses filters but still subject to minEdgePct/minModelProb from normal trades. This creates confusion.

**Recommendation:**
```json
"lottery": {
  "enabled": true,
  "maxDailyTrades": 4,
  "minEdgePct": 10,        // Separate edge threshold for lottery
  "minModelProb": 0.06,
  "maxEntryPrice": 0.15,
  ...
},
"normal": {
  "minEdgePct": 45,
  "minModelProb": 0.75,
  ...
}
```

---

### I5: Add Dry-Run Mode Flag
**Location:** `config.json`, `stormwatch/entry.js`

**Recommendation:**
```json
"dryRun": true  // If true, scan but don't actually enter trades
```

Would have helped test the multi-source fix before going live.

---

## 📊 CONFIGURATION REVIEW

### Current Risk Settings Analysis

| Setting | Current Value | Assessment | Recommendation |
|---------|---------------|------------|----------------|
| `minEdgePct` | 75% | ❌ Too restrictive | Lower to 40-50% |
| `minModelProb` | 0.75 | ⚠️  Very high | OK for post-failure, but may need 0.65-0.70 later |
| `defaultSizeUSDC` | $6 | ✅ Conservative | Keep |
| `maxDailyLossUSDC` | $50 | ✅ Good | Keep |
| `minForecastSources` | 2 | ✅ CRITICAL - keep | Keep |
| `maxTradesPerCity` | 1 | ✅ Prevents concentration | Keep |
| `cityBlacklist` | Miami, Toronto, London | ⚠️  Also in cities array | Remove from cities array |

---

## 🎯 PRIORITY FIXES (Ranked)

### Must Fix Before Re-Enabling (P0):
1. **C1: Add forecast.sources to candidate** - Without this, multi-source is still broken
2. **C3: Remove lottery bypass for specific-temp-NO** - Lottery can still enter death traps

### Should Fix This Week (P1):
3. **C2: Remove blacklisted cities from cities array** - Wasteful API calls
4. **H1: Lower minEdgePct to 40-50%** - Currently blocking all trades
5. **H2: Add multi-source validation** - Detect silent failures

### Can Fix Later (P2):
6. **H3: Handle undefined forecast.models**
7. **H5: Log circuit breaker state**
8. **I1: Add pre-trade verification**
9. **I2: Add integration tests**

---

## 📝 VERIFICATION CHECKLIST (Before Re-Enabling)

Before turning scanner back on:

- [ ] Fix C1: Scanner passes forecast.sources to candidate
- [ ] Fix C1: entry.js reads signal.forecastSources correctly  
- [ ] Fix C3: Lottery cannot bypass specific-temp-NO filter
- [ ] Test: Run scanner and verify last trade shows sources >= 2
- [ ] Test: Verify forecastSource = "multi-source" in trade record
- [ ] Config: Lower minEdgePct to 45%
- [ ] Config: Remove Miami/Toronto/London from cities array OR from blacklist
- [ ] Test: Dry-run scan and confirm trades would pass filters

---

## 🔍 ROOT CAUSE ANALYSIS

**Why did the original multi-source bug happen?**

1. **No verification after implementation** - Code was written but never tested
2. **Assumed data flow** - Thought forecast.sources would auto-populate
3. **No integration tests** - Nothing checked actual trade records
4. **Silent failures OK** - System didn't fail loudly when sources were missing

**Prevention:**
- Always verify data in final output (trades.json)
- Add tests for critical paths
- Fail loudly when required data missing
- Use dry-run mode for new features

---

## ✅ WHAT'S WORKING WELL

1. **Multi-source fetching** - Visual Crossing, WeatherAPI, NOAA all working
2. **Weighted aggregation** - Correctly combining sources with reliability weights
3. **Bucket filtering** - specific-temp-NO ban is in place (except lottery bypass)
4. **Scalper** - Stop-loss and profit-taking working correctly
5. **Risk limits** - Per-city and position size limits enforced
6. **Circuit breaker** - Paused after 3 losses

---

## 📈 METRICS TO TRACK

Going forward, track these in dashboard:

1. **Source usage**: % of trades using 2+ sources
2. **Forecast accuracy**: Per-source MAE (mean absolute error)
3. **Filter rejection reasons**: Which filters block most trades?
4. **Edge distribution**: Are we seeing good edges or barely passing?
5. **P&L by source count**: Do multi-source trades perform better?

---

**END OF AUDIT**

Total Issues Found:
- 🔴 Critical: 3
- 🟡 High: 5  
- 🟢 Improvements: 5

**Next Steps:** Fix C1 and C3 immediately. Test thoroughly. Then consider H1 before re-enabling scanner.
