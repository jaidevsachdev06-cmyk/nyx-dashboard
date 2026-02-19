const { cors, checkAuth, readFile, writeFile, uuid } = require('./_github');

module.exports = async (req, res) => {
  cors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (!checkAuth(req)) return res.status(401).json({ error: 'Unauthorized' });

  const FILE = '_data/whale-positions.json';

  try {
    const { data, sha } = await readFile(FILE);
    const id = req.query.id;
    const conditionId = req.query.conditionId;

    if (req.method === 'GET') {
      // Lookup by id or conditionId
      if (id) {
        const item = data.find(d => d.id === id);
        return item ? res.json(item) : res.status(404).json({ error: 'Not found' });
      }
      if (conditionId) {
        const item = data.find(d => d.conditionId === conditionId);
        return item ? res.json(item) : res.status(404).json({ error: 'Not found' });
      }
      // Filter by status if provided
      const status = req.query.status;
      if (status) return res.json(data.filter(d => d.status === status));
      return res.json(data);
    }

    if (req.method === 'POST') {
      // UPSERT: if conditionId exists AND position is open, update instead of duplicate
      if (req.body.conditionId) {
        const existing = data.findIndex(d => d.conditionId === req.body.conditionId && d.status === 'open');
        if (existing !== -1) {
          // Update existing position
          const updates = { ...req.body };
          delete updates.id; // don't overwrite id
          delete updates.createdAt; // don't overwrite creation date
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
      // New position
      const item = {
        id: uuid(),
        ...req.body,
        createdAt: new Date().toISOString(),
        invested: req.body.invested || (req.body.entryPrice * req.body.shares),
        currentValue: req.body.currentValue || (req.body.entryPrice * req.body.shares),
        pnl: req.body.pnl || 0,
        pnlPercent: req.body.pnlPercent || 0,
        status: req.body.status || 'open',
        entryDate: req.body.entryDate || new Date().toISOString(),
      };
      data.push(item);
      await writeFile(FILE, data, sha);
      return res.status(201).json({ ...item, _upsert: 'created' });
    }

    if (req.method === 'PUT') {
      // Support lookup by id OR conditionId
      let idx = -1;
      if (id) idx = data.findIndex(d => d.id === id);
      else if (conditionId) idx = data.findIndex(d => d.conditionId === conditionId);
      else return res.status(400).json({ error: 'id or conditionId required' });
      if (idx === -1) return res.status(404).json({ error: 'Not found' });
      data[idx] = { ...data[idx], ...req.body, updatedAt: new Date().toISOString() };
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
