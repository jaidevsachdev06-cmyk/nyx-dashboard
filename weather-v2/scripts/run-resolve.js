#!/usr/bin/env node
/**
 * scripts/run-resolve.js — Check all open trades for resolution
 */

const { observe } = require('../stormwatch/observer');

async function main() {
  console.log(`[run-resolve] Starting resolution check | ${new Date().toISOString()}`);
  const result = await observe();
  console.log(`\n[run-resolve] Complete:`, JSON.stringify(result, null, 2));
  return result;
}

main().catch(err => {
  console.error('[run-resolve] Fatal:', err);
  process.exit(1);
});
