/**
 * core/polymarket.js — Polymarket data interface
 *
 * Primary: Dome API (official Polymarket data layer)
 * Fallbacks (when Dome 5xx / timeouts):
 *   - Prices: Polymarket CLOB `/midpoint?token_id=...` (public)
 *   - Market metadata + soft-resolution checks: Gamma `/markets?condition_ids=...` (public)
 *
 * NOTE: Resolution truth is still best from Dome (winning_side). Gamma fallback is best-effort
 * (uses `closed` + extreme outcomePrices to infer YES/NO).
 */

const config = require('../config.json');

const DOME_URL = config.dome.apiUrl;
const API_KEY = config.dome.apiKey;

const GAMMA_URL = config.gamma?.apiUrl || 'https://gamma-api.polymarket.com';
const CLOB_URL = config.clob?.apiUrl || 'https://clob.polymarket.com';

const RATE_LIMIT_MS = config.dome.rateLimitMs || 700;

let lastCallTime = 0;

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function isRetryableDomeFailure(err) {
  const m = String(err?.message || err);
  return (
    m.includes('Dome API 500') ||
    m.includes('Dome API 502') ||
    m.includes('Dome API 503') ||
    m.includes('Dome API 504') ||
    m.includes('fetch failed') ||
    m.includes('ETIMEDOUT') ||
    m.includes('ECONNRESET')
  );
}

async function fetchJSON(url, opts = {}, timeoutMs = 15000) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const r = await fetch(url, { ...opts, signal: ctrl.signal });
    if (!r.ok) {
      const body = await r.text().catch(() => '');
      throw new Error(`${url}: ${r.status} ${body.slice(0, 200)}`);
    }
    return r.json();
  } finally {
    clearTimeout(t);
  }
}

async function rateLimitedDomeFetch(url, opts = {}, retries = 2) {
  const now = Date.now();
  const wait = RATE_LIMIT_MS - (now - lastCallTime);
  if (wait > 0) await sleep(wait);
  lastCallTime = Date.now();

  const headers = { 'X-Api-Key': API_KEY, ...opts.headers };

  let res;
  try {
    res = await fetch(url, { ...opts, headers });
  } catch (e) {
    // network error / aborted / dns — treat as retryable
    if (retries > 0) {
      await sleep(1200);
      lastCallTime = Date.now();
      return rateLimitedDomeFetch(url, opts, retries - 1);
    }
    throw new Error(`Dome API fetch failed: ${e.message}`);
  }

  if (res.status === 429 && retries > 0) {
    await sleep(2000);
    lastCallTime = Date.now();
    return rateLimitedDomeFetch(url, opts, retries - 1);
  }

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Dome API ${res.status}: ${body.slice(0, 200)}`);
  }

  return res.json();
}

// ---- Gamma fallback helpers ----

async function gammaGetMarket(conditionId) {
  const url = `${GAMMA_URL}/markets?condition_ids=${encodeURIComponent(conditionId)}`;
  const data = await fetchJSON(url, { headers: { 'User-Agent': 'NyxWeatherV2/1.0' } });
  return Array.isArray(data) && data.length > 0 ? data[0] : null;
}

function inferResolutionFromGammaMarket(market) {
  if (!market) return { resolved: false, outcome: null, resolutionPrice: null, source: 'gamma', market: null };

  // Gamma doesn't always expose a clean "winning outcome" field; we infer when closed + extreme prices.
  const closed = !!market.closed;
  const prices = Array.isArray(market.outcomePrices) ? market.outcomePrices.map(p => parseFloat(p)) : [];

  if (!closed || prices.length < 2 || prices.some(p => Number.isNaN(p))) {
    return {
      resolved: false,
      outcome: null,
      resolutionPrice: null,
      source: 'gamma',
      market: { slug: market.slug, question: market.question }
    };
  }

  const [yesP, noP] = prices;
  const EPS = 0.02;
  if (yesP >= 1 - EPS && noP <= EPS) {
    return {
      resolved: true,
      outcome: 'YES',
      resolutionPrice: 1.0,
      source: 'gamma-inferred',
      market: { slug: market.slug, question: market.question }
    };
  }
  if (noP >= 1 - EPS && yesP <= EPS) {
    return {
      resolved: true,
      outcome: 'NO',
      resolutionPrice: 0.0,
      source: 'gamma-inferred',
      market: { slug: market.slug, question: market.question }
    };
  }

  return {
    resolved: false,
    outcome: null,
    resolutionPrice: null,
    source: 'gamma',
    market: { slug: market.slug, question: market.question }
  };
}

// ---- Public API ----

async function searchMarkets(query) {
  const params = new URLSearchParams({ search: query, status: 'open', limit: '30' });
  const data = await rateLimitedDomeFetch(`${DOME_URL}/polymarket/markets?${params}`);
  return Array.isArray(data) ? data : (data.markets || data.data || []);
}

async function getMarket(conditionId) {
  const params = new URLSearchParams({ condition_id: conditionId });
  try {
    const data = await rateLimitedDomeFetch(`${DOME_URL}/polymarket/markets?${params}`);
    const markets = Array.isArray(data) ? data : (data.markets || data.data || []);
    return markets.length > 0 ? markets[0] : null;
  } catch (err) {
    if (!isRetryableDomeFailure(err)) throw err;
    // Fallback: Gamma
    return gammaGetMarket(conditionId);
  }
}

async function validateConditionId(conditionId) {
  try {
    const market = await getMarket(conditionId);
    if (!market) return { valid: false, market: null, error: `No market found for conditionId: ${conditionId}` };
    return { valid: true, market, error: null };
  } catch (err) {
    return { valid: false, market: null, error: `API error: ${err.message}` };
  }
}

async function getMidpointPrice(tokenId) {
  // 1) Try Dome
  try {
    const data = await rateLimitedDomeFetch(`${DOME_URL}/polymarket/market-price/${tokenId}`);
    return parseFloat(data.price || data.mid || data.midpoint || 0);
  } catch (err) {
    if (!isRetryableDomeFailure(err)) throw err;
  }

  // 2) Fallback to CLOB midpoint
  try {
    const d = await fetchJSON(`${CLOB_URL}/midpoint?token_id=${encodeURIComponent(tokenId)}`, { headers: { 'User-Agent': 'NyxWeatherV2/1.0' } }, 15000);
    const p = d?.midpoint ?? d?.price ?? d?.mid;
    return p != null ? parseFloat(p) : 0;
  } catch (err) {
    // 3) Last resort: return 0 (caller can treat as unknown)
    throw new Error(`Price fetch failed (Dome+CLOB): ${err.message}`);
  }
}

async function checkResolution(conditionId) {
  // 1) Dome truth
  try {
    const params = new URLSearchParams({ condition_id: conditionId });
    const data = await rateLimitedDomeFetch(`${DOME_URL}/polymarket/markets?${params}`);
    const markets = Array.isArray(data) ? data : (data.markets || data.data || []);
    const market = markets.length > 0 ? markets[0] : null;

    if (!market) return { resolved: false, outcome: null, resolutionPrice: null, error: 'Market not found' };

    if (market.winning_side && market.winning_side.label) {
      const outcome = market.winning_side.label.toUpperCase();
      return {
        resolved: true,
        outcome,
        resolutionPrice: outcome === 'YES' ? 1.0 : 0.0,
        source: 'dome',
        market: { slug: market.slug || market.market_slug, question: market.question || market.title }
      };
    }

    return { resolved: false, outcome: null, resolutionPrice: null, source: 'dome' };
  } catch (err) {
    if (!isRetryableDomeFailure(err)) throw err;
  }

  // 2) Gamma best-effort inference
  const gammaMarket = await gammaGetMarket(conditionId);
  const inferred = inferResolutionFromGammaMarket(gammaMarket);
  return inferred;
}

async function paperOrder({ tokenId, side, price, size }) {
  const orderId = `paper-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
  console.log(`[polymarket] PAPER ORDER: ${side} ${size} @ ${price} | token: ${tokenId} | id: ${orderId}`);
  return { orderID: orderId, id: orderId, paper: true };
}

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
    resolutionSource: resolution.source || resolution.resolutionSource || 'polymarket'
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
