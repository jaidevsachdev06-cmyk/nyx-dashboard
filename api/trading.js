const { cors, checkAuth, readFile, writeFile, uuid } = require('./_github');

const FILES = {
  positions: '_data/trading-positions.json',
  watchlist: '_data/trading-watchlist.json',
  journal: '_data/trading-journal.json'
};

module.exports = async (req, res) => {
  cors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (!checkAuth(req)) return res.status(401).json({ error: 'Unauthorized' });

  const type = req.query.type || 'positions';
  const FILE = FILES[type] || FILES.positions;

  try {
    const { data, sha } = await readFile(FILE);
    const id = req.query.id;

    if (req.method === 'GET') {
      if (id) {
        const item = data.find(d => d.id === id);
        return item ? res.json(item) : res.status(404).json({ error: 'Not found' });
      }
      return res.json(data);
    }

    if (req.method === 'POST') {
      const item = { id: uuid(), ...req.body, createdAt: new Date().toISOString() };
      if (type === 'positions') {
        item.invested = item.invested || (item.entryPrice * item.shares);
        item.currentValue = item.currentValue || item.invested;
        item.pnl = item.pnl || 0;
        item.pnlPercent = item.pnlPercent || 0;
        item.status = item.status || 'open';
        item.entryDate = item.entryDate || new Date().toISOString();
      } else if (type === 'watchlist') {
        item.addedAt = item.addedAt || new Date().toISOString();
      } else if (type === 'journal') {
        item.timestamp = item.timestamp || new Date().toISOString();
      }
      data.push(item);
      await writeFile(FILE, data, sha);
      return res.status(201).json(item);
    }

    if (req.method === 'PUT') {
      if (!id) return res.status(400).json({ error: 'id required' });
      const idx = data.findIndex(d => d.id === id);
      if (idx === -1) return res.status(404).json({ error: 'Not found' });
      data[idx] = { ...data[idx], ...req.body };
      if (type === 'positions' && data[idx].currentPrice && data[idx].entryPrice && data[idx].shares) {
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
