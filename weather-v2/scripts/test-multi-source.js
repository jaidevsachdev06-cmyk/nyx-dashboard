#!/usr/bin/env node
/**
 * Test multi-source forecast aggregation
 */

const multiSource = require('../core/multi-source-forecast');
const config = require('../config.json');

async function test() {
  console.log('Testing multi-source forecast aggregation...\n');
  
  const testCities = [
    { name: 'New York City', lat: 40.7128, lon: -74.006, unit: 'F' },
    { name: 'Paris', lat: 48.8566, lon: 2.3522, unit: 'C' }
  ];
  
  for (const city of testCities) {
    console.log(`\n${city.name}:`);
    console.log('─'.repeat(60));
    
    const forecasts = await multiSource.fetchAllSources(city, config);
    
    console.log(`Found ${forecasts.length} forecasts from ${new Set(forecasts.map(f => f.source)).size} sources:`);
    
    const bySources = {};
    for (const f of forecasts) {
      if (!bySources[f.source]) bySources[f.source] = [];
      bySources[f.source].push(f);
    }
    
    for (const [source, sourceForecasts] of Object.entries(bySources)) {
      console.log(`\n  ${source.toUpperCase()}:`);
      for (const f of sourceForecasts) {
        console.log(`    ${f.date}: ${f.highTemp}°${city.unit} (reliability: ${(f.reliability*100).toFixed(0)}%)`);
      }
    }
    
    // Test aggregation
    const aggregated = multiSource.aggregateWithWeighting(forecasts, city.name);
    console.log(`\n  WEIGHTED ENSEMBLE:`);
    for (const [date, agg] of Object.entries(aggregated)) {
      console.log(`    ${date}: ${agg.mean}°${city.unit} ± ${agg.sd}°${city.unit} (${agg.sources} sources)`);
      console.log(`      Weights: ${agg.weights.map(w => `${w.source}=${w.weight}`).join(', ')}`);
    }
  }
}

test().catch(err => {
  console.error('Test failed:', err);
  process.exit(1);
});
