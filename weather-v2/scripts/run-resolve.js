#!/usr/bin/env node
/**
 * scripts/run-resolve.js — Check all open trades for resolution
 */

const { observe } = require('../stormwatch/observer');
const { execSync } = require('child_process');
const path = require('path');

const GIT_DIR = path.join(__dirname, '..', '..', '..'); // nyx-dashboard root

async function main() {
  console.log(`[run-resolve] Starting resolution check | ${new Date().toISOString()}`);
  const result = await observe();
  console.log(`\n[run-resolve] Complete:`, JSON.stringify(result, null, 2));

  // Auto-push if any trades resolved
  if (result.resolved && result.resolved.length > 0) {
    try {
      execSync(`git -C ${GIT_DIR} add weather-v2/trades.json`, { stdio: 'pipe' });
      try { execSync(`git -C ${GIT_DIR} commit -m "auto: ${result.resolved.length} weather trade(s) resolved"`, { stdio: 'pipe' }); } catch(e) { /* nothing to commit */ }
      execSync(`git -C ${GIT_DIR} push`, { stdio: 'pipe' });
      console.log(`[run-resolve] Pushed ${result.resolved.length} resolved trade(s) to GitHub`);
    } catch (e) {
      console.warn(`[run-resolve] Git push failed: ${e.message?.slice(0, 80)}`);
    }
  }
  return result;
}

main().catch(err => {
  console.error('[run-resolve] Fatal:', err);
  process.exit(1);
});
