#!/usr/bin/env node
/**
 * scripts/run-resolve.js — Check all open trades for resolution
 */

const { observe } = require('../stormwatch/observer');
const { execSync } = require('child_process');
const path = require('path');

const GIT_DIR = path.join(__dirname, '..', '..'); // nyx-dashboard root

async function main() {
  console.log(`[run-resolve] Starting resolution check | ${new Date().toISOString()}`);
  const result = await observe();
  console.log(`\n[run-resolve] Complete:`, JSON.stringify(result, null, 2));

  // Auto-push if any trades resolved
  if (result.resolved && result.resolved.length > 0) {
    try {
      execSync(`git -C ${GIT_DIR} add weather-v2/trades.json`, { stdio: 'pipe' });
      try { execSync(`git -C ${GIT_DIR} commit -m "auto: ${result.resolved.length} weather trade(s) resolved"`, { stdio: 'pipe' }); } catch(e) { /* nothing to commit */ }
      // E028: Robust push with retry + verification
      let pushOk = false;
      for (let attempt = 1; attempt <= 3; attempt++) {
        try {
          execSync(`git -C ${GIT_DIR} pull --rebase origin main`, { stdio: 'pipe' });
          execSync(`git -C ${GIT_DIR} push origin main`, { stdio: 'pipe' });
          const local = execSync(`git -C ${GIT_DIR} rev-parse HEAD`, { encoding: 'utf8' }).trim();
          const remote = execSync(`git -C ${GIT_DIR} ls-remote origin HEAD`, { encoding: 'utf8' }).split(/\s/)[0];
          if (local === remote) { pushOk = true; console.log(`[run-resolve] Git push verified (attempt ${attempt})`); break; }
        } catch(e) { console.log(`[run-resolve] Git push attempt ${attempt} failed: ${e.message}`); }
      }
      if (!pushOk) console.error('[run-resolve] 🚨 CRITICAL: Git push failed after 3 attempts');
      console.log(`[run-resolve] Pushed ${result.resolved.length} resolved trade(s) to GitHub`);
    } catch (e) {
      console.warn(`[run-resolve] Git push failed: ${e.message?.slice(0, 80)}`);
    }
    
    // Send notification
    console.log('\n[run-resolve] Sending notification...');
    try {
      const winners = result.resolved.filter(t => t.pnl > 0).length;
      const losers = result.resolved.filter(t => t.pnl <= 0).length;
      const totalPnL = result.resolved.reduce((sum, t) => sum + (t.pnl || 0), 0).toFixed(2);
      const msg = `✅ Weather Resolver: ${result.resolved.length} position(s) resolved\n${winners}W ${losers}L | P&L: $${totalPnL}`;
      execSync(`/usr/bin/node ${path.join(__dirname, 'notify.js')} "${msg}"`, { stdio: 'inherit' });
    } catch (err) {
      console.error('[run-resolve] Notification failed (non-fatal):', err.message);
    }
  }
  return result;
}

main().catch(err => {
  console.error('[run-resolve] Fatal:', err);
  process.exit(1);
});
