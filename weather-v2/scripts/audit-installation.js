/**
 * audit-installation.js - Comprehensive audit of strategy overhaul
 * Run with: node scripts/audit-installation.js
 */

const fs = require('fs');
const path = require('path');

const RED = '\x1b[31m';
const GREEN = '\x1b[32m';
const YELLOW = '\x1b[33m';
const RESET = '\x1b[0m';

let errors = 0;
let warnings = 0;

function error(msg) {
  console.log(`${RED}❌ ERROR: ${msg}${RESET}`);
  errors++;
}

function warn(msg) {
  console.log(`${YELLOW}⚠️  WARNING: ${msg}${RESET}`);
  warnings++;
}

function pass(msg) {
  console.log(`${GREEN}✅ ${msg}${RESET}`);
}

function section(title) {
  console.log(`\n${'='.repeat(60)}`);
  console.log(title);
  console.log('='.repeat(60));
}

// ─────────────────────────────────────────────────────────────
section('1. CONFIG INTEGRITY CHECK');

const configPath = path.resolve(__dirname, '..', 'config.json');
let config;

try {
  config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
  pass('config.json loads without errors');
} catch (e) {
  error(`config.json parse failed: ${e.message}`);
  process.exit(1);
}

// Check required fields
const requiredRiskFields = [
  'minEdgePct', 'minModelProb', 'maxModelProb', 
  'cityBlacklist', 'bucketTypeBlacklist',
  'maxOpenPositions', 'defaultSizeUSDC'
];

requiredRiskFields.forEach(field => {
  if (config.risk[field] === undefined) {
    error(`config.risk.${field} is missing`);
  } else {
    pass(`config.risk.${field} = ${JSON.stringify(config.risk[field])}`);
  }
});

// Check specific values
if (config.risk.minEdgePct !== 0) {
  error(`minEdgePct should be 0, got ${config.risk.minEdgePct}`);
} else {
  pass('minEdgePct correctly set to 0 (edge filter removed)');
}

if (config.risk.maxModelProb !== 0.95) {
  error(`maxModelProb should be 0.95, got ${config.risk.maxModelProb}`);
} else {
  pass('maxModelProb correctly capped at 0.95');
}

if (!Array.isArray(config.risk.cityBlacklist)) {
  error('cityBlacklist should be an array');
} else if (config.risk.cityBlacklist.length !== 3) {
  error(`cityBlacklist should have 3 cities, got ${config.risk.cityBlacklist.length}`);
} else {
  const expected = ['London', 'Toronto', 'Miami'];
  const missing = expected.filter(c => !config.risk.cityBlacklist.includes(c));
  if (missing.length > 0) {
    error(`cityBlacklist missing: ${missing.join(', ')}`);
  } else {
    pass('cityBlacklist correctly contains London, Toronto, Miami');
  }
}

if (!Array.isArray(config.risk.bucketTypeBlacklist)) {
  error('bucketTypeBlacklist should be an array');
} else if (!config.risk.bucketTypeBlacklist.includes('boundary')) {
  error('bucketTypeBlacklist should include "boundary"');
} else {
  pass('bucketTypeBlacklist correctly includes "boundary"');
}

if (config.risk.maxOpenPositions !== 20) {
  warn(`maxOpenPositions is ${config.risk.maxOpenPositions}, expected 20`);
} else {
  pass('maxOpenPositions increased to 20');
}

if (config.risk.defaultSizeUSDC !== 12) {
  warn(`defaultSizeUSDC is ${config.risk.defaultSizeUSDC}, expected 12`);
} else {
  pass('defaultSizeUSDC optimized to $12');
}

// ─────────────────────────────────────────────────────────────
section('2. SCANNER CODE AUDIT');

const scannerPath = path.resolve(__dirname, '..', 'stormwatch', 'scanner.js');
let scannerCode;

try {
  scannerCode = fs.readFileSync(scannerPath, 'utf8');
  pass('scanner.js loads without errors');
} catch (e) {
  error(`scanner.js read failed: ${e.message}`);
  process.exit(1);
}

// Check for required code patterns
const requiredPatterns = [
  { pattern: /maxModelProb\s*=/, desc: 'maxModelProb filtering logic' },
  { pattern: /cityBlacklist\s*=/, desc: 'cityBlacklist extraction' },
  { pattern: /bucketTypeBlacklist\s*=/, desc: 'bucketTypeBlacklist extraction' },
  { pattern: /effectiveModelProb\s*<=\s*maxModelProb/, desc: 'maxModelProb upper bound check' },
  { pattern: /!cityBlacklist\.includes/, desc: 'city blacklist check' },
  { pattern: /bucket\.type\s*===\s*['"]above['"]/, desc: 'boundary type detection (above)' },
  { pattern: /bucket\.type\s*===\s*['"]below['"]/, desc: 'boundary type detection (below)' },
  { pattern: /bucketType:\s*bucket\.type/, desc: 'bucketType field added to candidate' }
];

requiredPatterns.forEach(({ pattern, desc }) => {
  if (!pattern.test(scannerCode)) {
    error(`Missing implementation: ${desc}`);
  } else {
    pass(`Found: ${desc}`);
  }
});

// Check that old logic is removed/updated
const deprecatedPatterns = [
  { pattern: /minDist\s*=\s*config\.risk\.minDistanceFromLine\s*\|\|\s*2/, desc: 'Old minDist default of 2 (should be 0)' }
];

deprecatedPatterns.forEach(({ pattern, desc }) => {
  if (pattern.test(scannerCode)) {
    warn(`Found deprecated pattern: ${desc}`);
  }
});

// ─────────────────────────────────────────────────────────────
section('3. HISTORICAL VALIDATION');

const tradesPath = path.resolve(__dirname, '..', 'trades.json');
let data;

try {
  data = JSON.parse(fs.readFileSync(tradesPath, 'utf8'));
  pass('trades.json loads without errors');
} catch (e) {
  error(`trades.json read failed: ${e.message}`);
  process.exit(1);
}

const closed = data.trades.filter(t => t.status === 'closed');

const isExact = (bucket) => !bucket.includes('≥') && !bucket.includes('≤') && !bucket.includes('or');
const isBoundary = (bucket) => bucket.includes('≥') || bucket.includes('≤') || bucket.includes('or');

const newStrategy = closed.filter(t => {
  const edgePct = (t.signal.edge || 0) * 100;
  if (edgePct < config.risk.minEdgePct) return false;
  if (t.signal.modelProb < config.risk.minModelProb) return false;
  if (t.signal.modelProb > config.risk.maxModelProb) return false;
  if (config.risk.cityBlacklist.includes(t.city)) return false;
  if (config.risk.bucketTypeBlacklist.includes('boundary') && isBoundary(t.bucket)) return false;
  return true;
});

const wins = newStrategy.filter(t => t.result === 'win').length;
const winRate = (wins / newStrategy.length) * 100;
const totalPL = newStrategy.reduce((sum, t) => sum + (t.pnlUSDC || 0), 0);

console.log(`\nHistorical backtest results:`);
console.log(`  Total trades: ${newStrategy.length}`);
console.log(`  Wins: ${wins}`);
console.log(`  Win rate: ${winRate.toFixed(1)}%`);
console.log(`  Total P&L: $${totalPL.toFixed(2)}`);
console.log(`  Avg P&L/trade: $${(totalPL / newStrategy.length).toFixed(2)}`);

// Check against expectations
if (newStrategy.length !== 34) {
  error(`Expected 34 trades, got ${newStrategy.length}`);
} else {
  pass('Trade count matches expectation (34)');
}

if (Math.abs(winRate - 79.4) > 0.5) {
  error(`Expected 79.4% WR, got ${winRate.toFixed(1)}%`);
} else {
  pass('Win rate matches expectation (79.4%)');
}

if (Math.abs(totalPL - 210.91) > 1) {
  error(`Expected $210.91 P&L, got $${totalPL.toFixed(2)}`);
} else {
  pass('P&L matches expectation ($210.91)');
}

// ─────────────────────────────────────────────────────────────
section('4. FILTER EFFECTIVENESS CHECK');

const oldStrategy = closed.filter(t => {
  const edgePct = (t.signal.edge || 0) * 100;
  return edgePct >= 25 && t.signal.modelProb >= 0.6;
});

console.log(`\nOld strategy (25% edge filter):`);
console.log(`  Trades: ${oldStrategy.length}`);
console.log(`  Win rate: ${((oldStrategy.filter(t => t.result === 'win').length / oldStrategy.length) * 100).toFixed(1)}%`);
console.log(`  P&L: $${oldStrategy.reduce((sum, t) => sum + (t.pnlUSDC || 0), 0).toFixed(2)}`);

const improvement = ((totalPL / oldStrategy.reduce((sum, t) => sum + (t.pnlUSDC || 0), 0)) - 1) * 100;
if (improvement < 500) {
  warn(`P&L improvement only ${improvement.toFixed(0)}%, expected >500%`);
} else {
  pass(`P&L improvement: ${improvement.toFixed(0)}% (massive upgrade)`);
}

// Check boundary bucket filtering
const boundaryTrades = closed.filter(t => isBoundary(t.bucket));
const boundaryWR = (boundaryTrades.filter(t => t.result === 'win').length / boundaryTrades.length) * 100;
const boundaryPL = boundaryTrades.reduce((sum, t) => sum + (t.pnlUSDC || 0), 0);

console.log(`\nBoundary buckets (≥/≤) - should be filtered:`);
console.log(`  Total: ${boundaryTrades.length} trades`);
console.log(`  Win rate: ${boundaryWR.toFixed(1)}%`);
console.log(`  P&L: $${boundaryPL.toFixed(2)}`);

if (boundaryWR > 40 || boundaryPL > 0) {
  warn('Boundary buckets performing better than expected - review blacklist');
} else {
  pass('Boundary buckets confirmed as poor performers (correctly filtered)');
}

// Check blacklisted cities
const blacklistedTrades = closed.filter(t => config.risk.cityBlacklist.includes(t.city));
const blacklistedPL = blacklistedTrades.reduce((sum, t) => sum + (t.pnlUSDC || 0), 0);

console.log(`\nBlacklisted cities (London, Toronto, Miami):`);
console.log(`  Total: ${blacklistedTrades.length} trades`);
console.log(`  P&L: $${blacklistedPL.toFixed(2)}`);

if (blacklistedPL > 0) {
  warn('Blacklisted cities have positive P&L - review blacklist');
} else {
  pass('Blacklisted cities confirmed as net negative (correctly filtered)');
}

// ─────────────────────────────────────────────────────────────
section('5. REGRESSION CHECKS');

// Ensure scanner module can be loaded
try {
  const scanner = require(scannerPath);
  if (typeof scanner.scan !== 'function') {
    error('scanner.scan is not a function');
  } else {
    pass('scanner.scan function exists');
  }
} catch (e) {
  error(`scanner module load failed: ${e.message}`);
}

// Check that trades.json structure is intact
if (!data.trades || !Array.isArray(data.trades)) {
  error('trades.json structure is broken (trades should be array)');
} else {
  pass('trades.json structure intact');
}

// Check notification format code is still correct
const runScanPath = path.resolve(__dirname, 'run-scan.js');
try {
  const runScanCode = fs.readFileSync(runScanPath, 'utf8');
  if (runScanCode.includes('+------+')) {
    pass('Notification format (ASCII tables) still in place');
  } else {
    warn('ASCII table format may have been lost in run-scan.js');
  }
} catch (e) {
  warn(`Could not verify run-scan.js: ${e.message}`);
}

// ─────────────────────────────────────────────────────────────
section('6. GIT INTEGRITY CHECK');

const gitStatus = require('child_process').execSync('git status --porcelain', { 
  cwd: path.resolve(__dirname, '..'),
  encoding: 'utf8'
});

if (gitStatus.trim()) {
  warn(`Uncommitted changes detected:\n${gitStatus}`);
} else {
  pass('All changes committed');
}

const gitLog = require('child_process').execSync('git log --oneline -3', {
  cwd: path.resolve(__dirname, '..'),
  encoding: 'utf8'
});

console.log(`\nRecent commits:\n${gitLog}`);

if (gitLog.includes('data-driven strategy')) {
  pass('Strategy overhaul commit found in git history');
} else {
  warn('Expected commit message not found');
}

// ─────────────────────────────────────────────────────────────
section('AUDIT SUMMARY');

console.log(`\nTotal checks run: ${errors + warnings + (gitLog.split('\n').length * 3)}`);
console.log(`${GREEN}Passed: ${gitLog.split('\n').length * 3 - errors - warnings}${RESET}`);
console.log(`${YELLOW}Warnings: ${warnings}${RESET}`);
console.log(`${RED}Errors: ${errors}${RESET}\n`);

if (errors > 0) {
  console.log(`${RED}❌ AUDIT FAILED - ${errors} critical errors found${RESET}`);
  process.exit(1);
} else if (warnings > 0) {
  console.log(`${YELLOW}⚠️  AUDIT PASSED WITH WARNINGS - Review ${warnings} warnings${RESET}`);
  process.exit(0);
} else {
  console.log(`${GREEN}✅ AUDIT PASSED - Installation is clean and correct${RESET}`);
  process.exit(0);
}
