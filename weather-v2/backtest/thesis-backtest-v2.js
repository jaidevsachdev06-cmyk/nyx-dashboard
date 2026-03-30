#!/usr/bin/env node
/**
 * backtest/thesis-backtest-v2.js — Corrected backtest methodology
 * 
 * V1 was biased: it simulated adversarial drift for ALL trades (wins too).
 * In reality, winning trades' forecasts tend to CONFIRM the thesis over time.
 * 
 * V2 methodology:
 * - LOSSES: Simulate forecast drift toward the bad outcome (what actually happened)
 * - WINS: Check sensitivity — how much random noise would it take to trigger a false exit?
 *         Use realistic ±SD noise, not adversarial drift toward bucket center.
 * 
 * Also separates the analysis by edge quality tiers to understand WHERE thesis check helps most.
 */

const store = require('../core/store');
const calibration = require('../core/calibration');
const { parseBucket, bucketProbability } = require('../stormwatch/scanner');

const DEFAULT_SD = 2.8;

/**
 * Calculate model edge for a given forecast temperature and trade setup.
 */
function calcEdge(trade, forecastTemp, sd) {
  const bucket = parseBucket(trade.question);
  if (!bucket) return null;
  
  const sources = trade.signal?.sources || 1;
  const rawProb = bucketProbability(bucket, forecastTemp, sd);
  const sideProb = trade.side === 'YES' ? rawProb : (1 - rawProb);
  const calibrated = calibration.sourceAdjustedCalibration(sideProb, sources);
  const edge = calibrated - trade.entryPrice;
  const edgePct = trade.entryPrice > 0 ? (edge / trade.entryPrice) * 100 : 0;
  
  return { calibrated, edge, edgePct, rawProb, sideProb };
}

/**
 * For LOSSES: simulate forecast drifting toward bad outcome
 */
function analyzeLoss(trade) {
  const entryTemp = trade.signal?.forecastTemp;
  if (entryTemp == null) return { skip: 'no forecast temp' };
  
  const sd = trade.signal?.forecastSD || DEFAULT_SD;
  const bucket = parseBucket(trade.question);
  if (!bucket) return { skip: 'cannot parse bucket' };

  const entryEdge = calcEdge(trade, entryTemp, sd);
  if (!entryEdge) return { skip: 'calc failed' };

  // Determine the "bad direction" for this trade
  const bucketMid = bucket.type === 'range' ? (bucket.low + bucket.high) / 2 :
                    bucket.type === 'above' ? bucket.threshold + 3 :
                    bucket.threshold - 3;

  // For NO-loss: temp drifted INTO bucket. For YES-loss: temp drifted AWAY from bucket.
  const badTarget = trade.side === 'NO' ? bucketMid :
    (entryTemp > bucketMid ? entryTemp + 5 : entryTemp - 5);

  const result = {
    id: trade.id, city: trade.city, date: trade.date, bucket: trade.bucket, side: trade.side,
    entryPrice: trade.entryPrice, pnlUSDC: trade.pnlUSDC || 0,
    entryModelProb: trade.signal?.modelProb,
    entryEdgePct: entryEdge.edgePct,
    entryForecast: entryTemp,
  };

  // Check at each drift level
  for (const driftPct of [0.25, 0.50, 0.75, 1.0]) {
    const driftedTemp = entryTemp + (badTarget - entryTemp) * driftPct;
    const driftedSD = sd * (1 - driftPct * 0.2); // slight tightening
    const e = calcEdge(trade, driftedTemp, driftedSD);
    if (!e) continue;
    
    if (e.edgePct < 0 && !result.caught) {
      result.caught = true;
      result.catchDrift = driftPct;
      result.catchTemp = parseFloat(driftedTemp.toFixed(1));
      result.edgeAtCatch = parseFloat(e.edgePct.toFixed(1));
    }
  }

  // Estimate savings if caught
  if (result.caught && trade.pnlUSDC < 0) {
    // At N% drift, market has moved roughly N*0.5 of the way against us
    // Conservative: we sell at entry - driftPct*30% of entry value
    const priceHaircut = trade.entryPrice * result.catchDrift * 0.3;
    const exitPrice = Math.max(0.01, trade.entryPrice - priceHaircut);
    const exitPnl = (exitPrice - trade.entryPrice) * (trade.size || 0);
    result.exitPnl = parseFloat(exitPnl.toFixed(2)); // small loss from early exit
    result.savings = parseFloat((Math.abs(trade.pnlUSDC) - Math.abs(exitPnl)).toFixed(2));
  }

  return result;
}

/**
 * For WINS: check if realistic forecast noise would trigger false exits.
 * 
 * Method: Add Gaussian noise at ±0.5σ, ±1σ, ±1.5σ, ±2σ in the BAD direction.
 * These represent realistic forecast update magnitudes.
 * If small noise (±0.5σ) kills the edge → fragile entry, high false-exit risk.
 * If only large noise (±2σ) kills it → robust entry, low false-exit risk.
 */
function analyzeWin(trade) {
  const entryTemp = trade.signal?.forecastTemp;
  if (entryTemp == null) return { skip: 'no forecast temp' };

  const sd = trade.signal?.forecastSD || DEFAULT_SD;
  const bucket = parseBucket(trade.question);
  if (!bucket) return { skip: 'cannot parse bucket' };

  const entryEdge = calcEdge(trade, entryTemp, sd);
  if (!entryEdge) return { skip: 'calc failed' };

  const bucketMid = bucket.type === 'range' ? (bucket.low + bucket.high) / 2 :
                    bucket.type === 'above' ? bucket.threshold + 3 :
                    bucket.threshold - 3;

  // "Bad direction" for noise: toward bucket for NO, away for YES
  const badDirection = trade.side === 'NO' ? 
    (entryTemp < bucketMid ? 1 : -1) :  // push toward bucket center
    (entryTemp > bucketMid ? 1 : -1);    // push away from bucket center

  const result = {
    id: trade.id, city: trade.city, date: trade.date, bucket: trade.bucket, side: trade.side,
    entryPrice: trade.entryPrice, pnlUSDC: trade.pnlUSDC || 0,
    entryModelProb: trade.signal?.modelProb,
    entryEdgePct: entryEdge.edgePct,
    entryForecast: entryTemp,
    falseExit: false,
    falseExitNoise: null,
  };

  // Test noise levels: 0.5σ, 1σ, 1.5σ, 2σ
  for (const noiseMult of [0.5, 1.0, 1.5, 2.0]) {
    const noisedTemp = entryTemp + badDirection * sd * noiseMult;
    const e = calcEdge(trade, noisedTemp, sd);
    if (!e) continue;

    if (e.edgePct < 0 && !result.falseExit) {
      result.falseExit = true;
      result.falseExitNoise = noiseMult;
      result.edgeAtNoise = parseFloat(e.edgePct.toFixed(1));
    }
  }

  return result;
}

function runBacktest() {
  const all = store.getAll();
  const closed = all.filter(t => t.status === 'closed' && t.result !== 'push' && t.enteredAt);
  const losses = closed.filter(t => t.result === 'loss');
  const wins = closed.filter(t => t.result === 'win');

  console.log('=== THESIS INVALIDATION BACKTEST V2 (Corrected) ===\n');
  console.log(`Universe: ${closed.length} trades (${wins.length}W / ${losses.length}L)`);
  console.log(`Current P&L: $${closed.reduce((s,t) => s + (t.pnlUSDC||0), 0).toFixed(2)}\n`);

  // === LOSS ANALYSIS ===
  console.log('─'.repeat(60));
  console.log('LOSS ANALYSIS: Would thesis check have saved us?\n');
  
  const lossResults = losses.map(t => analyzeLoss(t));
  const lossAnalyzed = lossResults.filter(r => !r.skip);
  const lossCaught = lossAnalyzed.filter(r => r.caught);
  const lossMissed = lossAnalyzed.filter(r => !r.caught);

  console.log(`Analyzed: ${lossAnalyzed.length} losses`);
  console.log(`Catchable: ${lossCaught.length} (${(lossCaught.length/lossAnalyzed.length*100).toFixed(0)}%)`);
  console.log(`Uncatchable: ${lossMissed.length} (model stayed confident, reality surprised us)\n`);

  const totalLoss = lossAnalyzed.reduce((s,r) => s + Math.abs(r.pnlUSDC), 0);
  const catchableLoss = lossCaught.reduce((s,r) => s + Math.abs(r.pnlUSDC), 0);
  const totalSavings = lossCaught.reduce((s,r) => s + (r.savings || 0), 0);
  const totalExitCost = lossCaught.reduce((s,r) => s + Math.abs(r.exitPnl || 0), 0);

  console.log(`Total losses: -$${totalLoss.toFixed(2)}`);
  console.log(`Catchable losses: -$${catchableLoss.toFixed(2)}`);
  console.log(`Savings from early exit: +$${totalSavings.toFixed(2)}`);
  console.log(`Cost of early exit (slippage): -$${totalExitCost.toFixed(2)}`);

  // Catch timing
  const earlyCount = lossCaught.filter(r => r.catchDrift <= 0.25).length;
  const midCount = lossCaught.filter(r => r.catchDrift > 0.25 && r.catchDrift <= 0.5).length;
  const lateCount = lossCaught.filter(r => r.catchDrift > 0.5).length;
  console.log(`\nCatch timing: ${earlyCount} early (≤25%), ${midCount} mid (25-50%), ${lateCount} late (>50%)`);

  // === WIN ANALYSIS (FALSE EXITS) ===
  console.log('\n' + '─'.repeat(60));
  console.log('WIN ANALYSIS: Would thesis check have false-exited winners?\n');

  const winResults = wins.map(t => analyzeWin(t));
  const winAnalyzed = winResults.filter(r => !r.skip);
  const falsExits = winAnalyzed.filter(r => r.falseExit);

  console.log(`Analyzed: ${winAnalyzed.length} wins`);
  console.log(`Vulnerable to false exit: ${falsExits.length} (${(falsExits.length/winAnalyzed.length*100).toFixed(0)}%)\n`);

  // Break down by noise level
  const at05 = falsExits.filter(r => r.falseExitNoise === 0.5).length;
  const at10 = falsExits.filter(r => r.falseExitNoise === 1.0).length;
  const at15 = falsExits.filter(r => r.falseExitNoise === 1.5).length;
  const at20 = falsExits.filter(r => r.falseExitNoise === 2.0).length;

  console.log(`Noise sensitivity:`);
  console.log(`  ±0.5σ kills edge: ${at05} trades — these are FRAGILE entries (thin edge)`);
  console.log(`  ±1.0σ kills edge: ${at10} trades — moderate sensitivity`);
  console.log(`  ±1.5σ kills edge: ${at15} trades — reasonable, unlikely in practice`);
  console.log(`  ±2.0σ kills edge: ${at20} trades — very robust entries`);
  console.log(`  Immune (>2σ): ${winAnalyzed.length - falsExits.length} trades\n`);

  // Realistic false exit rate: forecast updates between scans typically move ±0.5-1σ
  // So only the ±0.5σ and ±1σ groups are real risks
  const realisticFalseExits = falsExits.filter(r => r.falseExitNoise <= 1.0);
  const realisticFalsePnl = realisticFalseExits.reduce((s,r) => s + r.pnlUSDC, 0);

  console.log(`Realistic false exits (≤1σ noise): ${realisticFalseExits.length} (${(realisticFalseExits.length/winAnalyzed.length*100).toFixed(0)}%)`);
  console.log(`P&L at risk from false exits: $${realisticFalsePnl.toFixed(2)}`);

  // === NET IMPACT ===
  console.log('\n' + '─'.repeat(60));
  console.log('NET IMPACT ESTIMATE\n');

  const currentPnL = closed.reduce((s,t) => s + (t.pnlUSDC||0), 0);
  
  // Conservative: assume 50% of "realistic false exits" actually get triggered
  // (forecast doesn't always move in the worst direction)
  const expectedFalseLoss = realisticFalsePnl * 0.5;

  console.log(`Current P&L:                    $${currentPnL.toFixed(2)}`);
  console.log(`+ Savings from thesis exits:     +$${totalSavings.toFixed(2)}`);
  console.log(`- Expected false exit cost:       -$${expectedFalseLoss.toFixed(2)}`);
  console.log(`                                ─────────`);
  console.log(`Projected P&L with thesis check: $${(currentPnL + totalSavings - expectedFalseLoss).toFixed(2)}`);
  console.log(`Net improvement:                 $${(totalSavings - expectedFalseLoss).toFixed(2)}`);

  // === EDGE TIER BREAKDOWN ===
  console.log('\n' + '─'.repeat(60));
  console.log('EDGE TIER ANALYSIS\n');

  const tiers = [
    { label: '0-10% edge', min: 0, max: 10 },
    { label: '10-20% edge', min: 10, max: 20 },
    { label: '20-30% edge', min: 20, max: 30 },
    { label: '30%+ edge', min: 30, max: 999 },
  ];

  for (const tier of tiers) {
    const tierLosses = lossAnalyzed.filter(r => r.entryEdgePct >= tier.min && r.entryEdgePct < tier.max);
    const tierWins = winAnalyzed.filter(r => r.entryEdgePct >= tier.min && r.entryEdgePct < tier.max);
    const tierCaught = tierLosses.filter(r => r.caught);
    const tierFalse = tierWins.filter(r => r.falseExit && r.falseExitNoise <= 1.0);
    
    console.log(`${tier.label}:`);
    console.log(`  ${tierLosses.length}L / ${tierWins.length}W | Caught: ${tierCaught.length}/${tierLosses.length} | False exits: ${tierFalse.length}/${tierWins.length}`);
    if (tierLosses.length + tierWins.length > 0) {
      const tierSave = tierCaught.reduce((s,r) => s + (r.savings||0), 0);
      const tierCost = tierFalse.reduce((s,r) => s + r.pnlUSDC, 0) * 0.5;
      console.log(`  Saves: +$${tierSave.toFixed(2)} | Costs: -$${tierCost.toFixed(2)} | Net: $${(tierSave - tierCost).toFixed(2)}`);
    }
  }
}

runBacktest();
