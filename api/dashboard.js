const { cors, checkAuth, readFile } = require('./_github');

module.exports = async (req, res) => {
  cors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (!checkAuth(req)) return res.status(401).json({ error: 'Unauthorized' });

  try {
    const [agents, activity, schoolTasks, polyPositions, tradingPositions] = await Promise.all([
      readFile('_data/agents.json').catch(() => ({ data: [] })),
      readFile('_data/activity.json').catch(() => ({ data: [] })),
      readFile('_data/school-tasks.json').catch(() => ({ data: [] })),
      readFile('_data/polymarket-positions.json').catch(() => ({ data: [] })),
      readFile('_data/trading-positions.json').catch(() => ({ data: [] }))
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

    // Recent activity
    const recentActivity = (activity.data || [])
      .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp))
      .slice(0, 50);

    return res.json({
      agents: { online: onlineAgents, total: agentData.length, list: agentData },
      school: { pendingTasks, overdueTasks: overdueTasks.length, nextDeadline },
      polymarket: { openPositions: openPoly.length, totalExposure: totalPolyExposure },
      trading: { openPositions: openTrades.length, dailyPnl: totalTradePnl },
      activity: recentActivity
    });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
};
