/**
 * core/polymarket.js — Dome API Interface (Polymarket data layer)
 * 
 * ALL market data flows through Dome API. Zero Gamma/CLOB references.
 * Resolution truth comes from Dome's winning_side field.
 */

const config = require('../config.json');

const DOME_URL = config.dome.apiUrl;
const API_KEY = config.dome.apiKey;
const RATE_LIMIT_MS = config.dome.rateLimitMs || 700;

let lastCallTime = 0;

async function rateLimitedFetch(url, opts = {}, retries = 2) {
  const now = Date.now();
  const wait = RATE_LIMIT_MS - (now - lastCallTime);
  if (wait > 0) await new Promise(r => setTimeout(r, wait));
  lastCallTime = Date.now();

  const headers = { 'X-Api-Key': API_KEY, ...opts.headers };
  const res = await fetch(url, { ...opts, headers });
  if (res.status === 429 && retries > 0) {
    await new Promise(r => setTimeout(r, 2000));
    lastCallTime = Date.now();
    return rateLimitedFetch(url, opts, retries - 1);
  }
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Dome API ${res.status}: ${body.slice(0, 200)}`);
  }
  return res.json();
}

/**
 * Search for markets on Polymarket via Dome.
 */
async function searchMarkets(query) {
  const params = new URLSearchParams({ search: query, status: 'open', limit: '30' });
  const data = await rateLimitedFetch(`${DOME_URL}/polymarket/markets?${params}`);
  return Array.isArray(data) ? data : (data.markets || data.data || []);
}

/**
 * Get market by conditionId via Dome.
 */
async function getMarket(conditionId) {
  const params = new URLSearchParams({ condition_id: conditionId });
  const data = await rateLimitedFetch(`${DOME_URL}/polymarket/markets?${params}`);
  const markets = Array.isArray(data) ? data : (data.markets || data.data || []);
  return markets.length > 0 ? markets[0] : null;
}

/**
 * Validate a conditionId exists on Polymarket.
 */
async function validateConditionId(conditionId) {
  try {
    const market = await getMarket(conditionId);
    if (!market) return { valid: false, market: null, error: `No market found for conditionId: ${conditionId}` };
    return { valid: true, market, error: null };
  } catch (err) {
    return { valid: false, market: null, error: `API error: ${err.message}` };
  }
}

/**
 * Get midpoint price for a token via Dome.
 */
async function getMidpointPrice(tokenId) {
  const data = await rateLimitedFetch(`${DOME_URL}/polymarket/market-price/${tokenId}`);
  return parseFloat(data.price || data.mid || data.midpoint || 0);
}

/**
 * Check if a market has resolved via Dome.
 * Uses winning_side.label for resolution outcome.
 */
async function checkResolution(conditionId) {
  const market = await getMarket(conditionId);
  if (!market) return { resolved: false, outcome: null, resolutionPrice: null, error: 'Market not found' };

  // Dome uses winning_side for resolved markets
  if (market.winning_side && market.winning_side.label) {
    const outcome = market.winning_side.label.toUpperCase(); // "Yes" → "YES"
    return {
      resolved: true,
      outcome,
      resolutionPrice: outcome === 'YES' ? 1.0 : 0.0,
      source: 'polymarket',
      market: { slug: market.slug, question: market.question }
    };
  }

  return { resolved: false, outcome: null, resolutionPrice: null };
}

/**
 * Paper order — no real execution. Just log and return mock.
 */
async function paperOrder({ tokenId, side, price, size }) {
  const orderId = `paper-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
  console.log(`[polymarket] PAPER ORDER: ${side} ${size} @ ${price} | token: ${tokenId} | id: ${orderId}`);
  return { orderID: orderId, id: orderId, paper: true };
}

/**
 * Compute P&L from Polymarket resolution.
 */
function computePnL(trade, resolution) {
  if (!resolution.resolved || resolution.outcome === null) {
    throw new Error('Cannot compute P&L: market not resolved');
  }
  if (!trade.entryPrice || !trade.size) {
    throw new Error('Cannot compute P&L: missing entryPrice or size');
  }

  const won = (trade.side === 'YES' && resolution.outcome === 'YES') ||
              (trade.side === 'NO' && resolution.outcome === 'NO');

  const pnlPerShare = won ? (1.0 - trade.entryPrice) : (0.0 - trade.entryPrice);
  const pnlUSDC = parseFloat((pnlPerShare * trade.size).toFixed(4));

  return {
    pnlUSDC,
    result: won ? 'win' : 'loss',
    resolutionPrice: resolution.resolutionPrice,
    resolutionSource: 'polymarket'
  };
}

module.exports = {
  searchMarkets,
  getMarket,
  validateConditionId,
  getMidpointPrice,
  checkResolution,
  paperOrder,
  computePnL
};
