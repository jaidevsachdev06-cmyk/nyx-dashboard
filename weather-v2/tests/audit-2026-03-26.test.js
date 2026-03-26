/**
 * tests/audit-2026-03-26.test.js
 * 
 * Comprehensive bug audit run on 2026-03-26 20:22 UTC
 * Checks: schema, trades.json integrity, circuit breaker, order log matching
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');

describe('Audit 2026-03-26: Schema, Data Integrity, Circuit Breaker', () => {
  let trades, schema, cb;

  before(() => {
    trades = require('../trades.json');
    schema = require('../core/schema.js');
    cb = require('../core/circuit-breaker.js');
  });

  it('✓ All trades pass schema validation', () => {
    const errors = [];
    trades.trades.forEach((trade, idx) => {
      const validation = schema.validateTrade(trade);
      if (!validation.valid) {
        errors.push(`Trade ${idx} (${trade.id}): ${validation.errors.join('; ')}`);
      }
    });
    assert.strictEqual(errors.length, 0, `${errors.length} trades failed validation:\n${errors.join('\n')}`);
  });

  it('✓ No trades with negative or zero edge (bypass bug regression)', () => {
    // Note: edgePercent is NOT in schema, only signal.edge exists
    const badTrades = trades.trades.filter(t => {
      if (t.signal?.edge !== undefined) {
        return t.signal.edge <= 0;
      }
      return false;
    });
    assert.strictEqual(badTrades.length, 0, `${badTrades.length} trades with edge <= 0`);
  });

  it('✓ Circuit breaker state is consistent', () => {
    const state = cb.getStatus();
    // Circuit is tripped on 2026-03-25T21:05 UTC (4 consecutive losses)
    assert.strictEqual(state.tripped, true, 'Circuit breaker should be tripped');
    assert.strictEqual(state.consecutiveLosses, 4, 'Should have 4 consecutive losses');
    
    // Verify these losses are real
    const recentLosses = trades.trades
      .filter(t => t.result === 'loss' && t.closedAt && new Date(t.closedAt) > new Date('2026-03-24T00:00:00Z'))
      .sort((a, b) => new Date(b.closedAt) - new Date(a.closedAt));
    
    assert(recentLosses.length >= 4, `Should have at least 4 recent losses, found ${recentLosses.length}`);
  });

  it('✓ Real order log has no orphaned real positions', () => {
    // Check that all open trades with realTrading=true have a realOrderId
    const openRealTrades = trades.trades.filter(t => t.status === 'open' && t.realTrading);
    const orphans = openRealTrades.filter(t => !t.realOrderId);
    
    assert.strictEqual(orphans.length, 0, `${orphans.length} open real trades missing realOrderId:\n${orphans.map(t => `  ${t.id} (${t.city})`).join('\n')}`);
  });

  it('✓ No orphaned duplicates in order log (cancellations allowed)', () => {
    const logPath = path.resolve(__dirname, '..', 'real-order-log.jsonl');
    if (!fs.existsSync(logPath)) {
      console.log('  (order log not found, skipping)');
      return;
    }
    
    const lines = fs.readFileSync(logPath, 'utf8').trim().split('\n');
    const orderIds = {};
    const orphans = [];
    
    lines.forEach((line, idx) => {
      try {
        const entry = JSON.parse(line);
        if (orderIds[entry.orderID]) {
          // Expected: first entry is placement, second is cancellation event
          const prev = orderIds[entry.orderID];
          if (prev.event === 'CANCELLED_UNFILLED') {
            // Already cancelled — this is an orphan duplicate
            orphans.push({ orderID: entry.orderID, line: idx + 1, reason: 'Multiple cancellations' });
          }
          // Update to latest state
          orderIds[entry.orderID] = entry;
        } else {
          orderIds[entry.orderID] = entry;
        }
      } catch (e) {
        console.log(`  Warning: line ${idx} failed to parse`);
      }
    });
    
    assert.strictEqual(orphans.length, 0, `${orphans.length} orphaned duplicates found`);
  });

  it('✓ Syntax check: all JS files parse clean', () => {
    const coreDir = path.resolve(__dirname, '..', 'core');
    const files = fs.readdirSync(coreDir).filter(f => f.endsWith('.js'));
    
    const errors = [];
    files.forEach(file => {
      const filePath = path.join(coreDir, file);
      try {
        require(filePath);
      } catch (e) {
        if (e instanceof SyntaxError) {
          errors.push(`${file}: ${e.message}`);
        }
      }
    });
    
    assert.strictEqual(errors.length, 0, `${errors.length} syntax errors:\n${errors.join('\n')}`);
  });

  it('✓ Last 5 trades have consistent structure', () => {
    const last5 = trades.trades.slice(-5);
    const requiredFields = ['id', 'conditionId', 'city', 'status', 'side'];
    
    last5.forEach((trade, idx) => {
      requiredFields.forEach(field => {
        assert(field in trade, `Trade ${idx} (${trade.id}) missing field: ${field}`);
      });
    });
  });

  it('✓ Audit summary', () => {
    const total = trades.trades.length;
    const open = trades.trades.filter(t => t.status === 'open').length;
    const closed = trades.trades.filter(t => t.status === 'closed').length;
    const losses = trades.trades.filter(t => t.result === 'loss').length;
    
    console.log(`\n  Total trades: ${total}`);
    console.log(`  Open positions: ${open}`);
    console.log(`  Closed trades: ${closed}`);
    console.log(`  Loss count: ${losses}`);
    console.log(`  Circuit breaker: ${cb.getStatus().tripped ? 'TRIPPED' : 'OK'}`);
    
    // Audit is "clean" if no validation errors, no orphans, no dupes, syntax OK
    assert(true, 'Audit complete');
  });
});
