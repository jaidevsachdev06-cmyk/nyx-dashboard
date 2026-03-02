const { cors, checkAuth, readFile, writeFile, uuid } = require('./_github');

// ── Write-time validation ──────────────────────────────────────────────────
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
    const shares = parseFloat(body.shares);
    if (isNaN(shares) || shares <= 0)
      errors.push('shares must be a positive number');
    if (!body.confidence || body.confidence < 95)
      errors.push('confidence must be >= 95% for resolution arb');
  }
  return errors;
}

function recomputePnl(position) {
  const entry = parseFloat(position.entryPrice);
  const current = parseFloat(position.currentPrice ?? position.exitPrice ?? entry);
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

  const FILE = '_data/reaper-positions.json';

  try {
    const { data, sha } = await readFile(FILE);
    const id = req.query.id;
    const conditionId = req.query.conditionId;

    if (req.method === 'GET') {
      if (id) {
        const item = data.find(d => d.id === id);
        return item ? res.json(item) : res.status(404).json({ error: 'Not found' });
      }
      if (conditionId) {
        const item = data.find(d => d.conditionId === conditionId);
        return item ? res.json(item) : res.status(404).json({ error: 'Not found' });
      }
      const status = req.query.status;
      if (status) return res.json(data.filter(d => d.status === status));
      return res.json(data);
    }

    if (req.method === 'POST') {
      const errs = validatePosition(req.body, 'POST');
      if (errs.length) return res.status(400).json({ error: 'Validation failed', details: errs });

      // UPSERT: if conditionId exists AND position is open, update instead of duplicate
      if (req.body.conditionId) {
        const existing = data.findIndex(d => d.conditionId === req.body.conditionId && d.status === 'open');
        if (existing !== -1) {
          // Update existing
          const updated = recomputePnl({ ...data[existing], ...req.body, updatedAt: new Date().toISOString() });
          data[existing] = updated;
          await writeFile(FILE, data, sha);
          return res.json(updated);
        }
      }

      const newPos = recomputePnl({
        id: req.body.id || uuid(),
        ...req.body,
        strategy: 'resolution',
        ep: 'reaper',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      });
      data.push(newPos);
      await writeFile(FILE, data, sha);
      return res.status(201).json(newPos);
    }

    if (req.method === 'PUT') {
      if (!id && !conditionId) return res.status(400).json({ error: 'id or conditionId required' });
      const idx = id
        ? data.findIndex(d => d.id === id)
        : data.findIndex(d => d.conditionId === conditionId);
      if (idx === -1) return res.status(404).json({ error: 'Not found' });

      const updated = recomputePnl({ ...data[idx], ...req.body, updatedAt: new Date().toISOString() });
      data[idx] = updated;
      await writeFile(FILE, data, sha);
      return res.json(updated);
    }

    if (req.method === 'DELETE') {
      if (!id) return res.status(400).json({ error: 'id required' });
      const idx = data.findIndex(d => d.id === id);
      if (idx === -1) return res.status(404).json({ error: 'Not found' });
      const removed = data.splice(idx, 1)[0];
      await writeFile(FILE, data, sha);
      return res.json(removed);
    }

    return res.status(405).json({ error: 'Method not allowed' });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
};
