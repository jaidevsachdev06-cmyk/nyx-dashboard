/**
 * core/circuit-breaker.js — Circuit Breaker System
 * 
 * Pauses trading after 3 consecutive losses.
 * Requires manual reset or auto-resets after 24h.
 */

const fs = require('fs');
const path = require('path');

const STATE_FILE = path.resolve(__dirname, '..', 'logs', '.circuit-breaker.json');

function loadState() {
  try {
    return JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
  } catch {
    return { consecutiveLosses: 0, tripped: false, trippedAt: null, lastResult: null };
  }
}

function saveState(state) {
  try {
    fs.mkdirSync(path.dirname(STATE_FILE), { recursive: true });
    fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
  } catch {}
}

function recordResult(result) {
  const state = loadState();
  
  if (result === 'win') {
    state.consecutiveLosses = 0;
    state.lastResult = 'win';
  } else if (result === 'loss') {
    state.consecutiveLosses++;
    state.lastResult = 'loss';
    
    if (state.consecutiveLosses >= 3 && !state.tripped) {
      state.tripped = true;
      state.trippedAt = new Date().toISOString();
      console.log(`[circuit-breaker] 🚨 TRIPPED — ${state.consecutiveLosses} consecutive losses`);
      
      // Send alert
      try {
        const { execSync } = require('child_process');
        const msg = `🚨 CIRCUIT BREAKER TRIPPED\\n\\n${state.consecutiveLosses} consecutive losses.\\nTrading paused until manual reset.\\n\\nSend "reset circuit breaker" to resume.`;
        execSync(`openclaw message send --channel telegram --to "-1003762193481:topic:2" --message "${msg}"`, { stdio: 'pipe' });
      } catch {}
    }
  }
  
  saveState(state);
  return state;
}

function isTripped() {
  const state = loadState();
  
  // Auto-reset after 24h
  if (state.tripped && state.trippedAt) {
    const elapsed = Date.now() - new Date(state.trippedAt).getTime();
    if (elapsed > 24 * 3600000) {
      state.tripped = false;
      state.consecutiveLosses = 0;
      state.trippedAt = null;
      saveState(state);
      console.log('[circuit-breaker] Auto-reset after 24h');
      return false;
    }
  }
  
  return state.tripped;
}

function reset() {
  const state = { consecutiveLosses: 0, tripped: false, trippedAt: null, lastResult: null };
  saveState(state);
  console.log('[circuit-breaker] Manually reset');
  return state;
}

function getStatus() {
  return loadState();
}

module.exports = { recordResult, isTripped, reset, getStatus };
