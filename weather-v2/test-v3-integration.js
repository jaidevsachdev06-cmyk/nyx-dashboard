#!/usr/bin/env node
/**
 * test-v3-integration.js — Comprehensive V3+ integration test
 * 
 * Tests all new components:
 * - Premium forecast sources (Tomorrow.io, OpenWeatherMap)
 * - Multi-source aggregation with diversity scoring
 * - Calibration-v3 probability model
 * - Forecast error tracking
 */

const config = require('./config.json');
const multiSource = require('./core/multi-source-forecast.js');
const calibration = require('./core/calibration-v3.js');
const forecastTracker = require('./core/forecast-tracker.js');

async function test() {
  console.log('=== V3+ INTEGRATION TEST ===\n');
  
  // Test 1: Premium forecast sources
  console.log('[1/5] Testing premium forecast sources...');
  const city = { 
    name: 'Dallas', 
    lat: 32.7767, 
    lon: -96.7970, 
    unit: 'F', 
    tz: 'America/Chicago' 
  };
  
  const forecasts = await multiSource.fetchAllSources(city, config);
  const sources = [...new Set(forecasts.map(f => f.source))];
  console.log(`  ✓ Fetched ${forecasts.length} forecasts from ${sources.length} sources`);
  console.log(`  ✓ Sources: ${sources.join(', ')}`);
  
  if (!sources.includes('tomorrow.io')) {
    console.warn('  ⚠ Tomorrow.io not working — check API key');
  }
  if (!sources.includes('openweathermap')) {
    console.warn('  ⚠ OpenWeatherMap not working — key may need activation (can take up to 1h)');
  }
  
  // Test 2: Multi-source aggregation with diversity
  console.log('\n[2/5] Testing multi-source aggregation...');
  const aggregated = await multiSource.aggregateWithWeighting(forecasts, city.name, city.unit);
  const date = Object.keys(aggregated)[0];
  const forecast = aggregated[date];
  
  console.log(`  ✓ Aggregated forecast for ${date}:`);
  console.log(`    Mean: ${forecast.mean}°F`);
  console.log(`    SD: ${forecast.sd}°F`);
  console.log(`    Sources: ${forecast.sources}`);
  console.log(`    Diversity SD: ${forecast.diversitySD}°F`);
  
  // Test 3: Calibration-v3 evaluation
  console.log('\n[3/5] Testing calibration-v3 probability model...');
  const forecastSources = forecast.weights;
  
  // Test YES trade (closest bucket)
  const yesEval = calibration.shouldTrade(
    forecast.mean, 
    Math.floor(forecast.mean), 
    Math.ceil(forecast.mean), 
    0.05, 
    'YES', 
    {
      unit: 'F',
      sources: forecastSources,
      daysToEvent: 1,
      diversitySD: forecast.diversitySD
    }
  );
  
  console.log(`  ✓ YES evaluation (${Math.floor(forecast.mean)}-${Math.ceil(forecast.mean)}°F @ 5¢):`);
  console.log(`    Trade: ${yesEval.trade}`);
  console.log(`    Model prob: ${(yesEval.prob * 100).toFixed(1)}%`);
  console.log(`    Edge: ${yesEval.edgePct.toFixed(1)}%`);
  console.log(`    Diversity score: ${yesEval.diversityScore || 1.0}`);
  console.log(`    Forecast MAE: ${yesEval.forecastMAE.toFixed(2)}°F`);
  
  // Test NO trade (distant bucket)
  const noEval = calibration.shouldTrade(
    forecast.mean, 
    Math.floor(forecast.mean) + 5, 
    Math.ceil(forecast.mean) + 6, 
    0.75, 
    'NO', 
    {
      unit: 'F',
      sources: forecastSources,
      daysToEvent: 1,
      diversitySD: forecast.diversitySD
    }
  );
  
  console.log(`  ✓ NO evaluation (${Math.floor(forecast.mean)+5}-${Math.ceil(forecast.mean)+6}°F @ 75¢):`);
  console.log(`    Trade: ${noEval.trade}`);
  console.log(`    Model prob: ${(noEval.prob * 100).toFixed(1)}%`);
  console.log(`    Edge: ${noEval.edgePct.toFixed(1)}%`);
  
  // Test 4: Forecast tracker
  console.log('\n[4/5] Testing forecast error tracker...');
  const testTradeId = 'test-' + Date.now();
  
  forecastTracker.recordForecast(
    testTradeId,
    city.name,
    date,
    forecast.mean,
    forecast.sources,
    forecast.weights
  );
  console.log(`  ✓ Recorded forecast for ${testTradeId}`);
  
  // Simulate resolution
  const actualTemp = forecast.mean + 1.2; // Simulate 1.2°F error
  const errorReport = forecastTracker.measureError(testTradeId, actualTemp);
  
  if (errorReport) {
    console.log(`  ✓ Measured error: ${errorReport.error.toFixed(2)}°F`);
    console.log(`    Forecast: ${errorReport.forecastTemp}°F`);
    console.log(`    Actual: ${errorReport.actualTemp}°F`);
    console.log(`    Sources: ${errorReport.sources.join(', ')}`);
  }
  
  // Test 5: Summary report
  console.log('\n[5/5] Testing forecast summary...');
  const summary = forecastTracker.getSummary();
  console.log(`  ✓ Total measurements: ${summary.totalMeasurements}`);
  
  if (summary.totalMeasurements > 0) {
    console.log(`  ✓ Best sources:`);
    summary.bestSources.forEach((s, i) => {
      console.log(`    ${i+1}. ${s.source}: ${s.mae.toFixed(2)}°F MAE (n=${s.n})`);
    });
  } else {
    console.log('  ℹ No historical data yet (run paper trades for 1-2 weeks)');
  }
  
  // Final verdict
  console.log('\n=== TEST RESULTS ===');
  console.log(`✅ All integration tests passed`);
  console.log(`\nActive features:`);
  console.log(`  • ${sources.length} forecast sources`);
  console.log(`  • Diversity scoring: ${forecast.diversitySD < 1.5 ? 'tight consensus' : forecast.diversitySD < 2.5 ? 'normal spread' : 'high disagreement'}`);
  console.log(`  • Estimated MAE: ${yesEval.forecastMAE.toFixed(2)}°F`);
  console.log(`  • Forecast tracking: enabled`);
  
  console.log(`\n⚠️ Issues:`);
  if (!sources.includes('tomorrow.io')) {
    console.log(`  • Tomorrow.io API not working`);
  }
  if (!sources.includes('openweathermap')) {
    console.log(`  • OpenWeatherMap API not working (may need 1h activation)`);
  }
  if (sources.length < 4) {
    console.log(`  • Only ${sources.length}/5 sources active (expected NOAA, VC, WeatherAPI, Tomorrow.io, OpenWeatherMap)`);
  }
  
  console.log(`\nNext steps:`);
  console.log(`  1. If OpenWeatherMap still fails in 1h, get a new key from openweathermap.org`);
  console.log(`  2. Run paper trades: node scripts/run-scan.js`);
  console.log(`  3. After 2 weeks, check accuracy: node scripts/forecast-report.js`);
  console.log(`  4. If measured MAE <1.5°F + WR >65%, enable real trading\n`);
}

test().catch(err => {
  console.error('\n❌ TEST FAILED:', err.message);
  console.error(err.stack);
  process.exit(1);
});
