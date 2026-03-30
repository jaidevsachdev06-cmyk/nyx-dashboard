/**
 * core/forecast-sources.js — Premium forecast source integrations
 * 
 * Added 2026-03-27: Tomorrow.io, OpenWeatherMap for better MAE
 */

const config = require('../config.json');

// Tomorrow.io free tier: 500 calls/day, 3-day hourly forecast
async function fetchTomorrowIO(lat, lon, forecastDays = 2) {
  const apiKey = process.env.TOMORROW_IO_API_KEY || config.weather?.tomorrowIoKey;
  if (!apiKey) return null;

  try {
    const fields = ['temperatureMax'];
    const units = 'imperial';  // Always use Fahrenheit
    const url = `https://api.tomorrow.io/v4/timelines?location=${lat},${lon}&fields=${fields.join(',')}&timesteps=1d&units=${units}&apikey=${apiKey}`;
    
    const ctrl = new AbortController();
    const timeout = setTimeout(() => ctrl.abort(), 10000);
    const res = await fetch(url, { signal: ctrl.signal });
    clearTimeout(timeout);
    
    if (!res.ok) {
      console.warn(`[tomorrow.io] ${lat},${lon} failed: ${res.status}`);
      return null;
    }
    
    const data = await res.json();
    const timeline = data.data?.timelines?.[0];
    if (!timeline) return null;
    
    const forecasts = [];
    for (const interval of timeline.intervals.slice(0, forecastDays)) {
      const date = interval.startTime.split('T')[0];
      const tempF = interval.values?.temperatureMax;
      if (tempF != null) {
        forecasts.push({
          source: 'tomorrow.io',
          date,
          highTemp: tempF,
          unit: 'F',
          reliability: 0.88  // Initial estimate, will be measured
        });
      }
    }
    
    return forecasts;
  } catch (err) {
    console.warn(`[tomorrow.io] error: ${err.message}`);
    return null;
  }
}

// OpenWeatherMap OneCall (free tier: 1000 calls/day, 7-day daily forecast)
async function fetchOpenWeatherMap(lat, lon, forecastDays = 2) {
  const apiKey = process.env.OPENWEATHER_API_KEY || config.weather?.openWeatherKey;
  if (!apiKey) return null;

  try {
    // OneCall 3.0 requires paid plan, use OneCall 2.5 (still available on free tier)
    const url = `https://api.openweathermap.org/data/2.5/onecall?lat=${lat}&lon=${lon}&exclude=current,minutely,hourly,alerts&units=imperial&appid=${apiKey}`;
    
    const ctrl = new AbortController();
    const timeout = setTimeout(() => ctrl.abort(), 10000);
    const res = await fetch(url, { signal: ctrl.signal });
    clearTimeout(timeout);
    
    if (!res.ok) {
      console.warn(`[openweathermap] ${lat},${lon} failed: ${res.status}`);
      return null;
    }
    
    const data = await res.json();
    const forecasts = [];
    
    for (let i = 0; i < Math.min(forecastDays, data.daily?.length || 0); i++) {
      const day = data.daily[i];
      const date = new Date(day.dt * 1000).toISOString().split('T')[0];
      const tempF = day.temp?.max;
      
      if (tempF != null) {
        forecasts.push({
          source: 'openweathermap',
          date,
          highTemp: tempF,
          unit: 'F',
          reliability: 0.82  // Initial estimate, will be measured
        });
      }
    }
    
    return forecasts;
  } catch (err) {
    console.warn(`[openweathermap] error: ${err.message}`);
    return null;
  }
}

// AccuWeather (requires paid API, placeholder for future)
async function fetchAccuWeather(lat, lon, forecastDays = 2) {
  const apiKey = process.env.ACCUWEATHER_API_KEY || config.weather?.accuWeatherKey;
  if (!apiKey) return null;
  
  // Implementation requires location key lookup first, then daily forecast
  // Skipping for now — premium API tier needed
  return null;
}

module.exports = {
  fetchTomorrowIO,
  fetchOpenWeatherMap,
  fetchAccuWeather
};
