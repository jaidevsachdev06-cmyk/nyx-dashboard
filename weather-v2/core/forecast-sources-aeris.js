/**
 * core/forecast-sources-aeris.js — Aeris Weather API integration
 * 
 * Premium station-based forecasts (requires paid account)
 * Best accuracy for airport station predictions (~0.8-1.0°F MAE)
 * 
 * Setup:
 * 1. Sign up at https://www.aerisweather.com/signup/
 * 2. Get API credentials (client_id + client_secret)
 * 3. Add to config.json:
 *    "weather": {
 *      "aerisClientId": "YOUR_CLIENT_ID",
 *      "aerisClientSecret": "YOUR_CLIENT_SECRET"
 *    }
 * 
 * Pricing: Developer plan $49/mo (25k API calls/day)
 * 
 * API docs: https://www.aerisweather.com/support/docs/api/
 */

const config = require('../config.json');

/**
 * Fetch Aeris Weather forecast for a specific airport station
 * @param {string} station - ICAO airport code (e.g., "KLGA", "KDFW")
 * @param {number} forecastDays - Number of days to forecast (max 15)
 * @returns {Promise<Array>} Forecast objects with { source, date, highTemp, unit, reliability }
 */
async function fetchAeris(station, forecastDays = 2) {
  const clientId = process.env.AERIS_CLIENT_ID || config.weather?.aerisClientId;
  const clientSecret = process.env.AERIS_CLIENT_SECRET || config.weather?.aerisClientSecret;
  
  if (!clientId || !clientSecret) {
    console.log('[aeris] API credentials not configured (set aerisClientId + aerisClientSecret in config.json)');
    return null;
  }
  
  try {
    // Aeris forecast endpoint: /forecasts/:location
    // Use station code for precise airport forecasts
    const params = new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      filter: 'day',  // Daily summary forecasts
      limit: forecastDays.toString(),
      plimit: '1',  // One forecast period per day
    });
    
    const url = `https://api.aerisapi.com/forecasts/${station}?${params}`;
    
    const ctrl = new AbortController();
    const timeout = setTimeout(() => ctrl.abort(), 10000);
    
    const res = await fetch(url, { signal: ctrl.signal });
    clearTimeout(timeout);
    
    if (!res.ok) {
      const body = await res.text();
      console.warn(`[aeris] ${station} failed: ${res.status} ${body.slice(0, 200)}`);
      return null;
    }
    
    const data = await res.json();
    
    if (!data.success) {
      console.warn(`[aeris] ${station} error: ${JSON.stringify(data.error || data)}`);
      return null;
    }
    
    const forecasts = [];
    const periods = data.response?.[0]?.periods || [];
    
    for (const period of periods.slice(0, forecastDays)) {
      // Aeris returns both min and max — we want max (daytime high)
      const maxTempF = period.maxTempF;
      const maxTempC = period.maxTempC;
      const dateISO = period.dateTimeISO?.split('T')[0]; // "2026-03-27T00:00:00-04:00" → "2026-03-27"
      
      if (maxTempF != null && dateISO) {
        forecasts.push({
          source: 'aeris',
          date: dateISO,
          highTemp: maxTempF,
          unit: 'F',
          reliability: 0.92  // Estimate: station-based, premium quality
        });
      }
    }
    
    return forecasts;
  } catch (err) {
    console.warn(`[aeris] ${station} error: ${err.message}`);
    return null;
  }
}

/**
 * Fetch Weather Underground forecast (free tier, station-based)
 * 
 * NOTE: WUnderground personal weather station (PWS) API is free but requires signup
 * Docs: https://www.wunderground.com/weather/api/
 * 
 * @param {string} station - ICAO station code
 * @param {number} forecastDays - Days to forecast (max 10)
 * @returns {Promise<Array>}
 */
async function fetchWunderground(station, forecastDays = 2) {
  const apiKey = process.env.WUNDERGROUND_API_KEY || config.weather?.wundergroundKey;
  
  if (!apiKey) {
    console.log('[wunderground] API key not configured');
    return null;
  }
  
  try {
    // WUnderground endpoint: /api/{key}/forecast10day/q/{station}.json
    const url = `https://api.wunderground.com/api/${apiKey}/forecast10day/q/${station}.json`;
    
    const ctrl = new AbortController();
    const timeout = setTimeout(() => ctrl.abort(), 10000);
    
    const res = await fetch(url, { signal: ctrl.signal });
    clearTimeout(timeout);
    
    if (!res.ok) {
      console.warn(`[wunderground] ${station} failed: ${res.status}`);
      return null;
    }
    
    const data = await res.json();
    const forecastDays_data = data.forecast?.simpleforecast?.forecastday || [];
    
    const forecasts = [];
    for (const day of forecastDays_data.slice(0, forecastDays)) {
      const highF = day.high?.fahrenheit;
      const dateObj = day.date;
      const dateISO = `${dateObj.year}-${String(dateObj.month).padStart(2, '0')}-${String(dateObj.day).padStart(2, '0')}`;
      
      if (highF != null && dateISO) {
        forecasts.push({
          source: 'wunderground',
          date: dateISO,
          highTemp: parseFloat(highF),
          unit: 'F',
          reliability: 0.80  // Estimate: station network, free tier
        });
      }
    }
    
    return forecasts;
  } catch (err) {
    console.warn(`[wunderground] ${station} error: ${err.message}`);
    return null;
  }
}

module.exports = {
  fetchAeris,
  fetchWunderground,
};
