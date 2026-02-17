// Nyx Mission Control - Frontend
let TOKEN = sessionStorage.getItem('nyx_token');
let currentSection = 'home';

// API helper
async function api(endpoint, method = 'GET', body = null) {
  const opts = { method, headers: { 'Content-Type': 'application/json' } };
  if (TOKEN) opts.headers['Authorization'] = `Bearer ${TOKEN}`;
  if (body) opts.body = JSON.stringify(body);
  const res = await fetch(`/api/${endpoint}`, opts);
  if (res.status === 401) { doLogout(); throw new Error('Unauthorized'); }
  return res.json();
}

// Auth
async function doLogin() {
  const pw = document.getElementById('login-password').value;
  try {
    const res = await api('auth', 'POST', { password: pw });
    if (res.token) {
      TOKEN = res.token;
      sessionStorage.setItem('nyx_token', TOKEN);
      document.getElementById('login-screen').style.display = 'none';
      document.getElementById('dashboard').style.display = 'flex';
      navigate('home');
    }
  } catch (e) {
    document.getElementById('login-error').textContent = 'Invalid password';
  }
}
document.getElementById('login-password')?.addEventListener('keydown', e => { if (e.key === 'Enter') doLogin(); });

function doLogout() {
  TOKEN = null;
  sessionStorage.removeItem('nyx_token');
  document.getElementById('login-screen').style.display = 'flex';
  document.getElementById('dashboard').style.display = 'none';
}

// Check existing session
if (TOKEN) {
  document.getElementById('login-screen').style.display = 'none';
  document.getElementById('dashboard').style.display = 'flex';
  navigate('home');
}

// Navigation
function navigate(section) {
  currentSection = section;
  document.querySelectorAll('#sidebar li').forEach(li => li.classList.toggle('active', li.dataset.section === section));
  const titles = { home: 'Mission Control', agents: 'The Office', school: 'School', polymarket: 'Polymarket', trading: 'Swing Trading' };
  document.getElementById('page-title').textContent = titles[section] || section;
  const content = document.getElementById('content');
  content.innerHTML = '<div class="loading"><div class="spinner"></div></div>';
  const renderers = { home: renderHome, agents: renderAgents, school: renderSchool, polymarket: renderPolymarket, trading: renderTrading };
  (renderers[section] || renderHome)();
  // Close sidebar on mobile
  document.getElementById('sidebar').classList.remove('open');
}

function toggleSidebar() { document.getElementById('sidebar').classList.toggle('open'); }
function refreshCurrentSection() { navigate(currentSection); }

// Modal
function openModal(title, bodyHtml) {
  document.getElementById('modal-title').textContent = title;
  document.getElementById('modal-body').innerHTML = bodyHtml;
  document.getElementById('modal-overlay').style.display = 'flex';
}
function closeModal() { document.getElementById('modal-overlay').style.display = 'none'; }

// Helpers
function timeAgo(iso) {
  if (!iso) return '—';
  const s = Math.floor((Date.now() - new Date(iso)) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return Math.floor(s/60) + 'm ago';
  if (s < 86400) return Math.floor(s/3600) + 'h ago';
  return Math.floor(s/86400) + 'd ago';
}
function fmtDate(iso) { return iso ? new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '—'; }
function fmtMoney(n) { return n != null ? '$' + parseFloat(n).toFixed(2) : '—'; }
function fmtPct(n) { return n != null ? (n >= 0 ? '+' : '') + parseFloat(n).toFixed(2) + '%' : '—'; }
function pnlClass(n) { return parseFloat(n) >= 0 ? 'pnl-positive' : 'pnl-negative'; }
function statusClass(s) { return `status-${s || 'offline'}`; }
function esc(s) { const d = document.createElement('div'); d.textContent = s || ''; return d.innerHTML; }

// ============ HOME ============
async function renderHome() {
  try {
    const data = await api('dashboard');
    const c = document.getElementById('content');
    c.innerHTML = `<div class="fade-in">
      <div class="summary-cards">
        <div class="summary-card"><div class="icon">📚</div><h4>School</h4><div class="value">${data.school.pendingCount} pending</div><div class="sub">${data.school.nextDeadline ? 'Next: ' + esc(data.school.nextDeadline.title) + ' (' + fmtDate(data.school.nextDeadline.dueDate) + ')' : 'No deadlines'}</div></div>
        <div class="summary-card"><div class="icon">📊</div><h4>Polymarket</h4><div class="value">${data.polymarket.activePositions} positions</div><div class="sub">Exposure: ${fmtMoney(data.polymarket.totalExposure)}</div></div>
        <div class="summary-card"><div class="icon">📈</div><h4>Trading</h4><div class="value">${data.trading.openPositions} open</div><div class="sub">P&L: <span class="${pnlClass(data.trading.dailyPnl)}">${fmtMoney(data.trading.dailyPnl)}</span></div></div>
        <div class="summary-card"><div class="icon">🤖</div><h4>Agents</h4><div class="value">${data.agents.online}/${data.agents.total} online</div><div class="sub">${data.agents.total} registered</div></div>
      </div>
      <div class="actions-bar">
        <button class="btn btn-primary" onclick="navigate('school');setTimeout(()=>openAddTask(),300)">+ Add Task</button>
        <button class="btn btn-ghost" onclick="openLogActivity()">📝 Log Activity</button>
        <button class="btn btn-ghost" onclick="refreshCurrentSection()">🔄 Refresh</button>
      </div>
      ${data.agents.list.length ? `<div class="section-header"><h3>Agents</h3></div><div class="cards-grid">${data.agents.list.map(a => `
        <div class="agent-card" onclick="navigate('agents')">
          <div class="agent-avatar">${a.avatar || '🤖'}</div>
          <div class="agent-name">${esc(a.name)}</div>
          <div class="agent-role">${esc(a.currentTask || a.role || '')}</div>
          <div class="agent-status ${statusClass(a.status)}"><span class="status-dot"></span>${a.status || 'offline'}</div>
        </div>`).join('')}</div>` : ''}
      <div class="section-header" style="margin-top:1.5rem"><h3>Recent Activity</h3></div>
      <div class="feed">
        ${data.activity.length ? data.activity.slice(0,30).map(a => `
          <div class="feed-item">
            <div class="feed-dot ${a.status || 'success'}"></div>
            <div class="feed-body">
              <div class="feed-action"><strong>${esc(a.agentName || 'System')}</strong> ${esc(a.action)}</div>
              <div class="feed-meta">${esc(a.section || '')} · ${timeAgo(a.timestamp)}${a.details ? ' · ' + esc(a.details) : ''}</div>
            </div>
          </div>`).join('') : '<div class="empty-state"><p>No activity yet</p></div>'}
      </div>
    </div>`;
  } catch (e) { document.getElementById('content').innerHTML = `<div class="empty-state"><div class="icon">⚠️</div><p>${esc(e.message)}</p></div>`; }
}

function openLogActivity() {
  openModal('Log Activity', `
    <div class="form-group"><label>Agent Name</label><input id="f-agent" placeholder="e.g. Nyx"></div>
    <div class="form-group"><label>Action</label><input id="f-action" placeholder="What happened?"></div>
    <div class="form-group"><label>Section</label><select id="f-section"><option>general</option><option>school</option><option>polymarket</option><option>trading</option></select></div>
    <div class="form-group"><label>Status</label><select id="f-status"><option>success</option><option>pending</option><option>failed</option></select></div>
    <div class="form-group"><label>Details</label><input id="f-details" placeholder="Optional details"></div>
    <div class="form-actions"><button class="btn btn-ghost" onclick="closeModal()">Cancel</button><button class="btn btn-primary" onclick="submitLogActivity()">Log</button></div>
  `);
}
async function submitLogActivity() {
  await api('activity', 'POST', {
    agentName: document.getElementById('f-agent').value || 'Manual',
    action: document.getElementById('f-action').value,
    section: document.getElementById('f-section').value,
    status: document.getElementById('f-status').value,
    details: document.getElementById('f-details').value,
  });
  closeModal();
  navigate(currentSection);
}

// ============ AGENTS ============
async function renderAgents() {
  try {
    const agents = await api('agents');
    const c = document.getElementById('content');
    c.innerHTML = `<div class="fade-in">
      <div class="actions-bar"><button class="btn btn-primary" onclick="openAddAgent()">+ Add Agent</button></div>
      <div class="cards-grid">
        ${agents.length ? agents.map(a => `
          <div class="agent-card" onclick='openAgentDetail(${JSON.stringify(a).replace(/'/g,"&#39;")})'>
            <div class="agent-avatar">${a.avatar || '🤖'}</div>
            <div class="agent-name">${esc(a.name)}</div>
            <div class="agent-role">${esc(a.role || '')}</div>
            <div class="agent-status ${statusClass(a.status)}"><span class="status-dot"></span>${a.status || 'offline'}</div>
            <div style="margin-top:.5rem;font-size:.75rem;color:var(--text-dim)">Task: ${esc(a.currentTask || 'None')}</div>
            <div style="font-size:.7rem;color:var(--text-dim)">Last active: ${timeAgo(a.lastActive)}</div>
          </div>`).join('') : '<div class="empty-state" style="grid-column:1/-1"><div class="icon">🤖</div><p>No agents registered</p></div>'}
      </div>
    </div>`;
  } catch (e) { document.getElementById('content').innerHTML = `<div class="empty-state"><p>${esc(e.message)}</p></div>`; }
}

function openAddAgent() {
  openModal('Add Agent', `
    <div class="form-group"><label>Name</label><input id="f-name" placeholder="Agent name"></div>
    <div class="form-group"><label>Avatar (emoji)</label><input id="f-avatar" placeholder="🤖" maxlength="4"></div>
    <div class="form-group"><label>Role</label><input id="f-role" placeholder="What does this agent do?"></div>
    <div class="form-group"><label>Status</label><select id="f-status"><option>online</option><option>idle</option><option>offline</option><option>error</option></select></div>
    <div class="form-group"><label>Tools (comma-separated)</label><input id="f-tools" placeholder="Google Calendar, API"></div>
    <div class="form-actions"><button class="btn btn-ghost" onclick="closeModal()">Cancel</button><button class="btn btn-primary" onclick="submitAddAgent()">Add</button></div>
  `);
}
async function submitAddAgent() {
  await api('agents', 'POST', {
    name: document.getElementById('f-name').value,
    avatar: document.getElementById('f-avatar').value || '🤖',
    role: document.getElementById('f-role').value,
    status: document.getElementById('f-status').value,
    tools: document.getElementById('f-tools').value.split(',').map(s=>s.trim()).filter(Boolean),
    lastActive: new Date().toISOString(),
    currentTask: '',
    accessList: [],
  });
  closeModal(); navigate('agents');
}

function openAgentDetail(agent) {
  openModal(agent.name, `
    <div style="text-align:center;font-size:3rem;margin-bottom:1rem">${agent.avatar || '🤖'}</div>
    <div class="form-group"><label>Name</label><input id="f-name" value="${esc(agent.name)}"></div>
    <div class="form-group"><label>Role</label><input id="f-role" value="${esc(agent.role || '')}"></div>
    <div class="form-group"><label>Status</label><select id="f-status">${['online','idle','offline','error'].map(s=>`<option ${s===agent.status?'selected':''}>${s}</option>`).join('')}</select></div>
    <div class="form-group"><label>Current Task</label><input id="f-task" value="${esc(agent.currentTask || '')}"></div>
    <div class="form-group"><label>Tools</label><input id="f-tools" value="${esc((agent.tools||[]).join(', '))}"></div>
    <div class="form-actions">
      <button class="btn btn-danger" onclick="deleteAgent('${agent.id}')">Delete</button>
      <button class="btn btn-ghost" onclick="closeModal()">Cancel</button>
      <button class="btn btn-primary" onclick="updateAgent('${agent.id}')">Save</button>
    </div>
  `);
}
async function updateAgent(id) {
  await api(`agents?id=${id}`, 'PUT', {
    name: document.getElementById('f-name').value,
    role: document.getElementById('f-role').value,
    status: document.getElementById('f-status').value,
    currentTask: document.getElementById('f-task').value,
    tools: document.getElementById('f-tools').value.split(',').map(s=>s.trim()).filter(Boolean),
    lastActive: new Date().toISOString(),
  });
  closeModal(); navigate('agents');
}
async function deleteAgent(id) {
  if (!confirm('Delete this agent?')) return;
  await api(`agents?id=${id}`, 'DELETE');
  closeModal(); navigate('agents');
}

// ============ SCHOOL ============
let schoolTab = 'kanban';
async function renderSchool() {
  try {
    const [tasks, schedule] = await Promise.all([api('school?type=tasks'), api('school?type=schedule')]);
    const c = document.getElementById('content');
    const todo = tasks.filter(t => t.status === 'todo');
    const inProgress = tasks.filter(t => t.status === 'in-progress');
    const done = tasks.filter(t => t.status === 'done');
    const overdue = tasks.filter(t => t.status === 'overdue');

    c.innerHTML = `<div class="fade-in">
      <div class="actions-bar">
        <button class="btn btn-primary" onclick="openAddTask()">+ Add Task</button>
        <button class="btn btn-ghost" onclick="openAddSchedule()">+ Add Schedule</button>
      </div>
      <div class="tabs">
        <div class="tab ${schoolTab==='kanban'?'active':''}" onclick="schoolTab='kanban';renderSchool()">Kanban</div>
        <div class="tab ${schoolTab==='schedule'?'active':''}" onclick="schoolTab='schedule';renderSchool()">Schedule</div>
      </div>
      ${schoolTab === 'kanban' ? `
        <div class="kanban">
          ${renderKanbanCol('Overdue 🔴', overdue, 'overdue')}
          ${renderKanbanCol('To Do', todo, 'todo')}
          ${renderKanbanCol('In Progress', inProgress, 'in-progress')}
          ${renderKanbanCol('Done ✅', done, 'done')}
        </div>
      ` : `
        <div class="schedule-grid">
          ${['Monday','Tuesday','Wednesday','Thursday','Friday'].map(day => `
            <div class="schedule-day">
              <div class="schedule-day-name">${day}</div>
              ${schedule.filter(s => s.day === day).sort((a,b) => (a.startTime||'').localeCompare(b.startTime||'')).map(s => `
                <div class="schedule-entry">
                  <div class="time">${s.startTime || ''} - ${s.endTime || ''}</div>
                  <div>${esc(s.course)}</div>
                  <div style="font-size:.65rem;color:var(--text-dim)">${esc(s.location || '')}</div>
                </div>
              `).join('') || '<div style="font-size:.75rem;color:var(--text-dim)">No classes</div>'}
            </div>
          `).join('')}
        </div>
      `}
    </div>`;
  } catch (e) { document.getElementById('content').innerHTML = `<div class="empty-state"><p>${esc(e.message)}</p></div>`; }
}

function renderKanbanCol(title, items, status) {
  return `<div class="kanban-col">
    <div class="kanban-col-title">${title}<span class="count">${items.length}</span></div>
    ${items.map(t => `
      <div class="kanban-item ${t.status === 'overdue' ? 'overdue' : ''}" onclick='openEditTask(${JSON.stringify(t).replace(/'/g,"&#39;")})'>
        <div class="kanban-item-title">${esc(t.title)}</div>
        <div class="kanban-item-meta">
          <span class="badge priority-${t.priority || 'low'}">${t.priority || 'low'}</span>
          ${t.course ? `<span class="badge" style="background:rgba(59,130,246,.15);color:var(--blue)">${esc(t.course)}</span>` : ''}
          ${t.dueDate ? `<span style="margin-left:.25rem">${fmtDate(t.dueDate)}</span>` : ''}
        </div>
      </div>
    `).join('') || '<div style="text-align:center;font-size:.8rem;color:var(--text-dim);padding:.5rem">Empty</div>'}
  </div>`;
}

function openAddTask() {
  openModal('Add Task', `
    <div class="form-group"><label>Title</label><input id="f-title" placeholder="Task title"></div>
    <div class="form-group"><label>Course</label><input id="f-course" placeholder="CS 101"></div>
    <div class="form-group"><label>Type</label><select id="f-type"><option>assignment</option><option>exam</option><option>reading</option><option>project</option><option>lecture-note</option><option>office-hours</option><option>other</option></select></div>
    <div class="form-group"><label>Due Date</label><input id="f-due" type="date"></div>
    <div class="form-group"><label>Priority</label><select id="f-priority"><option>low</option><option>medium</option><option>high</option></select></div>
    <div class="form-group"><label>Notes</label><textarea id="f-notes" placeholder="Optional notes"></textarea></div>
    <div class="form-actions"><button class="btn btn-ghost" onclick="closeModal()">Cancel</button><button class="btn btn-primary" onclick="submitAddTask()">Add</button></div>
  `);
}
async function submitAddTask() {
  await api('school?type=tasks', 'POST', {
    title: document.getElementById('f-title').value,
    course: document.getElementById('f-course').value,
    type: document.getElementById('f-type').value,
    dueDate: document.getElementById('f-due').value,
    priority: document.getElementById('f-priority').value,
    status: 'todo',
    notes: document.getElementById('f-notes').value,
    createdBy: 'manual',
  });
  await logActivity('Added task: ' + document.getElementById('f-title').value, 'school');
  closeModal(); navigate('school');
}

function openEditTask(task) {
  openModal('Edit Task', `
    <div class="form-group"><label>Title</label><input id="f-title" value="${esc(task.title)}"></div>
    <div class="form-group"><label>Course</label><input id="f-course" value="${esc(task.course || '')}"></div>
    <div class="form-group"><label>Type</label><select id="f-type">${['assignment','exam','reading','project','lecture-note','office-hours','other'].map(t=>`<option ${t===task.type?'selected':''}>${t}</option>`).join('')}</select></div>
    <div class="form-group"><label>Due Date</label><input id="f-due" type="date" value="${task.dueDate ? task.dueDate.split('T')[0] : ''}"></div>
    <div class="form-group"><label>Priority</label><select id="f-priority">${['low','medium','high'].map(p=>`<option ${p===task.priority?'selected':''}>${p}</option>`).join('')}</select></div>
    <div class="form-group"><label>Status</label><select id="f-statusx">${['todo','in-progress','done'].map(s=>`<option ${s===task.status?'selected':''}>${s}</option>`).join('')}</select></div>
    <div class="form-group"><label>Notes</label><textarea id="f-notes">${esc(task.notes || '')}</textarea></div>
    <div class="form-actions">
      <button class="btn btn-danger" onclick="deleteTask('${task.id}')">Delete</button>
      <button class="btn btn-ghost" onclick="closeModal()">Cancel</button>
      <button class="btn btn-primary" onclick="updateTask('${task.id}')">Save</button>
    </div>
  `);
}
async function updateTask(id) {
  await api(`school?type=tasks&id=${id}`, 'PUT', {
    title: document.getElementById('f-title').value,
    course: document.getElementById('f-course').value,
    type: document.getElementById('f-type').value,
    dueDate: document.getElementById('f-due').value,
    priority: document.getElementById('f-priority').value,
    status: document.getElementById('f-statusx').value,
    notes: document.getElementById('f-notes').value,
  });
  closeModal(); navigate('school');
}
async function deleteTask(id) {
  if (!confirm('Delete?')) return;
  await api(`school?type=tasks&id=${id}`, 'DELETE');
  closeModal(); navigate('school');
}

function openAddSchedule() {
  openModal('Add Schedule Entry', `
    <div class="form-group"><label>Course</label><input id="f-course" placeholder="CS 101"></div>
    <div class="form-group"><label>Day</label><select id="f-day"><option>Monday</option><option>Tuesday</option><option>Wednesday</option><option>Thursday</option><option>Friday</option></select></div>
    <div class="form-group"><label>Start Time</label><input id="f-start" type="time"></div>
    <div class="form-group"><label>End Time</label><input id="f-end" type="time"></div>
    <div class="form-group"><label>Location</label><input id="f-location" placeholder="Room 201"></div>
    <div class="form-actions"><button class="btn btn-ghost" onclick="closeModal()">Cancel</button><button class="btn btn-primary" onclick="submitAddSchedule()">Add</button></div>
  `);
}
async function submitAddSchedule() {
  await api('school?type=schedule', 'POST', {
    course: document.getElementById('f-course').value,
    day: document.getElementById('f-day').value,
    startTime: document.getElementById('f-start').value,
    endTime: document.getElementById('f-end').value,
    location: document.getElementById('f-location').value,
    type: 'lecture',
  });
  closeModal(); navigate('school');
}

// ============ POLYMARKET ============
let polyTab = 'positions';
async function renderPolymarket() {
  try {
    const [positions, watchlist] = await Promise.all([api('polymarket?type=positions'), api('polymarket?type=watchlist')]);
    const c = document.getElementById('content');
    const open = positions.filter(p => p.status === 'open');
    const closed = positions.filter(p => p.status && p.status.startsWith('closed'));
    const totalInvested = open.reduce((s,p) => s + (parseFloat(p.invested)||0), 0);
    const totalValue = open.reduce((s,p) => s + (parseFloat(p.currentValue)||0), 0);
    const totalPnl = totalValue - totalInvested;
    const wins = closed.filter(p => p.status === 'closed-win').length;
    const winRate = closed.length ? ((wins/closed.length)*100).toFixed(0) : 0;

    c.innerHTML = `<div class="fade-in">
      <div class="stats-row">
        <div class="stat-card"><div class="stat-label">Invested</div><div class="stat-value">${fmtMoney(totalInvested)}</div></div>
        <div class="stat-card"><div class="stat-label">Value</div><div class="stat-value">${fmtMoney(totalValue)}</div></div>
        <div class="stat-card"><div class="stat-label">P&L</div><div class="stat-value ${pnlClass(totalPnl)}">${fmtMoney(totalPnl)}</div></div>
        <div class="stat-card"><div class="stat-label">Win Rate</div><div class="stat-value">${winRate}%</div></div>
      </div>
      <div class="actions-bar">
        <button class="btn btn-primary" onclick="openAddPolyPosition()">+ Add Position</button>
        <button class="btn btn-ghost" onclick="openAddPolyWatchlist()">+ Watchlist</button>
      </div>
      <div class="tabs">
        <div class="tab ${polyTab==='positions'?'active':''}" onclick="polyTab='positions';renderPolymarket()">Open (${open.length})</div>
        <div class="tab ${polyTab==='closed'?'active':''}" onclick="polyTab='closed';renderPolymarket()">Closed (${closed.length})</div>
        <div class="tab ${polyTab==='watchlist'?'active':''}" onclick="polyTab='watchlist';renderPolymarket()">Watchlist (${watchlist.length})</div>
      </div>
      ${polyTab === 'positions' ? renderPolyTable(open) : polyTab === 'closed' ? renderPolyTable(closed) : renderPolyWatchlist(watchlist)}
    </div>`;
  } catch (e) { document.getElementById('content').innerHTML = `<div class="empty-state"><p>${esc(e.message)}</p></div>`; }
}

function renderPolyTable(items) {
  if (!items.length) return '<div class="empty-state"><div class="icon">📊</div><p>No positions</p></div>';
  return `<div style="overflow-x:auto"><table class="data-table">
    <tr><th>Market</th><th>Position</th><th>Entry</th><th>Current</th><th>Shares</th><th>P&L</th><th>Actions</th></tr>
    ${items.map(p => `<tr>
      <td>${p.marketUrl ? `<a href="${esc(p.marketUrl)}" target="_blank" style="color:var(--blue)">${esc(p.market)}</a>` : esc(p.market)}</td>
      <td>${esc(p.position)}</td>
      <td class="mono">${fmtMoney(p.entryPrice)}</td>
      <td class="mono">${fmtMoney(p.currentPrice)}</td>
      <td class="mono">${p.shares || '—'}</td>
      <td class="${pnlClass(p.pnl)}">${fmtMoney(p.pnl)} (${fmtPct(p.pnlPercent)})</td>
      <td><button class="btn-sm" onclick='openEditPoly(${JSON.stringify(p).replace(/'/g,"&#39;")})'>✏️</button> <button class="btn-sm" onclick="deletePoly('${p.id}')">🗑</button></td>
    </tr>`).join('')}
  </table></div>`;
}

function renderPolyWatchlist(items) {
  if (!items.length) return '<div class="empty-state"><div class="icon">👀</div><p>Watchlist empty</p></div>';
  return `<div style="overflow-x:auto"><table class="data-table">
    <tr><th>Market</th><th>Current Price</th><th>Target Entry</th><th>Notes</th><th>Actions</th></tr>
    ${items.map(w => `<tr>
      <td>${w.marketUrl ? `<a href="${esc(w.marketUrl)}" target="_blank" style="color:var(--blue)">${esc(w.market)}</a>` : esc(w.market)}</td>
      <td class="mono">${fmtMoney(w.currentPrice)}</td>
      <td class="mono">${fmtMoney(w.targetEntry)}</td>
      <td>${esc(w.notes || '')}</td>
      <td><button class="btn-sm" onclick="deletePolyWatchlist('${w.id}')">🗑</button></td>
    </tr>`).join('')}
  </table></div>`;
}

function openAddPolyPosition() {
  openModal('Add Position', `
    <div class="form-group"><label>Market</label><input id="f-market" placeholder="Market name"></div>
    <div class="form-group"><label>Market URL</label><input id="f-url" placeholder="https://..."></div>
    <div class="form-group"><label>Position (Yes/No)</label><select id="f-position"><option>Yes</option><option>No</option></select></div>
    <div class="form-group"><label>Entry Price</label><input id="f-entry" type="number" step="0.01"></div>
    <div class="form-group"><label>Current Price</label><input id="f-current" type="number" step="0.01"></div>
    <div class="form-group"><label>Shares</label><input id="f-shares" type="number"></div>
    <div class="form-group"><label>Notes</label><textarea id="f-notes"></textarea></div>
    <div class="form-actions"><button class="btn btn-ghost" onclick="closeModal()">Cancel</button><button class="btn btn-primary" onclick="submitAddPolyPosition()">Add</button></div>
  `);
}
async function submitAddPolyPosition() {
  const entry = parseFloat(document.getElementById('f-entry').value)||0;
  const current = parseFloat(document.getElementById('f-current').value)||0;
  const shares = parseFloat(document.getElementById('f-shares').value)||0;
  const invested = entry * shares;
  const currentValue = current * shares;
  const pnl = currentValue - invested;
  await api('polymarket?type=positions', 'POST', {
    market: document.getElementById('f-market').value,
    marketUrl: document.getElementById('f-url').value,
    position: document.getElementById('f-position').value,
    entryPrice: entry, currentPrice: current, shares, invested, currentValue, pnl,
    pnlPercent: invested ? (pnl/invested)*100 : 0,
    status: 'open',
    notes: document.getElementById('f-notes').value,
    tags: [],
  });
  await logActivity('Added Polymarket position: ' + document.getElementById('f-market').value, 'polymarket');
  closeModal(); navigate('polymarket');
}

function openEditPoly(p) {
  openModal('Edit Position', `
    <div class="form-group"><label>Market</label><input id="f-market" value="${esc(p.market)}"></div>
    <div class="form-group"><label>Current Price</label><input id="f-current" type="number" step="0.01" value="${p.currentPrice||''}"></div>
    <div class="form-group"><label>Status</label><select id="f-status">${['open','closed-win','closed-loss','watching'].map(s=>`<option ${s===p.status?'selected':''}>${s}</option>`).join('')}</select></div>
    <div class="form-group"><label>Notes</label><textarea id="f-notes">${esc(p.notes||'')}</textarea></div>
    <div class="form-actions"><button class="btn btn-ghost" onclick="closeModal()">Cancel</button><button class="btn btn-primary" onclick="updatePoly('${p.id}',${p.entryPrice},${p.shares})">Save</button></div>
  `);
}
async function updatePoly(id, entryPrice, shares) {
  const current = parseFloat(document.getElementById('f-current').value)||0;
  const invested = entryPrice * shares;
  const currentValue = current * shares;
  const pnl = currentValue - invested;
  const status = document.getElementById('f-status').value;
  const body = { market: document.getElementById('f-market').value, currentPrice: current, currentValue, pnl, pnlPercent: invested?(pnl/invested)*100:0, status, notes: document.getElementById('f-notes').value };
  if (status.startsWith('closed') && !body.exitDate) { body.exitDate = new Date().toISOString(); body.exitPrice = current; }
  await api(`polymarket?type=positions&id=${id}`, 'PUT', body);
  closeModal(); navigate('polymarket');
}
async function deletePoly(id) { if(!confirm('Delete?'))return; await api(`polymarket?type=positions&id=${id}`, 'DELETE'); navigate('polymarket'); }
async function deletePolyWatchlist(id) { if(!confirm('Delete?'))return; await api(`polymarket?type=watchlist&id=${id}`, 'DELETE'); navigate('polymarket'); }

function openAddPolyWatchlist() {
  openModal('Add to Watchlist', `
    <div class="form-group"><label>Market</label><input id="f-market" placeholder="Market name"></div>
    <div class="form-group"><label>Market URL</label><input id="f-url" placeholder="https://..."></div>
    <div class="form-group"><label>Current Price</label><input id="f-current" type="number" step="0.01"></div>
    <div class="form-group"><label>Target Entry</label><input id="f-target" type="number" step="0.01"></div>
    <div class="form-group"><label>Notes</label><textarea id="f-notes"></textarea></div>
    <div class="form-actions"><button class="btn btn-ghost" onclick="closeModal()">Cancel</button><button class="btn btn-primary" onclick="submitPolyWatchlist()">Add</button></div>
  `);
}
async function submitPolyWatchlist() {
  await api('polymarket?type=watchlist', 'POST', {
    market: document.getElementById('f-market').value,
    marketUrl: document.getElementById('f-url').value,
    currentPrice: parseFloat(document.getElementById('f-current').value)||0,
    targetEntry: parseFloat(document.getElementById('f-target').value)||0,
    notes: document.getElementById('f-notes').value,
  });
  closeModal(); navigate('polymarket');
}

// ============ TRADING ============
let tradingTab = 'positions';
async function renderTrading() {
  try {
    const [positions, watchlist, journal] = await Promise.all([
      api('trading?type=positions'), api('trading?type=watchlist'), api('trading?type=journal')
    ]);
    const c = document.getElementById('content');
    const open = positions.filter(p => p.status === 'open');
    const closed = positions.filter(p => p.status && p.status !== 'open');
    const totalInvested = open.reduce((s,p) => s+(parseFloat(p.invested)||0), 0);
    const totalValue = open.reduce((s,p) => s+(parseFloat(p.currentValue)||0), 0);
    const totalPnl = totalValue - totalInvested;
    const closedPnl = closed.reduce((s,p) => s+(parseFloat(p.pnl)||0), 0);
    const wins = closed.filter(p => p.status === 'closed-profit').length;
    const losses = closed.filter(p => p.status === 'closed-loss' || p.status === 'stopped-out').length;
    const winRate = (wins+losses) ? ((wins/(wins+losses))*100).toFixed(0) : 0;
    const avgWin = wins ? closed.filter(p=>p.status==='closed-profit').reduce((s,p)=>s+(parseFloat(p.pnl)||0),0)/wins : 0;
    const avgLoss = losses ? closed.filter(p=>p.status!=='closed-profit').reduce((s,p)=>s+(parseFloat(p.pnl)||0),0)/losses : 0;
    const profitFactor = avgLoss !== 0 ? Math.abs(avgWin / avgLoss) : 0;

    c.innerHTML = `<div class="fade-in">
      <div class="stats-row">
        <div class="stat-card"><div class="stat-label">Open P&L</div><div class="stat-value ${pnlClass(totalPnl)}">${fmtMoney(totalPnl)}</div></div>
        <div class="stat-card"><div class="stat-label">Realized P&L</div><div class="stat-value ${pnlClass(closedPnl)}">${fmtMoney(closedPnl)}</div></div>
        <div class="stat-card"><div class="stat-label">Win Rate</div><div class="stat-value">${winRate}%</div></div>
        <div class="stat-card"><div class="stat-label">Avg Win</div><div class="stat-value pnl-positive">${fmtMoney(avgWin)}</div></div>
        <div class="stat-card"><div class="stat-label">Avg Loss</div><div class="stat-value pnl-negative">${fmtMoney(avgLoss)}</div></div>
        <div class="stat-card"><div class="stat-label">Profit Factor</div><div class="stat-value">${profitFactor.toFixed(2)}</div></div>
      </div>
      <div class="actions-bar">
        <button class="btn btn-primary" onclick="openAddTrade()">+ Add Position</button>
        <button class="btn btn-ghost" onclick="openAddTradeWatchlist()">+ Watchlist</button>
        <button class="btn btn-ghost" onclick="openAddJournal()">📝 Journal</button>
      </div>
      <div class="tabs">
        <div class="tab ${tradingTab==='positions'?'active':''}" onclick="tradingTab='positions';renderTrading()">Open (${open.length})</div>
        <div class="tab ${tradingTab==='closed'?'active':''}" onclick="tradingTab='closed';renderTrading()">Closed (${closed.length})</div>
        <div class="tab ${tradingTab==='watchlist'?'active':''}" onclick="tradingTab='watchlist';renderTrading()">Watchlist (${watchlist.length})</div>
        <div class="tab ${tradingTab==='journal'?'active':''}" onclick="tradingTab='journal';renderTrading()">Journal (${journal.length})</div>
      </div>
      ${tradingTab==='positions' ? renderTradeTable(open, true) : tradingTab==='closed' ? renderTradeTable(closed, false) : tradingTab==='watchlist' ? renderTradeWatchlist(watchlist) : renderJournal(journal)}
    </div>`;
  } catch (e) { document.getElementById('content').innerHTML = `<div class="empty-state"><p>${esc(e.message)}</p></div>`; }
}

function renderTradeTable(items, showTargets) {
  if (!items.length) return '<div class="empty-state"><div class="icon">📈</div><p>No positions</p></div>';
  return `<div style="overflow-x:auto"><table class="data-table">
    <tr><th>Ticker</th><th>Side</th><th>Entry</th><th>Current</th><th>Shares</th>${showTargets?'<th>SL</th><th>TP</th>':''}<th>P&L</th><th>Actions</th></tr>
    ${items.map(p => `<tr>
      <td><strong>${esc(p.ticker)}</strong><div style="font-size:.7rem;color:var(--text-dim)">${esc(p.company||'')}</div></td>
      <td>${esc(p.side||'long')}</td>
      <td class="mono">${fmtMoney(p.entryPrice)}</td>
      <td class="mono">${fmtMoney(p.currentPrice)}</td>
      <td class="mono">${p.shares||'—'}</td>
      ${showTargets?`<td class="mono" style="color:var(--red)">${fmtMoney(p.stopLoss)}</td><td class="mono" style="color:var(--green)">${fmtMoney(p.takeProfit)}</td>`:''}
      <td class="${pnlClass(p.pnl)}">${fmtMoney(p.pnl)} (${fmtPct(p.pnlPercent)})</td>
      <td><button class="btn-sm" onclick='openEditTrade(${JSON.stringify(p).replace(/'/g,"&#39;")})'>✏️</button> <button class="btn-sm" onclick="deleteTrade('${p.id}')">🗑</button></td>
    </tr>`).join('')}
  </table></div>`;
}

function renderTradeWatchlist(items) {
  if (!items.length) return '<div class="empty-state"><div class="icon">👀</div><p>Watchlist empty</p></div>';
  return `<div style="overflow-x:auto"><table class="data-table">
    <tr><th>Ticker</th><th>Company</th><th>Target Entry</th><th>Current</th><th>Thesis</th><th>Actions</th></tr>
    ${items.map(w => `<tr>
      <td><strong>${esc(w.ticker)}</strong></td><td>${esc(w.company||'')}</td>
      <td class="mono">${fmtMoney(w.targetEntry)}</td><td class="mono">${fmtMoney(w.currentPrice)}</td>
      <td style="max-width:200px;font-size:.8rem">${esc(w.thesis||'')}</td>
      <td><button class="btn-sm" onclick="deleteTradeWatchlist('${w.id}')">🗑</button></td>
    </tr>`).join('')}
  </table></div>`;
}

function renderJournal(items) {
  if (!items.length) return '<div class="empty-state"><div class="icon">📝</div><p>No journal entries</p></div>';
  return items.sort((a,b)=>new Date(b.timestamp)-new Date(a.timestamp)).map(j => `
    <div class="journal-entry">
      <div class="je-header"><span class="je-type">${esc(j.type||'note')}</span><span class="je-date">${esc(j.ticker||'')} · ${fmtDate(j.timestamp)}</span></div>
      <div class="je-note">${esc(j.note)}</div>
    </div>
  `).join('');
}

function openAddTrade() {
  openModal('Add Position', `
    <div class="form-group"><label>Ticker</label><input id="f-ticker" placeholder="AAPL"></div>
    <div class="form-group"><label>Company</label><input id="f-company" placeholder="Apple Inc."></div>
    <div class="form-group"><label>Side</label><select id="f-side"><option>long</option><option>short</option></select></div>
    <div class="form-group"><label>Entry Price</label><input id="f-entry" type="number" step="0.01"></div>
    <div class="form-group"><label>Current Price</label><input id="f-current" type="number" step="0.01"></div>
    <div class="form-group"><label>Shares</label><input id="f-shares" type="number"></div>
    <div class="form-group"><label>Stop Loss</label><input id="f-sl" type="number" step="0.01"></div>
    <div class="form-group"><label>Take Profit</label><input id="f-tp" type="number" step="0.01"></div>
    <div class="form-group"><label>Thesis</label><textarea id="f-thesis"></textarea></div>
    <div class="form-actions"><button class="btn btn-ghost" onclick="closeModal()">Cancel</button><button class="btn btn-primary" onclick="submitAddTrade()">Add</button></div>
  `);
}
async function submitAddTrade() {
  const entry = parseFloat(document.getElementById('f-entry').value)||0;
  const current = parseFloat(document.getElementById('f-current').value)||0;
  const shares = parseFloat(document.getElementById('f-shares').value)||0;
  const invested = entry*shares;
  const currentValue = current*shares;
  const pnl = currentValue-invested;
  await api('trading?type=positions', 'POST', {
    ticker: document.getElementById('f-ticker').value,
    company: document.getElementById('f-company').value,
    side: document.getElementById('f-side').value,
    entryPrice: entry, currentPrice: current, shares, invested, currentValue, pnl,
    pnlPercent: invested?(pnl/invested)*100:0,
    stopLoss: parseFloat(document.getElementById('f-sl').value)||null,
    takeProfit: parseFloat(document.getElementById('f-tp').value)||null,
    status: 'open',
    thesis: document.getElementById('f-thesis').value,
    tags: [], entryDate: new Date().toISOString(),
  });
  await logActivity('Added trade: ' + document.getElementById('f-ticker').value, 'trading');
  closeModal(); navigate('trading');
}

function openEditTrade(p) {
  openModal('Edit Position', `
    <div class="form-group"><label>Ticker</label><input id="f-ticker" value="${esc(p.ticker)}"></div>
    <div class="form-group"><label>Current Price</label><input id="f-current" type="number" step="0.01" value="${p.currentPrice||''}"></div>
    <div class="form-group"><label>Stop Loss</label><input id="f-sl" type="number" step="0.01" value="${p.stopLoss||''}"></div>
    <div class="form-group"><label>Take Profit</label><input id="f-tp" type="number" step="0.01" value="${p.takeProfit||''}"></div>
    <div class="form-group"><label>Status</label><select id="f-status">${['open','closed-profit','closed-loss','stopped-out'].map(s=>`<option ${s===p.status?'selected':''}>${s}</option>`).join('')}</select></div>
    <div class="form-group"><label>Thesis</label><textarea id="f-thesis">${esc(p.thesis||'')}</textarea></div>
    <div class="form-actions"><button class="btn btn-ghost" onclick="closeModal()">Cancel</button><button class="btn btn-primary" onclick="updateTrade('${p.id}',${p.entryPrice},${p.shares})">Save</button></div>
  `);
}
async function updateTrade(id, entryPrice, shares) {
  const current = parseFloat(document.getElementById('f-current').value)||0;
  const invested = entryPrice*shares;
  const currentValue = current*shares;
  const pnl = currentValue-invested;
  const status = document.getElementById('f-status').value;
  const body = { ticker: document.getElementById('f-ticker').value, currentPrice: current, currentValue, pnl, pnlPercent: invested?(pnl/invested)*100:0, stopLoss: parseFloat(document.getElementById('f-sl').value)||null, takeProfit: parseFloat(document.getElementById('f-tp').value)||null, status, thesis: document.getElementById('f-thesis').value };
  if (status !== 'open' && !body.exitDate) { body.exitDate = new Date().toISOString(); body.exitPrice = current; }
  await api(`trading?type=positions&id=${id}`, 'PUT', body);
  closeModal(); navigate('trading');
}
async function deleteTrade(id) { if(!confirm('Delete?'))return; await api(`trading?type=positions&id=${id}`, 'DELETE'); navigate('trading'); }
async function deleteTradeWatchlist(id) { if(!confirm('Delete?'))return; await api(`trading?type=watchlist&id=${id}`, 'DELETE'); navigate('trading'); }

function openAddTradeWatchlist() {
  openModal('Add to Watchlist', `
    <div class="form-group"><label>Ticker</label><input id="f-ticker" placeholder="AAPL"></div>
    <div class="form-group"><label>Company</label><input id="f-company" placeholder="Apple Inc."></div>
    <div class="form-group"><label>Target Entry</label><input id="f-target" type="number" step="0.01"></div>
    <div class="form-group"><label>Current Price</label><input id="f-current" type="number" step="0.01"></div>
    <div class="form-group"><label>Thesis</label><textarea id="f-thesis"></textarea></div>
    <div class="form-actions"><button class="btn btn-ghost" onclick="closeModal()">Cancel</button><button class="btn btn-primary" onclick="submitTradeWatchlist()">Add</button></div>
  `);
}
async function submitTradeWatchlist() {
  await api('trading?type=watchlist', 'POST', {
    ticker: document.getElementById('f-ticker').value,
    company: document.getElementById('f-company').value,
    targetEntry: parseFloat(document.getElementById('f-target').value)||0,
    currentPrice: parseFloat(document.getElementById('f-current').value)||0,
    thesis: document.getElementById('f-thesis').value,
    alerts: [],
  });
  closeModal(); navigate('trading');
}

function openAddJournal() {
  openModal('Add Journal Entry', `
    <div class="form-group"><label>Ticker</label><input id="f-ticker" placeholder="AAPL"></div>
    <div class="form-group"><label>Type</label><select id="f-type"><option>entry</option><option>exit</option><option>update</option><option>thesis</option><option>note</option></select></div>
    <div class="form-group"><label>Note</label><textarea id="f-note" placeholder="What happened?"></textarea></div>
    <div class="form-actions"><button class="btn btn-ghost" onclick="closeModal()">Cancel</button><button class="btn btn-primary" onclick="submitJournal()">Add</button></div>
  `);
}
async function submitJournal() {
  await api('trading?type=journal', 'POST', {
    ticker: document.getElementById('f-ticker').value,
    type: document.getElementById('f-type').value,
    note: document.getElementById('f-note').value,
  });
  closeModal(); navigate('trading');
}

// Activity logger helper
async function logActivity(action, section) {
  try { await api('activity', 'POST', { agentName: 'Dashboard', action, section, status: 'success' }); } catch {}
}
