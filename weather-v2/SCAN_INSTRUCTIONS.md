# Weather Scanner Instructions

## Steps
1. Run scalper (check exits): `cd /data/.openclaw/workspace/projects/nyx-dashboard/weather-v2 && timeout 60 /usr/bin/node scripts/run-scalper.js 2>&1`
2. Execute scan: `cd /data/.openclaw/workspace/projects/nyx-dashboard/weather-v2 && timeout 300 /usr/bin/node scripts/run-scan.js 2>&1`
3. Read portfolio: `cd /data/.openclaw/workspace/projects/nyx-dashboard/weather-v2 && node -e "const t=require('./trades.json');const open=t.trades.filter(p=>p.status==='open');const closed=t.trades.filter(p=>p.status==='closed');const wins=closed.filter(p=>p.result==='win').length;const losses=closed.filter(p=>p.result==='loss').length;const pnl=closed.reduce((s,p)=>s+(p.pnlUSDC||0),0);const exp=open.reduce((s,p)=>s+(p.sizeUSDC||0),0);console.log(JSON.stringify({open:open.length,openList:open.map(p=>({city:p.city,bucket:p.bucket,side:p.side,date:p.date,entry:p.entryPrice,scalps:p.scalps||[]})),wins,losses,pnl:pnl.toFixed(2),exposure:exp.toFixed(2)}))"`
4. Check circuit breaker: `cd /data/.openclaw/workspace/projects/nyx-dashboard/weather-v2 && node -e "try{const cb=require('./core/circuit-breaker');console.log(JSON.stringify(cb.getStatus()))}catch(e){console.log('not loaded')}"`

## Report Format

🌪️ Weather Scan Complete
Timestamp: [date] @ [time] UTC
Scan time: Xs | Markets evaluated: N

Scalper Actions (if any):
• 💰 [City] [Bucket] — sold [N] shares @ [price]¢ (+$X.XX) [rule name]
• 🛑 [City] [Bucket] — stop-loss exit @ [price]¢ ($-X.XX)
(or omit section if no scalper actions)

Trades Entered:
• [City] [Bucket] [Side] @ [price]¢ | [shares] shares | Edge: [X]% [🎰 if lottery]
(or 'None this scan' if 0)

Candidates Skipped:
• [City] [Bucket] — [reason]
(list all, not just top 3)

Open Positions ([N] total, $[X] exposure):
• [City] [Bucket] [Side] @ [entry]¢ — [date] [note if partially scalped]
(list all open positions)

Portfolio: [W]W/[L]L | Realized P&L: $[X]
Circuit Breaker: OK/TRIPPED
Next scan in 2 hours.
