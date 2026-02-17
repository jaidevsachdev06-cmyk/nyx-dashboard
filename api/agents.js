const { cors, checkAuth, readFile, writeFile, uuid } = require('./_github');
const FILE = '_data/agents.json';

module.exports = async (req, res) => {
  cors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (!checkAuth(req)) return res.status(401).json({ error: 'Unauthorized' });

  try {
    const { data, sha } = await readFile(FILE);
    const id = req.query.id;

    if (req.method === 'GET') {
      if (id) {
        const agent = data.find(a => a.id === id);
        return agent ? res.json(agent) : res.status(404).json({ error: 'Not found' });
      }
      return res.json(data);
    }

    if (req.method === 'POST') {
      const agent = { id: uuid(), ...req.body, createdAt: new Date().toISOString() };
      data.push(agent);
      await writeFile(FILE, data, sha);
      return res.status(201).json(agent);
    }

    if (req.method === 'PUT') {
      if (!id) return res.status(400).json({ error: 'id required' });
      const idx = data.findIndex(a => a.id === id);
      if (idx === -1) return res.status(404).json({ error: 'Not found' });
      data[idx] = { ...data[idx], ...req.body };
      await writeFile(FILE, data, sha);
      return res.json(data[idx]);
    }

    if (req.method === 'DELETE') {
      if (!id) return res.status(400).json({ error: 'id required' });
      const filtered = data.filter(a => a.id !== id);
      await writeFile(FILE, filtered, sha);
      return res.json({ success: true });
    }

    return res.status(405).json({ error: 'Method not allowed' });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
};
