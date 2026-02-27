const { cors, checkAuth } = require('./_github');

// Proxy predicting.top leaderboard for whale scorecard
module.exports = async (req, res) => {
  cors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (!checkAuth(req)) return res.status(401).json({ error: 'Unauthorized' });

  const limit = req.query.limit || 20;

  try {
    const r = await fetch(`https://predicting.top/api/leaderboard?limit=${limit}`);
    const data = await r.json();
    const traders = Array.isArray(data) ? data : (data.traders || []);

    const result = traders.map((t, i) => {
      const s = t.smart_score || t.score || {};
      return {
        rank: t.rank || i + 1,
        name: t.name || t.username || 'Unknown',
        wallet: t.wallet ? t.wallet.slice(0, 10) + '...' : '',
        tier: s.tier || '—',
        smartScore: s.score || 0,
        percentile: s.percentile || 0,
        winRate: s.winRate || 0,
        winCount: s.winCount || 0,
        lossCount: s.lossCount || 0,
        totalReturn: s.totalReturn || 0,
        sharpe: s.sharpeRatio || 0,
        sortino: s.sortinoRatio || 0,
        maxDrawdownPct: s.maxDrawdownPercent || 0,
        profitFactor: s.profitFactor || 0,
        longestWinStreak: s.longestWinStreak || 0,
        lastActive: s.lastDate || '',
        dataPoints: s.dataPoints || 0,
      };
    });

    return res.json(result);
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
};
