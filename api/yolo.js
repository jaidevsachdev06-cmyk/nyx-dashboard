const fs = require('fs');
const path = require('path');

module.exports = (req, res) => {
  // Auth check
  const auth = req.headers.authorization;
  if (!auth || !auth.startsWith('Bearer ')) return res.status(401).json({ error: 'Unauthorized' });
  
  const BUILDS_PATH = process.env.YOLO_BUILDS_PATH || '/data/.openclaw/workspace/projects/yolo/builds.json';
  
  try {
    let builds = [];
    try {
      builds = JSON.parse(fs.readFileSync(BUILDS_PATH, 'utf8'));
    } catch (e) {
      // File doesn't exist or empty
    }
    
    return res.json({
      totalBuilds: builds.length,
      builds: builds.slice(-30).reverse(),
      streak: calculateStreak(builds),
      categories: countCategories(builds)
    });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
};

function calculateStreak(builds) {
  if (!builds.length) return 0;
  let streak = 0;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  
  for (let i = 0; i <= 30; i++) {
    const d = new Date(today);
    d.setDate(d.getDate() - i);
    const ds = d.toISOString().split('T')[0];
    if (builds.some(b => b.date === ds)) streak++;
    else break;
  }
  return streak;
}

function countCategories(builds) {
  const cats = {};
  builds.forEach(b => { cats[b.category || 'Other'] = (cats[b.category || 'Other'] || 0) + 1; });
  return cats;
}
