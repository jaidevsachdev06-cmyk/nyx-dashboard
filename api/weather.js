const { cors, checkAuth, readFile, writeFile, uuid } = require('./_github');

const SIMMER_KEY = process.env.SIMMER_API_KEY;
const SIMMER_AGENT = process.env.SIMMER_AGENT_ID;
const DATA_PATH = '_data/weather-trades.json';

const CITY_COORDS = {
  'NYC': [40.7128, -74.0060],
  'Chicago': [41.8781, -87.6298],
  'Seattle': [47.6062, -122.3321],
  'Atlanta': [33.749, -84.388],
  'Dallas': [32.7767, -96.797],
  'Miami': [25.7617, -80.1918],
};

module.exports = async (req, res) => {
  cors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (!checkAuth(req)) return res.status(401).json({ error: 'Unauthorized' });

  const { type, city, id } = req.query || {};

  try {
    // Scan Simmer weather markets
    if (req.method === 'GET' && type === 'scan') {
      const r = await fetch('https://api.simmer.markets/api/sdk/markets?tags=weather&status=active&limit=50', {
        headers: { Authorization: `Bearer ${SIMMER_KEY}` }
      });
      const data = await r.json();
      return res.json(data);
    }

    // NOAA forecast
    if (req.method === 'GET' && type === 'noaa') {
      if (!city || !CITY_COORDS[city]) return res.status(400).json({ error: 'Unknown city. Use: ' + Object.keys(CITY_COORDS).join(', ') });
      const [lat, lon] = CITY_COORDS[city];
      const pointsRes = await fetch(`https://api.weather.gov/points/${lat},${lon}`, {
        headers: { 'User-Agent': 'NyxDashboard/1.0' }
      });
      const points = await pointsRes.json();
      const forecastUrl = points.properties?.forecast;
      if (!forecastUrl) return res.status(500).json({ error: 'Could not get forecast URL from NOAA' });
      const fcRes = await fetch(forecastUrl, { headers: { 'User-Agent': 'NyxDashboard/1.0' } });
      const fc = await fcRes.json();
      return res.json({ city, forecast: fc.properties?.periods || [] });
    }

    // Trade via Simmer
    if (req.method === 'POST' && type === 'trade') {
      const { market_id, side, amount, reasoning } = req.body;
      const r = await fetch('https://api.simmer.markets/api/sdk/trade', {
        method: 'POST',
        headers: { Authorization: `Bearer ${SIMMER_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ market_id, side, amount, venue: 'simmer', source: 'sdk:weather', reasoning: reasoning || '', agent_id: SIMMER_AGENT })
      });
      const data = await r.json();
      return res.json(data);
    }

    // CRUD for weather trades
    const { data, sha } = await readFile(DATA_PATH);

    if (req.method === 'GET') {
      if (id) {
        const trade = data.find(t => t.id === id);
        return trade ? res.json(trade) : res.status(404).json({ error: 'Not found' });
      }
      if (req.query.conditionId) {
        const item = data.find(d => d.conditionId === req.query.conditionId);
        return item ? res.json(item) : res.status(404).json({ error: 'Not found' });
      }
      if (req.query.status) {
        return res.json(data.filter(d => d.status === req.query.status));
      }
      return res.json(data);
    }

    if (req.method === 'POST') {
      // UPSERT: if conditionId exists AND position is open, update instead of duplicate
      if (req.body.conditionId) {
        const existing = data.findIndex(d => d.conditionId === req.body.conditionId && d.status === 'open');
        if (existing !== -1) {
          const updates = { ...req.body };
          delete updates.id;
          delete updates.createdAt;
          data[existing] = { ...data[existing], ...updates, updatedAt: new Date().toISOString() };
          await writeFile(DATA_PATH, data, sha);
          return res.json({ ...data[existing], _upsert: 'updated' });
        }
      }
      const trade = { id: uuid(), ...req.body, createdAt: new Date().toISOString() };
      data.push(trade);
      await writeFile(DATA_PATH, data, sha);
      return res.json({ ...trade, _upsert: 'created' });
    }

    if (req.method === 'PUT') {
      let idx = -1;
      if (id) idx = data.findIndex(t => t.id === id);
      else if (req.query.conditionId) idx = data.findIndex(t => t.conditionId === req.query.conditionId);
      else return res.status(400).json({ error: 'id or conditionId required' });
      if (idx === -1) return res.status(404).json({ error: 'Not found' });
      data[idx] = { ...data[idx], ...req.body, updatedAt: new Date().toISOString() };
      await writeFile(DATA_PATH, data, sha);
      return res.json(data[idx]);
    }

    if (req.method === 'DELETE') {
      const idx = data.findIndex(t => t.id === id);
      if (idx === -1) return res.status(404).json({ error: 'Not found' });
      data.splice(idx, 1);
      await writeFile(DATA_PATH, data, sha);
      return res.json({ ok: true });
    }

    return res.status(405).json({ error: 'Method not allowed' });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
};
