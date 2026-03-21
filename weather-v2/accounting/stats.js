/**
 * accounting/stats.js — Performance Feedback Loop
 */

const store = require('../core/store');

function getCompletedTrades() {
  return store.getAll().filter(t => 
    t.status === 'closed' && t.result && ['win', 'loss'].includes(t.result) && t.pnlUSDC !== null && t.pnlUSDC !== undefined
  );
}

function overallStats() {
  const trades = getCompletedTrades();
  if (trades.length === 0) return { totalTrades: 0, message: 'No completed trades yet' };

  const wins = trades.filter(t => t.result === 'win');
  const losses = trades.filter(t => t.result === 'loss');
  const totalPnL = trades.reduce((s, t) => s + t.pnlUSDC, 0);
  const avgPnL = totalPnL / trades.length;
  const avgWin = wins.length ? wins.reduce((s, t) => s + t.pnlUSDC, 0) / wins.length : 0;
  const avgLoss = losses.length ? losses.reduce((s, t) => s + t.pnlUSDC, 0) / losses.length : 0;

  return {
    totalTrades: trades.length,
    wins: wins.length,
    losses: losses.length,
    winRate: (wins.length / trades.length * 100).toFixed(1) + '%',
    totalPnLUSDC: parseFloat(totalPnL.toFixed(2)),
    avgPnLUSDC: parseFloat(avgPnL.toFixed(2)),
    avgWinUSDC: parseFloat(avgWin.toFixed(2)),
    avgLossUSDC: parseFloat(avgLoss.toFixed(2)),
    profitFactor: losses.length && avgLoss !== 0
      ? parseFloat((Math.abs(avgWin * wins.length) / Math.abs(avgLoss * losses.length)).toFixed(2))
      : null
  };
}

function statsByField(field) {
  const trades = getCompletedTrades();
  const groups = {};
  for (const t of trades) {
    const key = t[field] || 'unknown';
    if (!groups[key]) groups[key] = { trades: 0, wins: 0, losses: 0, pnlUSDC: 0 };
    groups[key].trades++;
    if (t.result === 'win') groups[key].wins++;
    if (t.result === 'loss') groups[key].losses++;
    groups[key].pnlUSDC += t.pnlUSDC;
  }
  return Object.entries(groups)
    .map(([key, g]) => ({
      [field]: key, trades: g.trades, wins: g.wins, losses: g.losses,
      winRate: (g.wins / g.trades * 100).toFixed(1) + '%',
      pnlUSDC: parseFloat(g.pnlUSDC.toFixed(2))
    }))
    .sort((a, b) => b.pnlUSDC - a.pnlUSDC);
}

function statsByCity() { return statsByField('city'); }
function statsByBucket() { return statsByField('bucket'); }
function statsBySide() { return statsByField('side'); }

function statsBySource() {
  const trades = getCompletedTrades();
  const groups = { paper: { trades: 0, wins: 0, pnl: 0 }, real: { trades: 0, wins: 0, pnl: 0 }, both: { trades: 0, wins: 0, pnl: 0 } };
  for (const t of trades) {
    const src = t.tradeSource || 'paper';
    if (!groups[src]) groups[src] = { trades: 0, wins: 0, pnl: 0 };
    groups[src].trades++;
    if (t.result === 'win') groups[src].wins++;
    groups[src].pnl += t.pnlUSDC;
  }
  return groups;
}

function printDashboard() {
  console.log('\n═══════════════════════════════════════');
  console.log('  WEATHER v2 — PERFORMANCE DASHBOARD');
  console.log('═══════════════════════════════════════\n');

  const statusCounts = store.statusCounts();
  const allOpen = store.getOpenPositions();
  const paperOpen = allOpen.filter(t => (t.tradeSource || 'paper') === 'paper');
  const realOpen = allOpen.filter(t => t.tradeSource === 'real' || t.tradeSource === 'both');
  console.log('📊 STATUS OVERVIEW');
  console.log(`   Open: ${statusCounts.open || 0} (paper: ${paperOpen.length}, real: ${realOpen.length}) | Closed: ${statusCounts.closed || 0}`);
  console.log('');

  const overall = overallStats();
  if (overall.totalTrades === 0) {
    console.log('   No completed trades yet.\n');
    return overall;
  }
  console.log('📈 OVERALL PERFORMANCE (paper)');
  console.log(`   Trades: ${overall.totalTrades} | Win Rate: ${overall.winRate}`);
  console.log(`   Total P&L: $${overall.totalPnLUSDC} | Avg: $${overall.avgPnLUSDC}`);
  console.log(`   Avg Win: $${overall.avgWinUSDC} | Avg Loss: $${overall.avgLossUSDC}`);
  if (overall.profitFactor) console.log(`   Profit Factor: ${overall.profitFactor}`);
  console.log('');

  // Real money stats
  const bySource = statsBySource();
  if (bySource.real.trades > 0 || bySource.both.trades > 0) {
    const realTrades = bySource.real.trades + bySource.both.trades;
    const realWins = bySource.real.wins + bySource.both.wins;
    const realPnl = bySource.real.pnl + bySource.both.pnl;
    console.log('💰 REAL MONEY PERFORMANCE');
    console.log(`   Trades: ${realTrades} | Win Rate: ${(realWins/realTrades*100).toFixed(1)}%`);
    console.log(`   Real P&L: $${realPnl.toFixed(2)}`);
    console.log('');
  }

  const cities = statsByCity();
  if (cities.length) {
    console.log('🌆 BY CITY');
    for (const c of cities) {
      console.log(`   ${c.pnlUSDC >= 0 ? '✅' : '❌'} ${c.city.padEnd(15)} ${c.winRate.padStart(6)} win | $${String(c.pnlUSDC).padStart(8)} | ${c.trades} trades`);
    }
    console.log('');
  }

  console.log('═══════════════════════════════════════\n');
  return overall;
}

module.exports = { overallStats, statsByCity, statsByBucket, statsBySide, statsBySource, printDashboard };
