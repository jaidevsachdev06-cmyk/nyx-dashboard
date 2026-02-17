const { cors, checkAuth, readFile, writeFile, uuid } = require('./_github');

module.exports = async (req, res) => {
  cors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (!checkAuth(req)) return res.status(401).json({ error: 'Unauthorized' });

  const type = req.query.type || 'tasks';
  const FILE = type === 'schedule' ? '_data/school-schedule.json' : '_data/school-tasks.json';

  try {
    const { data, sha } = await readFile(FILE);
    const id = req.query.id;

    if (req.method === 'GET') {
      if (id) {
        const item = data.find(d => d.id === id);
        return item ? res.json(item) : res.status(404).json({ error: 'Not found' });
      }
      // Auto-mark overdue tasks
      if (type === 'tasks') {
        const now = new Date();
        data.forEach(t => {
          if (t.status !== 'done' && t.dueDate && new Date(t.dueDate) < now) t.status = 'overdue';
        });
      }
      return res.json(data);
    }

    if (req.method === 'POST') {
      const item = { id: uuid(), ...req.body, createdAt: new Date().toISOString() };
      data.push(item);
      await writeFile(FILE, data, sha);
      return res.status(201).json(item);
    }

    if (req.method === 'PUT') {
      if (!id) return res.status(400).json({ error: 'id required' });
      const idx = data.findIndex(d => d.id === id);
      if (idx === -1) return res.status(404).json({ error: 'Not found' });
      if (req.body.status === 'done' && !data[idx].completedAt) req.body.completedAt = new Date().toISOString();
      data[idx] = { ...data[idx], ...req.body };
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
