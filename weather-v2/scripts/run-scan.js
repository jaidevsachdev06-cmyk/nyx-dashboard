#!/usr/bin/env node
/**
 * scripts/run-scan.js — Full scan cycle
 * Fetches forecasts, finds markets, evaluates candidates, enters trades.
 */

const { scan } = require('../stormwatch/scanner');
const { processCandidate } = require('../stormwatch/entry');
const config = require('../config.json');

async function main() {
  console.log(`[run-scan] Starting weather v2 scan | paper=${config.paper} | ${new Date().toISOString()}`);

  const result = await scan();

  console.log(`\n[run-scan] Found ${result.candidates.length} candidates, ${result.passing.length} pass threshold`);

  if (result.passing.length === 0) {
    console.log('[run-scan] No actionable candidates. Done.');
    return { scanned: result.candidates.length, entered: 0 };
  }

  // Enter trades for passing candidates
  let entered = 0;
  for (const candidate of result.passing) {
    try {
      const res = await processCandidate(candidate);
      if (res.entered) entered++;
      else console.log(`[run-scan] Skipped: ${res.reason}`);
    } catch (err) {
      console.error(`[run-scan] Error processing candidate: ${err.message}`);
    }
  }

  console.log(`\n[run-scan] Complete: ${entered} trades entered out of ${result.passing.length} candidates`);
  return { scanned: result.candidates.length, passing: result.passing.length, entered };
}

main().then(r => {
  console.log('\n' + JSON.stringify(r, null, 2));
}).catch(err => {
  console.error('[run-scan] Fatal:', err);
  process.exit(1);
});
