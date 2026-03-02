#!/usr/bin/env node
/**
 * scripts/run-scalper.js — Run scalper check on all open positions
 */
const { scanAll } = require('../stormwatch/scalper');

(async () => {
  try {
    const results = await scanAll();
    
    // Summary output
    if (results.scalps.length > 0 || results.exits.length > 0) {
      console.log('\n=== SCALPER SUMMARY ===');
      for (const s of results.scalps) {
        console.log(`💰 PARTIAL: ${s.city} ${s.bucket} ${s.side} | Sold ${s.sharesSold} shares @ ${s.currentPrice} | +$${s.pnlOnSold.toFixed(2)} | ${s.sharesRemaining} remaining`);
      }
      for (const e of results.exits) {
        console.log(`✅ EXITED: ${e.city} ${e.bucket} ${e.side} | Rule: ${e.rule} | P&L: $${e.pnlUSDC.toFixed(2)}`);
      }
    } else {
      console.log('No scalp/exit signals triggered.');
    }
  } catch (err) {
    console.error('Scalper failed:', err);
    process.exit(1);
  }
})();
