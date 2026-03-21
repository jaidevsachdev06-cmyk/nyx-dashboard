/**
 * BUG REGRESSION TEST: Manual Entry Validation
 * 
 * On 2026-03-21, a manual real-money position was entered into the system
 * without proper validation or signal data:
 *   - Trade 188: Seattle YES @ 1.4¢
 *   - signal: null (no edge/forecast data)
 *   - tradeSource: "real"
 *   - Real shares were filled (19 units)
 * 
 * This test proves that manual trades entered without signal data should
 * either be rejected or have default signal data generated.
 */

const { validateTrade } = require('../core/schema');
const store = require('../core/store');

console.log('=== BUG REGRESSION TEST: Manual Entry Validation ===\n');

// TEST 1: Prove that null signal passes validation (THE BUG)
console.log('TEST 1: Null signal validation');
const malformed = {
  id: 'oc-test-manual',
  conditionId: '0xfa27b0b742432fe2a9da5684b31c528d3d8967cb6d1af9169a5f4ea3324c9137',
  tokenId: '0x33b7cf5fe97947be08e0a3672cd15024be6525b19f17092b89b440b461ad807',
  tokenSide: 'YES',
  marketSlug: 'test-market',
  city: 'Seattle',
  date: '2026-03-22',
  bucket: '46-47°F',
  question: 'Test question',
  side: 'YES',
  entryPrice: 0.014263,
  size: 19,
  sizeUSDC: 0.271,
  status: 'open',
  result: null,
  pnlUSDC: 0.27,
  createdAt: new Date().toISOString(),
  enteredAt: new Date().toISOString(),
  currentPrice: 0.0285,
  tradeSource: 'real',
  realTrading: true,
  realSize: 19,
  realEntryPrice: 0.014263,
  signal: null,  // ← BUG: null signal passes validation
  notes: 'Manual entry'
};

const validation = validateTrade(malformed);
if (!validation.valid) {
  console.log('✅ Signal validation: Correctly rejected');
} else {
  console.log('❌ BUG CONFIRMED: null signal passes validation');
  console.log('   Reason: signal field is not marked as required in schema');
}
console.log('');

// TEST 2: Find all real trades without signal data
console.log('TEST 2: Real trades without signal data');
const allTrades = store.getAll();
const realWithoutSignal = allTrades.filter(t => 
  t.realTrading && 
  (!t.signal || t.signal === null)
);

console.log(`Found ${realWithoutSignal.length} real trade(s) without signal data`);
realWithoutSignal.forEach(t => {
  const idx = allTrades.indexOf(t);
  console.log(`  [${idx}] ${t.city} ${t.date} ${t.bucket} | ${t.side} @ $${t.entryPrice.toFixed(4)} | real_size: ${t.realSize}`);
});
console.log('');

// TEST 3: List all trades with issue flags
console.log('TEST 3: Issue summary');
const issuesFound = [];

// Issue: real trading enabled but no signal
realWithoutSignal.forEach(t => {
  issuesFound.push({
    trade_id: t.id,
    issue: 'Real trade with null signal',
    city: t.city,
    severity: 'HIGH'
  });
});

console.log(`Total issues found: ${issuesFound.length}`);
issuesFound.forEach(issue => {
  console.log(`  [${issue.severity}] ${issue.trade_id}: ${issue.issue}`);
});
console.log('');

// TEST 4: Verification
console.log('TEST 4: Verification');
if (issuesFound.length === 0) {
  console.log('✅ AUDIT CLEAN: No real trades without signal data');
} else {
  console.log('⚠️  ACTION REQUIRED:');
  console.log('  1. Review each real trade without signal data');
  console.log('  2. Verify they were intentional manual entries');
  console.log('  3. Either close them or add signal data');
}
