const { cors, checkAuth } = require('./_github');

// Leaderboard for whale scorecard
// Primary:  Polymarket data-api.polymarket.com/v1/leaderboard (official, full wallets)
// Fallback: predicting.top (richer smart_score data, less saturated pool)
module.exports = async (req, res) => {
  cors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (!checkAuth(req)) return res.status(401).json({ error: 'Unauthorized' });

  const limit = req.query.limit || 20;

  // Fetch helper with timeout
  async function fetchWithTimeout(url, opts = {}, ms = 8000) {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), ms);
    try {
      const r = await fetch(url, { ...opts, signal: ctrl.signal });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return r.json();
    } finally {
      clearTimeout(t);
    }
  }

  // Primary: Polymarket data API
  try {
    const data = await fetchWithTimeout(
      `https://data-api.polymarket.com/v1/leaderboard?limit=${limit}&period=all&order_by=pnl`,
      { headers: { 'User-Agent': 'NyxDashboard/1.0' } }
    );
    const traders = Array.isArray(data) ? data : (data.traders || data.leaderboard || []);

    if (traders.length > 0) {
      const result = traders.map((t, i) => ({
        rank:             parseInt(t.rank) || i + 1,
        name:             t.userName || t.user_name || 'Unknown',
        wallet:           t.proxyWallet ? t.proxyWallet.slice(0, 10) + '...' : '',
        pnl:              parseFloat(t.pnl || 0),
        vol:              parseFloat(t.vol || 0),
        // Fields not in Polymarket API — preserved as defaults so dashboard doesn't break
        tier:             '—',
        smartScore:       0,
        percentile:       0,
        winRate:          0,
        winCount:         0,
        lossCount:        0,
        totalReturn:      0,
        sharpe:           0,
        sortino:          0,
        maxDrawdownPct:   0,
        profitFactor:     0,
        longestWinStreak: 0,
        lastActive:       '',
        dataPoints:       0,
        source:           'polymarket',
      }));
      return res.json(result);
    }
  } catch (_e) {
    // fall through to predicting.top
  }

  // Fallback: predicting.top
  try {
    const data = await fetchWithTimeout(`https://predicting.top/api/leaderboard?limit=${limit}`);
    const traders = Array.isArray(data) ? data : (data.traders || []);

    const result = traders.map((t, i) => {
      const s = t.smart_score || t.score || {};
      return {
        rank:             t.rank || i + 1,
        name:             t.name || t.username || 'Unknown',
        wallet:           t.wallet ? t.wallet.slice(0, 10) + '...' : '',
        tier:             s.tier || '—',
        smartScore:       s.score || 0,
        percentile:       s.percentile || 0,
        winRate:          s.winRate || 0,
        winCount:         s.winCount || 0,
        lossCount:        s.lossCount || 0,
        totalReturn:      s.totalReturn || 0,
        sharpe:           s.sharpeRatio || 0,
        sortino:          s.sortinoRatio || 0,
        maxDrawdownPct:   s.maxDrawdownPercent || 0,
        profitFactor:     s.profitFactor || 0,
        longestWinStreak: s.longestWinStreak || 0,
        lastActive:       s.lastDate || '',
        dataPoints:       s.dataPoints || 0,
        source:           'predicting.top',
      };
    });

    return res.json(result);
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
};
