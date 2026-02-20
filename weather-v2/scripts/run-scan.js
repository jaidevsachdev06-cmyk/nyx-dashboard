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

  // Sort by edge descending — best trades enter first, spreads across cities
  result.passing.sort((a, b) => (b.edge || 0) - (a.edge || 0));

  // Cap max edge to filter illiquid garbage (>500% usually means 3¢ market)
  result.passing = result.passing.filter(c => (c.edge || 0) <= 5.0);

  console.log(`[run-scan] After sorting & filtering: ${result.passing.length} candidates (top 5: ${result.passing.slice(0,5).map(c => `${c.city} ${c.bucket} ${(c.edge*100).toFixed(0)}%`).join(', ')})`);

  // Enter trades for passing candidates (stop when position cap hit)
  let entered = 0;
  let capHit = false;
  for (const candidate of result.passing) {
    if (capHit) break;
    try {
      const res = await processCandidate(candidate);
      if (res.entered) entered++;
      else {
        console.log(`[run-scan] Skipped: ${res.reason}`);
        if (res.reason?.includes('Risk limit: max')) { capHit = true; console.log('[run-scan] Position cap reached, stopping entries.'); }
      }
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
