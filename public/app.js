// ========== CONFIG ==========
const API = '';
let TOKEN = sessionStorage.getItem('nyx-token') || '';

// ========== API HELPERS ==========
async function api(path, opts = {}) {
  const res = await fetch(API + path, {
    ...opts,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${TOKEN}`, ...opts.headers }
  });
  if (res.status === 401) { logout(); throw new Error('Unauthorized'); }
  return res.json();
}
const get = (p) => api(p + (p.includes('?') ? '&' : '?') + 'v=' + Date.now()); // cache-bust with timestamp
const post = (p, d) => api(p, { method: 'POST', body: JSON.stringify(d) });
const put = (p, d) => api(p, { method: 'PUT', body: JSON.stringify(d) });
const del = (p) => api(p, { method: 'DELETE' });

// ========== AUTH ==========
function checkAuth() {
  if (TOKEN) { document.getElementById('login-screen').style.display = 'none'; document.getElementById('app').style.display = 'block'; startHeaderClock(); loadCurrentSection(); }
}
function logout() { TOKEN = ''; sessionStorage.removeItem('nyx-token'); location.reload(); }
document.getElementById('login-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const pw = document.getElementById('login-password').value;
  try {
    const r = await fetch(API + '/api/auth', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password: pw }) });
    const d = await r.json();
    if (d.token) { TOKEN = d.token; sessionStorage.setItem('nyx-token', TOKEN); checkAuth(); }
    else { document.getElementById('login-error').textContent = 'Wrong password'; }
  } catch (e) { document.getElementById('login-error').textContent = 'Connection error'; }
});

// ========== HEADER CLOCK ==========
function startHeaderClock() {
  function update() {
    const now = new Date();
    const el = document.getElementById('header-clock');
    if (el) el.textContent = now.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });
  }
  update();
  setInterval(update, 1000);
}
function updateLastRefreshed() {
  const el = document.getElementById('last-refreshed');
  if (el) el.textContent = 'Updated ' + new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false });
}

// ========== NAVIGATION ==========
let currentSection = 'dashboard';
const sectionLabels = { dashboard: 'Dashboard', agents: 'The Office', school: 'School', polymarket: 'Polymarket', trading: 'Swing Trading' };

document.querySelectorAll('.sidebar a').forEach(a => {
  a.addEventListener('click', (e) => {
    e.preventDefault();
    const sec = a.dataset.section;
    switchSection(sec);
    document.getElementById('sidebar').classList.remove('open');
  });
});
document.getElementById('hamburger').addEventListener('click', () => {
  document.getElementById('sidebar').classList.toggle('open');
});

function switchSection(sec) {
  currentSection = sec;
  document.querySelectorAll('.sidebar a').forEach(a => a.classList.toggle('active', a.dataset.section === sec));
  document.querySelectorAll('.section').forEach(s => s.classList.toggle('active', s.id === `sec-${sec}`));
  window.location.hash = sec;
  const label = document.getElementById('header-section-label');
  if (label) label.textContent = sectionLabels[sec] || sec;
  loadCurrentSection();
}

function loadCurrentSection() {
  switch(currentSection) {
    case 'dashboard': loadDashboard(); break;
    case 'agents': loadAgents(); break;
    case 'school': loadSchool(); loadInternships(); break;
    case 'polymarket': loadPolymarket(); break;
    case 'trading': loadTrading(); break;
  }
}

// ========== POLYMARKET SUB-TABS ==========
let currentPolyTab = 'paper';
function switchPolyTab(tab) {
  currentPolyTab = tab;
  document.querySelectorAll('#poly-sub-tabs .sub-tab').forEach(t => t.classList.toggle('active', t.dataset.tab === tab));
  document.querySelectorAll('.sub-tab-panel').forEach(p => p.classList.toggle('active', p.id === `poly-tab-${tab}`));
}

// ========== POLY OVERVIEW ==========
let _polyData = { paper: null, weather: null, whale: null };

function computeStrategyStats(positions, strategyName) {
  if (!positions || !positions.length) return { open: 0, closed: 0, wins: 0, losses: 0, totalPnl: 0, realizedPnl: 0, unrealizedPnl: 0, deployed: 0, winRate: 0, avgPnl: 0, lastRun: null, trades: [] };
  positions.forEach(p => {
    if (p.pnl == null || p.pnl === 0) {
      if (p.entryPrice != null && p.currentPrice != null && p.shares) {
        const isNo = (p.side || p.position || '').toLowerCase() === 'no';
        p.pnl = isNo ? (p.entryPrice - p.currentPrice) * p.shares : (p.currentPrice - p.entryPrice) * p.shares;
      } else p.pnl = 0;
    }
  });
  const open = positions.filter(p => p.status === 'open');
  const closed = positions.filter(p => p.status !== 'open');
  const wins = closed.filter(p => /win/.test(p.status)).length;
  const losses = closed.filter(p => /loss/.test(p.status)).length;
  const scored = wins + losses;
  const realizedPnl = closed.reduce((s, p) => s + (p.pnl || 0), 0);
  const unrealizedPnl = open.reduce((s, p) => s + (p.pnl || 0), 0);
  const deployed = open.reduce((s, p) => s + ((p.entryPrice || 0) * (p.shares || 0)), 0);
  const timestamps = positions.map(p => p.updatedAt || p.createdAt).filter(Boolean).sort().reverse();
  return {
    open: open.length, closed: closed.length, wins, losses, scored,
    totalPnl: realizedPnl + unrealizedPnl, realizedPnl, unrealizedPnl,
    deployed, winRate: scored ? (wins / scored * 100) : 0,
    avgPnl: scored ? realizedPnl / scored : 0,
    lastRun: timestamps[0] || null,
    closedTrades: closed
  };
}

function renderPolyOverview() {
  const paperStats = computeStrategyStats(_polyData.paper || [], 'Paper');
  const weatherStats = computeStrategyStats(_polyData.weather || [], 'Weather');
  const whaleStats = computeStrategyStats(_polyData.whale || [], 'Whale');

  const bankroll = 500;
  const totalDeployed = paperStats.deployed + weatherStats.deployed + whaleStats.deployed;
  const totalOpenPos = paperStats.open + weatherStats.open + whaleStats.open;
  const totalPnl = paperStats.totalPnl + weatherStats.totalPnl + whaleStats.totalPnl;
  const totalReal = paperStats.realizedPnl + weatherStats.realizedPnl + whaleStats.realizedPnl;
  const totalUnreal = paperStats.unrealizedPnl + weatherStats.unrealizedPnl + whaleStats.unrealizedPnl;
  const totalWins = paperStats.wins + weatherStats.wins + whaleStats.wins;
  const totalLosses = paperStats.losses + weatherStats.losses + whaleStats.losses;
  const totalScored = totalWins + totalLosses;
  const overallWinRate = totalScored ? (totalWins / totalScored * 100) : 0;
  const totalTrades = (paperStats.closed + paperStats.open) + (weatherStats.closed + weatherStats.open) + (whaleStats.closed + whaleStats.open);
  const totalClosed = paperStats.closed + weatherStats.closed + whaleStats.closed;
  const avgPnl = totalClosed ? totalReal / totalClosed : 0;

  const pnlColor = n => n >= 0 ? '#22c55e' : '#ef4444';
  const pnlBorder = totalPnl >= 0 ? 'border-green' : 'border-red';
  const avgBorder = avgPnl >= 0 ? 'border-green' : 'border-red';

  // Win rate conic gradient
  const wrPct = Math.round(overallWinRate);
  const wrColor = wrPct > 55 ? '#22c55e' : wrPct >= 45 ? '#eab308' : '#ef4444';

  document.getElementById('poly-overview-cards').innerHTML = `
    <div class="overview-card border-green">
      <div class="ov-label">Balance <span class="ov-badge">📄 Paper</span></div>
      <div class="ov-value" style="color:#22c55e">${fmtMoney(bankroll + totalPnl)}</div>
      <div class="ov-sub">$${bankroll} bankroll</div>
    </div>
    <div class="overview-card border-blue">
      <div class="ov-label">Deployed</div>
      <div class="ov-value">${fmtMoney(totalDeployed)}</div>
      <div class="ov-sub">${totalOpenPos} open positions</div>
    </div>
    <div class="overview-card ${pnlBorder}">
      <div class="ov-label">Total P&L</div>
      <div class="ov-value" style="color:${pnlColor(totalPnl)}">${fmtMoney(totalPnl)}</div>
      <div class="ov-sub">Real: <span style="color:${pnlColor(totalReal)}">${fmtMoney(totalReal)}</span> · Unreal: <span style="color:${pnlColor(totalUnreal)}">${fmtMoney(totalUnreal)}</span></div>
    </div>
    <div class="overview-card border-yellow">
      <div class="ov-label">Win Rate</div>
      <div class="win-rate-circle" style="background:conic-gradient(${wrColor} ${wrPct}%, rgba(255,255,255,0.08) ${wrPct}%)">${wrPct}%</div>
      <div class="ov-sub">${totalWins}W / ${totalLosses}L</div>
    </div>
    <div class="overview-card border-white">
      <div class="ov-label">Total Trades</div>
      <div class="ov-value">${totalTrades}</div>
      <div class="ov-sub">${totalClosed} closed</div>
    </div>
    <div class="overview-card ${avgBorder}">
      <div class="ov-label">Avg P&L</div>
      <div class="ov-value" style="color:${pnlColor(avgPnl)}">${fmtMoney(avgPnl)}</div>
      <div class="ov-sub">per closed trade</div>
    </div>
  `;

  // Strategy Leaderboard
  const strategies = [
    { key: 'whale', name: '🐋 Mirror', dotClass: 'mirror', stats: whaleStats, active: true },
    { key: 'weather', name: '🌡️ Monsoon', dotClass: 'monsoon', stats: weatherStats, active: true },
    { key: 'paper', name: '📊 Paper', dotClass: 'paper', stats: paperStats, active: true },
  ];

  document.getElementById('strategy-leaderboard-body').innerHTML = strategies.map((s, i) => {
    const st = s.stats;
    const wr = st.winRate.toFixed(0);
    const wrBarClass = wr > 55 ? 'wr-green' : wr >= 45 ? 'wr-yellow' : 'wr-red';
    const consistency = st.scored ? Math.min(100, st.scored * 5) : 0; // rough consistency proxy
    const score = Math.round((st.winRate / 100) * consistency);
    const scoreClass = score > 70 ? 'score-green' : score >= 50 ? 'score-yellow' : 'score-red';
    return `<tr>
      <td class="mono">${i + 1}</td>
      <td><span class="strategy-dot ${s.dotClass}"></span><strong>${s.name}</strong></td>
      <td><span class="status-pill ${s.active ? 'active' : 'disabled'}">${s.active ? 'Active' : 'Disabled'}</span></td>
      <td class="mono">${st.open + st.closed}</td>
      <td class="mono">${wr}% <span class="wr-bar"><span class="wr-bar-fill ${wrBarClass}" style="width:${wr}%"></span></span></td>
      <td class="mono ${pnlClass(st.totalPnl)}" style="font-weight:700">${fmtMoney(st.totalPnl)}</td>
      <td>${st.lastRun ? timeAgo(st.lastRun) : '—'}</td>
      <td><span class="score-val ${scoreClass}">${score}</span></td>
    </tr>`;
  }).join('');

  // P&L by Strategy
  document.getElementById('pnl-by-strategy').innerHTML = strategies.map(s => {
    const pnl = s.stats.totalPnl;
    const barColor = pnl >= 0 ? '#22c55e' : '#ef4444';
    return `<div class="pnl-strat-card">
      <div class="psc-header"><span class="strategy-dot ${s.dotClass}"></span>${s.name}</div>
      <div class="psc-value" style="color:${pnlColor(pnl)}">${fmtMoney(pnl)}</div>
      <div class="psc-bar" style="background:${barColor}"></div>
    </div>`;
  }).join('');

  // P&L History - last 20 closed trades across all strategies
  const allClosed = [
    ...(paperStats.closedTrades || []).map(t => ({ ...t, strategy: 'paper' })),
    ...(weatherStats.closedTrades || []).map(t => ({ ...t, strategy: 'weather' })),
    ...(whaleStats.closedTrades || []).map(t => ({ ...t, strategy: 'whale' })),
  ].sort((a, b) => new Date(a.updatedAt || a.createdAt || 0) - new Date(b.updatedAt || b.createdAt || 0)).slice(-20);

  const chart = document.getElementById('pnl-history-chart');
  if (allClosed.length === 0) {
    chart.innerHTML = '<div style="color:var(--text-dim);display:flex;align-items:center;justify-content:center;height:100%;font-size:13px">No closed trades yet</div>';
  } else {
    const maxAbs = Math.max(...allClosed.map(t => Math.abs(t.pnl || 0)), 1);
    chart.innerHTML = allClosed.map(t => {
      const isWin = (t.pnl || 0) >= 0;
      const h = Math.max(4, Math.round((Math.abs(t.pnl || 0) / maxAbs) * 100));
      return `<div class="pnl-bar ${isWin ? 'win' : 'loss'}" style="height:${h}px" title="${fmtMoney(t.pnl)}"></div>`;
    }).join('');
  }
}

// ========== HELPERS ==========
function timeAgo(ts) {
  if (!ts) return '—';
  const diff = Date.now() - new Date(ts).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
}
function fmtDate(ts) {
  if (!ts) return '—';
  return new Date(ts).toLocaleDateString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}
function fmtMoney(n) { if (n == null) return '—'; const r = Math.round((n || 0) * 100) / 100; return `$${r.toFixed(2)}`; }
function fmtCountdown(ts) {
  if (!ts) return '';
  const ms = new Date(ts).getTime() - Date.now();
  if (ms <= 0) return '<span style="color:var(--red);font-weight:600">RESOLVING</span>';
  const h = Math.floor(ms / 3600000);
  const d = Math.floor(h / 24);
  const rem = h % 24;
  if (d > 30) return `<span style="color:var(--text-dim)">${d}d</span>`;
  if (d > 7) return `<span style="color:var(--text-dim)">${d}d ${rem}h</span>`;
  if (d > 1) return `<span style="color:var(--yellow)">${d}d ${rem}h</span>`;
  if (h > 6) return `<span style="color:var(--yellow)">${h}h</span>`;
  const m = Math.floor((ms % 3600000) / 60000);
  return `<span style="color:var(--red);font-weight:600">${h}h ${m}m</span>`;
}
function fmtPct(n) { return n != null ? `${n >= 0 ? '+' : ''}${n.toFixed(2)}%` : '—'; }
function pnlClass(n) { return n > 0 ? 'pnl-pos' : n < 0 ? 'pnl-neg' : ''; }
function statusDot(s) { return `<span class="status-dot status-${s}"></span>`; }
function sectionBadge(s) { return `<span class="section-badge ${s}">${s}</span>`; }
function priorityBadge(p) { return `<span class="badge badge-${p || 'low'}">${p || 'low'}</span>`; }

// ========== DASHBOARD ==========
async function loadDashboard() {
  try {
    const d = await get('/api/dashboard');
    updateLastRefreshed();
    document.getElementById('dash-summary').innerHTML = `
      <div class="summary-card gradient-agents"><div class="label">Agents</div><div class="value">${d.agents.online}/${d.agents.total}</div><div class="detail">online</div></div>
      <div class="summary-card gradient-school"><div class="label">School</div><div class="value">${d.school.pendingTasks}</div><div class="detail">pending tasks${d.school.overdueTasks ? ` · <span style="color:var(--red)">${d.school.overdueTasks} overdue</span>` : ''}</div></div>
      <div class="summary-card gradient-poly"><div class="label">Polymarket</div><div class="value">${d.polymarket.openPositions}</div><div class="detail">${fmtMoney(d.polymarket.totalExposure)} exposure</div></div>
      <div class="summary-card gradient-weather"><div class="label">Weather</div><div class="value">${d.weather?.openPositions || 0}</div><div class="detail">${fmtMoney(d.weather?.totalExposure || 0)} exposure</div></div>
    `;
    document.getElementById('dash-activity').innerHTML = (d.activity || []).map(a => `
      <div class="activity-item">
        <div class="activity-dot ${a.status || 'success'}"></div>
        <div class="activity-content">
          <div class="activity-action"><span class="activity-agent">${a.agentName || 'System'}</span> ${a.action}</div>
          <div class="activity-meta"><span>${timeAgo(a.timestamp)}</span>${a.section ? sectionBadge(a.section) : ''}</div>
        </div>
      </div>
    `).join('') || '<div style="color:var(--text-dim);padding:20px">No activity yet</div>';
    document.getElementById('dash-agents').innerHTML = (d.agents.list || []).map(a => `
      <div class="agent-card" onclick="switchSection('agents')">
        <div class="agent-avatar">${a.avatar || '🤖'}</div>
        <div class="agent-name">${statusDot(a.status || 'offline')} ${a.name}</div>
        <div class="agent-role">${a.role || ''}</div>
        <div class="agent-task">${a.currentTask || 'No active task'}</div>
      </div>
    `).join('') || '<div style="color:var(--text-dim)">No agents registered</div>';
  } catch (e) { console.error('Dashboard load error:', e); }
}

// ========== AGENTS ==========
async function loadAgents() {
  try {
    const [agents, activity] = await Promise.all([get('/api/agents'), get('/api/activity')]);
    updateLastRefreshed();

    document.getElementById('office-floor').innerHTML = agents.map(a => {
      const s = a.status || 'offline';
      const statusLabel = s === 'online' ? '● Working' : s === 'idle' ? '● Idle' : s === 'error' ? '● Error' : '● Offline';
      return `
        <div class="agent-figure">
          <div class="agent-figure-body">
            <div class="agent-figure-pixel ${s === 'online' ? 'working' : ''}">${a.avatar || '🤖'}</div>
          </div>
          <div class="agent-figure-card">
            <div class="agent-figure-name">${a.avatar || ''} ${a.name}</div>
            <div class="agent-figure-role">${a.role || ''}</div>
            <div class="agent-figure-status ${s}">${statusLabel}</div>
          </div>
        </div>
      `;
    }).join('') || '<div style="color:var(--text-dim);font-size:13px;padding:40px">No agents yet. Add your first agent!</div>';

    document.getElementById('agents-activity-side').innerHTML = activity.slice(0, 20).map(a => `
      <div class="activity-item">
        <div class="activity-dot ${a.status || 'success'}"></div>
        <div class="activity-content">
          <div class="activity-action"><span class="activity-agent">${a.agentName || 'System'}</span> ${a.action}</div>
          <div class="activity-meta"><span>${timeAgo(a.timestamp)}</span></div>
        </div>
      </div>
    `).join('') || '<div style="color:var(--text-dim);padding:16px;font-size:12px">No activity yet</div>';

    document.getElementById('agents-breakdown').innerHTML = agents.map(a => {
      const s = a.status || 'offline';
      const capabilities = (a.tools || []);
      const accessSections = (a.accessList || []);
      const integrations = (a.integrations || []);
      const files = (a.files || []);
      const model = a.model || '';
      const description = a.description || a.role || '';

      return `
        <div class="breakdown-card">
          <div class="breakdown-header">
            <div class="breakdown-header-left">
              <span class="avatar">${a.avatar || '🤖'}</span>
              <div>
                <div class="name">${a.name}</div>
                <div class="role">${a.role || ''}</div>
              </div>
            </div>
            ${model ? `<span class="breakdown-model">${model}</span>` : ''}
          </div>
          ${description && description !== a.role ? `<div class="breakdown-desc">${description}</div>` : ''}
          ${capabilities.length ? `
            <div class="breakdown-section">
              <div class="breakdown-section-title">⚡ Capabilities</div>
              <div class="breakdown-tags">${capabilities.map(t => `<span class="breakdown-tag">${t}</span>`).join('')}</div>
            </div>
          ` : ''}
          ${accessSections.length ? `
            <div class="breakdown-section">
              <div class="breakdown-section-title">🔑 Access</div>
              <div class="breakdown-tags">${accessSections.map(t => `<span class="breakdown-tag blue">${t}</span>`).join('')}</div>
            </div>
          ` : ''}
          ${integrations.length ? `
            <div class="breakdown-section">
              <div class="breakdown-section-title">⚙️ Integrations</div>
              <div class="breakdown-tags">${integrations.map(t => `<span class="breakdown-tag green">${t}</span>`).join('')}</div>
            </div>
          ` : ''}
          ${files.length ? `
            <div class="breakdown-section">
              <div class="breakdown-section-title">📁 Special Files & References</div>
              ${files.map(f => `
                <div class="breakdown-file">
                  <span class="breakdown-file-icon">📄</span>
                  <div>
                    <div class="breakdown-file-name">${f.name || ''}</div>
                    <div class="breakdown-file-desc">${f.desc || ''}</div>
                  </div>
                </div>
              `).join('')}
            </div>
          ` : ''}
          <div class="breakdown-actions">
            <button class="btn btn-sm" onclick="editAgent('${a.id}')">Edit</button>
            <button class="btn btn-sm" onclick="deleteAgent('${a.id}')" style="color:var(--red)">Delete</button>
          </div>
        </div>
      `;
    }).join('') || '';
  } catch (e) { console.error(e); }
}
async function deleteAgent(id) { if (confirm('Delete this agent?')) { await del(`/api/agents?id=${id}`); loadAgents(); } }
async function editAgent(id) {
  const agent = await get(`/api/agents?id=${id}`);
  showModal('agent', agent);
}

// ========== SCHOOL ==========
async function loadSchool() {
  try {
    const [tasks, schedule] = await Promise.all([get('/api/school?type=tasks'), get('/api/school?type=schedule')]);
    updateLastRefreshed();
    const cols = { todo: [], 'in-progress': [], done: [], overdue: [] };
    tasks.forEach(t => { const s = t.status || 'todo'; if (cols[s]) cols[s].push(t); else cols.todo.push(t); });
    const renderCol = (title, items, color) => `
      <div class="kanban-col">
        <h3>${title} <span class="count">${items.length}</span></h3>
        ${items.map(t => `
          <div class="task-card ${t.status === 'overdue' ? 'overdue' : t.priority === 'high' || t.priority === 'critical' ? 'high' : ''}" onclick="editTask('${t.id}')">
            <div style="display:flex;justify-content:space-between;align-items:start">
              <div class="task-title">${t.title}</div>
              ${priorityBadge(t.priority)}
            </div>
            <div class="task-course">${t.course || ''}</div>
            <div class="task-due">${t.dueDate ? fmtDate(t.dueDate) : 'No due date'}</div>
          </div>
        `).join('')}
      </div>
    `;
    document.getElementById('school-kanban').innerHTML =
      renderCol('Overdue 🔴', cols.overdue) + renderCol('To Do', cols.todo) + renderCol('In Progress', cols['in-progress']) + renderCol('Done ✓', cols.done);

    const now = new Date();
    const upcoming = tasks
      .filter(t => t.status !== 'done' && t.dueDate)
      .sort((a, b) => new Date(a.dueDate) - new Date(b.dueDate));

    const urgencyLabel = (d) => {
      const ms = new Date(d) - now;
      const hrs = ms / 3600000;
      if (hrs < 0) return '<span style="color:var(--red);font-weight:600">OVERDUE</span>';
      if (hrs < 24) return '<span style="color:var(--red);font-weight:600">TODAY</span>';
      if (hrs < 48) return '<span style="color:#f59e0b;font-weight:600">TOMORROW</span>';
      if (hrs < 168) return '<span style="color:#eab308">This week</span>';
      return '<span style="color:var(--text-dim)">' + Math.ceil(hrs / 24) + 'd</span>';
    };

    document.getElementById('school-checklist').innerHTML = upcoming.length ? `
      <div style="display:flex;flex-direction:column;gap:4px">
        ${upcoming.map(t => {
          const isOverdue = new Date(t.dueDate) < now;
          return `<div style="display:flex;align-items:center;gap:12px;padding:12px 16px;border-radius:var(--radius-sm);background:${isOverdue ? 'rgba(239,68,68,0.06)' : 'rgba(255,255,255,0.02)'};border:1px solid ${isOverdue ? 'rgba(239,68,68,0.1)' : 'var(--border)'};cursor:pointer;transition:all .15s" onclick="toggleTaskDone('${t.id}','${t.status}')" onmouseenter="this.style.background='rgba(255,255,255,0.04)'" onmouseleave="this.style.background='${isOverdue ? 'rgba(239,68,68,0.06)' : 'rgba(255,255,255,0.02)'}'">
            <input type="checkbox" ${t.status === 'done' ? 'checked' : ''} style="width:18px;height:18px;accent-color:var(--accent);cursor:pointer;flex-shrink:0" onclick="event.stopPropagation();toggleTaskDone('${t.id}','${t.status}')">
            <div style="flex:1;min-width:0">
              <div style="font-size:14px;font-weight:500;${t.status === 'in-progress' ? 'color:var(--accent)' : ''}">${t.title}</div>
              <div style="font-size:12px;color:var(--text-dim);display:flex;gap:12px;margin-top:3px">
                <span>${t.course || ''}</span>
                <span>${t.dueDate ? fmtDate(t.dueDate) : ''}</span>
              </div>
            </div>
            <div style="text-align:right;white-space:nowrap">${urgencyLabel(t.dueDate)}</div>
            ${t.priority === 'high' || t.priority === 'critical' ? '<span style="color:var(--red);font-size:10px">●</span>' : ''}
          </div>`;
        }).join('')}
      </div>
    ` : '<div style="color:var(--text-dim);padding:16px">No upcoming tasks 🎉</div>';

    const days = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'];
    const times = ['08:00','08:30','09:00','09:30','10:00','10:30','11:00','11:30','12:00','12:30','13:00','13:30','14:00','14:30','15:00','15:30','16:00','16:30','17:00','17:30'];
    let html = '<div class="schedule-grid"><div class="schedule-header"></div>';
    days.forEach(d => { html += `<div class="schedule-header">${d.slice(0,3)}</div>`; });
    times.forEach(time => {
      html += `<div class="schedule-cell schedule-time">${time}</div>`;
      days.forEach(day => {
        const events = schedule.filter(s => s.day === day && s.startTime === time);
        if (events.length) {
          html += `<div class="schedule-cell">${events.map(e => `<div class="schedule-event">${e.course}<br><span style="color:var(--text-dim)">${e.startTime}–${e.endTime} · ${e.location || ''}</span></div>`).join('')}</div>`;
        } else {
          html += `<div class="schedule-cell"></div>`;
        }
      });
    });
    html += '</div>';
    document.getElementById('school-schedule').innerHTML = html;
  } catch (e) { console.error(e); }
}
async function editTask(id) {
  const task = await get(`/api/school?type=tasks&id=${id}`);
  showModal('task', task);
}
async function toggleTaskDone(id, currentStatus) {
  const newStatus = currentStatus === 'done' ? 'todo' : 'done';
  await put(`/api/school?type=tasks&id=${id}`, { status: newStatus });
  loadSchool();
  if (currentSection === 'dashboard') loadDashboard();
}

// ========== POLYMARKET ==========
async function loadPolymarket() {
  try {
    const [positions, watchlist] = await Promise.all([get('/api/polymarket?type=positions'), get('/api/polymarket?type=watchlist')]);
    updateLastRefreshed();
    positions.forEach(p => {
      if (p.pnl != null && p.pnl !== 0) { /* keep server pnl */ }
      else if (p.entryPrice != null && p.currentPrice != null && p.shares) {
        const isNo = (p.side || p.position || '').toLowerCase() === 'no';
        p.pnl = isNo
          ? (p.entryPrice - p.currentPrice) * p.shares
          : (p.currentPrice - p.entryPrice) * p.shares;
      } else { p.pnl = p.pnl || 0; }
    });
    const open = positions.filter(p => p.status === 'open');
    const closed = positions.filter(p => p.status !== 'open');
    const totalInvested = open.reduce((s, p) => s + ((p.entryPrice || 0) * (p.shares || 0)), 0);
    const totalPnl = closed.reduce((s, p) => s + (p.pnl || 0), 0) + open.reduce((s, p) => s + (p.pnl || 0), 0);
    const wins = closed.filter(p => p.status === 'closed-win' || p.status === 'resolved-win').length;
    const losses = closed.filter(p => p.status === 'closed-loss' || p.status === 'resolved-loss').length;
    const scored = wins + losses;
    const winRate = scored ? ((wins / scored) * 100).toFixed(0) : '—';

    const dailyPctP = totalInvested > 0 ? (totalPnl / totalInvested * 100) : 0;
    const pnlCardClass = totalPnl > 0 ? 'pnl-positive' : totalPnl < 0 ? 'pnl-negative' : '';
    document.getElementById('poly-summary').innerHTML = `
      <div class="summary-card poly-card"><div class="label">Positions</div><div class="value mono">${open.length}</div></div>
      <div class="summary-card poly-card"><div class="label">Invested</div><div class="value mono">${fmtMoney(totalInvested)}</div></div>
      <div class="summary-card poly-card ${pnlCardClass}"><div class="label">P&L</div><div class="value mono ${pnlClass(totalPnl)}">${fmtMoney(totalPnl)}</div><div class="detail ${pnlClass(dailyPctP)}">${dailyPctP >= 0 ? '+' : ''}${dailyPctP.toFixed(1)}%</div></div>
      <div class="summary-card poly-card"><div class="label">Win Rate</div><div class="value mono">${winRate}%</div><div class="detail">${wins}/${scored} trades</div></div>
    `;

    _polyData.paper = positions;

    const sideBadge = s => `<span class="side-pill ${(s||'').toLowerCase() === 'yes' ? 'yes' : 'no'}">${(s||'—').toUpperCase()}</span>`;

    document.querySelector('#poly-open-table tbody').innerHTML = open.map(p => `<tr>
      <td style="max-width:250px"><a href="${p.marketUrl || '#'}" target="_blank" style="color:var(--accent);text-decoration:none;font-weight:500">${p.market || ''}</a></td>
      <td>${sideBadge(p.position)}</td>
      <td class="mono">${fmtMoney(p.entryPrice)}</td>
      <td class="mono">${fmtMoney(p.currentPrice)}</td>
      <td class="mono">${p.shares || ''}</td>
      <td class="mono ${pnlClass(p.pnl)}" style="font-weight:700">${fmtMoney(p.pnl)}</td>
      <td class="mono" style="font-size:11px">${fmtCountdown(p.endDate || p.resolutionDate)}</td>
      <td><button class="btn btn-sm" onclick="editPolyPosition('${p.id}')">Edit</button></td>
    </tr>
    <tr class="evidence-row"><td colspan="8" style="padding:6px 16px 14px;border-top:none">
      <div style="display:flex;gap:16px;align-items:center;flex-wrap:wrap;font-size:12px">
        <span>${sideBadge(p.position)}</span>
        <span>📊 ${(p.tags || []).map(t => `<span style="background:rgba(255,255,255,0.04);padding:2px 8px;border-radius:6px;font-size:11px">${t}</span>`).join(' ') || '—'}</span>
        <span>📅 Entered: <strong>${p.createdAt ? fmtDate(p.createdAt) : '—'}</strong></span>
        <span>🏁 Resolves: <strong>${p.endDate || p.resolutionDate ? fmtDate(p.endDate || p.resolutionDate) : '—'}</strong></span>
      </div>
      <div style="font-size:12px;color:var(--text-dim);margin-top:6px;line-height:1.5">💡 ${p.notes || 'No reasoning recorded'}</div>
    </td></tr>`).join('') || '<tr><td colspan="7" style="color:var(--text-dim);padding:20px">No open positions</td></tr>';

    document.getElementById('poly-trade-log').innerHTML = closed.length ? closed.map(p => `
      <div class="activity-item">
        <div class="activity-dot ${p.status === 'closed-win' ? 'success' : 'error'}"></div>
        <div class="activity-content">
          <div class="activity-action">
            <strong>${p.market}</strong> — ${p.status === 'closed-win' ? '✅ WIN' : '❌ LOSS'}
            <span class="mono ${pnlClass(p.pnl)}" style="margin-left:8px;font-weight:700">${fmtMoney(p.pnl)}</span>
          </div>
          <div style="font-size:12px;margin:4px 0;color:var(--text-dim)">
            ${p.position || ''} · Entry ${fmtMoney(p.entryPrice)} → Exit ${fmtMoney(p.exitPrice || p.resolutionPrice || p.currentPrice)} · ${p.shares || 0} shares
          </div>
          <div style="font-size:12px;color:var(--text-dim);line-height:1.5">💡 ${p.notes || 'No reasoning'}</div>
          <div class="activity-meta">
            <span>📅 Entered: ${p.createdAt ? fmtDate(p.createdAt) : '—'}</span>
            <span style="margin-left:12px">🏁 Closed: ${p.updatedAt ? fmtDate(p.updatedAt) : '—'}</span>
          </div>
        </div>
      </div>
    `).join('') : '<div style="color:var(--text-dim);padding:20px">No closed trades yet</div>';

    document.querySelector('#poly-watch-table tbody').innerHTML = watchlist.map(w => `<tr>
      <td>${w.market || ''}</td><td class="mono">${fmtMoney(w.currentPrice)}</td>
      <td class="mono">${fmtMoney(w.targetEntry)}</td><td>${w.notes || ''}</td>
      <td><button class="btn btn-sm" onclick="deletePolyWatch('${w.id}')" style="color:var(--red)">✕</button></td>
    </tr>`).join('') || '<tr><td colspan="5" style="color:var(--text-dim)">Watchlist empty</td></tr>';
    loadWeatherTrades();
    loadWhaleTrades();
  } catch (e) { console.error(e); }
}
async function editPolyPosition(id) { const p = await get(`/api/polymarket?type=positions&id=${id}`); showModal('poly-position', p); }
async function deletePolyWatch(id) { await del(`/api/polymarket?type=watchlist&id=${id}`); loadPolymarket(); }

// ========== WEATHER TRADES ==========
async function loadWeatherTrades() {
  try {
    const raw = await get('/api/weather');
    // v2 API returns { openPositions, recentTrades, stats, ... } — normalize
    let trades;
    if (Array.isArray(raw)) {
      trades = raw;
    } else {
      // Map v2 openPositions to the format the frontend expects
      const openPos = (raw.openPositions || []).map(t => ({
        ...t, status: 'open', market: t.market || t.question || `${t.city} ${t.date} ${t.bucket}`,
        shares: t.sizeUSDC && t.entryPrice ? t.sizeUSDC / t.entryPrice : 0,
        currentPrice: t.currentPrice ?? t.entryPrice,
        pnl: t.pnlUSDC ?? 0,
        side: (t.side || 'YES').toLowerCase(),
        city: t.city, bucket: t.bucket,
        forecastConfidence: t.signal?.edge > 0.3 ? 'high' : t.signal?.edge > 0.15 ? 'medium-high' : 'medium',
        noaaForecast: t.signal?.forecastTemp ? `${t.signal.forecastTemp.toFixed(1)}°` : '—',
        reasoning: t.signal ? `Model: ${(t.signal.modelProb*100).toFixed(0)}% vs Market: ${(t.signal.impliedProb*100).toFixed(0)}% | Edge: ${(t.signal.edge*100).toFixed(0)}%` : '',
      }));
      const closedPos = (raw.recentTrades || []).map(t => ({
        ...t, status: t.result === 'win' ? 'closed-win' : 'closed-loss',
        market: t.market || t.question || `${t.city} ${t.date} ${t.bucket}`, pnl: t.pnlUSDC || 0,
        shares: t.sizeUSDC && t.entryPrice ? Math.round(t.sizeUSDC / t.entryPrice) : 0,
      }));
      trades = [...openPos, ...closedPos];
    }
    trades.forEach(t => {
      if (t.pnl != null && t.pnl !== 0) { /* keep server pnl */ }
      else if (t.entryPrice != null && t.currentPrice != null && t.shares) {
        const isNo = (t.side || '').toLowerCase() === 'no';
        t.pnl = isNo
          ? (t.entryPrice - t.currentPrice) * t.shares
          : (t.currentPrice - t.entryPrice) * t.shares;
      } else { t.pnl = 0; }
    });
    const open = trades.filter(t => t.status === 'open');
    const closed = trades.filter(t => t.status !== 'open');
    const totalPnl = closed.reduce((s, t) => s + (t.pnl || 0), 0);
    const wins = closed.filter(t => t.status === 'closed-win' || t.status === 'resolved-win').length;
    const losses = closed.filter(t => t.status === 'closed-loss' || t.status === 'resolved-loss').length;
    const scored = wins + losses;
    const winRate = scored ? ((wins / scored) * 100).toFixed(0) : '—';

    const totalInvestedW = open.reduce((s, t) => s + ((t.entryPrice || 0) * (t.shares || 0)), 0);
    const dailyPctW = totalInvestedW > 0 ? (totalPnl / totalInvestedW * 100) : 0;
    const pnlCardClass = totalPnl > 0 ? 'pnl-positive' : totalPnl < 0 ? 'pnl-negative' : '';
    document.getElementById('weather-summary').innerHTML = `
      <div class="summary-card weather-card"><div class="label">Positions</div><div class="value mono">${open.length}</div></div>
      <div class="summary-card weather-card"><div class="label">Invested</div><div class="value mono">${fmtMoney(totalInvestedW)}</div></div>
      <div class="summary-card weather-card ${pnlCardClass}"><div class="label">P&L</div><div class="value mono ${pnlClass(totalPnl)}">${fmtMoney(totalPnl)}</div><div class="detail ${pnlClass(dailyPctW)}">${dailyPctW >= 0 ? '+' : ''}${dailyPctW.toFixed(1)}%</div></div>
      <div class="summary-card weather-card"><div class="label">Win Rate</div><div class="value mono">${winRate}%</div><div class="detail">${wins}/${scored} trades</div></div>
    `;
    _polyData.weather = trades;
    loadNoaaForecasts(open);

    const confBadge = c => {
      const colors = { high: 'var(--green)', 'medium-high': '#84cc16', medium: 'var(--yellow)', low: 'var(--red)' };
      return `<span style="background:${colors[c] || '#666'};color:#000;padding:3px 8px;border-radius:6px;font-size:11px;font-weight:700">${(c||'—').toUpperCase()}</span>`;
    };
    const edgePct = t => {
      if (!t.entryPrice || !t.currentPrice) return '—';
      const edge = ((t.currentPrice - t.entryPrice) / t.entryPrice * 100).toFixed(1);
      return `<span class="${edge > 0 ? 'pnl-pos' : 'pnl-neg'}">${edge > 0 ? '+' : ''}${edge}%</span>`;
    };

    document.querySelector('#weather-open-table tbody').innerHTML = open.map(t => `<tr>
      <td>${t.city || ''}</td>
      <td style="max-width:200px"><a href="${t.marketUrl || '#'}" target="_blank" style="color:var(--teal);text-decoration:none;font-weight:500">${t.market || ''}</a></td>
      <td>${t.side || ''}</td>
      <td class="mono">${fmtMoney(t.entryPrice)}</td>
      <td class="mono">${fmtMoney(t.currentPrice)}</td>
      <td class="mono">${t.noaaForecast || '—'}</td>
      <td class="mono">${t.shares || ''}</td>
      <td class="mono ${pnlClass(t.pnl)}" style="font-weight:700">${fmtMoney(t.pnl)}</td>
      <td class="mono" style="font-size:11px">${fmtCountdown(t.date ? t.date + 'T23:59:59Z' : t.endDate)}</td>
      <td><button class="btn btn-sm" onclick="editWeatherTrade('${t.id}')">Edit</button></td>
    </tr>
    <tr class="evidence-row"><td colspan="10" style="padding:6px 16px 14px;border-top:none">
      <div style="display:flex;gap:16px;align-items:center;flex-wrap:wrap;font-size:12px">
        <span>🎯 Bucket: <strong>${t.bucket || '—'}</strong></span>
        <span>🌡️ NOAA: <strong>${t.noaaForecast || '—'}</strong></span>
        <span>📊 Confidence: ${confBadge(t.forecastConfidence)}</span>
        <span>📈 Edge: ${edgePct(t)}</span>
        <span>📅 Entered: <strong>${t.createdAt ? fmtDate(t.createdAt) : '—'}</strong></span>
        <span>🏁 Resolves: <strong>${t.date ? fmtDate(t.date + 'T23:59:59Z') : t.endDate ? fmtDate(t.endDate) : '—'}</strong></span>
      </div>
      <div style="font-size:12px;color:var(--text-dim);margin-top:6px;line-height:1.5">💡 ${t.reasoning || t.notes || 'No reasoning recorded'}</div>
    </td></tr>`).join('') || '<tr><td colspan="9" style="color:var(--text-dim);padding:20px">No open weather positions</td></tr>';

    document.getElementById('weather-trade-log').innerHTML = closed.length ? closed.map(t => {
      const label = t.city || t.market || 'Unknown';
      const shortLabel = label.length > 60 ? label.substring(0, 57) + '...' : label;
      const reason = t.reasoning || t.notes || 'No reasoning';
      const isWin = t.status === 'closed-win' || t.status === 'resolved-win';
      const isLoss = t.status === 'closed-loss' || t.status === 'resolved-loss';
      const outcomeLabel = isWin ? '✅ WIN' : isLoss ? '❌ LOSS' : '⚪ CLOSED';
      return `
      <div class="activity-item">
        <div class="activity-dot ${isWin ? 'success' : isLoss ? 'error' : ''}"></div>
        <div class="activity-content">
          <div class="activity-action">
            <strong>${shortLabel}</strong> ${t.bucket || t.side || ''} — ${outcomeLabel}
            <span class="mono ${pnlClass(t.pnl)}" style="margin-left:8px;font-weight:700">${fmtMoney(t.pnl)}</span>
          </div>
          <div style="font-size:12px;margin:4px 0;color:var(--text-dim)">
            Entry ${fmtMoney(t.entryPrice)} → Exit ${fmtMoney(t.exitPrice || t.resolutionPrice || t.currentPrice)} · ${t.shares || '—'} shares
          </div>
          <div style="font-size:12px;color:var(--text-dim);line-height:1.5">💡 ${reason}</div>
          <div class="activity-meta">
            <span>📅 Entered: ${t.createdAt ? fmtDate(t.createdAt) : '—'}</span>
            <span style="margin-left:12px">🏁 Closed: ${t.updatedAt ? fmtDate(t.updatedAt) : '—'}</span>
          </div>
        </div>
      </div>`;
    }).join('') : '<div style="color:var(--text-dim);padding:20px">No resolved trades yet</div>';
  } catch (e) { console.error('Weather load error:', e); }
}

async function editWeatherTrade(id) {
  const t = await get(`/api/weather?id=${id}`);
  showModal('weather-trade', t);
}

// ========== NOAA FORECASTS (City Grid) ==========
async function loadNoaaForecasts(openPositions) {
  const cities = ['NYC', 'Chicago', 'Miami', 'Dallas', 'Atlanta', 'Seattle'];
  const container = document.getElementById('noaa-forecasts');
  container.innerHTML = cities.map(c => `<div class="city-card" id="noaa-${c}"><div class="city-name">${c}</div><div class="city-temp mono" style="font-size:16px;color:var(--text-dim)">⏳ Loading...</div></div>`).join('');

  // Count open positions per city
  const posPerCity = {};
  if (openPositions) {
    openPositions.forEach(p => {
      const c = p.city || '';
      posPerCity[c] = (posPerCity[c] || 0) + 1;
    });
  }

  for (const city of cities) {
    try {
      const data = await get(`/api/weather?type=noaa&city=${city}`);
      const el = document.getElementById(`noaa-${city}`);
      if (data.forecast && data.forecast.length > 0) {
        const now = data.forecast[0];
        const temp = now.temperature;
        const unit = now.temperatureUnit || 'F';
        const short = now.shortForecast || '';
        const wind = now.windSpeed || '';
        const icon = short.toLowerCase().includes('rain') ? '🌧️' :
                     short.toLowerCase().includes('cloud') ? '☁️' :
                     short.toLowerCase().includes('snow') ? '🌨️' :
                     short.toLowerCase().includes('thunder') ? '⛈️' :
                     short.toLowerCase().includes('fog') ? '🌫️' :
                     short.toLowerCase().includes('sunny') || short.toLowerCase().includes('clear') ? '☀️' : '🌤️';
        const posCount = posPerCity[city] || 0;
        el.innerHTML = `
          <div class="city-name">${city} ${posCount > 0 ? `<span style="font-size:11px;background:rgba(20,184,166,0.12);color:var(--teal);padding:2px 8px;border-radius:8px;font-weight:600;margin-left:6px">${posCount} pos</span>` : ''}</div>
          <div class="city-temp">${icon} ${temp}°${unit}</div>
          <div class="city-detail">${short}</div>
          <div class="city-detail">💨 ${wind}</div>
          <div class="city-detail" style="font-size:10px;opacity:0.5;margin-top:4px">${now.name || ''}</div>
        `;
      }
    } catch (e) {
      const el = document.getElementById(`noaa-${city}`);
      if (el) el.innerHTML = `<div class="city-name">${city}</div><div class="city-temp mono" style="font-size:14px;color:var(--red)">Error</div>`;
    }
  }
}

// ========== WHALE COPYTRADING ==========
function tierColor(tier) {
  if (tier === 'Elite') return '#00ff88';
  if (tier === 'Great') return '#00cc66';
  if (tier === 'Good') return '#88cc00';
  if (tier === 'Average') return '#cccc00';
  if (tier === 'Risky') return '#ff4444';
  return '#888';
}

function tierBadge(tier) {
  const c = tierColor(tier);
  return `<span style="color:${c};font-weight:700">${tier}</span>`;
}

async function loadWhaleTrades() {
  try {
    const trades = await get('/api/whale');
    const all = Array.isArray(trades) ? trades : [];
    all.forEach(t => {
      if (t.pnl != null && t.pnl !== 0) { /* keep server pnl */ }
      else if (t.entryPrice != null && t.currentPrice != null && t.shares) {
        // Both YES and NO prices are stored as their own token price, so formula is same for both
        t.pnl = (t.currentPrice - t.entryPrice) * t.shares;
      } else { t.pnl = t.pnl || 0; }
    });
    const open = all.filter(t => t.status === 'open');
    const closed = all.filter(t => t.status !== 'open');
    const totalInvested = open.reduce((s, t) => s + ((t.entryPrice || 0) * (t.shares || 0)), 0);
    const totalPnl = closed.reduce((s, t) => s + (t.pnl || 0), 0) + open.reduce((s, t) => s + (t.pnl || 0), 0);
    const wins = closed.filter(t => t.status === 'closed-win' || t.status === 'resolved-win').length;
    const losses = closed.filter(t => t.status === 'closed-loss' || t.status === 'resolved-loss').length;
    const scored = wins + losses;
    const winRate = scored ? ((wins / scored) * 100).toFixed(0) : '—';

    const dailyPctWh = totalInvested > 0 ? (totalPnl / totalInvested * 100) : 0;
    const pnlCardClass = totalPnl > 0 ? 'pnl-positive' : totalPnl < 0 ? 'pnl-negative' : '';
    document.getElementById('whale-summary').innerHTML = `
      <div class="summary-card whale-card"><div class="label">Positions</div><div class="value mono">${open.length}</div></div>
      <div class="summary-card whale-card"><div class="label">Invested</div><div class="value mono">${fmtMoney(totalInvested)}</div></div>
      <div class="summary-card whale-card ${pnlCardClass}"><div class="label">P&L</div><div class="value mono ${pnlClass(totalPnl)}">${fmtMoney(totalPnl)}</div><div class="detail ${pnlClass(dailyPctWh)}">${dailyPctWh >= 0 ? '+' : ''}${dailyPctWh.toFixed(1)}%</div></div>
      <div class="summary-card whale-card"><div class="label">Win Rate</div><div class="value mono">${winRate}%</div><div class="detail">${wins}/${scored} trades</div></div>
    `;

    _polyData.whale = all;
    renderPolyOverview();
    loadWhaleScorecard();

    // Consensus
    const consensusMap = {};
    open.forEach(t => {
      const whaleList = (t.whales || '').split(',').map(w => w.trim()).filter(Boolean);
      const key = `${t.market}||${t.side}`;
      if (!consensusMap[key]) consensusMap[key] = { market: t.market, side: t.side, whales: new Set(), entries: [], current: t.currentPrice, pnls: [] };
      whaleList.forEach(w => consensusMap[key].whales.add(w));
      consensusMap[key].entries.push(t.entryPrice || 0);
      if (t.currentPrice) consensusMap[key].current = t.currentPrice;
      if (t.pnlPercent != null) consensusMap[key].pnls.push(t.pnlPercent);
    });
    const consensus = Object.values(consensusMap).filter(c => c.whales.size >= 3).sort((a,b) => b.whales.size - a.whales.size);

    document.querySelector('#whale-consensus-table tbody').innerHTML = consensus.length ? consensus.map(c => {
      const avgEntry = c.entries.reduce((s,v) => s+v, 0) / c.entries.length;
      const avgPnl = c.pnls.length ? c.pnls.reduce((s,v) => s+v, 0) / c.pnls.length : 0;
      const conf = c.whales.size >= 5 ? '🔥 Very High' : c.whales.size >= 4 ? '🟢 High' : '🟡 Moderate';
      return `<tr>
        <td style="max-width:220px">${c.market}</td>
        <td>${c.side}</td>
        <td>${Array.from(c.whales).join(', ')}</td>
        <td class="mono">${fmtMoney(avgEntry)}</td>
        <td class="mono">${fmtMoney(c.current)}</td>
        <td class="mono ${pnlClass(avgPnl)}">${fmtPct(avgPnl)}</td>
        <td>${conf}</td>
      </tr>`;
    }).join('') : '<tr><td colspan="7" style="color:var(--text-dim)">No consensus trades yet (need 3+ whales on same position)</td></tr>';

    const whaleConfBadge = c => {
      const colors = { high: 'var(--green)', 'medium-high': '#84cc16', medium: 'var(--yellow)', low: 'var(--red)' };
      return `<span style="background:${colors[c] || '#666'};color:#000;padding:3px 8px;border-radius:6px;font-size:11px;font-weight:700">${(c||'—').toUpperCase()}</span>`;
    };
    const whaleSideBadge = s => `<span style="background:${s === 'Yes' || s === 'yes' ? 'var(--green)' : 'var(--red)'};color:#000;padding:3px 8px;border-radius:6px;font-size:11px;font-weight:700">${(s||'—').toUpperCase()}</span>`;

    document.querySelector('#whale-open-table tbody').innerHTML = open.map(t => `<tr>
      <td style="max-width:220px"><a href="${t.marketUrl || '#'}" target="_blank" style="color:var(--purple);text-decoration:none;font-weight:500">${t.market || ''}</a></td>
      <td>${whaleSideBadge(t.side)}</td>
      <td class="mono">${fmtMoney(t.entryPrice)}</td>
      <td class="mono">${fmtMoney(t.currentPrice)}</td>
      <td class="mono">${t.shares || ''}</td>
      <td class="mono ${pnlClass(t.pnl)}" style="font-weight:700">${fmtMoney(t.pnl)}</td>
      <td class="mono" style="font-size:11px">${fmtCountdown(t.endDate)}</td>
      <td><button class="btn btn-sm" onclick="editWhalePosition('${t.id}')">Edit</button></td>
    </tr>
    <tr class="evidence-row"><td colspan="8" style="padding:6px 16px 14px;border-top:none">
      <div style="display:flex;gap:16px;align-items:center;flex-wrap:wrap;font-size:12px">
        <span>🐋 Whales: <strong>${t.whales || '—'}</strong></span>
        <span>📊 Confidence: ${whaleConfBadge(t.confidence)}</span>
        <span>📡 ${t.source || 'predicting.top'}</span>
        <span>📅 Entered: <strong>${t.createdAt ? fmtDate(t.createdAt) : '—'}</strong></span>
        <span>🏁 Resolves: <strong>${t.endDate ? fmtDate(t.endDate) : '—'}</strong></span>
      </div>
      <div style="font-size:12px;color:var(--text-dim);margin-top:6px;line-height:1.5">💡 ${t.reasoning || t.notes || 'No reasoning recorded'}</div>
    </td></tr>`).join('') || '<tr><td colspan="7" style="color:var(--text-dim);padding:20px">No open whale positions</td></tr>';

    document.getElementById('whale-trade-log').innerHTML = closed.length ? closed.map(t => `
      <div class="activity-item">
        <div class="activity-dot ${t.status === 'closed-win' ? 'success' : 'error'}"></div>
        <div class="activity-content">
          <div class="activity-action">
            <strong>${t.market}</strong> — ${(t.status === 'closed-win' || t.status === 'resolved-win') ? '✅ WIN' : (t.status === 'closed-loss' || t.status === 'resolved-loss') ? '❌ LOSS' : '⚪ CLOSED'}
            <span class="mono ${pnlClass(t.pnl)}" style="margin-left:8px;font-weight:700">${fmtMoney(t.pnl)}</span>
          </div>
          <div style="font-size:12px;margin:4px 0;color:var(--text-dim)">
            ${t.side || ''} · Entry ${fmtMoney(t.entryPrice)} → Exit ${fmtMoney(t.exitPrice || t.resolutionPrice || t.currentPrice)} · ${t.shares || 0} shares · Whales: ${t.whales || '—'}
          </div>
          <div style="font-size:12px;color:var(--text-dim);line-height:1.5">💡 ${t.reasoning || t.notes || 'No reasoning'}</div>
          <div class="activity-meta">
            <span>📅 Entered: ${t.createdAt ? fmtDate(t.createdAt) : '—'}</span>
            <span style="margin-left:12px">🏁 Closed: ${t.updatedAt ? fmtDate(t.updatedAt) : '—'}</span>
          </div>
        </div>
      </div>
    `).join('') : '<div style="color:var(--text-dim);padding:20px">No closed whale trades yet</div>';
  } catch (e) { console.error('Whale load error:', e); }
}

function toggleScorecard() {
  const wrap = document.getElementById('scorecard-wrap');
  const toggle = document.getElementById('scorecard-toggle');
  const open = wrap.style.display !== 'none';
  wrap.style.display = open ? 'none' : 'block';
  toggle.textContent = open ? '▶' : '▼';
}

async function loadWhaleScorecard() {
  const tbody = document.getElementById('whale-scorecard-body');
  const meta = document.getElementById('scorecard-meta');

  const cached = localStorage.getItem('whale-scorecard');
  const cacheTime = localStorage.getItem('whale-scorecard-ts');
  const ONE_DAY = 24 * 60 * 60 * 1000;
  let whales;

  if (cached && cacheTime && (Date.now() - parseInt(cacheTime)) < ONE_DAY) {
    whales = JSON.parse(cached);
    const ago = Math.round((Date.now() - parseInt(cacheTime)) / 3600000);
    meta.textContent = `(${whales.length} whales · cached ${ago}h ago)`;
  } else {
    tbody.innerHTML = '<tr><td colspan="11" style="color:var(--text-dim)">Fetching from predicting.top...</td></tr>';
    try {
      whales = await get('/api/whales?limit=200');
      localStorage.setItem('whale-scorecard', JSON.stringify(whales));
      localStorage.setItem('whale-scorecard-ts', Date.now().toString());
      meta.textContent = `(${whales.filter(w=>w.smartScore>0).length} whales · just updated)`;
    } catch (e) {
      if (cached) { whales = JSON.parse(cached); meta.textContent = '(using stale cache)'; }
      else { tbody.innerHTML = '<tr><td colspan="11" style="color:var(--red)">Failed to load</td></tr>'; return; }
    }
  }

  if (!whales || !whales.length) { tbody.innerHTML = '<tr><td colspan="11" style="color:var(--text-dim)">No data</td></tr>'; return; }
  tbody.innerHTML = whales.filter(w => w.smartScore > 0).map(w => {
    const wrPct = (w.winRate * 100).toFixed(1);
    const wrClass = w.winRate >= 0.6 ? 'pnl-pos' : w.winRate < 0.4 ? 'pnl-neg' : '';
    const scoreColor = tierColor(w.tier);
    const retFmt = w.totalReturn >= 1000000 ? `$${(w.totalReturn/1000000).toFixed(1)}M` :
                   w.totalReturn >= 1000 ? `$${(w.totalReturn/1000).toFixed(0)}K` :
                   `$${w.totalReturn.toFixed(0)}`;
    const ddPct = (w.maxDrawdownPct * 100).toFixed(1);
    return `<tr>
      <td class="mono">${w.rank}</td>
      <td><strong>${w.name}</strong><div style="font-size:10px;color:var(--text-dim)">${w.wallet}</div></td>
      <td>${tierBadge(w.tier)}</td>
      <td class="mono" style="color:${scoreColor};font-weight:700">${w.smartScore.toFixed(1)}</td>
      <td class="mono ${wrClass}">${wrPct}%</td>
      <td class="mono">${w.winCount}/${w.lossCount}</td>
      <td class="mono ${w.sharpe >= 2 ? 'pnl-pos' : w.sharpe < 0 ? 'pnl-neg' : ''}">${w.sharpe.toFixed(2)}</td>
      <td class="mono ${w.maxDrawdownPct > 0.5 ? 'pnl-neg' : ''}">${ddPct}%</td>
      <td class="mono ${w.profitFactor >= 2 ? 'pnl-pos' : w.profitFactor < 1 ? 'pnl-neg' : ''}">${w.profitFactor.toFixed(1)}x</td>
      <td class="mono pnl-pos">${retFmt}</td>
      <td class="mono">${w.longestWinStreak}</td>
    </tr>`;
  }).join('');
}

async function editWhalePosition(id) {
  const t = await get(`/api/whale?id=${id}`);
  showModal('poly-position', t);
}

async function scanWeatherMarkets() {
  try {
    const tbody = document.querySelector('#weather-scan-table tbody');
    tbody.innerHTML = '<tr><td colspan="6" style="color:var(--text-dim)">Scanning...</td></tr>';
    const data = await get('/api/weather?type=scan');
    const markets = data.markets || data.data || data || [];
    if (!Array.isArray(markets) || !markets.length) {
      tbody.innerHTML = '<tr><td colspan="6" style="color:var(--text-dim)">No weather markets found</td></tr>';
      return;
    }
    tbody.innerHTML = markets.map(m => `<tr>
      <td style="max-width:250px">${m.question || m.title || m.name || ''}</td>
      <td class="mono">${m.last_price != null ? fmtMoney(m.last_price) : (m.price != null ? fmtMoney(m.price) : '—')}</td>
      <td class="mono">—</td>
      <td>${m.end_date ? fmtDate(m.end_date) : (m.resolution_date ? fmtDate(m.resolution_date) : '—')}</td>
      <td class="mono">${m.volume_24h != null ? fmtMoney(m.volume_24h) : '—'}</td>
      <td><button class="btn btn-sm btn-primary" onclick='prefillWeatherTrade(${JSON.stringify(m).replace(/'/g,"&#39;")})'>Trade</button></td>
    </tr>`).join('');
  } catch (e) { console.error('Scan error:', e); }
}

function prefillWeatherTrade(m) {
  showModal('weather-trade', {
    market: m.question || m.title || m.name || '',
    marketId: m.id || m.market_id || '',
    marketUrl: m.url || '',
    side: 'yes',
    entryPrice: m.last_price || m.price || null,
  });
}

// ========== TRADING ==========
async function loadTrading() {
  try {
    const [positions, watchlist, journal] = await Promise.all([
      get('/api/trading?type=positions'), get('/api/trading?type=watchlist'), get('/api/trading?type=journal')
    ]);
    updateLastRefreshed();
    const open = positions.filter(p => p.status === 'open');
    const closed = positions.filter(p => p.status !== 'open');
    const totalInvested = open.reduce((s, p) => s + (p.invested || 0), 0);
    const totalValue = open.reduce((s, p) => s + (p.currentValue || 0), 0);
    const totalPnl = totalValue - totalInvested;
    const wins = closed.filter(p => p.status === 'closed-profit').length;
    const winRate = closed.length ? ((wins / closed.length) * 100).toFixed(0) : '—';
    const pnlCardClass = totalPnl > 0 ? 'pnl-positive' : totalPnl < 0 ? 'pnl-negative' : '';

    document.getElementById('trade-summary').innerHTML = `
      <div class="summary-card trading-card"><div class="label">Invested</div><div class="value mono">${fmtMoney(totalInvested)}</div></div>
      <div class="summary-card trading-card"><div class="label">Current Value</div><div class="value mono">${fmtMoney(totalValue)}</div></div>
      <div class="summary-card trading-card ${pnlCardClass}"><div class="label">Total P&L</div><div class="value mono ${pnlClass(totalPnl)}">${fmtMoney(totalPnl)}</div></div>
      <div class="summary-card trading-card"><div class="label">Win Rate</div><div class="value mono">${winRate}%</div><div class="detail">${wins}/${closed.length} trades</div></div>
    `;
    document.querySelector('#trade-open-table tbody').innerHTML = open.map(p => `<tr>
      <td class="mono" style="font-weight:700">${p.ticker}</td>
      <td>${p.side || 'long'}</td>
      <td class="mono">${fmtMoney(p.entryPrice)}</td>
      <td class="mono">${fmtMoney(p.currentPrice)}</td>
      <td class="mono">${p.shares}</td>
      <td class="mono" style="color:var(--red)">${fmtMoney(p.stopLoss)}</td>
      <td class="mono" style="color:var(--green)">${fmtMoney(p.takeProfit)}</td>
      <td class="mono ${pnlClass(p.pnl)}" style="font-weight:700">${fmtMoney(p.pnl)}</td>
      <td class="mono ${pnlClass(p.pnlPercent)}">${fmtPct(p.pnlPercent)}</td>
      <td><button class="btn btn-sm" onclick="editTradePosition('${p.id}')">Edit</button></td>
    </tr>`).join('') || '<tr><td colspan="10" style="color:var(--text-dim)">No open positions</td></tr>';
    document.querySelector('#trade-closed-table tbody').innerHTML = closed.map(p => `<tr>
      <td class="mono" style="font-weight:700">${p.ticker}</td><td>${p.side || 'long'}</td>
      <td class="mono">${fmtMoney(p.entryPrice)}</td><td class="mono">${fmtMoney(p.exitPrice)}</td>
      <td class="mono ${pnlClass(p.pnl)}" style="font-weight:700">${fmtMoney(p.pnl)}</td><td>${p.status}</td>
    </tr>`).join('') || '<tr><td colspan="6" style="color:var(--text-dim)">No closed positions</td></tr>';
    document.querySelector('#trade-watch-table tbody').innerHTML = watchlist.map(w => `<tr>
      <td class="mono" style="font-weight:700">${w.ticker}</td><td class="mono">${fmtMoney(w.currentPrice)}</td>
      <td class="mono">${fmtMoney(w.targetEntry)}</td><td>${w.thesis || ''}</td>
      <td><button class="btn btn-sm" onclick="deleteTradeWatch('${w.id}')" style="color:var(--red)">✕</button></td>
    </tr>`).join('') || '<tr><td colspan="5" style="color:var(--text-dim)">Watchlist empty</td></tr>';
    document.getElementById('trade-journal').innerHTML = journal.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp)).map(j => `
      <div class="activity-item">
        <div class="activity-dot success"></div>
        <div class="activity-content">
          <div class="activity-action"><span class="mono" style="color:var(--accent);font-weight:600">${j.ticker}</span> ${j.note}</div>
          <div class="activity-meta"><span>${timeAgo(j.timestamp)}</span><span>${j.type || ''}</span></div>
        </div>
      </div>
    `).join('') || '<div style="color:var(--text-dim);padding:20px">No journal entries</div>';
  } catch (e) { console.error(e); }
}
async function editTradePosition(id) { const p = await get(`/api/trading?type=positions&id=${id}`); showModal('trade-position', p); }
async function deleteTradeWatch(id) { await del(`/api/trading?type=watchlist&id=${id}`); loadTrading(); }

// ========== MODALS ==========
function showModal(type, existing = null) {
  const isEdit = !!existing;
  let title, fields, onSubmit;

  switch (type) {
    case 'agent':
      title = isEdit ? 'Edit Agent' : 'Add Agent';
      fields = `
        <label>Name</label><input id="m-name" value="${existing?.name || ''}">
        <label>Avatar (emoji)</label><input id="m-avatar" value="${existing?.avatar || '🤖'}" maxlength="4">
        <label>Role</label><input id="m-role" value="${existing?.role || ''}">
        <label>Status</label><select id="m-status"><option value="online" ${existing?.status==='online'?'selected':''}>Online</option><option value="idle" ${existing?.status==='idle'?'selected':''}>Idle</option><option value="offline" ${existing?.status==='offline'?'selected':''}>Offline</option><option value="error" ${existing?.status==='error'?'selected':''}>Error</option></select>
        <label>Current Task</label><input id="m-task" value="${existing?.currentTask || ''}">
        <label>Tools (comma-separated)</label><input id="m-tools" value="${(existing?.tools || []).join(', ')}">
        <label>Access Sections (comma-separated)</label><input id="m-access" value="${(existing?.accessList || []).join(', ')}">
      `;
      onSubmit = async () => {
        const data = { name: v('m-name'), avatar: v('m-avatar'), role: v('m-role'), status: v('m-status'), currentTask: v('m-task'), tools: v('m-tools').split(',').map(s=>s.trim()).filter(Boolean), accessList: v('m-access').split(',').map(s=>s.trim()).filter(Boolean), lastActive: new Date().toISOString() };
        isEdit ? await put(`/api/agents?id=${existing.id}`, data) : await post('/api/agents', data);
        loadAgents();
      };
      break;
    case 'task':
      title = isEdit ? 'Edit Task' : 'Add Task';
      fields = `
        <label>Title</label><input id="m-title" value="${existing?.title || ''}">
        <label>Course</label><input id="m-course" value="${existing?.course || ''}">
        <label>Type</label><select id="m-type"><option value="assignment">Assignment</option><option value="exam">Exam</option><option value="reading">Reading</option><option value="project">Project</option><option value="other">Other</option></select>
        <label>Due Date</label><input type="datetime-local" id="m-due" value="${existing?.dueDate ? existing.dueDate.slice(0,16) : ''}">
        <label>Priority</label><select id="m-priority"><option value="low">Low</option><option value="medium" ${existing?.priority==='medium'?'selected':''}>Medium</option><option value="high" ${existing?.priority==='high'?'selected':''}>High</option><option value="critical" ${existing?.priority==='critical'?'selected':''}>Critical</option></select>
        <label>Status</label><select id="m-status"><option value="todo">To Do</option><option value="in-progress" ${existing?.status==='in-progress'?'selected':''}>In Progress</option><option value="done" ${existing?.status==='done'?'selected':''}>Done</option></select>
        <label>Notes</label><textarea id="m-notes">${existing?.notes || ''}</textarea>
      `;
      if (existing?.type) setTimeout(() => { const el = document.getElementById('m-type'); if (el) el.value = existing.type; }, 0);
      onSubmit = async () => {
        const data = { title: v('m-title'), course: v('m-course'), type: v('m-type'), dueDate: v('m-due') ? new Date(v('m-due')).toISOString() : null, priority: v('m-priority'), status: v('m-status'), notes: v('m-notes') };
        isEdit ? await put(`/api/school?type=tasks&id=${existing.id}`, data) : await post('/api/school?type=tasks', data);
        loadSchool(); if (currentSection === 'dashboard') loadDashboard();
      };
      break;
    case 'schedule':
      title = 'Add Class';
      fields = `
        <label>Course</label><input id="m-course" value="">
        <label>Day</label><select id="m-day"><option>Monday</option><option>Tuesday</option><option>Wednesday</option><option>Thursday</option><option>Friday</option></select>
        <label>Start Time</label><input type="time" id="m-start" value="09:00">
        <label>End Time</label><input type="time" id="m-end" value="10:00">
        <label>Location</label><input id="m-location" value="">
        <label>Type</label><select id="m-type"><option value="lecture">Lecture</option><option value="tutorial">Tutorial</option><option value="lab">Lab</option></select>
      `;
      onSubmit = async () => {
        await post('/api/school?type=schedule', { course: v('m-course'), day: v('m-day'), startTime: v('m-start'), endTime: v('m-end'), location: v('m-location'), type: v('m-type') });
        loadSchool();
      };
      break;
    case 'poly-position':
      title = isEdit ? 'Edit Position' : 'Add Polymarket Position';
      fields = `
        <label>Market</label><input id="m-market" value="${existing?.market || ''}">
        <label>Market URL</label><input id="m-url" value="${existing?.marketUrl || ''}">
        <label>Position</label><select id="m-position"><option value="Yes" ${existing?.position==='Yes'?'selected':''}>Yes</option><option value="No" ${existing?.position==='No'?'selected':''}>No</option></select>
        <label>Entry Price</label><input type="number" step="0.01" id="m-entry" value="${existing?.entryPrice || ''}">
        <label>Current Price</label><input type="number" step="0.01" id="m-current" value="${existing?.currentPrice || ''}">
        <label>Shares</label><input type="number" id="m-shares" value="${existing?.shares || ''}">
        <label>Entry Date</label><input type="datetime-local" id="m-entrydate" value="${(existing?.entryDate || existing?.createdAt ? new Date(existing.entryDate || existing.createdAt) : new Date()).toISOString().slice(0,16)}">
        <label>Status</label><select id="m-status"><option value="open">Open</option><option value="closed-win" ${existing?.status==='closed-win'?'selected':''}>Closed (Win)</option><option value="closed-loss" ${existing?.status==='closed-loss'?'selected':''}>Closed (Loss)</option></select>
        <label>Notes</label><textarea id="m-notes">${existing?.notes || ''}</textarea>
        <label>Tags (comma-separated)</label><input id="m-tags" value="${(existing?.tags || []).join(', ')}">
      `;
      onSubmit = async () => {
        const data = { market: v('m-market'), marketUrl: v('m-url'), position: v('m-position'), entryPrice: parseFloat(v('m-entry')), currentPrice: parseFloat(v('m-current') || v('m-entry')), shares: parseFloat(v('m-shares')), entryDate: new Date(v('m-entrydate')).toISOString(), status: v('m-status'), notes: v('m-notes'), tags: v('m-tags').split(',').map(s=>s.trim()).filter(Boolean) };
        data.invested = data.entryPrice * data.shares;
        data.currentValue = data.currentPrice * data.shares;
        data.pnl = data.currentValue - data.invested;
        data.pnlPercent = data.invested ? (data.pnl / data.invested) * 100 : 0;
        if (data.status !== 'open') data.exitPrice = data.currentPrice;
        isEdit ? await put(`/api/polymarket?type=positions&id=${existing.id}`, data) : await post('/api/polymarket?type=positions', data);
        loadPolymarket();
      };
      break;
    case 'trade-position':
      title = isEdit ? 'Edit Position' : 'Add Trade Position';
      fields = `
        <label>Ticker</label><input id="m-ticker" value="${existing?.ticker || ''}" style="text-transform:uppercase">
        <label>Company</label><input id="m-company" value="${existing?.company || ''}">
        <label>Side</label><select id="m-side"><option value="long" ${existing?.side==='long'?'selected':''}>Long</option><option value="short" ${existing?.side==='short'?'selected':''}>Short</option></select>
        <label>Entry Price</label><input type="number" step="0.01" id="m-entry" value="${existing?.entryPrice || ''}">
        <label>Current Price</label><input type="number" step="0.01" id="m-current" value="${existing?.currentPrice || ''}">
        <label>Shares</label><input type="number" id="m-shares" value="${existing?.shares || ''}">
        <label>Stop Loss</label><input type="number" step="0.01" id="m-stop" value="${existing?.stopLoss || ''}">
        <label>Take Profit</label><input type="number" step="0.01" id="m-target" value="${existing?.takeProfit || ''}">
        <label>Status</label><select id="m-status"><option value="open">Open</option><option value="closed-profit" ${existing?.status==='closed-profit'?'selected':''}>Closed (Profit)</option><option value="closed-loss" ${existing?.status==='closed-loss'?'selected':''}>Closed (Loss)</option><option value="stopped-out" ${existing?.status==='stopped-out'?'selected':''}>Stopped Out</option></select>
        <label>Thesis</label><textarea id="m-thesis">${existing?.thesis || ''}</textarea>
        <label>Tags (comma-separated)</label><input id="m-tags" value="${(existing?.tags || []).join(', ')}">
      `;
      onSubmit = async () => {
        const data = { ticker: v('m-ticker').toUpperCase(), company: v('m-company'), side: v('m-side'), entryPrice: parseFloat(v('m-entry')), currentPrice: parseFloat(v('m-current') || v('m-entry')), shares: parseFloat(v('m-shares')), stopLoss: parseFloat(v('m-stop')) || null, takeProfit: parseFloat(v('m-target')) || null, status: v('m-status'), thesis: v('m-thesis'), tags: v('m-tags').split(',').map(s=>s.trim()).filter(Boolean) };
        data.invested = data.entryPrice * data.shares;
        data.currentValue = data.currentPrice * data.shares;
        data.pnl = data.currentValue - data.invested;
        data.pnlPercent = data.invested ? (data.pnl / data.invested) * 100 : 0;
        if (data.status !== 'open') data.exitPrice = data.currentPrice;
        isEdit ? await put(`/api/trading?type=positions&id=${existing.id}`, data) : await post('/api/trading?type=positions', data);
        loadTrading();
      };
      break;
    case 'weather-trade':
      title = isEdit ? 'Edit Weather Trade' : 'Add Weather Trade';
      fields = `
        <label>City</label><select id="m-city"><option value="">Select...</option><option value="NYC" ${existing?.city==='NYC'?'selected':''}>NYC</option><option value="Chicago" ${existing?.city==='Chicago'?'selected':''}>Chicago</option><option value="Seattle" ${existing?.city==='Seattle'?'selected':''}>Seattle</option><option value="Atlanta" ${existing?.city==='Atlanta'?'selected':''}>Atlanta</option><option value="Dallas" ${existing?.city==='Dallas'?'selected':''}>Dallas</option><option value="Miami" ${existing?.city==='Miami'?'selected':''}>Miami</option></select>
        <label>Market</label><input id="m-market" value="${existing?.market || ''}">
        <label>Market ID</label><input id="m-marketid" value="${existing?.marketId || ''}">
        <label>Market URL</label><input id="m-url" value="${existing?.marketUrl || ''}">
        <label>Side</label><select id="m-side"><option value="yes" ${existing?.side==='yes'?'selected':''}>Yes</option><option value="no" ${existing?.side==='no'?'selected':''}>No</option></select>
        <label>Bucket (temp range)</label><input id="m-bucket" value="${existing?.bucket || ''}" placeholder="e.g. 30-35°F">
        <label>Entry Price</label><input type="number" step="0.01" id="m-entry" value="${existing?.entryPrice || ''}">
        <label>Shares</label><input type="number" id="m-shares" value="${existing?.shares || ''}">
        <label>Entry Date</label><input type="datetime-local" id="m-entrydate" value="${(existing?.entryDate || existing?.createdAt ? new Date(existing.entryDate || existing.createdAt) : new Date()).toISOString().slice(0,16)}">
        <label>Status</label><select id="m-status"><option value="open">Open</option><option value="closed-win" ${existing?.status==='closed-win'?'selected':''}>Closed (Win)</option><option value="closed-loss" ${existing?.status==='closed-loss'?'selected':''}>Closed (Loss)</option></select>
        <label>Reasoning</label><textarea id="m-reasoning">${existing?.reasoning || ''}</textarea>
      `;
      onSubmit = async () => {
        const data = { city: v('m-city'), market: v('m-market'), marketId: v('m-marketid'), marketUrl: v('m-url'), side: v('m-side'), bucket: v('m-bucket'), entryPrice: parseFloat(v('m-entry')) || 0, shares: parseFloat(v('m-shares')) || 0, entryDate: new Date(v('m-entrydate')).toISOString(), status: v('m-status'), reasoning: v('m-reasoning'), source: 'manual' };
        data.currentPrice = data.entryPrice;
        data.pnl = 0;
        data.pnlPercent = 0;
        isEdit ? await put(`/api/weather?id=${existing.id}`, data) : await post('/api/weather', data);
        loadPolymarket();
      };
      break;
    case 'activity':
      title = 'Log Activity';
      fields = `
        <label>Agent Name</label><input id="m-agent" value="Nyx">
        <label>Action</label><input id="m-action" value="">
        <label>Section</label><select id="m-section"><option value="general">General</option><option value="school">School</option><option value="polymarket">Polymarket</option><option value="trading">Trading</option></select>
        <label>Status</label><select id="m-status"><option value="success">Success</option><option value="failed">Failed</option><option value="pending">Pending</option></select>
        <label>Details</label><textarea id="m-details"></textarea>
      `;
      onSubmit = async () => {
        await post('/api/activity', { agentName: v('m-agent'), action: v('m-action'), section: v('m-section'), status: v('m-status'), details: v('m-details') });
        loadDashboard();
      };
      break;
  }

  const container = document.getElementById('modal-container');
  container.innerHTML = `
    <div class="modal-overlay" onclick="closeModal(event)">
      <div class="modal" onclick="event.stopPropagation()">
        <h2>${title}</h2>
        ${fields}
        <div class="modal-actions">
          <button class="btn" onclick="closeModal()">Cancel</button>
          <button class="btn btn-primary" id="modal-submit">Save</button>
        </div>
      </div>
    </div>
  `;
  document.getElementById('modal-submit').addEventListener('click', async () => { await onSubmit(); closeModal(); });
}

function closeModal(e) { if (!e || e.target.classList.contains('modal-overlay')) document.getElementById('modal-container').innerHTML = ''; }
function v(id) { const el = document.getElementById(id); return el ? el.value : ''; }

// ========== INTERNSHIPS ==========
const INTERNSHIPS = [
  { company: "Seine Pacific Capital Partners", role: "Finance Analyst Intern, M&A & Growth Acceleration", priority: "HIGH", link: "https://sg.linkedin.com/jobs/view/finance-analyst-intern-m-a-growth-acceleration-at-seine-pacific-capital-partners-4372094909", letter: `Dear Hiring Manager,\n\nI am writing to apply for the Finance Analyst Intern position at Seine Pacific Capital Partners. I am a Year 1 Business student at NTU specialising in Banking & Finance, with hands-on experience in financial modelling and a strong personal investing track record.\n\nAt Mega Pacific Land, I built DCF and sensitivity analysis models for real estate developments, structured 5–10 year cash flow projections evaluating IRR and NPV, and analysed 10+ market comparables to inform acquisition decisions. Separately, I manage a personal equity portfolio (~$21.8k deployed), generating 131% cumulative returns since August 2024 through thesis-driven, fundamental analysis — identifying asymmetric opportunities in names like Palantir, Nebius, and AST SpaceMobile before consensus.\n\nI am drawn to Seine Pacific's cross-border M&A advisory focus and the opportunity to apply these skills in a deal-oriented environment. I am available from 11 May to 17 July 2026.\n\nThank you for your consideration.\n\nSincerely,\nJaidev Singh Sachdev` },
  { company: "Frasers Property", role: "Summer Intern, Investment", priority: "HIGH", link: "https://sg.linkedin.com/jobs/view/summer-intern-investment-at-frasers-property-limited-4364840686", letter: `Dear Hiring Manager,\n\nI am writing to apply for the Summer Intern, Investment position at Frasers Property. I am a Year 1 Business student at NTU specialising in Banking & Finance, with direct experience in real estate financial analysis.\n\nAt Mega Pacific Land, I built DCF and sensitivity analysis models for ongoing and prospective real estate developments, structured 5–10 year cash flow projections to evaluate project IRR and NPV, and analysed 10+ market comparables, rental yields, and property valuation data to support pricing and acquisition decisions. This experience gave me a practical understanding of how investment decisions are made in real estate.\n\nI also actively manage a personal equity portfolio (~$21.8k deployed), generating 131% cumulative returns since August 2024 through fundamental, thesis-driven analysis — a discipline I look forward to applying to real asset investment evaluation at Frasers. I am available from 11 May to 17 July 2026.\n\nThank you for your consideration.\n\nSincerely,\nJaidev Singh Sachdev` },
  { company: "SG Growth Capital", role: "Intern, Investment", priority: "HIGH", link: "https://sg.linkedin.com/jobs/view/intern-investment-at-sg-growth-capital-4366458342", letter: `Dear Hiring Manager,\n\nI am writing to apply for the Investment Intern position at SG Growth Capital. I am a Year 1 Business student at NTU specialising in Banking & Finance, with a demonstrated ability to identify and evaluate high-growth investment opportunities.\n\nI actively manage a personal equity portfolio (~$21.8k deployed), generating 131% cumulative returns since August 2024 by identifying asymmetric risk-reward opportunities early — including positions in Palantir ($29 entry), Nebius ($46), and AST SpaceMobile ($21.50), all well before consensus. My approach is thesis-driven and grounded in fundamental analysis: financial statement review, TAM estimation, competitive positioning, and downside scenario modelling.\n\nAt Mega Pacific Land, I further developed my analytical toolkit through DCF modelling, sensitivity analysis, and market comparable analysis for real estate investments. I am eager to apply this combination of hands-on investing instinct and formal valuation skills at SG Growth Capital. I am available from 11 May to 17 July 2026.\n\nThank you for your consideration.\n\nSincerely,\nJaidev Singh Sachdev` },
  { company: "Keppel Fund Management", role: "Intern, DC Investment (June-Aug)", priority: "HIGH", link: "https://sg.linkedin.com/jobs/view/keppel-internship-programme-2026-intern-dc-investment-june-aug-dec-2026-at-keppel-fund-management-investment-4344312165", letter: `Dear Hiring Manager,\n\nI am writing to apply for the Intern, DC Investment position under the Keppel Internship Programme 2026. I am a Year 1 Bachelor of Business student at NTU, specialising in Banking & Finance, with experience in financial modelling and equity research.\n\nDuring my internship at Mega Pacific Land, I built DCF and sensitivity analysis models for real estate developments, evaluated project IRR and NPV through 5–10 year cash flow projections, and analysed market comparables to support investment decisions. I also actively manage a personal equity portfolio (~$21.8k deployed capital), which has generated 131% cumulative returns since August 2024 through disciplined, fundamental analysis.\n\nI am keen to contribute to Keppel's investment team and develop my understanding of data centre and infrastructure investments within a structured programme. I am available from June to August 2026.\n\nThank you for your consideration.\n\nSincerely,\nJaidev Singh Sachdev` },
  { company: "Temasek", role: "Finance Intern, Treasury (Debt Capital Market)", priority: "MEDIUM", link: "https://sg.linkedin.com/jobs/view/finance-intern-treasury-debt-capital-market-jun-jul-dec-2026-at-temasek-4355362083", letter: `Dear Hiring Manager,\n\nI am writing to apply for the Finance Intern, Treasury (Debt Capital Market) position at Temasek. I am a Year 1 Business student at NTU specialising in Banking & Finance, with strong financial modelling skills and an analytical approach to markets.\n\nAt Mega Pacific Land, I structured 5–10 year Excel-based cash flow models evaluating IRR, NPV, and sensitivity to interest rate fluctuations — directly relevant to fixed income and debt instrument analysis. I also manage a personal equity portfolio (~$21.8k deployed) generating 131% cumulative returns, which has sharpened my understanding of market pricing, risk assessment, and macro drivers.\n\nI am eager to broaden my capital markets experience into fixed income and debt capital markets at Temasek, and to contribute analytical rigour to the treasury function. I am available from May to July 2026.\n\nThank you for your consideration.\n\nSincerely,\nJaidev Singh Sachdev` },
  { company: "Temasek", role: "Finance Intern, Treasury (FX Management)", priority: "MEDIUM", link: "https://sg.linkedin.com/jobs/view/finance-intern-treasury-fx-management-jun-jul-dec-2026-at-temasek-4355305665", letter: `Dear Hiring Manager,\n\nI am writing to apply for the Finance Intern, Treasury (FX Management) position at Temasek. I am a Year 1 Business student at NTU specialising in Banking & Finance, with experience in financial modelling and quantitative analysis.\n\nAt Mega Pacific Land, I built sensitivity analysis models assessing project viability under varying assumptions — an analytical approach directly applicable to FX risk assessment. I am also proficient in Python and R, which I have used for data analysis alongside managing a personal equity portfolio (~$21.8k deployed, 131% cumulative returns). I am eager to apply these quantitative skills to FX exposure management and hedging strategy at Temasek. I am available from May to July 2026.\n\nThank you for your consideration.\n\nSincerely,\nJaidev Singh Sachdev` },
  { company: "Frasers Property", role: "Summer Intern, Finance", priority: "MEDIUM", link: "https://sg.linkedin.com/jobs/view/summer-intern-finance-at-frasers-property-limited-4366297864", letter: `Dear Hiring Manager,\n\nI am writing to apply for the Summer Intern, Finance position at Frasers Property. I am a Year 1 Business student at NTU specialising in Banking & Finance, with prior real estate finance experience.\n\nAt Mega Pacific Land, I built DCF models, evaluated project feasibility through cash flow analysis, and analysed market comparables and rental yields to support financial decisions. I bring strong Excel proficiency, financial statement analysis skills, and a detail-oriented approach. I am available from 11 May to 17 July 2026.\n\nThank you for your consideration.\n\nSincerely,\nJaidev Singh Sachdev` },
  { company: "BMW Group", role: "Intern, Finance", priority: "LOW", link: "https://sg.linkedin.com/jobs/view/intern-finance-at-bmw-group-4371511518", letter: `Dear Hiring Manager,\n\nI am writing to apply for the Finance Intern position at BMW Group. I am a Year 1 Business student at NTU specialising in Banking & Finance, with financial modelling and analytical experience from my internship at Mega Pacific Land, where I built DCF models, sensitivity analyses, and market comparable studies.\n\nI am proficient in Excel and Python, and bring a strong analytical mindset developed through both academic coursework and actively managing a personal equity portfolio. I am available from 11 May to 17 July 2026 and eager to contribute to BMW's finance team.\n\nThank you for your consideration.\n\nSincerely,\nJaidev Singh Sachdev` },
  { company: "Shopee", role: "Business Analyst Intern, Strategy Office", priority: "MEDIUM", link: "https://sg.linkedin.com/jobs/view/business-analyst-intern-group-president-s-strategy-office-summer-2026-at-shopee-4372323207", letter: `Dear Hiring Manager,\n\nI am writing to apply for the Business Analyst Intern position in Shopee's Group President's Strategy Office. I am a Year 1 Business student at NTU with a strong analytical background and experience translating data into actionable decisions.\n\nI actively manage a personal equity portfolio (~$21.8k deployed, 131% cumulative returns) through data-driven thesis development — screening opportunities, modelling scenarios, and evaluating risk-reward asymmetries. At Mega Pacific Land, I applied similar rigour to real estate investment appraisal through DCF modelling and market analysis. I am proficient in Python, R, and Excel, and approach problems with the same structured, evidence-based mindset that drives strategic decision-making. I am available from 11 May to 17 July 2026.\n\nThank you for your consideration.\n\nSincerely,\nJaidev Singh Sachdev` }
];

function loadInternships() {
  const wrap = document.getElementById('internship-cards');
  if (!wrap) return;
  const priorityColor = { HIGH: '#22c55e', MEDIUM: '#eab308', LOW: '#6b7280' };
  wrap.innerHTML = INTERNSHIPS.map((it, i) => `
    <div class="card" style="margin-bottom:14px;cursor:pointer;border-left:3px solid ${priorityColor[it.priority]}" onclick="this.querySelector('.cl-body').style.display=this.querySelector('.cl-body').style.display==='none'?'block':'none'">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px">
        <h3 style="font-size:15px;margin:0;font-weight:700">${it.company}</h3>
        <span style="font-size:11px;padding:3px 10px;border-radius:10px;background:${priorityColor[it.priority]}18;color:${priorityColor[it.priority]};font-weight:700">${it.priority}</span>
      </div>
      <div style="font-size:13px;color:var(--text-dim);margin-bottom:10px">${it.role}</div>
      <div style="display:flex;gap:8px;margin-bottom:10px">
        <a href="${it.link}" target="_blank" class="btn btn-sm" onclick="event.stopPropagation()">LinkedIn ↗</a>
        <button class="btn btn-sm" onclick="event.stopPropagation();navigator.clipboard.writeText(INTERNSHIPS[${i}].letter);this.textContent='Copied!';setTimeout(()=>this.textContent='Copy Letter',1500)">Copy Letter</button>
      </div>
      <div class="cl-body" style="display:none;white-space:pre-wrap;font-size:13px;line-height:1.7;color:var(--text-dim);border-top:1px solid var(--border);padding-top:14px;margin-top:4px">${it.letter}</div>
    </div>
  `).join('');
}

// ========== INIT ==========
if (window.location.hash) { currentSection = window.location.hash.slice(1); }
checkAuth();
