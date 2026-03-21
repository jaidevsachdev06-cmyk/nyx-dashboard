/**
 * core/store.js — Trade Store
 * 
 * RULE: This is the ONLY module that reads/writes trades.json.
 *       All other modules go through this interface.
 *       Every write is validated before commit.
 */

const fs = require('fs');
const path = require('path');
const { validateTrade, validateTransition } = require('./schema');

const TRADES_FILE = path.resolve(__dirname, '..', 'trades.json');
const BACKUP_DIR = path.resolve(__dirname, '..', 'backups');
const LOCK_FILE = path.resolve(__dirname, '..', 'logs', '.trades.lock');

class TradeStore {
  constructor(filePath = TRADES_FILE) {
    this.filePath = filePath;
    this._ensureFile();
  }

  _ensureFile() {
    if (!fs.existsSync(this.filePath)) {
      fs.writeFileSync(this.filePath, JSON.stringify({ trades: [], meta: { version: 2, lastUpdated: new Date().toISOString() } }, null, 2));
    }
  }

  _read() {
    const raw = fs.readFileSync(this.filePath, 'utf-8');
    const data = JSON.parse(raw);
    if (!data.trades || !Array.isArray(data.trades)) {
      throw new Error('Corrupt trades.json: missing "trades" array');
    }
    return data;
  }

  _acquireLock(timeoutMs = 10000) {
    const start = Date.now();
    fs.mkdirSync(path.dirname(LOCK_FILE), { recursive: true });
    while (true) {
      try {
        // O_EXCL = fail if file exists (atomic on same filesystem)
        fs.writeFileSync(LOCK_FILE, String(process.pid), { flag: 'wx' });
        return true;
      } catch (e) {
        if (e.code !== 'EEXIST') throw e;
        // Check for stale lock (process died without releasing)
        try {
          const lockPid = parseInt(fs.readFileSync(LOCK_FILE, 'utf8'));
          try { process.kill(lockPid, 0); } catch { fs.unlinkSync(LOCK_FILE); continue; }
        } catch { fs.unlinkSync(LOCK_FILE); continue; }
        if (Date.now() - start > timeoutMs) throw new Error('Could not acquire trades.json lock after ' + timeoutMs + 'ms');
        // Spin wait 50ms
        const w = Date.now(); while (Date.now() - w < 50) {}
      }
    }
  }

  _releaseLock() {
    try { fs.unlinkSync(LOCK_FILE); } catch {}
  }

  _write(data) {
    this._acquireLock();
    try {
      if (!fs.existsSync(BACKUP_DIR)) {
        fs.mkdirSync(BACKUP_DIR, { recursive: true });
      }
      if (fs.existsSync(this.filePath)) {
        const ts = new Date().toISOString().replace(/[:.]/g, '-');
        const backupPath = path.join(BACKUP_DIR, `trades-${ts}.json`);
        fs.copyFileSync(this.filePath, backupPath);
        const backups = fs.readdirSync(BACKUP_DIR).sort();
        while (backups.length > 50) {
          fs.unlinkSync(path.join(BACKUP_DIR, backups.shift()));
        }
      }
      data.meta.lastUpdated = new Date().toISOString();
      // Write to tmp first, then rename (atomic on same filesystem)
      const tmpFile = this.filePath + '.tmp';
      fs.writeFileSync(tmpFile, JSON.stringify(data, null, 2));
      fs.renameSync(tmpFile, this.filePath);
    } finally {
      this._releaseLock();
    }
  }

  getAll(filter = {}) {
    const { trades } = this._read();
    return trades.filter(t => {
      for (const [key, val] of Object.entries(filter)) {
        if (Array.isArray(val)) {
          if (!val.includes(t[key])) return false;
        } else if (t[key] !== val) {
          return false;
        }
      }
      return true;
    });
  }

  getById(id) {
    const { trades } = this._read();
    const trade = trades.find(t => t.id === id);
    if (!trade) throw new Error(`Trade not found: ${id}`);
    return trade;
  }

  getOpenPositions() {
    return this.getAll({ status: 'open' });
  }

  getPendingResolution() {
    return this.getAll({ status: ['open', 'resolved'] });
  }

  add(trade) {
    const validation = validateTrade(trade);
    if (!validation.valid) {
      const err = new Error(`REJECTED: Trade failed validation:\n  ${validation.errors.join('\n  ')}`);
      err.validationErrors = validation.errors;
      throw err;
    }
    const data = this._read();
    const dup = data.trades.find(t => 
      t.conditionId === trade.conditionId && 
      t.side === trade.side && 
      !['closed'].includes(t.status)
    );
    if (dup) {
      throw new Error(`Duplicate: Active trade already exists for conditionId ${trade.conditionId} side ${trade.side} (trade ${dup.id})`);
    }
    data.trades.push(trade);
    this._write(data);
    console.log(`[store] Added trade ${trade.id} | ${trade.city} ${trade.date} ${trade.bucket} ${trade.side} | status: ${trade.status}`);
    return trade;
  }

  update(id, updates) {
    const data = this._read();
    const idx = data.trades.findIndex(t => t.id === id);
    if (idx === -1) throw new Error(`Trade not found: ${id}`);
    const existing = data.trades[idx];
    if (updates.status && updates.status !== existing.status) {
      const transitionCheck = validateTransition(existing.status, updates.status);
      if (!transitionCheck.valid) {
        throw new Error(`REJECTED: ${transitionCheck.error} (trade ${id})`);
      }
    }
    const updated = { ...existing, ...updates };
    const validation = validateTrade(updated);
    if (!validation.valid) {
      throw new Error(`REJECTED: Updated trade fails validation:\n  ${validation.errors.join('\n  ')}`);
    }
    const immutableFields = ['id', 'conditionId', 'tokenId', 'city', 'date', 'bucket', 'createdAt'];
    for (const field of immutableFields) {
      if (updates[field] !== undefined && updates[field] !== existing[field]) {
        throw new Error(`REJECTED: Cannot change immutable field "${field}" on trade ${id}`);
      }
    }
    data.trades[idx] = updated;
    this._write(data);
    const statusMsg = updates.status ? ` → ${updates.status}` : '';
    console.log(`[store] Updated trade ${id}${statusMsg} | ${JSON.stringify(Object.keys(updates))}`);
    return updated;
  }

  transition(id, toStatus, data = {}) {
    const trade = this.getById(id);
    const updates = { status: toStatus, ...data };
    switch (toStatus) {
      case 'entered':
        if (!updates.enteredAt) updates.enteredAt = new Date().toISOString();
        break;
      case 'open':
        if (updates.entryPrice === undefined && !trade.entryPrice) {
          throw new Error(`Cannot transition to "open" without entryPrice`);
        }
        break;
      case 'resolved':
        if (!updates.result) {
          throw new Error(`Cannot transition to "resolved" without result`);
        }
        if (!['polymarket', 'price-inferred', 'manual-exit'].includes(updates.resolutionSource)) {
          throw new Error(`resolutionSource must be "polymarket", "price-inferred", or "manual-exit"`);
        }
        if (!updates.resolvedAt) updates.resolvedAt = new Date().toISOString();
        break;
      case 'exited':
                if (!updates.exitedAt) updates.exitedAt = new Date().toISOString();
        break;
      case 'closed':
        if (!updates.closedAt) updates.closedAt = new Date().toISOString();
        break;
    }
    return this.update(id, updates);
  }

  statusCounts() {
    const trades = this.getAll();
    const counts = {};
    for (const t of trades) {
      counts[t.status] = (counts[t.status] || 0) + 1;
    }
    return counts;
  }

  integrityCheck() {
    const trades = this.getAll();
    const results = { valid: 0, invalid: [] };
    for (const t of trades) {
      const check = validateTrade(t);
      if (check.valid) results.valid++;
      else results.invalid.push({ id: t.id, errors: check.errors });
    }
    return results;
  }
}

module.exports = new TradeStore();
module.exports.TradeStore = TradeStore;
