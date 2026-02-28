# Weather Scanner Instructions

## Steps
1. Execute: `cd /data/.openclaw/workspace/projects/nyx-dashboard/weather-v2 && /usr/bin/node scripts/run-scan.js 2>&1`
2. Read portfolio: `cd /data/.openclaw/workspace/projects/nyx-dashboard/weather-v2 && node -e "const t=require('./trades.json');const open=t.trades.filter(p=>p.status==='open');const closed=t.trades.filter(p=>p.status==='closed');const wins=closed.filter(p=>p.result==='win').length;const losses=closed.filter(p=>p.result==='loss').length;const pnl=closed.reduce((s,p)=>s+(p.pnlUSDC||0),0);const exp=open.reduce((s,p)=>s+(p.sizeUSDC||0),0);console.log(JSON.stringify({open:open.length,openList:open.map(p=>({city:p.city,bucket:p.bucket,side:p.side,date:p.date,entry:p.entryPrice})),wins,losses,pnl:pnl.toFixed(2),exposure:exp.toFixed(2)}))"`
3. Check circuit breaker: `cd /data/.openclaw/workspace/projects/nyx-dashboard/weather-v2 && node -e "try{const cb=require('./core/circuit-breaker');console.log(JSON.stringify(cb.getStatus()))}catch(e){console.log('not loaded')}"`

## Report Format

🌪️ Weather Scan Complete
Timestamp: [date] @ [time] UTC
Scan time: Xs | Markets evaluated: N

Trades Entered:
• [City] [Bucket] [Side] @ [price]¢ | [shares] shares | Edge: [X]% [🎰 if lottery]
(or 'None this scan' if 0)

Candidates Skipped:
• [City] [Bucket] — [reason]
(list all, not just top 3)

Open Positions ([N] total, $[X] exposure):
• [City] [Bucket] [Side] @ [entry]¢ — [date]
(list all open positions)

Portfolio: [W]W/[L]L | Realized P&L: $[X]
Circuit Breaker: OK/TRIPPED
Next scan in 2 hours.
