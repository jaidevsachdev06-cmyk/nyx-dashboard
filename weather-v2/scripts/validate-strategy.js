/**
 * validate-strategy.js - Validate new strategy against historical trades
 */

const fs = require('fs');
const path = require('path');

const tradesPath = path.resolve(__dirname, '..', 'trades.json');
const configPath = path.resolve(__dirname, '..', 'config.json');

const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
const data = JSON.parse(fs.readFileSync(tradesPath, 'utf8'));

const closed = data.trades.filter(t => t.status === 'closed');

console.log('VALIDATION: Testing new strategy against historical data\n');
console.log(`Config settings:`);
console.log(`  minEdgePct: ${config.risk.minEdgePct}`);
console.log(`  minModelProb: ${config.risk.minModelProb}`);
console.log(`  maxModelProb: ${config.risk.maxModelProb || 'none'}`);
console.log(`  cityBlacklist: ${(config.risk.cityBlacklist || []).join(', ') || 'none'}`);
console.log(`  bucketTypeBlacklist: ${(config.risk.bucketTypeBlacklist || []).join(', ') || 'none'}\n`);

// Helper functions
const isExact = (bucket) => {
  if (!bucket) return false;
  return !bucket.includes('≥') && !bucket.includes('≤') && !bucket.includes('or');
};

const isBoundary = (bucket) => {
  if (!bucket) return false;
  return bucket.includes('≥') || bucket.includes('≤') || bucket.includes('or');
};

const isRange = (bucket) => {
  if (!bucket) return false;
  return bucket.includes('-') && !isBoundary(bucket);
};

// Apply new filters
const minEdgePct = config.risk.minEdgePct || 0;
const minModelProb = config.risk.minModelProb || 0.6;
const maxModelProb = config.risk.maxModelProb || 1.0;
const cityBlacklist = config.risk.cityBlacklist || [];
const bucketTypeBlacklist = config.risk.bucketTypeBlacklist || [];

const newStrategy = closed.filter(t => {
  // Edge filter
  const edgePct = (t.signal.edge || 0) * 100;
  if (edgePct < minEdgePct) return false;
  
  // Model prob range
  if (t.signal.modelProb < minModelProb) return false;
  if (t.signal.modelProb > maxModelProb) return false;
  
  // City blacklist
  if (cityBlacklist.includes(t.city)) return false;
  
  // Bucket type blacklist
  if (bucketTypeBlacklist.includes('boundary') && isBoundary(t.bucket)) return false;
  
  return true;
});

const wins = newStrategy.filter(t => t.result === 'win').length;
const losses = newStrategy.filter(t => t.result === 'loss').length;
const winRate = (wins / newStrategy.length) * 100;
const totalPL = newStrategy.reduce((sum, t) => sum + (t.pnlUSDC || 0), 0);
const avgPL = totalPL / newStrategy.length;

console.log(`RESULTS:`);
console.log(`  Total trades: ${newStrategy.length}/${closed.length}`);
console.log(`  Wins: ${wins}`);
console.log(`  Losses: ${losses}`);
console.log(`  Win rate: ${winRate.toFixed(1)}%`);
console.log(`  Total P&L: $${totalPL.toFixed(2)}`);
console.log(`  Avg P&L per trade: $${avgPL.toFixed(2)}\n`);

// Bucket type breakdown
const byType = {
  exact: newStrategy.filter(t => isExact(t.bucket)),
  range: newStrategy.filter(t => isRange(t.bucket)),
  boundary: newStrategy.filter(t => isBoundary(t.bucket))
};

console.log(`BUCKET TYPE BREAKDOWN:`);
for (const [type, trades] of Object.entries(byType)) {
  if (trades.length === 0) continue;
  const w = trades.filter(t => t.result === 'win').length;
  const wr = ((w / trades.length) * 100).toFixed(1);
  const pnl = trades.reduce((sum, t) => sum + (t.pnlUSDC || 0), 0).toFixed(2);
  console.log(`  ${type}: ${trades.length} trades, ${wr}% WR, $${pnl} P&L`);
}

// City breakdown
const byCity = {};
newStrategy.forEach(t => {
  if (!byCity[t.city]) byCity[t.city] = [];
  byCity[t.city].push(t);
});

console.log(`\nCITY BREAKDOWN:`);
Object.keys(byCity).sort((a, b) => {
  const pnlA = byCity[a].reduce((s, t) => s + (t.pnlUSDC || 0), 0);
  const pnlB = byCity[b].reduce((s, t) => s + (t.pnlUSDC || 0), 0);
  return pnlB - pnlA;
}).forEach(city => {
  const trades = byCity[city];
  const w = trades.filter(t => t.result === 'win').length;
  const wr = ((w / trades.length) * 100).toFixed(1);
  const pnl = trades.reduce((sum, t) => sum + (t.pnlUSDC || 0), 0).toFixed(2);
  console.log(`  ${city}: ${trades.length} trades, ${wr}% WR, $${pnl} P&L`);
});

// Expected vs actual check
const EXPECTED_TRADES = 34;
const EXPECTED_WR = 79.4;
const EXPECTED_PL = 210.91;

console.log(`\nEXPECTATION CHECK:`);
console.log(`  Expected trades: ${EXPECTED_TRADES} | Actual: ${newStrategy.length} ${newStrategy.length === EXPECTED_TRADES ? '✅' : '❌'}`);
console.log(`  Expected WR: ${EXPECTED_WR.toFixed(1)}% | Actual: ${winRate.toFixed(1)}% ${Math.abs(winRate - EXPECTED_WR) < 1 ? '✅' : '❌'}`);
console.log(`  Expected P&L: $${EXPECTED_PL.toFixed(2)} | Actual: $${totalPL.toFixed(2)} ${Math.abs(totalPL - EXPECTED_PL) < 10 ? '✅' : '❌'}`);

const allPass = newStrategy.length === EXPECTED_TRADES && 
               Math.abs(winRate - EXPECTED_WR) < 1 && 
               Math.abs(totalPL - EXPECTED_PL) < 10;

if (allPass) {
  console.log(`\n✅ VALIDATION PASSED - Strategy is correctly implemented`);
  process.exit(0);
} else {
  console.log(`\n❌ VALIDATION FAILED - Check filter implementation`);
  process.exit(1);
}
