const { cors, checkAuth, readFile, writeFile, uuid } = require('./_github');

module.exports = async (req, res) => {
  cors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (!checkAuth(req)) return res.status(401).json({ error: 'Unauthorized' });

  const type = req.query.type || 'positions';
  const FILE = type === 'watchlist' ? '_data/polymarket-watchlist.json' : '_data/polymarket-positions.json';

  try {
    const { data, sha } = await readFile(FILE);
    const id = req.query.id;

    if (req.method === 'GET') {
      if (id) {
        const item = data.find(d => d.id === id);
        return item ? res.json(item) : res.status(404).json({ error: 'Not found' });
      }
      const conditionId = req.query.conditionId;
      if (conditionId) {
        const item = data.find(d => d.conditionId === conditionId);
        return item ? res.json(item) : res.status(404).json({ error: 'Not found' });
      }
      const status = req.query.status;
      if (status) return res.json(data.filter(d => d.status === status));
      return res.json(data);
    }

    if (req.method === 'POST') {
      // UPSERT: if conditionId exists AND position is open, update instead of duplicate
      if (type === 'positions' && req.body.conditionId) {
        const existing = data.findIndex(d => d.conditionId === req.body.conditionId && d.status === 'open');
        if (existing !== -1) {
          const updates = { ...req.body };
          delete updates.id;
          delete updates.createdAt;
          data[existing] = { ...data[existing], ...updates, updatedAt: new Date().toISOString() };
          if (data[existing].currentPrice && data[existing].entryPrice && data[existing].shares) {
            data[existing].currentValue = data[existing].currentPrice * data[existing].shares;
            data[existing].invested = data[existing].entryPrice * data[existing].shares;
            data[existing].pnl = data[existing].currentValue - data[existing].invested;
            data[existing].pnlPercent = ((data[existing].pnl / data[existing].invested) * 100);
          }
          await writeFile(FILE, data, sha);
          return res.status(200).json({ ...data[existing], _upsert: 'updated' });
        }
      }
      const item = { id: uuid(), ...req.body, createdAt: new Date().toISOString() };
      if (type === 'positions') {
        item.invested = item.invested || (item.entryPrice * item.shares);
        item.currentValue = item.currentValue || item.invested;
        item.pnl = item.pnl || 0;
        item.pnlPercent = item.pnlPercent || 0;
        item.status = item.status || 'open';
        item.entryDate = item.entryDate || new Date().toISOString();
      } else {
        item.addedAt = item.addedAt || new Date().toISOString();
      }
      data.push(item);
      await writeFile(FILE, data, sha);
      return res.status(201).json({ ...item, _upsert: 'created' });
    }

    if (req.method === 'PUT') {
      let idx = -1;
      if (id) idx = data.findIndex(d => d.id === id);
      else if (req.query.conditionId) idx = data.findIndex(d => d.conditionId === req.query.conditionId);
      else return res.status(400).json({ error: 'id or conditionId required' });
      if (idx === -1) return res.status(404).json({ error: 'Not found' });
      data[idx] = { ...data[idx], ...req.body, updatedAt: new Date().toISOString() };
      // Recalculate P&L
      if (data[idx].currentPrice && data[idx].entryPrice && data[idx].shares) {
        data[idx].currentValue = data[idx].currentPrice * data[idx].shares;
        data[idx].invested = data[idx].entryPrice * data[idx].shares;
        data[idx].pnl = data[idx].currentValue - data[idx].invested;
        data[idx].pnlPercent = ((data[idx].pnl / data[idx].invested) * 100);
      }
      await writeFile(FILE, data, sha);
      return res.json(data[idx]);
    }

    if (req.method === 'DELETE') {
      if (!id) return res.status(400).json({ error: 'id required' });
      const filtered = data.filter(d => d.id !== id);
      await writeFile(FILE, filtered, sha);
      return res.json({ success: true });
    }

    return res.status(405).json({ error: 'Method not allowed' });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
};
