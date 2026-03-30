#!/usr/bin/env node
/**
 * Tests for sync-real-orders.js
 *
 * Run: node tests/sync-real-orders.test.js
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const { syncRealOrders, parseOrderLog } = require('../core/sync-real-orders');

let passed = 0;
let failed = 0;

function assert(condition, message) {
  if (condition) {
    console.log(`  ✅ ${message}`);
    passed++;
  } else {
    console.log(`  ❌ FAIL: ${message}`);
    failed++;
  }
}

function createTempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'sync-test-'));
}

function writeJsonl(filePath, entries) {
  fs.writeFileSync(filePath, entries.map(e => JSON.stringify(e)).join('\n'));
}

function writeTrades(filePath, trades) {
  fs.writeFileSync(filePath, JSON.stringify({ trades }, null, 2));
}

// ============================================================================
// Test 1: Match existing order in log to existing trade
// ============================================================================
console.log('\nTest 1: Match existing order → existing trade');
{
  const dir = createTempDir();
  const logPath = path.join(dir, 'log.jsonl');
  const tradesPath = path.join(dir, 'trades.json');

  const orderId = '0xabc123def456';
  const tokenId = '0xtokenid123';

  writeJsonl(logPath, [
    {
      timestamp: '2026-03-21T06:00:00.000Z',
      orderID: orderId,
      tokenId: tokenId,
      side: 'BUY',
      price: 0.62,
      size: 9,
      costUSDC: 5.58,
    },
  ]);

  writeTrades(tradesPath, [
    {
      id: 'oc-existing-trade',
      tokenId: tokenId,
      side: 'NO',
      status: 'open',
      entryPrice: 0.6,
      realOrderId: orderId,
      realEntryPrice: 0.62,
      tradeSource: 'both',
    },
  ]);

  const result = syncRealOrders({ logPath, tradesPath, dryRun: true });

  assert(result.matched === 1, `Matched 1 order (got ${result.matched})`);
  assert(result.orphaned === 0, `0 orphaned (got ${result.orphaned})`);
  assert(result.details.matched[0].matchedBy === 'realOrderId', 'Matched by realOrderId');
  assert(result.details.matched[0].tradeId === 'oc-existing-trade', 'Correct trade ID matched');

  fs.rmSync(dir, { recursive: true });
}

// ============================================================================
// Test 2: Find orphaned order not in trades.json
// ============================================================================
console.log('\nTest 2: Find orphaned order not in trades.json');
{
  const dir = createTempDir();
  const logPath = path.join(dir, 'log.jsonl');
  const tradesPath = path.join(dir, 'trades.json');

  const orphanedOrderId = '0xorphan999';
  const orphanedTokenId = '0xtokenOrphan';

  writeJsonl(logPath, [
    {
      timestamp: '2026-03-22T09:00:00.000Z',
      orderID: orphanedOrderId,
      tokenId: orphanedTokenId,
      side: 'BUY',
      price: 0.57,
      size: 10,
      costUSDC: 5.70,
      proxy: 'gnosis-safe',
      via: 'sdk',
    },
  ]);

  // Trades has a different trade, no match
  writeTrades(tradesPath, [
    {
      id: 'oc-unrelated',
      tokenId: '0xdifferentToken',
      side: 'NO',
      status: 'open',
      realOrderId: '0xdifferentOrder',
      tradeSource: 'both',
    },
  ]);

  const result = syncRealOrders({ logPath, tradesPath, dryRun: true });

  assert(result.matched === 0, `0 matched (got ${result.matched})`);
  assert(result.orphaned === 1, `1 orphaned (got ${result.orphaned})`);
  assert(result.created === 1, `1 candidate created (got ${result.created})`);

  const created = result.details.created[0];
  assert(created.tokenId === orphanedTokenId, 'Candidate has correct tokenId');
  assert(created.entryPrice === 0.57, 'Candidate has correct entry price');

  fs.rmSync(dir, { recursive: true });
}

// ============================================================================
// Test 3: Handle empty log
// ============================================================================
console.log('\nTest 3: Handle empty log');
{
  const dir = createTempDir();
  const logPath = path.join(dir, 'log.jsonl');
  const tradesPath = path.join(dir, 'trades.json');

  // Empty log file
  fs.writeFileSync(logPath, '');

  writeTrades(tradesPath, [
    { id: 'oc-trade1', tokenId: '0xabc', side: 'YES', status: 'open' },
  ]);

  const result = syncRealOrders({ logPath, tradesPath, dryRun: true });

  assert(result.totalLogEntries === 0, `0 log entries (got ${result.totalLogEntries})`);
  assert(result.matched === 0, `0 matched (got ${result.matched})`);
  assert(result.orphaned === 0, `0 orphaned (got ${result.orphaned})`);
  assert(result.parseErrors === 0, `0 parse errors (got ${result.parseErrors})`);

  fs.rmSync(dir, { recursive: true });
}

// ============================================================================
// Test 4: Handle JSON parse errors gracefully
// ============================================================================
console.log('\nTest 4: Handle JSON parse errors gracefully');
{
  const dir = createTempDir();
  const logPath = path.join(dir, 'log.jsonl');
  const tradesPath = path.join(dir, 'trades.json');

  // Mix of valid and invalid lines
  fs.writeFileSync(logPath, [
    '{"timestamp":"2026-03-21T06:00:00.000Z","orderID":"0xgood1","tokenId":"0xtoken1","side":"BUY","price":0.5,"size":10,"costUSDC":5}',
    'this is not json at all',
    '{"broken": json',
    '{"timestamp":"2026-03-21T07:00:00.000Z","orderID":"0xgood2","tokenId":"0xtoken2","side":"BUY","price":0.6,"size":8,"costUSDC":4.8}',
  ].join('\n'));

  writeTrades(tradesPath, []);

  const result = syncRealOrders({ logPath, tradesPath, dryRun: true });

  assert(result.parseErrors === 2, `2 parse errors (got ${result.parseErrors})`);
  assert(result.orphaned === 2, `2 valid orphaned orders (got ${result.orphaned})`);
  assert(result.totalLogEntries === 2, `2 successfully parsed entries (got ${result.totalLogEntries})`);
  assert(result.details.parseErrors.length === 2, 'Parse error details preserved');
  assert(result.details.parseErrors[0].includes('Line 2'), `First error is line 2 (got: ${result.details.parseErrors[0]})`);

  fs.rmSync(dir, { recursive: true });
}

// ============================================================================
// Test 5: Cancelled orders are excluded
// ============================================================================
console.log('\nTest 5: Cancelled orders are excluded');
{
  const dir = createTempDir();
  const logPath = path.join(dir, 'log.jsonl');
  const tradesPath = path.join(dir, 'trades.json');

  const cancelledOrderId = '0xcancelled123';

  writeJsonl(logPath, [
    {
      timestamp: '2026-03-21T08:35:00.000Z',
      orderID: cancelledOrderId,
      tokenId: '0xtoken_cancelled',
      side: 'BUY',
      price: 0.71,
      size: 8,
      costUSDC: 5.68,
    },
    {
      timestamp: '2026-03-21T08:35:30.000Z',
      orderID: cancelledOrderId,
      event: 'CANCELLED_UNFILLED',
      tokenId: '0xtoken_cancelled',
      side: 'BUY',
      price: 0.71,
      size: 8,
    },
  ]);

  writeTrades(tradesPath, []);

  const result = syncRealOrders({ logPath, tradesPath, dryRun: true });

  assert(result.cancelled === 1, `1 cancelled (got ${result.cancelled})`);
  assert(result.orphaned === 0, `0 orphaned — cancelled order excluded (got ${result.orphaned})`);
  assert(result.created === 0, `0 created (got ${result.created})`);

  fs.rmSync(dir, { recursive: true });
}

// ============================================================================
// Test 6: Write mode creates records in trades.json
// ============================================================================
console.log('\nTest 6: Write mode creates records in trades.json');
{
  const dir = createTempDir();
  const logPath = path.join(dir, 'log.jsonl');
  const tradesPath = path.join(dir, 'trades.json');

  writeJsonl(logPath, [
    {
      timestamp: '2026-03-24T02:00:00.000Z',
      orderID: '0xwritetest',
      tokenId: '0xtokenwrite',
      side: 'BUY',
      price: 0.67,
      size: 8,
      costUSDC: 5.36,
      proxy: 'gnosis-safe',
      via: 'sdk',
    },
  ]);

  writeTrades(tradesPath, [{ id: 'oc-existing', tokenId: '0xother', status: 'open' }]);

  const result = syncRealOrders({ logPath, tradesPath, dryRun: false });

  assert(result.created === 1, `1 created (got ${result.created})`);

  // Verify the file was written
  const updated = JSON.parse(fs.readFileSync(tradesPath, 'utf8'));
  assert(updated.trades.length === 2, `trades.json has 2 trades (got ${updated.trades.length})`);

  const candidate = updated.trades.find(t => t.status === 'candidate');
  assert(candidate !== undefined, 'Candidate trade exists');
  assert(candidate.needsReview === true, 'Candidate marked for review');
  assert(candidate.realOrderId === '0xwritetest', 'Correct realOrderId');
  assert(candidate.tradeSource === 'real', 'tradeSource is real');

  // Verify backup was created
  const backups = fs.readdirSync(dir).filter(f => f.includes('backup'));
  assert(backups.length === 1, `Backup file created (found ${backups.length})`);

  fs.rmSync(dir, { recursive: true });
}

// ============================================================================
// Summary
// ============================================================================
console.log(`\n${'='.repeat(50)}`);
console.log(`Results: ${passed} passed, ${failed} failed`);
console.log(`${'='.repeat(50)}\n`);

process.exit(failed > 0 ? 1 : 0);
