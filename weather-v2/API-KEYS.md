# API Keys for V3+ Forecast Sources

## Current Sources (Configured)
- ✅ Open-Meteo (no key needed)
- ✅ NOAA/Weather.gov (no key needed, US only)
- ✅ Visual Crossing (key configured: `visualCrossingKey`)
- ✅ WeatherAPI (key configured: `weatherApiKey`)

## New Premium Sources (V3+)

### Tomorrow.io
- **Why:** Station-based forecasts, claimed MAE ~1.2°F same-day
- **Free tier:** 500 calls/day
- **Sign up:** https://www.tomorrow.io/weather-api/
- **Add to config.json:** `"tomorrowIoKey": "YOUR_KEY_HERE"`

### OpenWeatherMap
- **Why:** OneCall API has good station correction
- **Free tier:** 1,000 calls/day
- **Sign up:** https://openweathermap.org/api
- **Add to config.json:** `"openWeatherKey": "YOUR_KEY_HERE"`

## Priority
1. **Tomorrow.io** — highest expected MAE improvement
2. **OpenWeatherMap** — good backup, large free tier

## How to add keys
```bash
cd /data/.openclaw/workspace/projects/nyx-dashboard/weather-v2
# Edit config.json manually OR via node:
node -e "
const config = require('./config.json');
config.weather.tomorrowIoKey = 'YOUR_TOMORROW_IO_KEY';
config.weather.openWeatherKey = 'YOUR_OPENWEATHER_KEY';
const fs = require('fs');
fs.writeFileSync('./config.json', JSON.stringify(config, null, 2));
"
```

## Testing
After adding keys, run a test scan:
```bash
node stormwatch/scanner.js
```

Check logs for:
- `[tomorrow.io]` or `[openweathermap]` fetch success
- Increased source count in forecasts (e.g. `sources: 11` instead of `sources: 9`)

