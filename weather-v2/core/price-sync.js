/**
 * core/price-sync.js — Periodic price updater for open positions
 * 
 * FIX 9 (2026-03-14): Open trades never had currentPrice updated.
 * This caused: stale P&L in notifications, dead price-inferred resolution,
 * and scalper falling back to null prices.
 */

const store = require('./store');
const polymarket = require('./polymarket');

/**
 * Update currentPrice for all open positions.
 * Returns { updated: number, errors: number }
 */
async function syncPrices() {
  const openTrades = store.getOpenPositions();
  if (openTrades.length === 0) return { updated: 0, errors: 0 };

  let updated = 0;
  let errors = 0;

  for (const trade of openTrades) {
    try {
      const price = await polymarket.getMidpointPrice(trade.tokenId);
      if (price != null && !isNaN(price) && price > 0 && price < 1) {
        store.update(trade.id, {
          currentPrice: parseFloat(price.toFixed(4)),
          updatedAt: new Date().toISOString()
        });
        updated++;
      }
    } catch (err) {
      console.warn(`[price-sync] Failed for ${trade.city} ${trade.bucket}: ${err.message}`);
      errors++;
    }
  }

  console.log(`[price-sync] Updated ${updated}/${openTrades.length} positions (${errors} errors)`);
  return { updated, errors };
}

module.exports = { syncPrices };
