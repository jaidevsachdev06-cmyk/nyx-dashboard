/**
 * core/forecast-tracker.js — Track forecast accuracy by source/city/horizon
 * 
 * CRITICAL: This is the feedback loop that makes V3+ work.
 * Measures actual MAE per source → adjusts weights → improves edge.
 */

const fs = require('fs');
const path = require('path');

const TRACKER_FILE = path.resolve(__dirname, '..', 'logs', '.forecast-error-tracker.json');

function loadTracker() {
  try {
    return JSON.parse(fs.readFileSync(TRACKER_FILE, 'utf8'));
  } catch {
    return { bySource: {}, byCity: {}, byCitySource: {} };
  }
}

function saveTracker(data) {
  try {
    fs.mkdirSync(path.dirname(TRACKER_FILE), { recursive: true });
    fs.writeFileSync(TRACKER_FILE, JSON.stringify(data, null, 2));
  } catch (e) {
    console.error('[forecast-tracker] Failed to save:', e.message);
  }
}

/**
 * Record a forecast and its eventual outcome
 * Called when a trade is entered (stores forecast) and resolved (measures error)
 * @param {string} tradeId
 * @param {string} city
 * @param {string} date - YYYY-MM-DD
 * @param {number} forecastTemp
 * @param {number} numSources - Total number of sources used
 * @param {Array} sourceDetails - [{source, weight}] from signal
 */
function recordForecast(tradeId, city, date, forecastTemp, numSources, sourceDetails) {
  const tracker = loadTracker();
  
  if (!tracker.pending) tracker.pending = {};
  
  tracker.pending[tradeId] = {
    city,
    date,
    forecastTemp,
    numSources,
    forecastWeights: sourceDetails || [],  // Store as forecastWeights internally
    recordedAt: new Date().toISOString()
  };
  
  saveTracker(tracker);
}

/**
 * Measure forecast error after market resolves
 * @param {string} tradeId 
 * @param {number} actualTemp - Polymarket resolution temp
 */
function measureError(tradeId, actualTemp) {
  const tracker = loadTracker();
  
  const pending = tracker.pending?.[tradeId];
  if (!pending) {
    console.warn(`[forecast-tracker] No pending forecast for trade ${tradeId}`);
    return null;
  }
  
  const error = Math.abs(pending.forecastTemp - actualTemp);
  const horizon = calculateHorizon(pending.date, pending.recordedAt);
  
  // Initialize structures
  if (!tracker.bySource) tracker.bySource = {};
  if (!tracker.byCity) tracker.byCity = {};
  if (!tracker.byCitySource) tracker.byCitySource = {};
  
  // Update global source stats
  for (const sw of (pending.forecastWeights || [])) {
    const source = sw.source || 'unknown';
    if (!tracker.bySource[source]) {
      tracker.bySource[source] = {
        errors: [],
        mae: null,
        n: 0,
        byHorizon: {}
      };
    }
    
    tracker.bySource[source].errors.push(error);
    tracker.bySource[source].n++;
    tracker.bySource[source].mae = calculateMAE(tracker.bySource[source].errors);
    
    // Track by horizon (0day, 1day, 2day)
    const horizonKey = `${horizon}day`;
    if (!tracker.bySource[source].byHorizon[horizonKey]) {
      tracker.bySource[source].byHorizon[horizonKey] = { errors: [], mae: null, n: 0 };
    }
    tracker.bySource[source].byHorizon[horizonKey].errors.push(error);
    tracker.bySource[source].byHorizon[horizonKey].n++;
    tracker.bySource[source].byHorizon[horizonKey].mae = calculateMAE(
      tracker.bySource[source].byHorizon[horizonKey].errors
    );
  }
  
  // Update city stats
  if (!tracker.byCity[pending.city]) {
    tracker.byCity[pending.city] = { errors: [], mae: null, n: 0 };
  }
  tracker.byCity[pending.city].errors.push(error);
  tracker.byCity[pending.city].n++;
  tracker.byCity[pending.city].mae = calculateMAE(tracker.byCity[pending.city].errors);
  
  // Update city+source stats (most granular)
  for (const sw of (pending.forecastWeights || [])) {
    const source = sw.source || 'unknown';
    const key = `${pending.city}|${source}`;
    
    if (!tracker.byCitySource[key]) {
      tracker.byCitySource[key] = {
        city: pending.city,
        source,
        errors: [],
        mae: null,
        n: 0,
        byHorizon: {}
      };
    }
    
    tracker.byCitySource[key].errors.push(error);
    tracker.byCitySource[key].n++;
    tracker.byCitySource[key].mae = calculateMAE(tracker.byCitySource[key].errors);
    
    // Track by horizon at city+source level
    const horizonKey = `${horizon}day`;
    if (!tracker.byCitySource[key].byHorizon[horizonKey]) {
      tracker.byCitySource[key].byHorizon[horizonKey] = { errors: [], mae: null, n: 0 };
    }
    tracker.byCitySource[key].byHorizon[horizonKey].errors.push(error);
    tracker.byCitySource[key].byHorizon[horizonKey].n++;
    tracker.byCitySource[key].byHorizon[horizonKey].mae = calculateMAE(
      tracker.byCitySource[key].byHorizon[horizonKey].errors
    );
  }
  
  // Remove from pending
  delete tracker.pending[tradeId];
  
  saveTracker(tracker);
  
  return {
    tradeId,
    forecastTemp: pending.forecastTemp,
    actualTemp,
    error,
    horizon,
    city: pending.city,
    sources: pending.forecastWeights?.map(w => w.source) || []
  };
}

function calculateHorizon(marketDate, recordedAt) {
  const market = new Date(marketDate + 'T12:00:00Z');
  const recorded = new Date(recordedAt);
  const hoursToEvent = (market - recorded) / 3600000;
  
  if (hoursToEvent < 12) return 0;
  if (hoursToEvent < 36) return 1;
  return 2;
}

function calculateMAE(errors) {
  if (!errors || errors.length === 0) return null;
  return errors.reduce((sum, e) => sum + e, 0) / errors.length;
}

/**
 * Get measured MAE for a source+city+horizon combo
 * Falls back to source-only → global estimate if no data
 */
function getMeasuredMAE(city, sources, horizon) {
  const tracker = loadTracker();
  const horizonKey = `${horizon}day`;
  
  // Try city+source specific (most accurate)
  const citySourceMAEs = [];
  for (const source of sources) {
    const key = `${city}|${source}`;
    const cs = tracker.byCitySource?.[key];
    if (cs && cs.byHorizon?.[horizonKey]?.n >= 3) {
      citySourceMAEs.push(cs.byHorizon[horizonKey].mae);
    }
  }
  if (citySourceMAEs.length > 0) {
    return citySourceMAEs.reduce((sum, m) => sum + m, 0) / citySourceMAEs.length;
  }
  
  // Fall back to source-only (any city)
  const sourceMAEs = [];
  for (const source of sources) {
    const s = tracker.bySource?.[source];
    if (s && s.byHorizon?.[horizonKey]?.n >= 5) {
      sourceMAEs.push(s.byHorizon[horizonKey].mae);
    }
  }
  if (sourceMAEs.length > 0) {
    return sourceMAEs.reduce((sum, m) => sum + m, 0) / sourceMAEs.length;
  }
  
  // Fall back to estimated MAE (from calibration-v3)
  return null;  // Caller will use estimate
}

/**
 * Get summary stats for monitoring
 */
function getSummary() {
  const tracker = loadTracker();
  
  const summary = {
    totalMeasurements: 0,
    bySource: {},
    byCity: {},
    bestSources: [],
    worstSources: []
  };
  
  // Source stats
  for (const [source, data] of Object.entries(tracker.bySource || {})) {
    if (data.n >= 5) {
      summary.bySource[source] = {
        mae: data.mae,
        n: data.n,
        horizons: {}
      };
      for (const [h, hdata] of Object.entries(data.byHorizon || {})) {
        if (hdata.n >= 3) {
          summary.bySource[source].horizons[h] = {
            mae: hdata.mae,
            n: hdata.n
          };
        }
      }
      summary.totalMeasurements += data.n;
    }
  }
  
  // City stats
  for (const [city, data] of Object.entries(tracker.byCity || {})) {
    if (data.n >= 5) {
      summary.byCity[city] = {
        mae: data.mae,
        n: data.n
      };
    }
  }
  
  // Rank sources
  const sourceRanks = Object.entries(summary.bySource)
    .map(([source, data]) => ({ source, mae: data.mae, n: data.n }))
    .sort((a, b) => a.mae - b.mae);
  
  summary.bestSources = sourceRanks.slice(0, 3);
  summary.worstSources = sourceRanks.slice(-3).reverse();
  
  return summary;
}

module.exports = {
  recordForecast,
  measureError,
  getMeasuredMAE,
  getSummary
};
