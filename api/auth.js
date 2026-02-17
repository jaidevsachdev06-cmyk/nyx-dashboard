const { cors } = require('./_github');

module.exports = (req, res) => {
  cors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { password } = req.body || {};
  if (password === process.env.AUTH_PASSWORD) {
    return res.status(200).json({ token: process.env.API_TOKEN });
  }
  return res.status(401).json({ error: 'Invalid password' });
};
