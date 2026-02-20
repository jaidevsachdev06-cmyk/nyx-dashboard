# OpenClaw v2 — Weather Trading Bot (Polymarket)

## Architecture

```
openclaw/
├── config.json            # Cities, buckets, API endpoints, risk params
├── trades.json            # The ONE trade journal — schema-enforced
├── core/
│   ├── schema.js          # Trade schema definition + validator
│   ├── store.js           # Read/write trades.json (all access goes through here)
│   ├── lifecycle.js       # State machine: candidate → entered → open → resolved → closed
│   └── polymarket.js      # Polymarket CLOB API: lookup, order, resolve
├── stormwatch/
│   ├── scanner.js         # Weather data → candidate generation
│   ├── entry.js           # Candidate → validated entry (with guardrails)
│   └── observer.js        # Monitor open positions, trigger resolution checks
├── accounting/
│   ├── resolver.js        # Check Polymarket resolution → compute P&L
│   └── stats.js           # Feedback loop: win rate by city/bucket/time
├── scripts/
│   ├── run-scan.js        # CLI: run a scan cycle
│   ├── run-resolve.js     # CLI: check & resolve settled markets
│   ├── run-stats.js       # CLI: print performance dashboard
│   └── migrate.js         # One-time: clean old trades.json
└── logs/                  # Structured logs per run
```

## Design Principles

1. **Schema-first**: No trade record is written without passing validation.
2. **Single store**: All trade I/O goes through `core/store.js`. No script touches `trades.json` directly.
3. **Polymarket is truth**: P&L comes from Polymarket resolution, never weather data.
4. **Fail loud**: If conditionId lookup fails, the trade is NOT written. Errors are logged, not swallowed.
5. **State machine**: Every trade follows: `candidate → entered → open → resolved → closed`. No skipping.
6. **Feedback loop**: After resolution, stats are aggregated to surface what's actually profitable.
