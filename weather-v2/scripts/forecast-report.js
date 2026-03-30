#!/usr/bin/env node
/**
 * scripts/forecast-report.js — Show forecast accuracy stats
 * 
 * Run: node scripts/forecast-report.js
 */

const forecastTracker = require('../core/forecast-tracker');

const summary = forecastTracker.getSummary();

console.log('=== FORECAST ACCURACY REPORT ===\n');
console.log(`Total measurements: ${summary.totalMeasurements}`);

if (summary.totalMeasurements === 0) {
  console.log('\nNo forecast data yet. Run paper trades for 1-2 weeks to build accuracy baseline.');
  process.exit(0);
}

console.log('\n--- BY SOURCE ---');
const sources = Object.entries(summary.bySource).sort((a, b) => a[1].mae - b[1].mae);
for (const [source, data] of sources) {
  console.log(`\n${source}:`);
  console.log(`  Overall MAE: ${data.mae.toFixed(2)}°F (n=${data.n})`);
  if (Object.keys(data.horizons).length > 0) {
    console.log(`  By horizon:`);
    for (const [h, hdata] of Object.entries(data.horizons)) {
      console.log(`    ${h}: ${hdata.mae.toFixed(2)}°F (n=${hdata.n})`);
    }
  }
}

console.log('\n--- BY CITY ---');
const cities = Object.entries(summary.byCity).sort((a, b) => a[1].mae - b[1].mae);
for (const [city, data] of cities) {
  console.log(`${city.padEnd(16)} MAE: ${data.mae.toFixed(2)}°F (n=${data.n})`);
}

console.log('\n--- SOURCE RANKINGS ---');
console.log('Best:');
summary.bestSources.forEach((s, i) => {
  console.log(`  ${i+1}. ${s.source.padEnd(16)} MAE: ${s.mae.toFixed(2)}°F (n=${s.n})`);
});

console.log('\nWorst:');
summary.worstSources.forEach((s, i) => {
  console.log(`  ${i+1}. ${s.source.padEnd(16)} MAE: ${s.mae.toFixed(2)}°F (n=${s.n})`);
});

console.log('\n--- RECOMMENDATIONS ---');
const best = summary.bestSources[0];
const worst = summary.worstSources[0];
if (best && worst) {
  console.log(`Switch from ${worst.source} (MAE ${worst.mae.toFixed(2)}) to ${best.source} (MAE ${best.mae.toFixed(2)})`);
  console.log(`Expected improvement: ${((worst.mae - best.mae) / worst.mae * 100).toFixed(0)}% better accuracy`);
}

console.log('\n');
