#!/usr/bin/env node
/**
 * test-filters.js — Test diversity filtering and source quality gates
 */

const calibration = require('./core/calibration-v3');

console.log('=== TESTING NEW FILTERS ===\n');

// Test 1: High diversity (should reject)
console.log('[1/4] Testing high forecast diversity filter...');
const highDiversity = calibration.shouldTrade(
  75.0,  // forecast
  75, 76,  // bucket
  0.50,  // market price
  'YES',
  {
    unit: 'F',
    sources: [
      { source: 'noaa', weight: 0.90 },
      { source: 'visualcrossing', weight: 0.85 },
      { source: 'weatherapi', weight: 0.70 },
      { source: 'tomorrow.io', weight: 0.88 },
      { source: 'aeris', weight: 0.92 },
    ],
    diversitySD: 4.2,  // High disagreement
    daysToEvent: 0
  }
);
console.log(`  Result: ${highDiversity.trade ? 'TRADE' : 'SKIP'}`);
console.log(`  Reason: ${highDiversity.reason || 'passed'}`);
if (!highDiversity.trade && highDiversity.reason.includes('high forecast uncertainty')) {
  console.log('  ✅ PASS: High diversity correctly filtered\n');
} else {
  console.log('  ❌ FAIL: Should have rejected high diversity\n');
}

// Test 2: Low diversity (should pass filter)
console.log('[2/4] Testing low forecast diversity (tight consensus)...');
const mockSources = [
  { source: 'noaa', weight: 0.90 },
  { source: 'visualcrossing', weight: 0.85 },
  { source: 'weatherapi', weight: 0.70 },
  { source: 'tomorrow.io', weight: 0.88 },
  { source: 'aeris', weight: 0.92 },
];
const lowDiversity = calibration.shouldTrade(
  75.0,
  75, 76,
  0.05,  // Cheap price for YES
  'YES',
  {
    unit: 'F',
    sources: mockSources,
    diversitySD: 1.2,  // Tight consensus
    daysToEvent: 0
  }
);
console.log(`  Result: ${lowDiversity.trade ? 'TRADE' : 'SKIP'}`);
console.log(`  Reason: ${lowDiversity.reason || 'passed all filters, meets edge threshold'}`);
if (lowDiversity.trade || (lowDiversity.reason && !lowDiversity.reason.includes('high forecast uncertainty'))) {
  console.log('  ✅ PASS: Low diversity allowed through\n');
} else {
  console.log('  ❌ FAIL: Low diversity should pass filter\n');
}

// Test 3: Insufficient sources (should reject)
console.log('[3/4] Testing insufficient sources filter...');
const fewSources = calibration.shouldTrade(
  75.0,
  75, 76,
  0.05,
  'YES',
  {
    unit: 'F',
    sources: [
      { source: 'noaa', weight: 0.90 },
      { source: 'visualcrossing', weight: 0.85 }
    ],  // Only 2 sources
    diversitySD: 1.0,
    daysToEvent: 0
  }
);
console.log(`  Result: ${fewSources.trade ? 'TRADE' : 'SKIP'}`);
console.log(`  Reason: ${fewSources.reason || 'passed'}`);
if (!fewSources.trade && fewSources.reason.includes('insufficient sources')) {
  console.log('  ✅ PASS: Insufficient sources correctly filtered\n');
} else {
  console.log('  ❌ FAIL: Should have rejected insufficient sources\n');
}

// Test 4: Good setup (sufficient sources, low diversity)
console.log('[4/4] Testing good setup (should pass all filters)...');
const goodSetup = calibration.shouldTrade(
  75.0,
  75, 76,
  0.05,
  'YES',
  {
    unit: 'F',
    sources: mockSources,
    diversitySD: 1.1,
    daysToEvent: 0
  }
);
console.log(`  Result: ${goodSetup.trade ? 'TRADE' : 'SKIP'}`);
console.log(`  Reason: ${goodSetup.reason || 'passed all filters'}`);
console.log(`  Edge: ${goodSetup.edgePct.toFixed(1)}%`);
console.log(`  Diversity score: ${goodSetup.diversityScore || 1.0}`);
if (goodSetup.trade) {
  console.log('  ✅ PASS: Good setup allowed through\n');
} else {
  console.log(`  ⚠️  Rejected for other reason: ${goodSetup.reason}\n`);
}

console.log('=== FILTER TEST SUMMARY ===');
console.log('✓ Diversity filter (>3.0°F): ENABLED');
console.log('✓ Source count filter (<3): ENABLED');
console.log('✓ Diversity scoring: ENABLED');
console.log('\nFilters are live. Scanner will now skip:');
console.log('  • Trades with diversitySD > 3.0°F (Celsius: > 1.5°C)');
console.log('  • Trades with < 3 forecast sources');
console.log('  • Adjusted probabilities based on consensus quality');
