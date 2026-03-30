#!/usr/bin/env node
/**
 * sync-real-orders.js — Reconcile real-order-log.jsonl against trades.json
 *
 * Finds orphaned real orders (placed on Polymarket but missing from trades.json)
 * and creates candidate trade records for manual review.
 *
 * Usage (CLI):
 *   node core/sync-real-orders.js [--dry-run] [--log <path>] [--trades <path>]
 *
 * Usage (module):
 *   const { syncRealOrders } = require('./core/sync-real-orders');
 *   const result = await syncRealOrders({ logPath, tradesPath, dryRun: true });
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function generateId() {
  const ts = Date.now().toString(36);
  const rand = crypto.randomBytes(3).toString('hex');
  return `oc-sync-${ts}-${rand}`;
}

/**
 * Parse real-order-log.jsonl safely, skipping bad lines.
 * Returns { orders: ParsedOrder[], parseErrors: string[] }
 */
function parseOrderLog(logPath) {
  const orders = [];
  const parseErrors = [];

  if (!fs.existsSync(logPath)) {
    return { orders, parseErrors };
  }

  const raw = fs.readFileSync(logPath, 'utf8').trim();
  if (!raw) return { orders, parseErrors };

  const lines = raw.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;
    try {
      orders.push(JSON.parse(line));
    } catch (err) {
      parseErrors.push(`Line ${i + 1}: ${err.message}`);
    }
  }

  return { orders, parseErrors };
}

/**
 * Load trades.json (returns { trades: [] } structure).
 */
function loadTrades(tradesPath) {
  if (!fs.existsSync(tradesPath)) {
    return { trades: [] };
  }
  return JSON.parse(fs.readFileSync(tradesPath, 'utf8'));
}

// ---------------------------------------------------------------------------
// Core reconciliation
// ---------------------------------------------------------------------------

/**
 * Reconcile real orders against trades.
 *
 * Matching strategy (in order):
 *   1. trade.realOrderId === order.orderID  (exact match)
 *   2. trade.orderId === order.orderID       (fallback)
 *
 * Cancelled orders (event === 'CANCELLED_UNFILLED') are tracked separately.
 *
 * @param {Object} opts
 * @param {string} opts.logPath     - Path to real-order-log.jsonl
 * @param {string} opts.tradesPath  - Path to trades.json
 * @param {boolean} opts.dryRun     - If true, don't write trades.json
 * @returns {{ matched, orphaned, cancelled, created, parseErrors, details }}
 */
function syncRealOrders(opts = {}) {
  const logPath = opts.logPath || path.join(__dirname, '..', 'real-order-log.jsonl');
  const tradesPath = opts.tradesPath || path.join(__dirname, '..', 'trades.json');
  const dryRun = opts.dryRun !== false; // default to dry-run for safety

  // 1. Parse order log
  const { orders, parseErrors } = parseOrderLog(logPath);

  // 2. Load trades
  const tradesData = loadTrades(tradesPath);
  const trades = tradesData.trades || [];

  // 3. Separate cancellations from placements
  const cancelledOrderIds = new Set();
  const cancellations = [];
  const placements = [];

  for (const order of orders) {
    if (order.event === 'CANCELLED_UNFILLED') {
      cancelledOrderIds.add(order.orderID);
      cancellations.push(order);
    } else {
      placements.push(order);
    }
  }

  // 4. Build lookup indexes for fast matching
  const byRealOrderId = new Map();
  const byOrderId = new Map();
  for (const trade of trades) {
    if (trade.realOrderId) byRealOrderId.set(trade.realOrderId, trade);
    if (trade.orderId) byOrderId.set(trade.orderId, trade);
  }

  // 5. Reconcile each placement
  const matched = [];
  const orphaned = [];

  for (const order of placements) {
    // Skip if this order was later cancelled
    if (cancelledOrderIds.has(order.orderID)) {
      continue;
    }

    // Try matching
    const matchByReal = byRealOrderId.get(order.orderID);
    const matchByOrder = byOrderId.get(order.orderID);
    const match = matchByReal || matchByOrder;

    if (match) {
      matched.push({
        orderID: order.orderID,
        tradeId: match.id,
        matchedBy: matchByReal ? 'realOrderId' : 'orderId',
        tokenId: order.tokenId,
        side: order.side,
        price: order.price,
      });
    } else {
      orphaned.push(order);
    }
  }

  // 6. Create candidate trade records for orphaned orders
  const created = [];
  for (const order of orphaned) {
    const candidate = {
      id: generateId(),
      tokenId: order.tokenId,
      side: order.side === 'BUY' ? 'YES' : 'NO', // BUY on CLOB = YES position
      status: 'candidate',
      result: null,
      pnlUSDC: 0,
      createdAt: order.timestamp,
      enteredAt: order.timestamp,
      entryPrice: order.price,
      size: order.size,
      sizeUSDC: order.costUSDC || (order.price * order.size),
      orderId: order.orderID,
      realOrderId: order.orderID,
      realEntryPrice: order.price,
      realSize: order.size,
      txHash: null,
      tradeSource: 'real',
      needsReview: true,
      syncedAt: new Date().toISOString(),
      notes: `Orphaned real order recovered by sync-real-orders.js. Proxy: ${order.proxy || 'direct'}, Via: ${order.via || 'unknown'}`,
    };
    created.push(candidate);
  }

  // 7. Write back if not dry run
  if (!dryRun && created.length > 0) {
    // Backup first
    const backupPath = tradesPath.replace('.json', `.backup-${Date.now()}.json`);
    fs.copyFileSync(tradesPath, backupPath);

    tradesData.trades = [...trades, ...created];
    fs.writeFileSync(tradesPath, JSON.stringify(tradesData, null, 2));
  }

  const summary = {
    totalLogEntries: orders.length,
    placements: placements.length,
    cancelled: cancellations.length,
    activePlacements: placements.length - cancellations.filter(c => placements.some(p => p.orderID === c.orderID)).length,
    matched: matched.length,
    orphaned: orphaned.length,
    created: created.length,
    parseErrors: parseErrors.length,
    dryRun,
    details: {
      matched,
      orphaned: orphaned.map(o => ({
        orderID: o.orderID,
        tokenId: o.tokenId,
        side: o.side,
        price: o.price,
        size: o.size,
        timestamp: o.timestamp,
      })),
      created: created.map(c => ({ id: c.id, tokenId: c.tokenId, side: c.side, entryPrice: c.entryPrice })),
      cancelled: cancellations.map(c => ({ orderID: c.orderID, tokenId: c.tokenId })),
      parseErrors,
    },
  };

  return summary;
}

// ---------------------------------------------------------------------------
// CLI mode
// ---------------------------------------------------------------------------

if (require.main === module) {
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run');
  const logIdx = args.indexOf('--log');
  const tradesIdx = args.indexOf('--trades');

  const logPath = logIdx >= 0 ? args[logIdx + 1] : undefined;
  const tradesPath = tradesIdx >= 0 ? args[tradesIdx + 1] : undefined;

  console.log('=== Real Order Reconciliation ===\n');

  const result = syncRealOrders({ logPath, tradesPath, dryRun });

  console.log(`Log entries:       ${result.totalLogEntries}`);
  console.log(`  Placements:      ${result.placements}`);
  console.log(`  Cancelled:       ${result.cancelled}`);
  console.log(`  Active orders:   ${result.placements - result.cancelled}`);
  console.log(`  Matched:         ${result.matched}`);
  console.log(`  Orphaned:        ${result.orphaned}`);
  console.log(`  Parse errors:    ${result.parseErrors}`);
  console.log(`  Dry run:         ${result.dryRun}`);
  console.log('');

  if (result.details.matched.length > 0) {
    console.log('--- Matched Orders ---');
    for (const m of result.details.matched) {
      console.log(`  ✅ ${m.orderID.slice(0, 14)}... → trade ${m.tradeId} (by ${m.matchedBy})`);
    }
    console.log('');
  }

  if (result.details.orphaned.length > 0) {
    console.log('--- Orphaned Orders ---');
    for (const o of result.details.orphaned) {
      console.log(`  ❌ ${o.orderID.slice(0, 14)}... | ${o.side} ${o.size}@${o.price} | ${o.timestamp}`);
    }
    console.log('');
  }

  if (result.details.cancelled.length > 0) {
    console.log('--- Cancelled Orders (skipped) ---');
    for (const c of result.details.cancelled) {
      console.log(`  ⏭️  ${c.orderID.slice(0, 14)}...`);
    }
    console.log('');
  }

  if (result.parseErrors > 0) {
    console.log('--- Parse Errors ---');
    for (const e of result.details.parseErrors) {
      console.log(`  ⚠️  ${e}`);
    }
    console.log('');
  }

  if (!dryRun && result.created > 0) {
    console.log(`✅ Created ${result.created} candidate trade records in trades.json`);
  } else if (dryRun && result.orphaned > 0) {
    console.log(`ℹ️  Dry run — ${result.orphaned} candidate records would be created. Run without --dry-run to write.`);
  }

  console.log(`\nSummary: ${result.matched} matched, ${result.orphaned} orphaned, ${result.created} created`);
}

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

module.exports = { syncRealOrders, parseOrderLog, loadTrades, generateId };
