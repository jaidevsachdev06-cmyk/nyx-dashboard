#!/usr/bin/env node
/**
 * backtest/thesis-backtest-v3.js — Test multiple exit thresholds to find optimal
 */

const store = require('../core/store');
const calibration = require('../core/calibration');
const { parseBucket, bucketProbability } = require('../stormwatch/scanner');

const DEFAULT_SD = 2.8;

function calcEdge(trade, forecastTemp, sd) {
  const bucket = parseBucket(trade.question);
  if (!bucket) return null;
  const sources = trade.signal?.sources || 1;
  const rawProb = bucketProbability(bucket, forecastTemp, sd);
  const sideProb = trade.side === 'YES' ? rawProb : (1 - rawProb);
  const calibrated = calibration.sourceAdjustedCalibration(sideProb, sources);
  const edge = calibrated - trade.entryPrice;
  const edgePct = trade.entryPrice > 0 ? (edge / trade.entryPrice) * 100 : 0;
  return { calibrated, edge, edgePct };
}

function testThreshold(losses, wins, threshold) {
  let caught = 0, savings = 0, catchableLoss = 0;
  let falseExits = 0, falsePnlLost = 0;

  for (const trade of losses) {
    const entryTemp = trade.signal?.forecastTemp;
    if (entryTemp == null) continue;
    const sd = trade.signal?.forecastSD || DEFAULT_SD;
    const bucket = parseBucket(trade.question);
    if (!bucket) continue;

    const bucketMid = bucket.type === 'range' ? (bucket.low + bucket.high) / 2 :
                      bucket.type === 'above' ? bucket.threshold + 3 : bucket.threshold - 3;
    const badTarget = trade.side === 'NO' ? bucketMid :
      (entryTemp > bucketMid ? entryTemp + 5 : entryTemp - 5);

    for (const driftPct of [0.25, 0.50, 0.75, 1.0]) {
      const driftedTemp = entryTemp + (badTarget - entryTemp) * driftPct;
      const driftedSD = sd * (1 - driftPct * 0.2);
      const e = calcEdge(trade, driftedTemp, driftedSD);
      if (!e) continue;

      if (e.edgePct < threshold) {
        caught++;
        const loss = Math.abs(trade.pnlUSDC || 0);
        catchableLoss += loss;
        const haircut = trade.entryPrice * driftPct * 0.3;
        const exitPrice = Math.max(0.01, trade.entryPrice - haircut);
        const exitPnl = Math.abs((exitPrice - trade.entryPrice) * (trade.size || 0));
        savings += (loss - exitPnl);
        break; // only count first catch
      }
    }
  }

  // False exits: ±0.5σ and ±1σ noise (realistic)
  for (const trade of wins) {
    const entryTemp = trade.signal?.forecastTemp;
    if (entryTemp == null) continue;
    const sd = trade.signal?.forecastSD || DEFAULT_SD;
    const bucket = parseBucket(trade.question);
    if (!bucket) continue;

    const bucketMid = bucket.type === 'range' ? (bucket.low + bucket.high) / 2 :
                      bucket.type === 'above' ? bucket.threshold + 3 : bucket.threshold - 3;
    const badDir = trade.side === 'NO' ?
      (entryTemp < bucketMid ? 1 : -1) :
      (entryTemp > bucketMid ? 1 : -1);

    let hit = false;
    for (const mult of [0.5, 1.0]) { // realistic noise levels only
      const noisedTemp = entryTemp + badDir * sd * mult;
      const e = calcEdge(trade, noisedTemp, sd);
      if (!e) continue;
      if (e.edgePct < threshold) {
        falseExits++;
        falsePnlLost += trade.pnlUSDC || 0;
        hit = true;
        break;
      }
    }
  }

  // 50% probability discount on false exits
  const adjustedFalseCost = falsePnlLost * 0.5;

  return {
    threshold,
    caught,
    savings: parseFloat(savings.toFixed(2)),
    catchableLoss: parseFloat(catchableLoss.toFixed(2)),
    falseExits,
    falsePnlLost: parseFloat(falsePnlLost.toFixed(2)),
    adjustedFalseCost: parseFloat(adjustedFalseCost.toFixed(2)),
    net: parseFloat((savings - adjustedFalseCost).toFixed(2)),
  };
}

function run() {
  const all = store.getAll();
  const closed = all.filter(t => t.status === 'closed' && t.result !== 'push' && t.enteredAt);
  const losses = closed.filter(t => t.result === 'loss');
  const wins = closed.filter(t => t.result === 'win');
  const currentPnL = closed.reduce((s,t) => s + (t.pnlUSDC||0), 0);

  console.log('=== THESIS CHECK THRESHOLD OPTIMIZATION ===\n');
  console.log(`Universe: ${closed.length} trades (${wins.length}W / ${losses.length}L) | Current P&L: $${currentPnL.toFixed(2)}\n`);

  const thresholds = [0, -5, -10, -15, -20, -25, -30];

  console.log(`${'Threshold'.padEnd(12)} ${'Catches'.padEnd(10)} ${'Savings'.padEnd(12)} ${'FalseExit'.padEnd(12)} ${'FalseCost'.padEnd(12)} ${'NET'.padEnd(12)} ${'Projected'}`);
  console.log('─'.repeat(90));

  for (const th of thresholds) {
    const r = testThreshold(losses, wins, th);
    const proj = currentPnL + r.net;
    const bar = r.net > 0 ? '█'.repeat(Math.min(20, Math.round(r.net / 10))) : '░'.repeat(Math.min(20, Math.round(Math.abs(r.net) / 10)));
    console.log(
      `${(th + '%').padEnd(12)} ${(r.caught + '/' + losses.length).padEnd(10)} +$${r.savings.toFixed(0).padEnd(9)} ${(r.falseExits + '/' + wins.length).padEnd(12)} -$${r.adjustedFalseCost.toFixed(0).padEnd(9)} ${(r.net >= 0 ? '+' : '') + '$' + r.net.toFixed(0).padEnd(8)} $${proj.toFixed(0).padStart(6)} ${bar}`
    );
  }

  console.log('\n💡 Higher (less negative) threshold = more aggressive exits (catches more losses but more false exits)');
  console.log('💡 Lower (more negative) threshold = more conservative (fewer false exits but misses some losses)');
  console.log('\nRecommended: -10% to -15% balances savings vs false exit cost\n');

  // Also check: V3 filter era vs pre-V3 (since March ~20th most blacklists were active)
  const cutoff = new Date('2026-03-10').getTime();
  const v3Losses = losses.filter(t => new Date(t.enteredAt).getTime() > cutoff);
  const v3Wins = wins.filter(t => new Date(t.enteredAt).getTime() > cutoff);
  
  if (v3Losses.length > 0) {
    console.log('─'.repeat(60));
    console.log(`\nV3 ERA ONLY (after March 10): ${v3Wins.length}W / ${v3Losses.length}L\n`);
    
    for (const th of [-5, -10, -15]) {
      const r = testThreshold(v3Losses, v3Wins, th);
      console.log(`  ${th}%: catches ${r.caught}/${v3Losses.length} losses (+$${r.savings.toFixed(0)}) | false exits: ${r.falseExits}/${v3Wins.length} (-$${r.adjustedFalseCost.toFixed(0)}) | net: $${r.net.toFixed(0)}`);
    }
  }
}

run();
