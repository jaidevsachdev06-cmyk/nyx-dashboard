const { cors, checkAuth, readFile, writeFile, uuid } = require('./_github');

function validatePosition(body, method = 'POST') {
  const errors = [];
  if (method === 'POST') {
    if (!body.market || typeof body.market !== 'string' || !body.market.trim())
      errors.push('market is required');
    if (!body.side)
      errors.push('side is required');
    const entry = parseFloat(body.entryPrice);
    if (isNaN(entry) || entry <= 0)
      errors.push('entryPrice must be a positive number');
    else if (entry < 0.01)
      errors.push(`entryPrice $${entry} < $0.01 — market is near-settled, refusing entry`);
    const shares = parseFloat(body.shares);
    if (isNaN(shares) || shares <= 0)
      errors.push('shares must be a positive number');
  }
  if (body.pnl !== undefined && body.shares !== undefined) {
    const pnl = parseFloat(body.pnl);
    const shares = parseFloat(body.shares);
    if (!isNaN(pnl) && !isNaN(shares) && Math.abs(pnl) > shares * 1.05)
      errors.push(`pnl $${pnl.toFixed(2)} exceeds maximum possible for ${shares} shares`);
  }
  return errors;
}

function recomputePnl(position) {
  const entry = parseFloat(position.entryPrice);
  const current = parseFloat(position.currentPrice ?? position.exitPrice);
  const shares = parseFloat(position.shares);
  if (!isNaN(entry) && !isNaN(current) && !isNaN(shares) && shares > 0) {
    position.invested = parseFloat((entry * shares).toFixed(4));
    position.currentValue = parseFloat((current * shares).toFixed(4));
    position.pnl = parseFloat(((current - entry) * shares).toFixed(4));
    position.pnlPercent = entry > 0 ? parseFloat(((position.pnl / position.invested) * 100).toFixed(2)) : 0;
  }
  return position;
}

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
      if (type === 'positions') {
        const errs = validatePosition(req.body, 'POST');
        if (errs.length) return res.status(400).json({ error: 'Validation failed', details: errs });
      }
      // UPSERT: if conditionId exists AND position is open, update instead of duplicate
      if (type === 'positions' && req.body.conditionId) {
        const existing = data.findIndex(d => d.conditionId === req.body.conditionId && d.status === 'open');
        if (existing !== -1) {
          const updates = { ...req.body };
          delete updates.id;
          delete updates.createdAt;
          data[existing] = recomputePnl({ ...data[existing], ...updates, updatedAt: new Date().toISOString() });
          await writeFile(FILE, data, sha);
          return res.status(200).json({ ...data[existing], _upsert: 'updated' });
        }
      }
      let item = { id: uuid(), ...req.body, createdAt: new Date().toISOString() };
      if (type === 'positions') {
        item.status = item.status || 'open';
        item.entryDate = item.entryDate || new Date().toISOString();
        item = recomputePnl(item);
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
      const putErrs = validatePosition(req.body, 'PUT');
      if (putErrs.length) return res.status(400).json({ error: 'Validation failed', details: putErrs });
      data[idx] = recomputePnl({ ...data[idx], ...req.body, updatedAt: new Date().toISOString() });
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
