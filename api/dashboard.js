const { cors, checkAuth, readFile } = require('./_github');

module.exports = async (req, res) => {
  cors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (!checkAuth(req)) return res.status(401).json({ error: 'Unauthorized' });

  try {
    const [agents, activity, schoolTasks, polyPositions, tradingPositions, weatherTrades] = await Promise.all([
      readFile('_data/agents.json').catch(() => ({ data: [] })),
      readFile('_data/activity.json').catch(() => ({ data: [] })),
      readFile('_data/school-tasks.json').catch(() => ({ data: [] })),
      readFile('_data/polymarket-positions.json').catch(() => ({ data: [] })),
      readFile('_data/trading-positions.json').catch(() => ({ data: [] })),
      readFile('_data/weather-trades.json').catch(() => ({ data: [] }))
    ]);

    const now = new Date();

    // Agent summary
    const agentData = agents.data || [];
    const onlineAgents = agentData.filter(a => a.status === 'online').length;

    // School summary
    const tasks = schoolTasks.data || [];
    const pendingTasks = tasks.filter(t => t.status !== 'done').length;
    const overdueTasks = tasks.filter(t => t.status !== 'done' && t.dueDate && new Date(t.dueDate) < now);
    const upcoming = tasks.filter(t => t.status !== 'done' && t.dueDate)
      .sort((a, b) => new Date(a.dueDate) - new Date(b.dueDate));
    const nextDeadline = upcoming[0] || null;

    // Polymarket summary
    const polyData = polyPositions.data || [];
    const openPoly = polyData.filter(p => p.status === 'open');
    const totalPolyExposure = openPoly.reduce((s, p) => s + (p.invested || 0), 0);

    // Trading summary
    const tradeData = tradingPositions.data || [];
    const openTrades = tradeData.filter(t => t.status === 'open');
    const totalTradePnl = openTrades.reduce((s, t) => s + (t.pnl || 0), 0);

    // Weather summary
    const weatherData = weatherTrades.data || [];
    const openWeather = weatherData.filter(w => w.status === 'open');
    const totalWeatherExposure = openWeather.reduce((s, w) => s + ((w.entryPrice || 0) * (w.shares || 0)), 0);

    // Recent activity — synthesize from all sections
    const allActivity = [];

    // From weather trades
    (weatherData || []).forEach(w => {
      allActivity.push({
        agentName: 'Stormwatch 🌪️',
        action: `${w.status === 'open' ? 'Opened' : 'Closed'} ${w.city} ${w.bucket || ''} ${w.side || 'YES'} at ${w.entryPrice ? '$' + w.entryPrice.toFixed(2) : '?'}`,
        timestamp: w.updatedAt || w.createdAt,
        section: 'weather',
        status: w.status === 'closed-win' ? 'success' : w.status === 'closed-loss' ? 'error' : 'success'
      });
    });

    // From polymarket trades
    (polyData || []).forEach(p => {
      allActivity.push({
        agentName: 'Oracle 🔮',
        action: `${p.status === 'open' ? 'Opened' : 'Closed'} ${(p.market || '').slice(0, 50)} ${p.side || ''} at ${p.entryPrice ? '$' + p.entryPrice.toFixed(2) : '?'}`,
        timestamp: p.updatedAt || p.createdAt,
        section: 'polymarket',
        status: p.status === 'closed-win' ? 'success' : p.status === 'closed-loss' ? 'error' : 'success'
      });
    });

    // From whale trades
    const whaleData2 = (await readFile('_data/whale-trades.json').catch(() => ({ data: [] }))).data || [];
    whaleData2.forEach(t => {
      allActivity.push({
        agentName: 'Copycat 🐋',
        action: `${t.status === 'open' ? 'Opened' : 'Closed'} ${(t.market || '').slice(0, 50)} ${t.side || ''}`,
        timestamp: t.updatedAt || t.createdAt,
        section: 'whale',
        status: t.status === 'closed-win' ? 'success' : t.status === 'closed-loss' ? 'error' : 'success'
      });
    });

    // Also include manual activity entries if any
    (activity.data || []).forEach(a => allActivity.push(a));

    const recentActivity = allActivity
      .filter(a => a.timestamp)
      .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp))
      .slice(0, 20);

    return res.json({
      agents: { online: onlineAgents, total: agentData.length, list: agentData },
      school: { pendingTasks, overdueTasks: overdueTasks.length, nextDeadline },
      polymarket: { openPositions: openPoly.length, totalExposure: totalPolyExposure },
      trading: { openPositions: openTrades.length, dailyPnl: totalTradePnl },
      weather: { openPositions: openWeather.length, totalExposure: totalWeatherExposure },
      activity: recentActivity
    });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
};
