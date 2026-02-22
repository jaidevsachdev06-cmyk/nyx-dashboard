/**
 * schema-validator.js — Prevent corrupted trades from being saved
 * 
 * RULE: trades.json never accepts data without passing these checks.
 * This is the enforce point for data integrity.
 */

function validateTrade(t) {
  const errors = [];

  // CLOSED trades MUST have resolutionPrice
  if ((t.status || '').includes('closed') && (t.resolutionPrice === null || t.resolutionPrice === undefined)) {
    errors.push('Closed trade missing resolutionPrice');
  }

  // If resolutionPrice exists, validate P&L calculation
  if ((t.resolutionPrice !== null && t.resolutionPrice !== undefined) && t.entryPrice && t.size) {
    let expectedPnL;
    if (t.side === 'NO') {
      // NO: payout = (1 - resolutionPrice)
      const payout = 1 - t.resolutionPrice;
      expectedPnL = (payout - t.entryPrice) * t.size;
    } else {
      // YES: payout = resolutionPrice
      expectedPnL = (t.resolutionPrice - t.entryPrice) * t.size;
    }
    expectedPnL = parseFloat(expectedPnL.toFixed(2));
    const storedPnL = parseFloat(t.pnlUSDC.toFixed(2)) || 0;

    if (Math.abs(expectedPnL - storedPnL) > 1) {  // Allow 1¢ rounding
      errors.push(`P&L mismatch: expected ${expectedPnL}, got ${storedPnL} (entry ${t.entryPrice}, resolution ${t.resolutionPrice}, size ${t.size})`);
    }
  }

  // Entry price must be 0-1
  if (t.entryPrice < 0 || t.entryPrice > 1) {
    errors.push(`Invalid entry price: ${t.entryPrice} (must be 0-1)`);
  }

  // Current/resolution price must be 0-1
  if (t.currentPrice && (t.currentPrice < 0 || t.currentPrice > 1)) {
    errors.push(`Invalid current price: ${t.currentPrice} (must be 0-1)`);
  }
  if (t.resolutionPrice !== null && t.resolutionPrice !== undefined && (t.resolutionPrice < 0 || t.resolutionPrice > 1)) {
    errors.push(`Invalid resolution price: ${t.resolutionPrice} (must be 0-1)`);
  }

  // conditionId must be 66-char hex
  if (!t.conditionId || !t.conditionId.match(/^0x[a-fA-F0-9]{64}$/)) {
    errors.push(`Invalid conditionId: ${t.conditionId}`);
  }

  // OPEN trades should NOT have resolutionPrice
  if (t.status === 'open' && (t.resolutionPrice !== null && t.resolutionPrice !== undefined)) {
    errors.push('Open trade should not have resolutionPrice');
  }

  return { valid: errors.length === 0, errors };
}

function validateTrades(trades) {
  const errors = [];
  for (const t of trades) {
    const result = validateTrade(t);
    if (!result.valid) {
      errors.push({id: t.id, errors: result.errors});
    }
  }
  return { valid: errors.length === 0, errors };
}

module.exports = { validateTrade, validateTrades };
