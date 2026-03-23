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
    const state = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
    // Ensure all required fields exist (migration for old state format)
    state.consecutiveLosses = state.consecutiveLosses ?? 0;
    state.tripped = state.tripped ?? false;
    state.trippedAt = state.trippedAt ?? null;
    state.lastResult = state.lastResult ?? null;
    return state;
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
  
  state.lastUpdated = new Date().toISOString();
  if (result === 'win') {
    state.consecutiveLosses = 0;
    state.lastResult = 'win';
  } else if (result === 'loss') {
    state.consecutiveLosses++;
    state.lastResult = 'loss';
    // Log each loss for debugging false trips
    if (!state.lossLog) state.lossLog = [];
    state.lossLog.push({ at: new Date().toISOString(), caller: new Error().stack?.split('\n')[2]?.trim() || 'unknown' });
    if (state.lossLog.length > 10) state.lossLog = state.lossLog.slice(-10);
    
    if (state.consecutiveLosses >= 3 && !state.tripped) {
      state.tripped = true;
      state.trippedAt = new Date().toISOString();
      state.tripCaller = new Error().stack?.split('\n')[2]?.trim() || 'unknown';
      console.log(`[circuit-breaker] 🚨 TRIPPED — ${state.consecutiveLosses} consecutive losses`);
      console.log(`[circuit-breaker] Trigger stack: ${state.tripCaller}`);
      
      // Send alert via Telegram Bot API (reliable, same as scanner/resolver)
      try {
        const BOT_TOKEN = '8550919932:AAEJrh5TX03LP7gXq_WiRnMNBUlPA6K1zC4';
        const msg = `🚨 CIRCUIT BREAKER TRIPPED\n\n${state.consecutiveLosses} consecutive losses.\nTrading paused until manual reset.\n\nSend "reset circuit breaker" to resume.`;
        fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ chat_id: '-1003762193481', message_thread_id: 2, text: msg })
        }).catch(() => {});
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
