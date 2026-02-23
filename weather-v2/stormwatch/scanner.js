/**
 * stormwatch/scanner.js — Multi-model forecast + Dome market discovery + edge calc
 * 
 * The brain: fetches Open-Meteo forecasts, finds Polymarket weather markets via Dome,
 * and calculates edge using normal distribution probability.
 */

const config = require('../config.json');
const polymarket = require('../core/polymarket');

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

// ── Temperature conversion ──

function cToF(c) { return c * 9 / 5 + 32; }

// ── Open-Meteo multi-model forecast ──

async function fetchForecasts(city) {
  const models = config.weather.models;
  const results = [];

  for (const model of models) {
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
      const res = await fetch(url);
      if (!res.ok) {
        console.warn(`[scanner] ${model} failed for ${city.name}: ${res.status}`);
        continue;
      }
      const data = await res.json();

      if (data.daily && data.daily.temperature_2m_max) {
        const dates = data.daily.time || [];
        const temps = data.daily.temperature_2m_max || [];
        for (let i = 0; i < dates.length; i++) {
          if (temps[i] !== null && temps[i] !== undefined) {
            results.push({ model, date: dates[i], highTemp: temps[i] });
          }
        }
      }
    } catch (err) {
      console.warn(`[scanner] ${model} error for ${city.name}: ${err.message}`);
    }
  }

  return results;
}

/**
 * Aggregate multi-model forecasts into mean + stddev per date.
 */
function aggregateForecasts(forecasts) {
  const byDate = {};
  for (const f of forecasts) {
    if (!byDate[f.date]) byDate[f.date] = [];
    byDate[f.date].push(f.highTemp);
  }

  const result = {};
  for (const [date, temps] of Object.entries(byDate)) {
    const n = temps.length;
    const mean = temps.reduce((s, t) => s + t, 0) / n;
    const variance = n > 1 ? temps.reduce((s, t) => s + (t - mean) ** 2, 0) / (n - 1) : 4; // default sd=2 if single model
    const sd = Math.sqrt(variance);
    result[date] = { mean: Math.round(mean * 10) / 10, sd: Math.round(sd * 10) / 10, models: n };
  }
  return result;
}

// ── Bucket parsing from Polymarket questions ──

/**
 * Parse a temperature bucket from a market question.
 * Returns { type: 'range'|'above'|'below', low, high, unit } or null.
 */
function parseBucket(question) {
  if (!question) return null;
  const q = question.toLowerCase();

  // "between X-Y°F" or "between X and Y"
  let m = q.match(/between\s+(\d+)\s*[-–]\s*(\d+)\s*°?\s*([fc])/i);
  if (m) return { type: 'range', low: parseInt(m[1]), high: parseInt(m[2]), unit: m[3].toUpperCase() };

  m = q.match(/between\s+(\d+)\s*°?\s*([fc])\s*(?:and|-|–)\s*(\d+)/i);
  if (m) return { type: 'range', low: parseInt(m[1]), high: parseInt(m[3]), unit: m[2].toUpperCase() };

  // "X°F or higher" / "X°C or higher" / "above X"
  m = q.match(/(\d+)\s*°?\s*([fc])\s*or\s*(?:higher|more|above)/i);
  if (m) return { type: 'above', low: parseInt(m[1]), high: null, unit: m[2].toUpperCase() };

  m = q.match(/(?:above|over|higher than|at least)\s+(\d+)\s*°?\s*([fc])/i);
  if (m) return { type: 'above', low: parseInt(m[1]), high: null, unit: m[2].toUpperCase() };

  // "X°F or lower" / "below X"
  m = q.match(/(\d+)\s*°?\s*([fc])\s*or\s*(?:lower|less|below|colder)/i);
  if (m) return { type: 'below', low: null, high: parseInt(m[1]), unit: m[2].toUpperCase() };

  m = q.match(/(?:below|under|lower than|at most)\s+(\d+)\s*°?\s*([fc])/i);
  if (m) return { type: 'below', low: null, high: parseInt(m[1]), unit: m[2].toUpperCase() };

  // Exact temperature: "be X°C" or "be X°F" (Polymarket common format)
  m = q.match(/be\s+(-?\d+)\s*°\s*([fc])/i);
  if (m) return { type: 'exact', low: parseInt(m[1]), high: parseInt(m[1]), unit: m[2].toUpperCase() };

  // Fallback exact: "X°C on" or "X°F on"  
  m = q.match(/(-?\d+)\s*°\s*([fc])\s+on/i);
  if (m) return { type: 'exact', low: parseInt(m[1]), high: parseInt(m[1]), unit: m[2].toUpperCase() };

  return null;
}

/**
 * Calculate model probability that actual temp falls in bucket.
 */
function bucketProbability(bucket, forecastMean, forecastSD) {
  if (!bucket) return null;

  switch (bucket.type) {
    case 'range':
      return normalCDF(bucket.high + 0.5, forecastMean, forecastSD) - normalCDF(bucket.low - 0.5, forecastMean, forecastSD);
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



/**
 * Distance (in degrees) from forecast mean to the nearest decision boundary.
 * Used to avoid coinflips near the line.
 */
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

/**
 * Scan all cities for trading candidates.
 * Returns array of candidate objects with edge calculations.
 */
async function scan() {
  console.log(`[scanner] Starting scan for ${config.cities.length} cities...`);
  const candidates = [];

  for (const city of config.cities) {
    console.log(`[scanner] Fetching forecasts for ${city.name}...`);

    // Step 1: Multi-model forecasts
    const forecasts = await fetchForecasts(city);
    if (forecasts.length === 0) {
      console.warn(`[scanner] No forecast data for ${city.name}`);
      continue;
    }

    const aggregated = aggregateForecasts(forecasts);
    console.log(`[scanner] ${city.name} forecasts:`, JSON.stringify(aggregated));

    // Step 2: Search Dome for matching markets
    for (const [date, forecast] of Object.entries(aggregated)) {
      const lowConfidence = (city.unit === 'F' && forecast.sd > 5) || (city.unit === 'C' && forecast.sd > 3);

      try {
        const query = `highest temperature ${city.name} ${date}`;
        const markets = await polymarket.searchMarkets(query);

        if (!markets || markets.length === 0) {
          console.log(`[scanner] No markets for ${city.name} ${date}`);
          continue;
        }

        console.log(`[scanner] Found ${markets.length} markets for ${city.name} ${date}`);

        // Step 3: Evaluate each market (limit to 10 most relevant to avoid rate limit burn)
        const relevantMarkets = markets.filter(m => {
          const q = (m.title || m.question || '').toLowerCase();
          return q.includes(city.name.toLowerCase()) || q.includes(city.name.split(' ')[0].toLowerCase());
        }).slice(0, 10);

        for (const market of relevantMarkets) {
          const question = market.question || market.title || market.name || '';
          
          // Verify it's actually about this city and date
          const cityMatch = question.toLowerCase().includes(city.name.toLowerCase()) || 
                           question.toLowerCase().includes(city.name.split(' ')[0].toLowerCase());
          if (!cityMatch) continue;

          const bucket = parseBucket(question);
          if (!bucket) {
            console.log(`[scanner] Could not parse bucket from: "${question}"`);
            continue;
          }

          const modelProb = bucketProbability(bucket, forecast.mean, forecast.sd);
          if (modelProb === null) continue;

          // Skip extreme probabilities — no edge possible regardless of price
          if (modelProb < 0.05 || modelProb > 0.95) continue;

          // Get market identifiers
          const conditionId = market.condition_id || market.conditionId;
          const yesTokenId = market.side_a?.id || (market.tokens || []).find(t => (t.outcome || '').toLowerCase() === 'yes')?.token_id || '';
          const noTokenId = market.side_b?.id || (market.tokens || []).find(t => (t.outcome || '').toLowerCase() === 'no')?.token_id || '';
          
          // Fetch price only for markets with potential edge (probability filter already applied)
          let marketPrice = null;
          if (yesTokenId) {
            try {
              marketPrice = await polymarket.getMidpointPrice(yesTokenId);
            } catch (e) {
              console.warn(`[scanner] Price fetch failed: ${e.message}`);
            }
          }

          if (!marketPrice || marketPrice <= 0.05 || marketPrice >= 0.95) continue;

          // Step 4: Calculate edge
          const side = modelProb > marketPrice ? 'YES' : 'NO';
          const effectiveModelProb = side === 'YES' ? modelProb : (1 - modelProb);
          const effectivePrice = side === 'YES' ? marketPrice : (1 - marketPrice);
          const edge = effectiveModelProb - effectivePrice;
          const edgePct = (edge / effectivePrice) * 100;

          // Confidence gates
          const distFromLine = bucketDistance(bucket, forecast.mean);
          const minModelProb = config.risk.minModelProb || 0.6;
          const minDist = config.risk.minDistanceFromLine || 2;
          const confident = (effectiveModelProb >= minModelProb) && (distFromLine == null || distFromLine >= minDist);


          const bucketLabel = bucket.type === 'exact' ? `${bucket.low}°${bucket.unit}` :
                              bucket.type === 'range' ? `${bucket.low}-${bucket.high}°${bucket.unit}` :
                              bucket.type === 'above' ? `≥${bucket.low}°${bucket.unit}` :
                              `≤${bucket.high}°${bucket.unit}`;

          const candidate = {
            city: city.name,
            date,
            bucket: bucketLabel,
            question,
            conditionId: conditionId || '',
            tokenId: side === 'YES' ? (yesTokenId || '') : (noTokenId || ''),
            tokenSide: side, // E029: track which side the tokenId belongs to
            marketSlug: market.market_slug || market.slug || '',
            side,
            forecastTemp: forecast.mean,
            forecastSD: forecast.sd,
            forecastModels: forecast.models,
            modelProb: parseFloat(effectiveModelProb.toFixed(4)),
            marketPrice: parseFloat(effectivePrice.toFixed(4)),
            edge: parseFloat(edge.toFixed(4)),
            edgePct: parseFloat(edgePct.toFixed(1)),
            distFromLine: distFromLine == null ? null : parseFloat(distFromLine.toFixed(2)),
            lowConfidence,
            confident,
            passesThreshold: edgePct >= config.risk.minEdgePct && !lowConfidence && confident
          };

          candidates.push(candidate);
          const emoji = candidate.passesThreshold ? '✅' : '⬜';
          console.log(`[scanner] ${emoji} ${city.name} ${date} ${bucketLabel} ${side} | model: ${(effectiveModelProb*100).toFixed(1)}% mkt: ${(effectivePrice*100).toFixed(1)}% edge: ${edgePct.toFixed(1)}%`);
        }
      } catch (err) {
        console.warn(`[scanner] Market search error for ${city.name} ${date}: ${err.message}`);
      }
    }
  }

  const passing = candidates.filter(c => c.passesThreshold);
  console.log(`[scanner] Scan complete: ${candidates.length} evaluated, ${passing.length} pass threshold`);
  return { candidates, passing, timestamp: new Date().toISOString() };
}

module.exports = { scan, fetchForecasts, aggregateForecasts, parseBucket, bucketProbability, normalCDF, erf };
