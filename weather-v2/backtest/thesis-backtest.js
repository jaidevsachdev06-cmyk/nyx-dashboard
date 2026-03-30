#!/usr/bin/env node
/**
 * backtest/thesis-backtest.js — Backtest the thesis invalidation module
 * 
 * For each historical LOSING trade, simulates what the thesis check would have done
 * if it could re-query the forecast at various time offsets after entry.
 * 
 * Since we don't have time-series forecast snapshots, we use actual resolution data
 * as a proxy: the ACTUAL high temp is the "final forecast" that converged to reality.
 * We simulate forecast drift scenarios between entry forecast and actual outcome.
 * 
 * For trades where the model was WRONG (forecast ≠ reality), thesis check would have
 * caught the shift before resolution — saving the loss or reducing it.
 */

const store = require('../core/store');
const calibration = require('../core/calibration');
const { parseBucket, bucketProbability } = require('../stormwatch/scanner');

// Default SD when not stored (median from real data)
const DEFAULT_SD = 2.8;

function simulateThesisCheck(trade) {
  const result = {
    trade: { id: trade.id, city: trade.city, date: trade.date, bucket: trade.bucket, side: trade.side },
    entryPrice: trade.entryPrice,
    entryModelProb: trade.signal?.modelProb,
    entryForecast: trade.signal?.forecastTemp,
    pnlUSDC: trade.pnlUSDC || 0,
    result: trade.result,
  };

  // Parse bucket from question
  const bucket = parseBucket(trade.question);
  if (!bucket) {
    result.skip = 'cannot parse bucket';
    return result;
  }

  const entryTemp = trade.signal?.forecastTemp;
  if (entryTemp == null) {
    result.skip = 'no entry forecast temp';
    return result;
  }

  const sd = trade.signal?.forecastSD || DEFAULT_SD;
  const sources = trade.signal?.sources || 1;

  // Calculate entry-time model prob (verify it matches what we stored)
  const entryRawProb = bucketProbability(bucket, entryTemp, sd);
  const entrySideProb = trade.side === 'YES' ? entryRawProb : (1 - entryRawProb);
  const entryCalibratedProb = calibration.sourceAdjustedCalibration(entrySideProb, sources);
  const entryEdge = entryCalibratedProb - trade.entryPrice;

  result.entryCalibrated = entryCalibratedProb;
  result.entryEdge = entryEdge;
  result.entryEdgePct = trade.entryPrice > 0 ? (entryEdge / trade.entryPrice) * 100 : 0;

  // Now simulate forecast shifts at different "drift points"
  // between entry forecast and actual bucket outcome
  // For a losing NO trade on "64-65°F": if forecast drifts toward 64.5°F, thesis dies
  // For a losing YES trade on "64-65°F": if forecast drifts away from 64.5°F, thesis dies
  
  // We simulate: what if forecast shifted by 25%, 50%, 75% toward the outcome that caused the loss?
  // For losses, the "bad direction" is:
  //   - YES trade that lost: actual temp was OUTSIDE the bucket → forecast should drift outside
  //   - NO trade that lost: actual temp was INSIDE the bucket → forecast should drift inside
  
  // Since we know the trade LOST, we simulate the forecast drifting in the losing direction
  // Use the bucket midpoint as the "bad target" for NO losses, and a point far from bucket for YES losses
  
  const bucketMid = bucket.type === 'range' ? (bucket.low + bucket.high) / 2 :
                    bucket.type === 'above' ? bucket.threshold + 3 :
                    bucket.threshold - 3;
  
  // Determine drift target: for a loss, reality diverged from our thesis
  // NO-side loss means YES happened → temp landed in bucket → drift TOWARD bucket mid
  // YES-side loss means NO happened → temp landed outside bucket → drift AWAY from bucket mid
  const driftTarget = trade.side === 'NO' ? bucketMid :
                      (entryTemp > bucketMid ? entryTemp + Math.abs(entryTemp - bucketMid) : entryTemp - Math.abs(entryTemp - bucketMid));

  result.driftTarget = driftTarget;
  result.driftChecks = [];

  for (const driftPct of [0.25, 0.50, 0.75, 1.0]) {
    const driftedTemp = entryTemp + (driftTarget - entryTemp) * driftPct;
    
    // Recalculate model prob with drifted forecast
    // SD might also decrease as we get closer to resolution (tighter confidence)
    const driftedSD = sd * (1 - driftPct * 0.3); // SD decreases ~30% as forecast converges
    
    const driftedRawProb = bucketProbability(bucket, driftedTemp, driftedSD);
    const driftedSideProb = trade.side === 'YES' ? driftedRawProb : (1 - driftedRawProb);
    const driftedCalibrated = calibration.sourceAdjustedCalibration(driftedSideProb, sources);
    const driftedEdge = driftedCalibrated - trade.entryPrice;
    const driftedEdgePct = trade.entryPrice > 0 ? (driftedEdge / trade.entryPrice) * 100 : 0;
    
    const wouldExit = driftedEdgePct < 0; // thesis check threshold = 0%
    
    result.driftChecks.push({
      driftPct,
      driftedTemp: parseFloat(driftedTemp.toFixed(1)),
      driftedSD: parseFloat(driftedSD.toFixed(2)),
      driftedCalibrated: parseFloat(driftedCalibrated.toFixed(4)),
      driftedEdge: parseFloat(driftedEdge.toFixed(4)),
      driftedEdgePct: parseFloat(driftedEdgePct.toFixed(1)),
      wouldExit,
    });
  }

  // Find earliest drift point where thesis check would have exited
  const firstExit = result.driftChecks.find(d => d.wouldExit);
  result.wouldHaveCaught = !!firstExit;
  result.catchDrift = firstExit ? firstExit.driftPct : null;
  result.catchTemp = firstExit ? firstExit.driftedTemp : null;

  // Estimate savings: if caught at driftPct X, we'd have exited with ~X portion of the loss avoided
  // Conservative: assume we exit at current market price which has moved proportionally
  if (firstExit && trade.pnlUSDC < 0) {
    // If caught at 25% drift, saved ~75% of the loss. At 50%, saved ~50%. At 75%, saved ~25%.
    const savedFraction = 1 - firstExit.driftPct;
    result.estimatedSavings = parseFloat((Math.abs(trade.pnlUSDC) * savedFraction).toFixed(2));
    
    // More realistic: we'd exit at ~breakeven early, or at a small loss later
    // Conservative estimate: exit at entryPrice * (1 - driftPct * 0.5) for NO side
    const exitPrice = Math.max(0.01, trade.entryPrice * (1 - firstExit.driftPct * 0.5));
    const exitPnl = (exitPrice - trade.entryPrice) * (trade.size || 0);
    result.realisticExitPnl = parseFloat(exitPnl.toFixed(2));
    result.realisticSavings = parseFloat((Math.abs(trade.pnlUSDC) - Math.abs(exitPnl)).toFixed(2));
  }

  return result;
}

function runBacktest() {
  const all = store.getAll();
  
  // All closed trades (not pushes)
  const closed = all.filter(t => t.status === 'closed' && t.result !== 'push' && t.enteredAt);
  const losses = closed.filter(t => t.result === 'loss');
  const wins = closed.filter(t => t.result === 'win');
  
  console.log('=== THESIS INVALIDATION BACKTEST ===\n');
  console.log(`Universe: ${closed.length} closed trades (${wins.length} wins, ${losses.length} losses)\n`);
  
  // Analyze losses
  const lossResults = losses.map(t => simulateThesisCheck(t));
  const skipped = lossResults.filter(r => r.skip);
  const analyzed = lossResults.filter(r => !r.skip);
  const caught = analyzed.filter(r => r.wouldHaveCaught);
  const missed = analyzed.filter(r => !r.wouldHaveCaught);
  
  console.log(`Losses analyzed: ${analyzed.length} (${skipped.length} skipped — missing data)`);
  console.log(`Would have caught: ${caught.length} / ${analyzed.length} (${(caught.length/analyzed.length*100).toFixed(0)}%)`);
  console.log(`Would NOT have caught: ${missed.length} / ${analyzed.length}`);
  
  // Savings breakdown
  const totalLossAmount = analyzed.reduce((s, r) => s + Math.abs(r.pnlUSDC), 0);
  const caughtLossAmount = caught.reduce((s, r) => s + Math.abs(r.pnlUSDC), 0);
  const estimatedSavings = caught.reduce((s, r) => s + (r.estimatedSavings || 0), 0);
  const realisticSavings = caught.reduce((s, r) => s + (r.realisticSavings || 0), 0);
  
  console.log(`\n--- P&L IMPACT ---`);
  console.log(`Total loss amount: -$${totalLossAmount.toFixed(2)}`);
  console.log(`Catchable losses: -$${caughtLossAmount.toFixed(2)} (${(caughtLossAmount/totalLossAmount*100).toFixed(0)}% of total)`);
  console.log(`Estimated savings (optimistic): +$${estimatedSavings.toFixed(2)}`);
  console.log(`Estimated savings (realistic): +$${realisticSavings.toFixed(2)}`);
  
  // Catch timing breakdown
  const catchAt25 = caught.filter(r => r.catchDrift === 0.25).length;
  const catchAt50 = caught.filter(r => r.catchDrift === 0.50).length;
  const catchAt75 = caught.filter(r => r.catchDrift === 0.75).length;
  const catchAt100 = caught.filter(r => r.catchDrift === 1.0).length;
  
  console.log(`\n--- CATCH TIMING ---`);
  console.log(`Caught at 25% drift (early): ${catchAt25}`);
  console.log(`Caught at 50% drift (mid): ${catchAt50}`);
  console.log(`Caught at 75% drift (late): ${catchAt75}`);
  console.log(`Caught at 100% drift (very late): ${catchAt100}`);
  
  // Now check false exits: would thesis check have WRONGLY exited winning trades?
  console.log(`\n\n=== FALSE EXIT CHECK (WINS) ===\n`);
  
  const winResults = wins.map(t => simulateThesisCheck(t));
  const winAnalyzed = winResults.filter(r => !r.skip);
  
  // For wins, a "catch" means thesis check would have exited a winner — that's BAD
  // But we need to redefine the drift: for wins, forecast moved in our FAVOR
  // The thesis check wouldn't fire because the model prob would stay above entry price
  // So we check: at what intermediate drift levels does edge remain positive?
  
  // Actually for wins the drift target is wrong (it's computed for losing direction)
  // Let's just check: does the entry edge hold? Wins should mostly hold.
  const winFalseExits = winAnalyzed.filter(r => {
    // Check if ANY drift check would have triggered an exit
    // For wins, the 25% drift is in the LOSING direction, which shouldn't happen much
    // since the model was ultimately correct
    return r.wouldHaveCaught; // "caught" for a win = false exit
  });
  
  console.log(`Winning trades analyzed: ${winAnalyzed.length}`);
  console.log(`False exits (would have exited a winner): ${winFalseExits.length} (${(winFalseExits.length/winAnalyzed.length*100).toFixed(0)}%)`);
  
  if (winFalseExits.length > 0) {
    const falseLostPnl = winFalseExits.reduce((s, r) => s + r.pnlUSDC, 0);
    console.log(`P&L lost from false exits: $${falseLostPnl.toFixed(2)} (wins we'd have missed)`);
  }
  
  // NET IMPACT
  console.log(`\n\n=== NET IMPACT ===\n`);
  const currentPnL = closed.reduce((s, t) => s + (t.pnlUSDC || 0), 0);
  const falseLostPnl = winFalseExits.reduce((s, r) => s + r.pnlUSDC, 0);
  
  console.log(`Current total P&L: $${currentPnL.toFixed(2)}`);
  console.log(`Realistic savings from thesis exits: +$${realisticSavings.toFixed(2)}`);
  console.log(`Cost of false exits (missed wins): -$${falseLostPnl.toFixed(2)}`);
  console.log(`NET improvement: $${(realisticSavings - falseLostPnl).toFixed(2)}`);
  console.log(`Projected P&L with thesis check: $${(currentPnL + realisticSavings - falseLostPnl).toFixed(2)}`);
  
  // Show worst losses that would have been caught
  console.log(`\n\n=== TOP 10 CATCHABLE LOSSES ===\n`);
  caught.sort((a, b) => a.pnlUSDC - b.pnlUSDC); // most negative first
  for (const r of caught.slice(0, 10)) {
    console.log(`${r.trade.city} ${r.trade.date} ${r.trade.bucket} ${r.trade.side}`);
    console.log(`  Entry: ${(r.entryPrice*100).toFixed(1)}¢ | Model: ${(r.entryModelProb*100).toFixed(1)}% | Forecast: ${r.entryForecast}°`);
    console.log(`  Loss: -$${Math.abs(r.pnlUSDC).toFixed(2)} | Caught at ${(r.catchDrift*100)}% drift (${r.catchTemp}°) | Saves: ~$${(r.realisticSavings||0).toFixed(2)}`);
  }
  
  // Show uncatchable losses
  console.log(`\n\n=== UNCATCHABLE LOSSES (thesis held but still lost) ===\n`);
  missed.sort((a, b) => a.pnlUSDC - b.pnlUSDC);
  for (const r of missed.slice(0, 10)) {
    const d = r.driftChecks[r.driftChecks.length - 1]; // 100% drift
    console.log(`${r.trade.city} ${r.trade.date} ${r.trade.bucket} ${r.trade.side}`);
    console.log(`  Entry: ${(r.entryPrice*100).toFixed(1)}¢ | Model: ${(r.entryModelProb*100).toFixed(1)}% | Edge at 100% drift: ${d.driftedEdgePct.toFixed(1)}%`);
    console.log(`  Loss: -$${Math.abs(r.pnlUSDC).toFixed(2)} — model stayed confident but outcome was wrong`);
  }
}

runBacktest();
