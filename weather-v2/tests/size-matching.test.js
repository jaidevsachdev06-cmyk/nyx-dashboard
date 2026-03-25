/**
 * tests/size-matching.test.js — Verify realSize <= paperSize invariant
 * 
 * Regression test for FIX 14 (2026-03-25)
 * Two trades had realSize > paperSize due to adjusted price calculation.
 * This test ensures the constraint is never violated.
 */

const fs = require('fs');
const assert = require('assert');

function testSizeMatching() {
  const tradesPath = './trades.json';
  if (!fs.existsSync(tradesPath)) {
    console.log('⊘ trades.json not found — skipping size matching test');
    return;
  }

  const trades = JSON.parse(fs.readFileSync(tradesPath, 'utf8'));
  const violations = [];

  trades.trades.forEach((trade, idx) => {
    const paperSize = trade.size || 0;
    const realSize = trade.realSize || 0;

    if (realSize > paperSize && realSize > 0) {
      violations.push({
        idx,
        id: trade.id,
        city: trade.city,
        paperSize,
        realSize,
        violation: `realSize ${realSize} > paperSize ${paperSize}`
      });
    }
  });

  if (violations.length > 0) {
    console.error('❌ FAILED: Size matching violations found:');
    violations.forEach(v => {
      console.error(`  Trade ${v.idx} (${v.id} - ${v.city}): ${v.violation}`);
    });
    process.exit(1);
  }

  console.log(`✓ Size matching test PASSED: ${trades.trades.length} trades validated`);
  console.log(`  • No realSize > paperSize violations`);
}

testSizeMatching();
