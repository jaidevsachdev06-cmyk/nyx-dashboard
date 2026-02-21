/**
 * api/weather.js — Dashboard API endpoint
 * 
 * Serves weather v2 trading data for the Nyx dashboard.
 */

const store = require('../core/store');
const { overallStats, statsByCity, statsBySide } = require('../accounting/stats');
const config = require('../config.json');

function authenticate(req) {
  const token = req.headers?.['authorization']?.replace('Bearer ', '') || 
                req.query?.token;
  return token === config.dashboard.token;
}

function computeShares(t) {
  // Prefer explicit size if present; otherwise derive from sizeUSDC/entryPrice
  if (typeof t.size === 'number' && t.size > 0) return t.size;
  if (typeof t.sizeUSDC === 'number' && typeof t.entryPrice === 'number' && t.entryPrice > 0) {
    return Math.round((t.sizeUSDC / t.entryPrice) * 10000) / 10000;
  }
  return null;
}

function getWeatherData() {
  const trades = store.getAll();
  const open = store.getOpenPositions();
  const stats = overallStats();
  const byCity = statsByCity();
  const bySide = statsBySide();

  return {
    system: 'weather-v2',
    paper: config.paper,
    timestamp: new Date().toISOString(),
    stats,
    byCity,
    bySide,
    openPositions: open.map(t => ({
      id: t.id,
      city: t.city,
      date: t.date,
      bucket: t.bucket,
      side: t.side,
      entryPrice: t.entryPrice,
      sizeUSDC: t.sizeUSDC,
      shares: computeShares(t),
      currentPrice: t.currentPrice ?? null,
      signal: t.signal
    })),
    recentTrades: trades
      .filter(t => t.status === 'closed')
      .sort((a, b) => (b.closedAt || '').localeCompare(a.closedAt || ''))
      .slice(0, 20)
      .map(t => ({
        id: t.id,
        city: t.city,
        date: t.date,
        bucket: t.bucket,
        side: t.side,
        result: t.result,
        pnlUSDC: t.pnlUSDC,
        entryPrice: t.entryPrice,
        exitPrice: typeof t.resolutionPrice === 'number' ? ((t.side === 'YES') ? t.resolutionPrice : (1 - t.resolutionPrice)) : null,
        shares: computeShares(t),
        closedAt: t.closedAt
      })),
    statusCounts: store.statusCounts()
  };
}

module.exports = { getWeatherData, authenticate };
