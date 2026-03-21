/**
 * core/polymarket.js — Polymarket data interface
 *
 * Primary: polymarket CLI (`/usr/local/bin/polymarket`) — official binary, no rate limit issues
 * Fallbacks:
 *   - Prices: CLOB HTTP `/midpoint?token_id=...`
 *   - Market search: Dome API (if CLI fails)
 *   - Resolution checks: Gamma `/markets?condition_ids=...` (public)
 *
 * NOTE: Resolution truth is still best from Dome (winning_side). Gamma fallback is best-effort
 * (uses `closed` + extreme outcomePrices to infer YES/NO).
 */

const { spawnSync } = require('child_process');
const config = require('../config.json');

const DOME_URL = config.dome.apiUrl;
const API_KEY = config.dome.apiKey;

const CLOB_URL = config.clob?.apiUrl || 'https://clob.polymarket.com';

const RATE_LIMIT_MS = config.dome.rateLimitMs || 700;

let lastCallTime = 0;

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// ---- polymarket CLI helper ----
// Runs the official Polymarket CLI binary and returns parsed JSON.
// Throws on failure — callers must have an HTTP fallback.
function execPolymarketCLI(args, timeoutMs = 5000) {
  const result = spawnSync('polymarket', args, {
    timeout: timeoutMs,
    encoding: 'utf8',
    env: { ...process.env, PATH: '/usr/local/bin:' + (process.env.PATH || '') },
  });
  if (result.error) throw new Error(`CLI spawn error: ${result.error.message}`);
  if (result.status !== 0) throw new Error(`CLI exit ${result.status}: ${(result.stderr || '').slice(0, 200)}`);
  const out = (result.stdout || '').trim();
  if (!out) throw new Error('CLI returned empty output');
  return JSON.parse(out);
}

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

// ---- CLI market helpers (replaces Gamma) ----

function cliGetMarket(conditionId) {
  try {
    return execPolymarketCLI(['-o', 'json', 'clob', 'market', conditionId], 8000);
  } catch { return null; }
}

function inferResolutionFromCLIMarket(market) {
  if (!market) return { resolved: false, outcome: null, resolutionPrice: null, source: 'cli', market: null };

  const closed = !!market.closed;
  const tokens = Array.isArray(market.tokens) ? market.tokens : [];
  const yesToken = tokens.find(t => (t.outcome || '').toLowerCase() === 'yes');
  const noToken  = tokens.find(t => (t.outcome || '').toLowerCase() === 'no');
  const yesP = yesToken ? parseFloat(yesToken.price) : NaN;
  const noP  = noToken  ? parseFloat(noToken.price)  : NaN;

  const meta = { slug: market.market_slug || market.slug || '', question: market.question || '' };

  if (!closed || isNaN(yesP) || isNaN(noP)) {
    return { resolved: false, outcome: null, resolutionPrice: null, source: 'cli', market: meta };
  }

  const EPS = 0.02;
  if (yesP >= 1 - EPS && noP <= EPS) {
    return { resolved: true, outcome: 'YES', resolutionPrice: 1.0, source: 'cli-inferred', market: meta };
  }
  if (noP >= 1 - EPS && yesP <= EPS) {
    return { resolved: true, outcome: 'NO',  resolutionPrice: 0.0, source: 'cli-inferred', market: meta };
  }

  return { resolved: false, outcome: null, resolutionPrice: null, source: 'cli', market: meta };
}

// ---- Public API ----

async function searchMarkets(query) {
  // Primary: polymarket CLI (official, no rate limit concerns, no Dome auth needed)
  try {
    const results = execPolymarketCLI(['-o', 'json', 'markets', 'search', query, '--limit', '20'], 10000);
    if (Array.isArray(results) && results.length > 0) {
      const enriched = [];
      for (const m of results) {
        const cid = m.conditionId || m.condition_id;
        if (!cid) continue;
        // Skip already-closed markets
        if (m.closed || m.active === false) continue;
        try {
          const clob = execPolymarketCLI(['-o', 'json', 'clob', 'market', cid], 8000);
          // Skip if CLOB says closed
          if (clob.closed) continue;
          enriched.push({
            ...m,
            condition_id: cid,
            conditionId: cid,
            tokens: (clob.tokens || []).map(t => ({
              token_id: t.token_id,
              outcome: t.outcome,
              price: parseFloat(t.price) || 0
            }))
          });
        } catch (e) {
          enriched.push({ ...m, condition_id: cid, conditionId: cid, tokens: [] });
        }
        await sleep(150);
      }
      return enriched;
    }
  } catch (err) {
    console.warn(`[polymarket] CLI search failed: ${err.message}, falling back to Dome`);
  }

  // Fallback: Dome
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
    // Fallback: CLI
    return cliGetMarket(conditionId);
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
  // 1) Primary: polymarket CLI
  try {
    const result = execPolymarketCLI(['-o', 'json', 'clob', 'midpoint', tokenId]);
    const p = result?.midpoint ?? result?.price ?? result?.mid;
    if (p != null && !isNaN(parseFloat(p))) return parseFloat(p);
  } catch (_cliErr) {
    // CLI failed — fall through
  }

  // 2) Fallback: CLOB HTTP
  try {
    const d = await fetchJSON(`${CLOB_URL}/midpoint?token_id=${encodeURIComponent(tokenId)}`, { headers: { 'User-Agent': 'NyxWeatherV2/1.0' } }, 15000);
    const p = d?.midpoint ?? d?.price ?? d?.mid;
    return p != null ? parseFloat(p) : 0;
  } catch (err) {
    throw new Error(`Price fetch failed (CLI+CLOB): ${err.message}`);
  }
}

async function checkResolution(conditionId, tokenId = null, tokenSide = 'YES') {
  const EPS_RESOLVED = 0.01; // price within 1% of 0 or 1 = resolved

  // 1) Dome truth (most authoritative)
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
    // Dome says open — fall through to Gamma + CLOB fallbacks
  } catch (err) {
    if (!isRetryableDomeFailure(err)) throw err;
  }

  // 2) CLI best-effort inference
  const cliMarket = cliGetMarket(conditionId);
  const inferred = inferResolutionFromCLIMarket(cliMarket);
  if (inferred.resolved) return inferred;

  // 3) CLOB price inference — YES token price near 0 or 1 means market resolved
  // tokenId is the YES token id (or whatever side the trade holds; caller passes it)
  if (tokenId) {
    try {
      const yesTokenPrice = await (async () => {
        // Try CLI first
        try {
          const result = execPolymarketCLI(['-o', 'json', 'clob', 'midpoint', tokenId]);
          const p = result?.midpoint ?? result?.price ?? result?.mid;
          if (p != null && !isNaN(parseFloat(p))) return parseFloat(p);
        } catch (_cliErr) {
          // CLI failed — fall through to HTTP
        }
        // Fallback: fetch via CLOB HTTP directly
        const d = await fetchJSON(
          `${CLOB_URL}/midpoint?token_id=${encodeURIComponent(tokenId)}`,
          { headers: { 'User-Agent': 'NyxWeatherV2/1.0' } },
          15000
        );
        const p = d?.midpoint ?? d?.price ?? d?.mid;
        return p != null ? parseFloat(p) : null;
      })();

      if (yesTokenPrice != null) {
        // Interpret based on which token we fetched
        const tokenIsYes = (tokenSide || 'YES').toUpperCase() === 'YES';
        const yesWon = tokenIsYes ? (yesTokenPrice >= 1 - EPS_RESOLVED) : (yesTokenPrice <= EPS_RESOLVED);
        const noWon  = tokenIsYes ? (yesTokenPrice <= EPS_RESOLVED)      : (yesTokenPrice >= 1 - EPS_RESOLVED);

        if (yesWon) {
          return { resolved: true, outcome: 'YES', resolutionPrice: 1.0, source: 'clob-inferred' };
        }
        if (noWon) {
          return { resolved: true, outcome: 'NO', resolutionPrice: 0.0, source: 'clob-inferred' };
        }
      }
    } catch (err) {
      // CLOB unavailable — fall through to unresolved
    }
  }

  return inferred; // resolved: false from Gamma
}

async function paperOrder({ tokenId, side, price, size }) {
  const orderId = `paper-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
  console.log(`[polymarket] PAPER ORDER: ${side} ${size} @ ${price} | token: ${tokenId} | id: ${orderId}`);
  return { orderID: orderId, id: orderId, paper: true };
}

/**
 * realOrder — Place an actual order on Polymarket CLOB via CLI.
 *
 * Uses GTC (Good Till Cancelled) limit orders.
 * Returns { orderID, success, paper: false } or throws on failure.
 *
 * SAFETY:
 * - Validates price is within [0.01, 0.99]
 * - Validates size >= 1
 * - Rounds price to tick size (0.01)
 * - Logs everything for audit trail
 */
async function realOrder({ tokenId, side, price, size }) {
  const tag = `[polymarket] REAL ORDER`;

  // SAFETY: refuse if config.paper is not explicitly false
  const cfg = require('../config.json');
  if (cfg.paper !== false) {
    throw new Error(`${tag}: SAFETY — config.paper must be explicitly false to place real orders (currently: ${cfg.paper})`);
  }

  // Emergency kill switch
  const fs = require('fs');
  const KILL_FILE = '/tmp/stormwatch-kill-real-trading';
  if (fs.existsSync(KILL_FILE)) {
    throw new Error(`${tag}: EMERGENCY KILL SWITCH ACTIVE — real trading halted. Remove ${KILL_FILE} to re-enable.`);
  }

  // Validate inputs
  if (!tokenId) throw new Error(`${tag}: missing tokenId`);
  if (!['BUY', 'SELL'].includes(side.toUpperCase())) throw new Error(`${tag}: invalid side "${side}"`);
  if (price < 0.01 || price > 0.99) throw new Error(`${tag}: price ${price} out of range [0.01, 0.99]`);
  if (size < 5) throw new Error(`${tag}: size ${size} too small (CLOB minimum is 5)`);

  // Round price to tick size (0.01)
  // Adjust to hit counterparty: +2 ticks for BUY (hit ask), -2 ticks for SELL (hit bid)
  let roundedPrice = Math.round(price * 100) / 100;
  if (side.toUpperCase() === 'BUY') {
    // Add 2 ticks to ensure fill against the ask
    roundedPrice = Math.min(0.99, Math.round((roundedPrice + 0.02) * 100) / 100);
  } else {
    // FIX: Math.round AFTER subtraction to avoid float precision bugs
    // e.g. 0.05 - 0.02 = 0.030000000000000002 → CLOB rejects
    roundedPrice = Math.max(0.01, Math.round((roundedPrice - 0.02) * 100) / 100);
  }

  const roundedSize = Math.floor(size);
  const costUSDC = roundedPrice * roundedSize;

  console.log(`${tag}: ${side} ${roundedSize} shares @ ${roundedPrice} ($${costUSDC.toFixed(2)}) | token: ${tokenId}`);

  try {
    const result = execPolymarketCLI([
      '-o', 'json',
      'clob', 'create-order',
      '--token', tokenId,
      '--side', side.toLowerCase(),
      '--price', roundedPrice.toString(),
      '--size', roundedSize.toString(),
      '--order-type', 'GTC'
    ], 30000);

    // Check for explicit failure indicators
    if (result?.error || result?.status === 'failed' || result?.success === false) {
      throw new Error(`Order rejected by CLOB: ${JSON.stringify(result).slice(0, 300)}`);
    }

    const orderID = result?.orderID || result?.id || result?.order_id || null;
    if (!orderID) {
      throw new Error(`Order returned no orderID: ${JSON.stringify(result).slice(0, 300)}`);
    }

    // Append-only audit log (survives even if trades.json update fails)
    try {
      const auditLine = JSON.stringify({
        timestamp: new Date().toISOString(), orderID, tokenId, side, price: roundedPrice, size: roundedSize, costUSDC
      }) + '\n';
      require('fs').appendFileSync(require('path').resolve(__dirname, '..', 'real-order-log.jsonl'), auditLine);
    } catch (_) { /* non-fatal */ }

    console.log(`${tag}: ✅ SUCCESS | orderID: ${orderID} | response: ${JSON.stringify(result).slice(0, 300)}`);
    // V3: Verify fill — poll order status for up to 15s
    let filled = false;
    let filledSize = 0;
    let filledAvgPrice = null;
    const pollStart = Date.now();
    const POLL_TIMEOUT_MS = 15000;
    const POLL_INTERVAL_MS = 3000;

    while (Date.now() - pollStart < POLL_TIMEOUT_MS) {
      await sleep(POLL_INTERVAL_MS);
      try {
        const orderStatus = execPolymarketCLI(['-o', 'json', 'clob', 'order', orderID], 8000);
        const status = (orderStatus?.status || '').toUpperCase();
        
        if (status === 'MATCHED' || status === 'FILLED') {
          filled = true;
          filledSize = parseInt(orderStatus?.size_matched || orderStatus?.matched || roundedSize);
          filledAvgPrice = parseFloat(orderStatus?.avg_price || orderStatus?.price || roundedPrice);
          console.log(`${tag}: 🟢 FILLED | ${filledSize} shares @ ${filledAvgPrice}`);
          break;
        } else if (status === 'CANCELLED' || status === 'EXPIRED' || status === 'REJECTED') {
          console.error(`${tag}: ⚠️ Order ${status} — NOT FILLED`);
          // Append unfilled to audit log
          try {
            const auditLine = JSON.stringify({
              timestamp: new Date().toISOString(), orderID, event: 'UNFILLED', status, tokenId, side
            }) + '\n';
            require('fs').appendFileSync(require('path').resolve(__dirname, '..', 'real-order-log.jsonl'), auditLine);
          } catch (_) {}
          return { orderID, success: true, filled: false, status, paper: false, result };
        } else if (status === 'LIVE') {
          console.log(`${tag}: ⏳ Still LIVE after ${((Date.now() - pollStart) / 1000).toFixed(0)}s...`);
        }
      } catch (pollErr) {
        console.warn(`${tag}: Poll error: ${pollErr.message}`);
      }
    }

    if (!filled) {
      // Order still LIVE after 15s — cancel it and return unfilled
      console.warn(`${tag}: ⚠️ Order still LIVE after ${POLL_TIMEOUT_MS / 1000}s — cancelling stale order`);
      try {
        execPolymarketCLI(['-o', 'json', 'clob', 'cancel', orderID], 10000);
        console.log(`${tag}: 🗑️ Cancelled unfilled order ${orderID}`);
      } catch (cancelErr) {
        console.warn(`${tag}: Cancel failed (may have filled in the meantime): ${cancelErr.message}`);
        // If cancel failed, try one more status check — it might have filled
        try {
          const finalCheck = execPolymarketCLI(['-o', 'json', 'clob', 'order', orderID], 8000);
          const finalStatus = (finalCheck?.status || '').toUpperCase();
          if (finalStatus === 'MATCHED' || finalStatus === 'FILLED') {
            filled = true;
            filledSize = parseInt(finalCheck?.size_matched || finalCheck?.matched || roundedSize);
            filledAvgPrice = parseFloat(finalCheck?.avg_price || finalCheck?.price || roundedPrice);
            console.log(`${tag}: 🟢 Filled between poll and cancel! ${filledSize} shares @ ${filledAvgPrice}`);
          }
        } catch (_) {}
      }

      try {
        const auditLine = JSON.stringify({
          timestamp: new Date().toISOString(), orderID, event: filled ? 'LATE_FILL' : 'CANCELLED_UNFILLED', tokenId, side, price: roundedPrice, size: roundedSize
        }) + '\n';
        require('fs').appendFileSync(require('path').resolve(__dirname, '..', 'real-order-log.jsonl'), auditLine);
      } catch (_) {}

      if (!filled) {
        return { orderID, success: true, filled: false, status: 'cancelled_unfilled', paper: false, result };
      }
    }

    return { orderID, success: true, filled, filledSize: filledSize || roundedSize, filledAvgPrice, paper: false, result };
  } catch (err) {
    console.error(`${tag}: ❌ FAILED | ${err.message}`);
    throw new Error(`Real order failed: ${err.message}`);
  }
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
  realOrder,
  computePnL
};
