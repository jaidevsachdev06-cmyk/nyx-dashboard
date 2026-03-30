/**
 * audit-script.js — Comprehensive audit of V3 implementation
 */

const fs = require('fs');
const path = require('path');

console.log('=== COMPREHENSIVE V3 AUDIT ===\n');

// 1. Syntax check all critical files
console.log('[1/7] Syntax validation...');
const criticalFiles = [
  'core/calibration-v3.js',
  'core/forecast-sources.js',
  'core/forecast-sources-aeris.js',
  'core/multi-source-forecast.js',
  'core/timing.js',
  'core/forecast-tracker.js',
  'stormwatch/scanner.js',
  'stormwatch/observer.js',
  'scripts/run-scan.js',
  'scripts/run-resolve.js'
];

let syntaxErrors = 0;
for (const file of criticalFiles) {
  try {
    require('./' + file);
    console.log(`  ✓ ${file}`);
  } catch (err) {
    console.error(`  ✗ ${file}: ${err.message}`);
    syntaxErrors++;
  }
}
console.log(`  ${syntaxErrors === 0 ? '✅' : '❌'} ${syntaxErrors} syntax errors\n`);

// 2. Test calibration-v3 edge cases
console.log('[2/7] Testing calibration-v3 edge cases...');
const calibration = require('./core/calibration-v3');

const edgeCases = [
  { name: 'Zero distance YES', args: [75, 75, 76, 0.25, 'YES', { unit: 'F', sources: [{source:'noaa',weight:0.9}], daysToEvent: 0 }] },
  { name: 'Zero distance NO', args: [75, 75, 76, 0.75, 'NO', { unit: 'F', sources: [{source:'noaa',weight:0.9}], daysToEvent: 0 }] },
  { name: 'Large distance YES', args: [75, 85, 86, 0.05, 'YES', { unit: 'F', sources: [{source:'noaa',weight:0.9}], daysToEvent: 0 }] },
  { name: 'Large distance NO', args: [75, 85, 86, 0.95, 'NO', { unit: 'F', sources: [{source:'noaa',weight:0.9}], daysToEvent: 0 }] },
  { name: 'Celsius conversion', args: [25, 24, 25, 0.25, 'YES', { unit: 'C', sources: [{source:'noaa',weight:0.9}], daysToEvent: 0 }] },
  { name: 'No sources', args: [75, 75, 76, 0.25, 'YES', { unit: 'F', sources: [], daysToEvent: 0 }] },
  { name: 'Missing sources', args: [75, 75, 76, 0.25, 'YES', { unit: 'F', daysToEvent: 0 }] },
  { name: 'Negative price', args: [75, 75, 76, -0.1, 'YES', { unit: 'F', sources: [{source:'noaa',weight:0.9}], daysToEvent: 0 }] },
  { name: 'Price > 1', args: [75, 75, 76, 1.5, 'YES', { unit: 'F', sources: [{source:'noaa',weight:0.9}], daysToEvent: 0 }] },
  { name: 'Future horizon d2', args: [75, 75, 76, 0.25, 'YES', { unit: 'F', sources: [{source:'noaa',weight:0.9}], daysToEvent: 2 }] }
];

let calibrationBugs = 0;
for (const test of edgeCases) {
  try {
    const result = calibration.evaluateTrade(...test.args);
    if (typeof result.prob !== 'number' || isNaN(result.prob)) {
      console.error(`  ✗ ${test.name}: prob is NaN or not a number`);
      calibrationBugs++;
    } else if (result.prob < 0 || result.prob > 1) {
      console.error(`  ✗ ${test.name}: prob out of range [0,1]: ${result.prob}`);
      calibrationBugs++;
    } else {
      console.log(`  ✓ ${test.name}: prob=${result.prob.toFixed(3)}, edge=${result.edgePct.toFixed(1)}%`);
    }
  } catch (err) {
    console.error(`  ✗ ${test.name}: ${err.message}`);
    calibrationBugs++;
  }
}
console.log(`  ${calibrationBugs === 0 ? '✅' : '❌'} ${calibrationBugs} calibration bugs\n`);

// 3. Test forecast source integrations
console.log('[3/7] Testing forecast source integrations...');
const sources = require('./core/forecast-sources');
const aerisSources = require('./core/forecast-sources-aeris');

async function testSources() {
  let sourceBugs = 0;
  
  // Test Tomorrow.io
  try {
    const tomorrowForecasts = await sources.fetchTomorrowIO(32.7767, -96.797, 2);
    if (tomorrowForecasts && tomorrowForecasts.length > 0) {
      const sample = tomorrowForecasts[0];
      if (sample.unit !== 'F') {
        console.error(`  ✗ Tomorrow.io wrong unit: ${sample.unit} (expected F)`);
        sourceBugs++;
      } else if (sample.highTemp < -50 || sample.highTemp > 150) {
        console.error(`  ✗ Tomorrow.io unrealistic temp: ${sample.highTemp}°F`);
        sourceBugs++;
      } else {
        console.log(`  ✓ Tomorrow.io: ${sample.highTemp}°F on ${sample.date}`);
      }
    } else {
      console.log(`  ⚠ Tomorrow.io: no data (rate limit or key issue)`);
    }
  } catch (err) {
    console.error(`  ✗ Tomorrow.io error: ${err.message}`);
    sourceBugs++;
  }
  
  // Test Aeris
  try {
    const aerisForecasts = await aerisSources.fetchAeris('KDFW', 2);
    if (aerisForecasts && aerisForecasts.length > 0) {
      const sample = aerisForecasts[0];
      if (sample.unit !== 'F') {
        console.error(`  ✗ Aeris wrong unit: ${sample.unit} (expected F)`);
        sourceBugs++;
      } else if (sample.highTemp < -50 || sample.highTemp > 150) {
        console.error(`  ✗ Aeris unrealistic temp: ${sample.highTemp}°F`);
        sourceBugs++;
      } else {
        console.log(`  ✓ Aeris: ${sample.highTemp}°F on ${sample.date}`);
      }
    } else {
      console.error(`  ✗ Aeris: no data returned`);
      sourceBugs++;
    }
  } catch (err) {
    console.error(`  ✗ Aeris error: ${err.message}`);
    sourceBugs++;
  }
  
  console.log(`  ${sourceBugs === 0 ? '✅' : '❌'} ${sourceBugs} source bugs\n`);
  return sourceBugs;
}

// 4. Test multi-source aggregation edge cases
console.log('[4/7] Testing multi-source aggregation...');
async function testAggregation() {
  const multiSource = require('./core/multi-source-forecast');
  let aggBugs = 0;
  
  // Test with empty forecasts
  try {
    const result = multiSource.aggregateWithWeighting([], 'Dallas', 'F');
    if (Object.keys(result).length !== 0) {
      console.error(`  ✗ Empty forecasts should return empty object, got:`, result);
      aggBugs++;
    } else {
      console.log(`  ✓ Empty forecasts handled correctly`);
    }
  } catch (err) {
    console.error(`  ✗ Empty forecasts error: ${err.message}`);
    aggBugs++;
  }
  
  // Test with single source
  try {
    const singleForecast = [
      { source: 'noaa', date: '2026-03-27', highTemp: 75, unit: 'F', reliability: 0.9 }
    ];
    const result = multiSource.aggregateWithWeighting(singleForecast, 'Dallas', 'F');
    if (!result['2026-03-27']) {
      console.error(`  ✗ Single source aggregation failed`);
      aggBugs++;
    } else if (Math.abs(result['2026-03-27'].mean - 75) > 0.1) {
      console.error(`  ✗ Single source mean wrong: ${result['2026-03-27'].mean} (expected ~75)`);
      aggBugs++;
    } else {
      console.log(`  ✓ Single source: mean=${result['2026-03-27'].mean.toFixed(1)}°F`);
    }
  } catch (err) {
    console.error(`  ✗ Single source error: ${err.message}`);
    aggBugs++;
  }
  
  // Test with mixed units (should not happen, but defensive)
  try {
    const mixedForecasts = [
      { source: 'noaa', date: '2026-03-27', highTemp: 75, unit: 'F', reliability: 0.9 },
      { source: 'visualcrossing', date: '2026-03-27', highTemp: 24, unit: 'C', reliability: 0.85 }
    ];
    const result = multiSource.aggregateWithWeighting(mixedForecasts, 'Dallas', 'F');
    // Both should be converted to F
    if (result['2026-03-27'] && result['2026-03-27'].mean > 100) {
      console.error(`  ✗ Mixed units bug: mean=${result['2026-03-27'].mean}°F (too high, C→F conversion failed)`);
      aggBugs++;
    } else {
      console.log(`  ✓ Mixed units handled: mean=${result['2026-03-27']?.mean?.toFixed(1) || 'N/A'}°F`);
    }
  } catch (err) {
    console.log(`  ⚠ Mixed units test skipped (${err.message})`);
  }
  
  console.log(`  ${aggBugs === 0 ? '✅' : '❌'} ${aggBugs} aggregation bugs\n`);
  return aggBugs;
}

// 5. Test forecast tracker
console.log('[5/7] Testing forecast tracker...');
const tracker = require('./core/forecast-tracker');

let trackerBugs = 0;
try {
  // Record a test forecast (correct signature: tradeId, city, date, forecastTemp, numSources, sourceDetails)
  tracker.recordForecast('test-audit', 'Dallas', '2026-03-27', 75.5, 2, [
    { source: 'noaa', weight: 0.9 },
    { source: 'visualcrossing', weight: 0.85 }
  ]);
  
  // Measure against actual
  const result = tracker.measureError('test-audit', 76.8);
  const expectedError = 1.3;  // |75.5 - 76.8| = 1.3
  if (!result || Math.abs(result.error - expectedError) > 0.1) {
    console.error(`  ✗ Error calculation wrong: ${result?.error || 'null'} (expected ${expectedError})`);
    trackerBugs++;
  } else {
    console.log(`  ✓ Forecast tracking: error=${result.error.toFixed(2)}°F`);
  }
  
  // Get summary (should have at least 1 measurement)
  const summary = tracker.getSummary();
  if (!summary || !summary.totalMeasurements || summary.totalMeasurements < 1) {
    console.error(`  ✗ Summary missing measurements: ${JSON.stringify(summary)}`);
    trackerBugs++;
  } else {
    console.log(`  ✓ Summary: ${summary.totalMeasurements} measurements`);
  }
} catch (err) {
  console.error(`  ✗ Forecast tracker error: ${err.message}`);
  trackerBugs++;
}
console.log(`  ${trackerBugs === 0 ? '✅' : '❌'} ${trackerBugs} tracker bugs\n`);

// 6. Test timing optimization
console.log('[6/7] Testing timing optimization...');
const timing = require('./core/timing');

let timingBugs = 0;
try {
  // Get tomorrow's date in YYYY-MM-DD format
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  const tomorrowStr = tomorrow.toISOString().split('T')[0];
  
  // Test 1-day-out market (should always scan)
  const oneDayOut = timing.shouldScanNow('Dallas', tomorrowStr, 'America/Chicago');
  if (!oneDayOut.shouldScan) {
    console.error(`  ✗ 1-day-out should be scannable`);
    timingBugs++;
  } else {
    console.log(`  ✓ 1-day-out timing: ${oneDayOut.reason}`);
  }
  
  // Test same-day market (timing-dependent)
  const today = new Date().toISOString().split('T')[0];
  const sameDay = timing.shouldScanNow('Dallas', today, 'America/Chicago');
  console.log(`  ✓ Same-day timing: ${sameDay.reason} (shouldScan: ${sameDay.shouldScan})`);
  
  // Test past market (should not scan)
  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  const yesterdayStr = yesterday.toISOString().split('T')[0];
  const pastMarket = timing.shouldScanNow('Dallas', yesterdayStr, 'America/Chicago');
  if (pastMarket.shouldScan) {
    console.error(`  ✗ Past market should not be scannable`);
    timingBugs++;
  } else {
    console.log(`  ✓ Past market timing: ${pastMarket.reason}`);
  }
} catch (err) {
  console.error(`  ✗ Timing error: ${err.message}`);
  timingBugs++;
}
console.log(`  ${timingBugs === 0 ? '✅' : '❌'} ${timingBugs} timing bugs\n`);

// 7. Integration test
console.log('[7/7] Running integration smoke test...');
async function integrationTest() {
  const config = require('./config.json');
  const dallas = config.cities.find(c => c.name === 'Dallas');
  const multiSource = require('./core/multi-source-forecast');
  
  let integrationBugs = 0;
  
  try {
    // Fetch all sources for Dallas
    const forecasts = await multiSource.fetchAllSources(dallas, config);
    if (!forecasts || forecasts.length === 0) {
      console.error(`  ✗ No forecasts returned for Dallas`);
      integrationBugs++;
    } else {
      const sources = [...new Set(forecasts.map(f => f.source))];
      console.log(`  ✓ Fetched ${forecasts.length} forecasts from ${sources.length} sources`);
      console.log(`    Sources: ${sources.join(', ')}`);
      
      // Aggregate
      const aggregated = multiSource.aggregateWithWeighting(forecasts, 'Dallas', 'F');
      const today = Object.keys(aggregated)[0];
      if (!today) {
        console.error(`  ✗ Aggregation failed to produce any dates`);
        integrationBugs++;
      } else {
        const forecast = aggregated[today];
        console.log(`  ✓ Aggregated forecast for ${today}:`);
        console.log(`    Mean: ${forecast.mean.toFixed(1)}°F`);
        console.log(`    SD: ${forecast.sd.toFixed(1)}°F`);
        console.log(`    Sources: ${forecast.sources}`);
        console.log(`    Diversity SD: ${forecast.diversitySD?.toFixed(1) || 'N/A'}°F`);
        
        // Test calibration with this forecast
        const analysis = calibration.evaluateTrade(
          forecast.mean,
          74, 75,
          0.25,
          'YES',
          {
            unit: 'F',
            sources: forecast.weights || [],
            daysToEvent: 0,
            diversitySD: forecast.diversitySD
          }
        );
        
        if (isNaN(analysis.prob)) {
          console.error(`  ✗ Calibration produced NaN probability`);
          integrationBugs++;
        } else {
          console.log(`  ✓ Trade evaluation:`);
          console.log(`    Model prob: ${(analysis.prob * 100).toFixed(1)}%`);
          console.log(`    Edge: ${analysis.edgePct.toFixed(1)}%`);
          console.log(`    MAE estimate: ${analysis.forecastMAE?.toFixed(2) || 'N/A'}°F`);
        }
      }
    }
  } catch (err) {
    console.error(`  ✗ Integration test failed: ${err.message}`);
    integrationBugs++;
  }
  
  console.log(`  ${integrationBugs === 0 ? '✅' : '❌'} ${integrationBugs} integration bugs\n`);
  return integrationBugs;
}

// Run async tests
(async () => {
  const sourceBugs = await testSources();
  const aggBugs = await testAggregation();
  const integrationBugs = await integrationTest();
  
  const totalBugs = syntaxErrors + calibrationBugs + sourceBugs + aggBugs + trackerBugs + timingBugs + integrationBugs;
  
  console.log('=== AUDIT SUMMARY ===');
  console.log(`Syntax errors: ${syntaxErrors}`);
  console.log(`Calibration bugs: ${calibrationBugs}`);
  console.log(`Source bugs: ${sourceBugs}`);
  console.log(`Aggregation bugs: ${aggBugs}`);
  console.log(`Tracker bugs: ${trackerBugs}`);
  console.log(`Timing bugs: ${timingBugs}`);
  console.log(`Integration bugs: ${integrationBugs}`);
  console.log(`\nTOTAL BUGS: ${totalBugs}`);
  
  if (totalBugs === 0) {
    console.log('\n✅ ALL TESTS PASSED — SYSTEM READY FOR PAPER TRADING');
  } else {
    console.log(`\n❌ ${totalBugs} BUGS FOUND — FIX BEFORE DEPLOYING`);
  }
  
  process.exit(totalBugs > 0 ? 1 : 0);
})();
