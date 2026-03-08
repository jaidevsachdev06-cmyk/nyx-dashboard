/**
 * stormwatch/scanner.js — Multi-model forecast + Dome market discovery + edge calc
 * 
 * OPTIMIZED: Parallel forecast fetches, forecast caching, batched market evaluation.
 */

const config = require('../config.json');
const polymarket = require('../core/polymarket');
const calibration = require('../core/calibration');
const fs = require('fs');
const path = require('path');

// ── Forecast cache (15-min TTL) ──
const CACHE_FILE = path.resolve(__dirname, '..', 'logs', '.forecast-cache.json');
const CACHE_TTL_MS = 15 * 60 * 1000;

function loadCache() {
  try {
    const data = JSON.parse(fs.readFileSync(CACHE_FILE, 'utf8'));
    if (Date.now() - data.ts < CACHE_TTL_MS) return data.forecasts;
  } catch {}
  return null;
}

function saveCache(forecasts) {
  try {
    fs.mkdirSync(path.dirname(CACHE_FILE), { recursive: true });
    fs.writeFileSync(CACHE_FILE, JSON.stringify({ ts: Date.now(), forecasts }));
  } catch {}
}

// ── Normal distribution helpers ──

function erf(x) {
  const a1 = 0.254829592, a2 = -0.284496736, a3 = 1.421413741, a4 = -1.453152027, a5 = 1.061405429, p = 0.3275911;
  const sign = x >= 0 ? 1 : -1;
  x = Math.abs(x);
  const t = 1 / (1 + p * x);
  const y = 1 - (((((a5 * t + a4) * t) + a3) * t + a2) * t + a1) * t * Math.exp(-x * x);
  return sign * y;
}

function normalCDF(x, mean, sd) {
  if (sd <= 0) return x >= mean ? 1 : 0;
  const z = (x - mean) / sd;
  return 0.5 * (1 + erf(z / Math.sqrt(2)));
}

function cToF(c) { return c * 9 / 5 + 32; }

// ── Open-Meteo multi-model forecast ──

async function fetchForecasts(city) {
  const models = config.weather.models;
  const results = [];

  // Parallel fetch all models for this city
  const promises = models.map(async (model) => {
    try {
      const params = new URLSearchParams({
        latitude: city.lat.toString(),
        longitude: city.lon.toString(),
        daily: 'temperature_2m_max',
        models: model,
        forecast_days: config.weather.forecastDays.toString(),
        temperature_unit: city.unit === 'F' ? 'fahrenheit' : 'celsius'
      });

      const url = `${config.weather.forecastApi}?${params}`;
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), 10000);
      const res = await fetch(url, { signal: ctrl.signal });
      clearTimeout(t);
      
      if (!res.ok) {
        console.warn(`[scanner] ${model} failed for ${city.name}: ${res.status}`);
        return [];
      }
      const data = await res.json();

      const modelResults = [];
      if (data.daily && data.daily.temperature_2m_max) {
        const dates = data.daily.time || [];
        const temps = data.daily.temperature_2m_max || [];
        for (let i = 0; i < dates.length; i++) {
          if (temps[i] !== null && temps[i] !== undefined) {
            modelResults.push({ model, date: dates[i], highTemp: temps[i] });
          }
        }
      }
      return modelResults;
    } catch (err) {
      console.warn(`[scanner] ${model} error for ${city.name}: ${err.message}`);
      return [];
    }
  });

  const allResults = await Promise.all(promises);
  for (const r of allResults) results.push(...r);
  return results;
}

// ── Empirical forecast error and city bias corrections ──

const EMPIRICAL_BASE_ERROR = { F: 1.5, C: 0.8 };
const EMPIRICAL_SD_FLOOR = { F: 2.0, C: 1.0 };

const CITY_BIAS = {
  'London':  -1.0,
  'Miami':   -2.0,
  'Chicago':  1.5,
};

function aggregateForecasts(forecasts, cityName, unit) {
  const byDate = {};
  for (const f of forecasts) {
    if (!byDate[f.date]) byDate[f.date] = [];
    byDate[f.date].push(f);  // Keep full forecast objects for weighted ensemble
  }

  const baseError = EMPIRICAL_BASE_ERROR[unit] || EMPIRICAL_BASE_ERROR.F;
  const sdFloor = EMPIRICAL_SD_FLOOR[unit] || EMPIRICAL_SD_FLOOR.F;
  const bias = CITY_BIAS[cityName] || 0;

  const result = {};
  for (const [date, forecastObjs] of Object.entries(byDate)) {
    // Use weighted ensemble from calibration module
    const ensemble = calibration.weightedEnsemble(forecastObjs);
    
    if (ensemble.mean === null) continue;
    
    const rawMean = ensemble.mean;
    const modelSpread = ensemble.sd || 0;
    const n = ensemble.models;
    
    // Add base forecast error and apply city bias
    const blendedSD = Math.sqrt(modelSpread * modelSpread + baseError * baseError);
    const sd = Math.max(blendedSD, sdFloor);
    const mean = rawMean - bias;

    result[date] = {
      mean: Math.round(mean * 10) / 10,
      sd: Math.round(sd * 10) / 10,
      rawMean: Math.round(rawMean * 10) / 10,
      modelSpread: Math.round(modelSpread * 10) / 10,
      biasAdj: bias,
      models: n,
      weights: ensemble.weights  // Track which models contributed
    };
  }
  return result;
}

// ── Bucket parsing from Polymarket questions ──

function parseBucket(question) {
  if (!question) return null;
  const q = question.toLowerCase();

  let m = q.match(/between\s+(\d+)\s*[-–]\s*(\d+)\s*°?\s*([fc])/i);
  if (m) return { type: 'range', low: parseInt(m[1]), high: parseInt(m[2]), unit: m[3].toUpperCase() };

  m = q.match(/between\s+(\d+)\s*°?\s*([fc])\s*(?:and|-|–)\s*(\d+)/i);
  if (m) return { type: 'range', low: parseInt(m[1]), high: parseInt(m[3]), unit: m[2].toUpperCase() };

  m = q.match(/(\d+)\s*°?\s*([fc])\s*or\s*(?:higher|more|above)/i);
  if (m) return { type: 'above', low: parseInt(m[1]), high: null, unit: m[2].toUpperCase() };

  m = q.match(/(?:above|over|higher than|at least)\s+(\d+)\s*°?\s*([fc])/i);
  if (m) return { type: 'above', low: parseInt(m[1]), high: null, unit: m[2].toUpperCase() };

  m = q.match(/(\d+)\s*°?\s*([fc])\s*or\s*(?:lower|less|below|colder)/i);
  if (m) return { type: 'below', low: null, high: parseInt(m[1]), unit: m[2].toUpperCase() };

  m = q.match(/(?:below|under|lower than|at most)\s+(\d+)\s*°?\s*([fc])/i);
  if (m) return { type: 'below', low: null, high: parseInt(m[1]), unit: m[2].toUpperCase() };

  m = q.match(/be\s+(-?\d+)\s*°\s*([fc])/i);
  if (m) return { type: 'exact', low: parseInt(m[1]), high: parseInt(m[1]), unit: m[2].toUpperCase() };

  m = q.match(/(-?\d+)\s*°\s*([fc])\s+on/i);
  if (m) return { type: 'exact', low: parseInt(m[1]), high: parseInt(m[1]), unit: m[2].toUpperCase() };

  return null;
}

function bucketProbability(bucket, forecastMean, forecastSD) {
  if (!bucket) return null;
  switch (bucket.type) {
    case 'range':
    case 'exact':
      return normalCDF(bucket.high + 0.5, forecastMean, forecastSD) - normalCDF(bucket.low - 0.5, forecastMean, forecastSD);
    case 'above':
      return 1 - normalCDF(bucket.low - 0.5, forecastMean, forecastSD);
    case 'below':
      return normalCDF(bucket.high + 0.5, forecastMean, forecastSD);
    default:
      return null;
  }
}

function bucketDistance(bucket, forecastMean) {
  if (!bucket) return null;
  switch (bucket.type) {
    case 'exact':
      return Math.abs(forecastMean - bucket.low);
    case 'range':
      return Math.min(Math.abs(forecastMean - bucket.low), Math.abs(forecastMean - bucket.high));
    case 'above':
      return Math.abs(forecastMean - bucket.low);
    case 'below':
      return Math.abs(forecastMean - bucket.high);
    default:
      return null;
  }
}

// ── Main scan ──

async function scan() {
  const startTime = Date.now();
  console.log(`[scanner] Starting scan for ${config.cities.length} cities...`);
  const candidates = [];

  // Step 1: Fetch all forecasts in parallel (biggest speedup)
  let allForecasts = loadCache();
  
  if (allForecasts) {
    console.log(`[scanner] Using cached forecasts (${Object.keys(allForecasts).length} cities)`);
  } else {
    console.log(`[scanner] Fetching fresh forecasts (parallel)...`);
    const forecastStart = Date.now();
    
    const forecastPromises = config.cities.map(async (city) => {
      const forecasts = await fetchForecasts(city);
      const aggregated = aggregateForecasts(forecasts, city.name, city.unit);
      return { cityName: city.name, aggregated };
    });
    
    const forecastResults = await Promise.all(forecastPromises);
    allForecasts = {};
    for (const r of forecastResults) {
      allForecasts[r.cityName] = r.aggregated;
    }
    saveCache(allForecasts);
    console.log(`[scanner] Forecasts fetched in ${((Date.now() - forecastStart) / 1000).toFixed(1)}s`);
  }

  // Step 2: For each city+date, search markets and evaluate
  for (const city of config.cities) {
    const forecasts = allForecasts[city.name];
    if (!forecasts || Object.keys(forecasts).length === 0) {
      console.warn(`[scanner] No forecast data for ${city.name}`);
      continue;
    }

    console.log(`[scanner] ${city.name} forecasts:`, JSON.stringify(forecasts));

    for (const [date, forecast] of Object.entries(forecasts)) {
      const lowConfidence = (city.unit === 'F' && forecast.sd > 5) || (city.unit === 'C' && forecast.sd > 3);

      try {
        // Format date for search query and pattern matching (convert 2026-03-07 → "March 7")
        const dateObj = new Date(date + 'T12:00:00Z');
        const monthNamesUpper = ['January','February','March','April','May','June','July','August','September','October','November','December'];
        const monthNamesLower = ['january','february','march','april','may','june','july','august','september','october','november','december'];
        const monthShort = ['jan','feb','mar','apr','may','jun','jul','aug','sep','oct','nov','dec'];
        const monthIdx = dateObj.getUTCMonth();
        const dayNum = dateObj.getUTCDate();
        const searchDate = `${monthNamesUpper[monthIdx]} ${dayNum}`;
        
        const query = `highest temperature ${city.name} ${searchDate}`;
        const markets = await polymarket.searchMarkets(query);

        if (!markets || markets.length === 0) {
          console.log(`[scanner] No markets for ${city.name} ${date}`);
          continue;
        }

        console.log(`[scanner] Found ${markets.length} markets for ${city.name} ${date}`);

        const relevantMarkets = markets.filter(m => {
          const q = (m.title || m.question || '').toLowerCase();
          return q.includes(city.name.toLowerCase()) || q.includes(city.name.split(' ')[0].toLowerCase());
        }).slice(0, 10);
        const datePatterns = [
          `${monthNamesLower[monthIdx]} ${dayNum}`,
          `${monthShort[monthIdx]} ${dayNum}`,
          `${String(monthIdx + 1).padStart(2,'0')}/${String(dayNum).padStart(2,'0')}`,
          `${monthIdx + 1}/${dayNum}`,
        ];

        for (const market of relevantMarkets) {
          const question = market.question || market.title || market.name || '';
          const qLow = question.toLowerCase();

          const cityMatch = qLow.includes(city.name.toLowerCase()) || 
                           qLow.includes(city.name.split(' ')[0].toLowerCase());
          if (!cityMatch) continue;

          const dateMatch = datePatterns.some(p => qLow.includes(p));
          if (!dateMatch) {
            console.log(`[scanner] Skip (date mismatch for ${date}): "${question.slice(0, 70)}"`);
            continue;
          }

          const bucket = parseBucket(question);
          if (!bucket) {
            console.log(`[scanner] Could not parse bucket from: "${question}"`);
            continue;
          }

          const modelProb = bucketProbability(bucket, forecast.mean, forecast.sd);
          if (modelProb === null) continue;
          
          // CRITICAL: Filter extreme probabilities on NARROW buckets only
          // Model is overconfident at distribution tails for 1-2°F ranges
          // Feb 28-Mar 2: 3 narrow-bucket trades with >95% prob lost $36.40
          // But Chicago YES "≥42°F" (100% prob) won $15.82 - wide buckets are OK
          const isNarrowBucket = bucket.type === 'exact' || (bucket.type === 'range' && (bucket.high - bucket.low) <= 2);
          if (isNarrowBucket && (modelProb < 0.03 || modelProb > 0.97)) continue;

          const conditionId = market.condition_id || market.conditionId;
          const yesTokenId = market.side_a?.id || (market.tokens || []).find(t => (t.outcome || '').toLowerCase() === 'yes')?.token_id || '';
          const noTokenId = market.side_b?.id || (market.tokens || []).find(t => (t.outcome || '').toLowerCase() === 'no')?.token_id || '';
          
          let yesPrice = null;
          let noPrice = null;

          try {
            if (yesTokenId) yesPrice = await polymarket.getMidpointPrice(yesTokenId);
          } catch (e) {
            console.warn(`[scanner] YES price fetch failed: ${e.message}`);
          }

          try {
            if (noTokenId) noPrice = await polymarket.getMidpointPrice(noTokenId);
          } catch (e) {
            console.warn(`[scanner] NO price fetch failed: ${e.message}`);
          }

          const hasYes = (yesPrice != null && yesPrice > 0.05 && yesPrice < 0.95);
          const hasNo = (noPrice != null && noPrice > 0.05 && noPrice < 0.95);
          if (!hasYes && !hasNo) continue;

          const evYes = hasYes ? (modelProb - yesPrice) : -1e9;
          const evNo  = hasNo  ? ((1 - modelProb) - noPrice) : -1e9;

          const side = evYes >= evNo ? 'YES' : 'NO';
          const tokenId = side === 'YES' ? (yesTokenId || '') : (noTokenId || '');
          const rawModelProb = side === 'YES' ? modelProb : (1 - modelProb);
          const effectivePrice = side === 'YES' ? yesPrice : noPrice;

          if (!tokenId || effectivePrice == null) continue;

          // Apply calibration to adjust for model overconfidence
          const calibratedModelProb = calibration.calibrateProb(rawModelProb);
          
          // Calculate edge with BOTH calibrated and raw probabilities
          const edge = calibratedModelProb - effectivePrice;
          const edgePct = (edge / effectivePrice) * 100;
          const rawEdge = rawModelProb - effectivePrice;
          const rawEdgePct = (rawEdge / effectivePrice) * 100;

          const distFromLine = bucketDistance(bucket, forecast.mean);
          const minModelProb = config.risk.minModelProb || 0.6;
          const maxModelProb = config.risk.maxModelProb || 1.0;
          const minDist = config.risk.minDistanceFromLine || 0;
          const cityBlacklist = config.risk.cityBlacklist || [];
          const bucketTypeBlacklist = config.risk.bucketTypeBlacklist || [];
          
          // Check model prob range (use RAW prob for filtering - calibration is for edge calc only)
          // This maintains strategy continuity while improving edge estimates
          const modelConfident = rawModelProb >= minModelProb && rawModelProb <= maxModelProb;
          
          // Check distance (legacy, now default 0)
          const distOk = distFromLine == null || distFromLine >= minDist;
          
          // Check city blacklist
          const cityOk = !cityBlacklist.includes(city.name);
          
          // Check bucket type blacklist (boundary = above/below types)
          const bucketTypeOk = !(bucketTypeBlacklist.includes('boundary') && (bucket.type === 'above' || bucket.type === 'below'));
          
          const confident = modelConfident && distOk && cityOk && bucketTypeOk;

          const bucketLabel = bucket.type === 'exact' ? `${bucket.low}°${bucket.unit}` :
                              bucket.type === 'range' ? `${bucket.low}-${bucket.high}°${bucket.unit}` :
                              bucket.type === 'above' ? `≥${bucket.low}°${bucket.unit}` :
                              `≤${bucket.high}°${bucket.unit}`;

          const candidate = {
            city: city.name,
            date,
            bucket: bucketLabel,
            bucketType: bucket.type,
            question,
            conditionId: conditionId || '',
            tokenId: tokenId,
            tokenSide: side,
            marketSlug: market.market_slug || market.slug || '',
            side,
            forecastTemp: forecast.mean,
            forecastSD: forecast.sd,
            forecastModels: forecast.models,
            forecastWeights: forecast.weights,  // Which models contributed
            modelProb: parseFloat(calibratedModelProb.toFixed(4)),  // Calibrated (for edge calc)
            rawModelProb: parseFloat(rawModelProb.toFixed(4)),      // Raw (for reference)
            marketPrice: parseFloat(effectivePrice.toFixed(4)),
            edge: parseFloat(edge.toFixed(4)),                      // Calibrated edge
            edgePct: parseFloat(edgePct.toFixed(1)),                // Calibrated edge %
            rawEdge: parseFloat(rawEdge.toFixed(4)),                // Raw edge (for comparison)
            rawEdgePct: parseFloat(rawEdgePct.toFixed(1)),          // Raw edge %
            distFromLine: distFromLine == null ? null : parseFloat(distFromLine.toFixed(2)),
            lowConfidence,
            confident,
            passesThreshold: edgePct >= (config.risk.minEdgePct || 0) && !lowConfidence && confident
          };

          candidates.push(candidate);
          const emoji = candidate.passesThreshold ? '✅' : '⬜';
          console.log(`[scanner] ${emoji} ${city.name} ${date} ${bucketLabel} ${side} | model: ${(calibratedModelProb*100).toFixed(1)}% (raw ${(rawModelProb*100).toFixed(1)}%) mkt: ${(effectivePrice*100).toFixed(1)}% edge: ${edgePct.toFixed(1)}%`);
        }
      } catch (err) {
        console.warn(`[scanner] Market search error for ${city.name} ${date}: ${err.message}`);
      }
    }
  }

  const passing = candidates.filter(c => c.passesThreshold);
  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log(`[scanner] Scan complete: ${candidates.length} evaluated, ${passing.length} pass threshold (${elapsed}s)`);
  return { candidates, passing, timestamp: new Date().toISOString(), elapsedSeconds: parseFloat(elapsed) };
}

module.exports = { scan, fetchForecasts, aggregateForecasts, parseBucket, bucketProbability, normalCDF, erf };
