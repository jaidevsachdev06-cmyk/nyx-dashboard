const { cors, checkAuth, readFile } = require('./_github');

module.exports = async (req, res) => {
  cors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (!checkAuth(req)) return res.status(401).json({ error: 'Unauthorized' });

  try {
    const { data } = await readFile('weather-v2/trades.json');
    const trades = data.trades || data || [];

    const open = trades.filter(t => t.status === 'open');
    const closed = trades.filter(t => t.status === 'closed');

    // Overall stats
    const wins = closed.filter(t => t.result === 'win').length;
    const losses = closed.filter(t => t.result === 'loss').length;
    const totalPnl = closed.reduce((s, t) => s + (t.pnlUSDC || 0), 0);
    const totalInvested = closed.reduce((s, t) => s + (t.sizeUSDC || 0), 0);

    // By city
    const byCity = {};
    for (const t of closed) {
      const c = t.city || 'Unknown';
      if (!byCity[c]) byCity[c] = { trades: 0, wins: 0, pnlUSDC: 0 };
      byCity[c].trades++;
      if (t.result === 'win') byCity[c].wins++;
      byCity[c].pnlUSDC += t.pnlUSDC || 0;
    }

    // By side
    const bySide = {};
    for (const t of closed) {
      const s = t.side || 'Unknown';
      if (!bySide[s]) bySide[s] = { trades: 0, wins: 0, pnlUSDC: 0 };
      bySide[s].trades++;
      if (t.result === 'win') bySide[s].wins++;
      bySide[s].pnlUSDC += t.pnlUSDC || 0;
    }

    return res.json({
      system: 'weather-v2',
      paper: true,
      timestamp: new Date().toISOString(),
      stats: {
        totalTrades: closed.length,
        wins,
        losses,
        winRate: closed.length > 0 ? (wins / closed.length * 100).toFixed(1) + '%' : 'N/A',
        totalPnlUSDC: Math.round(totalPnl * 100) / 100,
        totalInvested: Math.round(totalInvested * 100) / 100
      },
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
        signal: t.signal
      })),
      recentTrades: closed
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
          closedAt: t.closedAt
        })),
      statusCounts: {
        open: open.length,
        closed: closed.length,
        total: trades.length
      }
    });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
};
