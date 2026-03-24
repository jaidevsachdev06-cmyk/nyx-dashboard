/**
 * core/multi-source-forecast.js — Multi-source forecast aggregation with reliability weighting
 * 
 * Pulls from multiple independent weather sources and weights by historical accuracy.
 */

const fs = require('fs');
const path = require('path');

// Track per-source, per-city accuracy
const ACCURACY_FILE = path.resolve(__dirname, '..', 'logs', '.source-accuracy.json');

function loadAccuracy() {
  try {
    return JSON.parse(fs.readFileSync(ACCURACY_FILE, 'utf8'));
  } catch {
    return {};
  }
}

function saveAccuracy(data) {
  try {
    fs.mkdirSync(path.dirname(ACCURACY_FILE), { recursive: true });
    fs.writeFileSync(ACCURACY_FILE, JSON.stringify(data, null, 2));
  } catch (e) {
    console.error('[multi-source] Failed to save accuracy:', e.message);
  }
}

// NOAA/Weather.gov (US only, highly reliable)
async function fetchNOAA(lat, lon, forecastDays = 2) {
  try {
    // Get grid point
    const pointRes = await fetch(`https://api.weather.gov/points/${lat},${lon}`, {
      headers: { 'User-Agent': 'StormwatchTrader/1.0' }
    });
    if (!pointRes.ok) return null;
    const pointData = await pointRes.json();
    
    const forecastUrl = pointData.properties?.forecast;
    if (!forecastUrl) return null;
    
    const forecastRes = await fetch(forecastUrl, {
      headers: { 'User-Agent': 'StormwatchTrader/1.0' }
    });
    if (!forecastRes.ok) return null;
    const forecastData = await forecastRes.json();
    
    const forecasts = [];
    const periods = forecastData.properties?.periods || [];
    
    // Extract daily highs for next N days
    const dailyHighs = {};
    for (const period of periods) {
      if (!period.isDaytime) continue;
      const date = period.startTime.split('T')[0];
      if (!dailyHighs[date]) {
        dailyHighs[date] = period.temperature;
      }
    }
    
    const dates = Object.keys(dailyHighs).sort().slice(0, forecastDays);
    for (const date of dates) {
      forecasts.push({
        source: 'noaa',
        date,
        highTemp: dailyHighs[date],
        reliability: 0.85  // NOAA is highly reliable
      });
    }
    
    return forecasts;
  } catch (err) {
    console.warn('[multi-source] NOAA error:', err.message);
    return null;
  }
}

// Visual Crossing (global, free tier)
async function fetchVisualCrossing(lat, lon, forecastDays = 2, apiKey = null, unit = 'F') {
  if (!apiKey) return null;
  
  try {
    const unitGroup = unit === 'F' ? 'us' : 'metric';
    const endDate = new Date(Date.now() + forecastDays * 86400000).toISOString().split('T')[0];
    const url = `https://weather.visualcrossing.com/VisualCrossingWebServices/rest/services/timeline/${lat},${lon}?key=${apiKey}&unitGroup=${unitGroup}&include=days&elements=datetime,tempmax`;
    
    const res = await fetch(url);
    if (!res.ok) return null;
    const data = await res.json();
    
    const forecasts = [];
    const days = data.days || [];
    for (let i = 0; i < Math.min(days.length, forecastDays); i++) {
      forecasts.push({
        source: 'visualcrossing',
        date: days[i].datetime,
        highTemp: days[i].tempmax,
        reliability: 0.75
      });
    }
    
    return forecasts;
  } catch (err) {
    console.warn('[multi-source] Visual Crossing error:', err.message);
    return null;
  }
}

// WeatherAPI.com (global, generous free tier)
async function fetchWeatherAPI(lat, lon, forecastDays = 2, apiKey = null, unit = 'F') {
  if (!apiKey) return null;
  
  try {
    const url = `https://api.weatherapi.com/v1/forecast.json?key=${apiKey}&q=${lat},${lon}&days=${forecastDays}`;
    
    const res = await fetch(url);
    if (!res.ok) return null;
    const data = await res.json();
    
    const forecasts = [];
    const days = data.forecast?.forecastday || [];
    for (const day of days) {
      const temp = unit === 'F' ? day.day.maxtemp_f : day.day.maxtemp_c;
      forecasts.push({
        source: 'weatherapi',
        date: day.date,
        highTemp: temp,
        reliability: 0.70
      });
    }
    
    return forecasts;
  } catch (err) {
    console.warn('[multi-source] WeatherAPI error:', err.message);
    return null;
  }
}

// Open-Meteo ensemble (already implemented)
async function fetchOpenMeteo(lat, lon, forecastDays, unit, models) {
  // This will be imported from existing scanner.js
  return null; // Placeholder
}

/**
 * Fetch forecasts from all available sources
 */
async function fetchAllSources(city, config) {
  const { lat, lon, unit } = city;
  const forecastDays = config.weather?.forecastDays || 2;
  
  const promises = [];
  
  // NOAA (US cities only, always returns Fahrenheit)
  if (lat >= 24 && lat <= 50 && lon >= -125 && lon <= -66) {
    promises.push(fetchNOAA(lat, lon, forecastDays).then(forecasts => {
      if (!forecasts || unit === 'F') return forecasts;
      // Convert NOAA Fahrenheit to Celsius if needed
      return forecasts.map(f => ({
        ...f,
        highTemp: (f.highTemp - 32) * 5 / 9
      }));
    }));
  }
  
  // Visual Crossing (if API key configured)
  if (config.weather?.visualCrossingKey) {
    promises.push(fetchVisualCrossing(lat, lon, forecastDays, config.weather.visualCrossingKey, unit));
  }
  
  // WeatherAPI (if API key configured)
  if (config.weather?.weatherApiKey) {
    promises.push(fetchWeatherAPI(lat, lon, forecastDays, config.weather.weatherApiKey, unit));
  }
  
  // Open-Meteo will be added by caller (existing implementation)
  
  const results = await Promise.all(promises);
  return results.filter(r => r !== null).flat();
}

/**
 * Aggregate forecasts with reliability weighting
 */
function aggregateWithWeighting(forecasts, cityName, unit) {
  const accuracy = loadAccuracy();
  const byDate = {};
  
  for (const f of forecasts) {
    if (!byDate[f.date]) byDate[f.date] = [];
    
    // Get historical accuracy for this source+city
    const sourceAcc = accuracy[f.source]?.cities?.[cityName];
    let weight = f.reliability || 0.5;
    
    if (sourceAcc && sourceAcc.total >= 5) {
      // Use historical accuracy if we have enough data
      weight = sourceAcc.wins / sourceAcc.total;
    }
    
    byDate[f.date].push({ ...f, weight });
  }
  
  const result = {};
  for (const [date, forecastList] of Object.entries(byDate)) {
    if (forecastList.length === 0) continue;
    
    // Weighted average
    const totalWeight = forecastList.reduce((sum, f) => sum + f.weight, 0);
    const weightedMean = forecastList.reduce((sum, f) => sum + f.highTemp * f.weight, 0) / totalWeight;
    
    // Weighted variance for uncertainty estimate
    const variance = forecastList.reduce((sum, f) => {
      return sum + f.weight * Math.pow(f.highTemp - weightedMean, 2);
    }, 0) / totalWeight;
    
    // Add empirical base forecast error (same as scanner's aggregateForecasts)
    // Without this, SD only reflects inter-source spread, not actual forecast error
    const isCelsius = unit === 'C';
    const baseError = isCelsius ? 1.4 : 2.5; // Must match EMPIRICAL_BASE_ERROR in scanner.js
    const blendedVariance = variance + baseError * baseError;
    const sd = Math.sqrt(blendedVariance);
    
    // SD floor: 3.5°F for Fahrenheit, 2.0°C for Celsius (matches scanner's EMPIRICAL_SD_FLOOR)
    const sdFloor = isCelsius ? 2.0 : 3.5;
    
    result[date] = {
      mean: Math.round(weightedMean * 10) / 10,
      sd: Math.max(Math.round(sd * 10) / 10, sdFloor),
      sources: forecastList.length,
      weights: forecastList.map(f => ({ source: f.source, weight: f.weight.toFixed(3) }))
    };
  }
  
  return result;
}

/**
 * Update accuracy tracking after trade resolution
 */
function updateAccuracy(source, city, wasCorrect) {
  const accuracy = loadAccuracy();
  
  if (!accuracy[source]) accuracy[source] = { cities: {} };
  if (!accuracy[source].cities[city]) {
    accuracy[source].cities[city] = { wins: 0, losses: 0, total: 0 };
  }
  
  const cityData = accuracy[source].cities[city];
  if (wasCorrect) cityData.wins++;
  else cityData.losses++;
  cityData.total = cityData.wins + cityData.losses;
  
  saveAccuracy(accuracy);
}

module.exports = {
  fetchAllSources,
  aggregateWithWeighting,
  updateAccuracy,
  fetchNOAA,
  fetchVisualCrossing,
  fetchWeatherAPI
};
