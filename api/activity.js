const { cors, checkAuth, readFile, writeFile, uuid } = require('./_github');
const FILE = '_data/activity.json';

module.exports = async (req, res) => {
  cors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (!checkAuth(req)) return res.status(401).json({ error: 'Unauthorized' });

  try {
    const { data, sha } = await readFile(FILE);

    if (req.method === 'GET') {
      const limit = parseInt(req.query.limit) || 50;
      const section = req.query.section;
      const agentId = req.query.agentId;
      let filtered = data;
      if (section) filtered = filtered.filter(a => a.section === section);
      if (agentId) filtered = filtered.filter(a => a.agentId === agentId);
      filtered.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
      return res.json(filtered.slice(0, limit));
    }

    if (req.method === 'POST') {
      const entry = { id: uuid(), ...req.body, timestamp: req.body.timestamp || new Date().toISOString() };
      data.push(entry);
      // Keep last 200 entries
      if (data.length > 200) data.splice(0, data.length - 200);
      await writeFile(FILE, data, sha);
      return res.status(201).json(entry);
    }

    return res.status(405).json({ error: 'Method not allowed' });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
};
