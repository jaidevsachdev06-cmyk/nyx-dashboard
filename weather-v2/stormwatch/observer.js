/**
 * stormwatch/observer.js — Resolution Observer
 * 
 * Checks open positions for market resolution via Dome API.
 */

const lifecycle = require('../core/lifecycle');
const store = require('../core/store');

async function observe() {
  const openTrades = store.getOpenPositions();
  console.log(`[observer] Checking ${openTrades.length} open positions for resolution...`);

  if (openTrades.length === 0) {
    console.log('[observer] No open positions.');
    return { resolved: [], pending: [], errors: [] };
  }

  return lifecycle.resolveAll();
}

module.exports = { observe };
