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
const get = (p) => api(p);
const post = (p, d) => api(p, { method: 'POST', body: JSON.stringify(d) });
const put = (p, d) => api(p, { method: 'PUT', body: JSON.stringify(d) });
const del = (p) => api(p, { method: 'DELETE' });

// ========== AUTH ==========
function checkAuth() {
  if (TOKEN) { document.getElementById('login-screen').style.display = 'none'; document.getElementById('app').style.display = 'block'; loadCurrentSection(); }
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

// ========== NAVIGATION ==========
let currentSection = 'dashboard';
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
  loadCurrentSection();
}

function loadCurrentSection() {
  switch(currentSection) {
    case 'dashboard': loadDashboard(); break;
    case 'agents': loadAgents(); break;
    case 'school': loadSchool(); break;
    case 'polymarket': loadPolymarket(); break;
    case 'trading': loadTrading(); break;
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
function fmtMoney(n) { return n != null ? `$${n.toFixed(2)}` : '—'; }
function fmtPct(n) { return n != null ? `${n >= 0 ? '+' : ''}${n.toFixed(2)}%` : '—'; }
function pnlClass(n) { return n > 0 ? 'pnl-pos' : n < 0 ? 'pnl-neg' : ''; }
function statusDot(s) { return `<span class="status-dot status-${s}"></span>`; }
function sectionBadge(s) { return `<span class="section-badge ${s}">${s}</span>`; }
function priorityBadge(p) { return `<span class="badge badge-${p || 'low'}">${p || 'low'}</span>`; }

// ========== DASHBOARD ==========
async function loadDashboard() {
  try {
    const d = await get('/api/dashboard');
    // Summary cards
    document.getElementById('dash-summary').innerHTML = `
      <div class="summary-card"><div class="label">Agents</div><div class="value">${d.agents.online}/${d.agents.total}</div><div class="detail">online</div></div>
      <div class="summary-card"><div class="label">School</div><div class="value">${d.school.pendingTasks}</div><div class="detail">pending tasks${d.school.overdueTasks ? ` · <span style="color:var(--red)">${d.school.overdueTasks} overdue</span>` : ''}</div></div>
      <div class="summary-card"><div class="label">Polymarket</div><div class="value">${d.polymarket.openPositions}</div><div class="detail">${fmtMoney(d.polymarket.totalExposure)} exposure</div></div>
      <div class="summary-card"><div class="label">Trading</div><div class="value">${d.trading.openPositions}</div><div class="detail">P&L: <span class="${pnlClass(d.trading.dailyPnl)}">${fmtMoney(d.trading.dailyPnl)}</span></div></div>
    `;
    // Activity
    document.getElementById('dash-activity').innerHTML = (d.activity || []).map(a => `
      <div class="activity-item">
        <div class="activity-dot ${a.status || 'success'}"></div>
        <div class="activity-content">
          <div class="activity-action"><span class="activity-agent">${a.agentName || 'System'}</span> ${a.action}</div>
          <div class="activity-meta"><span>${timeAgo(a.timestamp)}</span>${a.section ? sectionBadge(a.section) : ''}</div>
        </div>
      </div>
    `).join('') || '<div style="color:var(--text-dim);padding:20px">No activity yet</div>';
    // Agents
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

    // Office floor - agent figures
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

    // Side activity feed
    document.getElementById('agents-activity-side').innerHTML = activity.slice(0, 20).map(a => `
      <div class="activity-item">
        <div class="activity-dot ${a.status || 'success'}"></div>
        <div class="activity-content">
          <div class="activity-action"><span class="activity-agent">${a.agentName || 'System'}</span> ${a.action}</div>
          <div class="activity-meta"><span>${timeAgo(a.timestamp)}</span></div>
        </div>
      </div>
    `).join('') || '<div style="color:var(--text-dim);padding:16px;font-size:12px">No activity yet</div>';

    // Agent breakdown cards
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

    // Schedule
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

// ========== POLYMARKET ==========
async function loadPolymarket() {
  try {
    const [positions, watchlist] = await Promise.all([get('/api/polymarket?type=positions'), get('/api/polymarket?type=watchlist')]);
    const open = positions.filter(p => p.status === 'open');
    const closed = positions.filter(p => p.status !== 'open');
    const totalInvested = open.reduce((s, p) => s + (p.invested || 0), 0);
    const totalValue = open.reduce((s, p) => s + (p.currentValue || 0), 0);
    const totalPnl = totalValue - totalInvested;
    const wins = closed.filter(p => p.status === 'closed-win').length;
    const winRate = closed.length ? ((wins / closed.length) * 100).toFixed(0) : '—';

    document.getElementById('poly-summary').innerHTML = `
      <div class="summary-card"><div class="label">Invested</div><div class="value mono">${fmtMoney(totalInvested)}</div></div>
      <div class="summary-card"><div class="label">Current Value</div><div class="value mono">${fmtMoney(totalValue)}</div></div>
      <div class="summary-card"><div class="label">Total P&L</div><div class="value mono ${pnlClass(totalPnl)}">${fmtMoney(totalPnl)}</div></div>
      <div class="summary-card"><div class="label">Win Rate</div><div class="value mono">${winRate}%</div><div class="detail">${wins}/${closed.length} trades</div></div>
    `;
    document.querySelector('#poly-open-table tbody').innerHTML = open.map(p => `<tr>
      <td style="max-width:250px">${p.market || ''}</td>
      <td>${p.position || ''}</td>
      <td class="mono">${fmtMoney(p.entryPrice)}</td>
      <td class="mono">${fmtMoney(p.currentPrice)}</td>
      <td class="mono">${p.shares || ''}</td>
      <td class="mono ${pnlClass(p.pnl)}">${fmtMoney(p.pnl)}</td>
      <td class="mono ${pnlClass(p.pnlPercent)}">${fmtPct(p.pnlPercent)}</td>
      <td><button class="btn btn-sm" onclick="editPolyPosition('${p.id}')">Edit</button></td>
    </tr>`).join('') || '<tr><td colspan="8" style="color:var(--text-dim)">No open positions</td></tr>';
    document.querySelector('#poly-closed-table tbody').innerHTML = closed.map(p => `<tr>
      <td>${p.market || ''}</td><td>${p.position || ''}</td>
      <td class="mono">${fmtMoney(p.entryPrice)}</td><td class="mono">${fmtMoney(p.exitPrice)}</td>
      <td class="mono ${pnlClass(p.pnl)}">${fmtMoney(p.pnl)}</td>
      <td>${p.status}</td>
    </tr>`).join('') || '<tr><td colspan="6" style="color:var(--text-dim)">No closed positions</td></tr>';
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
    const trades = await get('/api/weather');
    const open = trades.filter(t => t.status === 'open');
    const closed = trades.filter(t => t.status !== 'open');
    const totalPnl = open.reduce((s, t) => s + (t.pnl || 0), 0);
    const wins = closed.filter(t => t.status === 'closed-win').length;
    const winRate = closed.length ? ((wins / closed.length) * 100).toFixed(0) : '—';

    const totalInvestedW = open.reduce((s, t) => s + ((t.entryPrice || 0) * (t.shares || 0)), 0);

    document.getElementById('weather-summary').innerHTML = `
      <div class="summary-card"><div class="label">Weather Positions</div><div class="value mono">${open.length}</div></div>
      <div class="summary-card"><div class="label">Invested</div><div class="value mono">${fmtMoney(totalInvestedW)}</div></div>
      <div class="summary-card"><div class="label">Weather P&L</div><div class="value mono ${pnlClass(totalPnl)}">${fmtMoney(totalPnl)}</div></div>
      <div class="summary-card"><div class="label">Win Rate</div><div class="value mono">${winRate}%</div><div class="detail">${wins}/${closed.length} trades</div></div>
    `;
    loadNoaaForecasts();

    document.querySelector('#weather-open-table tbody').innerHTML = open.map(t => `<tr>
      <td>${t.city || ''}</td>
      <td style="max-width:200px">${t.market || ''}</td>
      <td>${t.side || ''}</td>
      <td class="mono">${fmtMoney(t.entryPrice)}</td>
      <td class="mono">${fmtMoney(t.currentPrice)}</td>
      <td class="mono">${t.noaaForecast || '—'}</td>
      <td class="mono">${t.shares || ''}</td>
      <td class="mono ${pnlClass(t.pnl)}">${fmtMoney(t.pnl)}</td>
      <td><button class="btn btn-sm" onclick="editWeatherTrade('${t.id}')">Edit</button></td>
    </tr>`).join('') || '<tr><td colspan="9" style="color:var(--text-dim)">No open weather positions</td></tr>';
  } catch (e) { console.error('Weather load error:', e); }
}

async function editWeatherTrade(id) {
  const t = await get(`/api/weather?id=${id}`);
  showModal('weather-trade', t);
}

// ========== NOAA FORECASTS ==========
async function loadNoaaForecasts() {
  const cities = ['NYC', 'Chicago', 'Miami', 'Dallas', 'Atlanta', 'Seattle'];
  const container = document.getElementById('noaa-forecasts');
  container.innerHTML = cities.map(c => `<div class="summary-card" id="noaa-${c}" style="min-width:150px"><div class="label">${c}</div><div class="value mono" style="font-size:14px">⏳</div></div>`).join('');

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
        el.innerHTML = `
          <div class="label">${city}</div>
          <div class="value mono" style="font-size:22px">${icon} ${temp}°${unit}</div>
          <div class="detail" style="margin-top:4px">${short}</div>
          <div class="detail">Wind: ${wind}</div>
          <div class="detail" style="font-size:10px;opacity:0.5">${now.name || ''}</div>
        `;
      }
    } catch (e) {
      const el = document.getElementById(`noaa-${city}`);
      if (el) el.innerHTML = `<div class="label">${city}</div><div class="value mono" style="font-size:12px;color:var(--red)">Error</div>`;
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
  return `<span style="color:${c};font-weight:600">${tier}</span>`;
}

async function loadWhaleTrades() {
  try {
    const trades = await get('/api/whale');
    const all = Array.isArray(trades) ? trades : [];
    const open = all.filter(t => t.status === 'open');
    const closed = all.filter(t => t.status !== 'open');
    const totalInvested = open.reduce((s, t) => s + (t.invested || 0), 0);
    const totalValue = open.reduce((s, t) => s + (t.currentValue || t.invested || 0), 0);
    const totalPnl = totalValue - totalInvested;
    const wins = closed.filter(t => t.status === 'closed-win').length;
    const winRate = closed.length ? ((wins / closed.length) * 100).toFixed(0) : '—';

    document.getElementById('whale-summary').innerHTML = `
      <div class="summary-card"><div class="label">Whale Positions</div><div class="value mono">${open.length}</div></div>
      <div class="summary-card"><div class="label">Invested</div><div class="value mono">${fmtMoney(totalInvested)}</div></div>
      <div class="summary-card"><div class="label">Whale P&L</div><div class="value mono ${pnlClass(totalPnl)}">${fmtMoney(totalPnl)}</div></div>
      <div class="summary-card"><div class="label">Win Rate</div><div class="value mono">${winRate}%</div><div class="detail">${wins}/${closed.length} trades</div></div>
    `;

    // === WHALE SCORECARD (from predicting.top live data) ===
    loadWhaleScorecard();

    // === CONSENSUS TRADES (3+ whales on same market+side) ===
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

    // === ACTIVE POSITIONS ===
    document.querySelector('#whale-open-table tbody').innerHTML = open.map(t => `<tr>
      <td style="max-width:220px">${t.market || ''}</td>
      <td>${t.side || ''}</td>
      <td class="mono">${fmtMoney(t.entryPrice)}</td>
      <td class="mono">${fmtMoney(t.currentPrice)}</td>
      <td class="mono">${t.shares || ''}</td>
      <td>${t.whales || ''}</td>
      <td class="mono ${pnlClass(t.pnl)}">${fmtMoney(t.pnl)}</td>
      <td class="mono ${pnlClass(t.pnlPercent)}">${fmtPct(t.pnlPercent)}</td>
      <td><button class="btn btn-sm" onclick="editWhalePosition('${t.id}')">Edit</button></td>
    </tr>`).join('') || '<tr><td colspan="9" style="color:var(--text-dim)">No open whale positions</td></tr>';

    // === CLOSED ===
    document.querySelector('#whale-closed-table tbody').innerHTML = closed.map(t => `<tr>
      <td>${t.market || ''}</td><td>${t.side || ''}</td>
      <td class="mono">${fmtMoney(t.entryPrice)}</td><td class="mono">${fmtMoney(t.exitPrice)}</td>
      <td>${t.whales || ''}</td>
      <td class="mono ${pnlClass(t.pnl)}">${fmtMoney(t.pnl)}</td>
      <td>${t.status}</td>
    </tr>`).join('') || '<tr><td colspan="7" style="color:var(--text-dim)">No closed whale positions</td></tr>';
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

  // Check cache (refresh once per day)
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

  if (!whales.length) { tbody.innerHTML = '<tr><td colspan="11" style="color:var(--text-dim)">No data</td></tr>'; return; }
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
  } catch (e) {
    tbody.innerHTML = '<tr><td colspan="11" style="color:var(--red)">Failed to load scorecard</td></tr>';
    console.error('Scorecard error:', e);
  }
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
    const open = positions.filter(p => p.status === 'open');
    const closed = positions.filter(p => p.status !== 'open');
    const totalInvested = open.reduce((s, p) => s + (p.invested || 0), 0);
    const totalValue = open.reduce((s, p) => s + (p.currentValue || 0), 0);
    const totalPnl = totalValue - totalInvested;
    const wins = closed.filter(p => p.status === 'closed-profit').length;
    const winRate = closed.length ? ((wins / closed.length) * 100).toFixed(0) : '—';

    document.getElementById('trade-summary').innerHTML = `
      <div class="summary-card"><div class="label">Invested</div><div class="value mono">${fmtMoney(totalInvested)}</div></div>
      <div class="summary-card"><div class="label">Current Value</div><div class="value mono">${fmtMoney(totalValue)}</div></div>
      <div class="summary-card"><div class="label">Total P&L</div><div class="value mono ${pnlClass(totalPnl)}">${fmtMoney(totalPnl)}</div></div>
      <div class="summary-card"><div class="label">Win Rate</div><div class="value mono">${winRate}%</div><div class="detail">${wins}/${closed.length} trades</div></div>
    `;
    document.querySelector('#trade-open-table tbody').innerHTML = open.map(p => `<tr>
      <td class="mono" style="font-weight:600">${p.ticker}</td>
      <td>${p.side || 'long'}</td>
      <td class="mono">${fmtMoney(p.entryPrice)}</td>
      <td class="mono">${fmtMoney(p.currentPrice)}</td>
      <td class="mono">${p.shares}</td>
      <td class="mono" style="color:var(--red)">${fmtMoney(p.stopLoss)}</td>
      <td class="mono" style="color:var(--green)">${fmtMoney(p.takeProfit)}</td>
      <td class="mono ${pnlClass(p.pnl)}">${fmtMoney(p.pnl)}</td>
      <td class="mono ${pnlClass(p.pnlPercent)}">${fmtPct(p.pnlPercent)}</td>
      <td><button class="btn btn-sm" onclick="editTradePosition('${p.id}')">Edit</button></td>
    </tr>`).join('') || '<tr><td colspan="10" style="color:var(--text-dim)">No open positions</td></tr>';
    document.querySelector('#trade-closed-table tbody').innerHTML = closed.map(p => `<tr>
      <td class="mono" style="font-weight:600">${p.ticker}</td><td>${p.side || 'long'}</td>
      <td class="mono">${fmtMoney(p.entryPrice)}</td><td class="mono">${fmtMoney(p.exitPrice)}</td>
      <td class="mono ${pnlClass(p.pnl)}">${fmtMoney(p.pnl)}</td><td>${p.status}</td>
    </tr>`).join('') || '<tr><td colspan="6" style="color:var(--text-dim)">No closed positions</td></tr>';
    document.querySelector('#trade-watch-table tbody').innerHTML = watchlist.map(w => `<tr>
      <td class="mono" style="font-weight:600">${w.ticker}</td><td class="mono">${fmtMoney(w.currentPrice)}</td>
      <td class="mono">${fmtMoney(w.targetEntry)}</td><td>${w.thesis || ''}</td>
      <td><button class="btn btn-sm" onclick="deleteTradeWatch('${w.id}')" style="color:var(--red)">✕</button></td>
    </tr>`).join('') || '<tr><td colspan="5" style="color:var(--text-dim)">Watchlist empty</td></tr>';
    document.getElementById('trade-journal').innerHTML = journal.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp)).map(j => `
      <div class="activity-item">
        <div class="activity-dot success"></div>
        <div class="activity-content">
          <div class="activity-action"><span class="mono" style="color:var(--accent)">${j.ticker}</span> ${j.note}</div>
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
        <label>Status</label><select id="m-status"><option value="open">Open</option><option value="closed-win" ${existing?.status==='closed-win'?'selected':''}>Closed (Win)</option><option value="closed-loss" ${existing?.status==='closed-loss'?'selected':''}>Closed (Loss)</option></select>
        <label>Notes</label><textarea id="m-notes">${existing?.notes || ''}</textarea>
        <label>Tags (comma-separated)</label><input id="m-tags" value="${(existing?.tags || []).join(', ')}">
      `;
      onSubmit = async () => {
        const data = { market: v('m-market'), marketUrl: v('m-url'), position: v('m-position'), entryPrice: parseFloat(v('m-entry')), currentPrice: parseFloat(v('m-current') || v('m-entry')), shares: parseFloat(v('m-shares')), status: v('m-status'), notes: v('m-notes'), tags: v('m-tags').split(',').map(s=>s.trim()).filter(Boolean) };
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
        <label>Status</label><select id="m-status"><option value="open">Open</option><option value="closed-win" ${existing?.status==='closed-win'?'selected':''}>Closed (Win)</option><option value="closed-loss" ${existing?.status==='closed-loss'?'selected':''}>Closed (Loss)</option></select>
        <label>Reasoning</label><textarea id="m-reasoning">${existing?.reasoning || ''}</textarea>
      `;
      onSubmit = async () => {
        const data = { city: v('m-city'), market: v('m-market'), marketId: v('m-marketid'), marketUrl: v('m-url'), side: v('m-side'), bucket: v('m-bucket'), entryPrice: parseFloat(v('m-entry')) || 0, shares: parseFloat(v('m-shares')) || 0, status: v('m-status'), reasoning: v('m-reasoning'), source: 'manual' };
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

// ========== INIT ==========
if (window.location.hash) { currentSection = window.location.hash.slice(1); }
checkAuth();
