# Performance Tracking - Nyx Trading System

**Purpose:** Track proof-of-work metrics for all trading agents. This is our accountability document.

**Last Updated:** 2026-03-07 10:28 UTC

---

## Stormwatch (Weather Trading)

### Production Status
- **Status:** Paper trading (preparing for real money shift)
- **Live Since:** 2026-02-26
- **Days Running:** ~10 days
- **Scan Frequency:** Every 2 hours at :10 past the hour

### Performance Metrics
| Metric | Value | Notes |
|--------|-------|-------|
| **Total P&L** | ~$335 | Paper money (confirmed by user 2026-02-27) |
| **Win Rate** | TBD | Needs calculation from trades.json |
| **Total Trades** | TBD | Count from trades.json |
| **Average Edge** | ≥25% | Entry threshold (relative edge) |
| **Edge Realized** | TBD | Actual vs predicted edge |
| **Best City** | TBD | Track by compound learning |
| **Worst City** | TBD | Track by compound learning |

### Strategy Details
- **Data Source:** Open-Meteo forecast API (free, no auth)
- **Entry Criteria:** Relative edge ≥25% AND modelProb 5–10% from market
- **Position Size:** $5 paper per trade
- **Liquidity Check:** Minimum $50 available on entry side
- **Auto-Swap:** Enabled when probability flips significantly
- **Circuit Breaker:** 3 consecutive losses → pause and alert

### Recent Learnings (From Compound Learning)
- [ ] First review scheduled for 2026-03-08 02:00 SGT (18:00 UTC today)
- System will track: city performance, hour-of-day patterns, edge calibration
- Updates written to: `/docker/openclaw-uwzq/data/.openclaw/workspace-stormwatch/memory/compound-learning.json`

### Known Issues
- None currently (strategy confirmed working well by user 2026-02-27)

---

## Copycat (Whale Consensus Trading)

### Production Status
- **Status:** Paper trading
- **Live Since:** 2026-02-27
- **Days Running:** ~9 days
- **Scan Frequency:** Every 4 hours (0, 4, 8, 12, 16, 20 SGT)

### Performance Metrics
| Metric | Value | Notes |
|--------|-------|-------|
| **Total P&L** | TBD | Read from positions.json |
| **Win Rate** | TBD | Calculate from closed positions |
| **Total Positions** | TBD | Count from positions.json |
| **Consensus Signals** | 75 found | First scan (2026-02-27) |
| **Positions Entered** | 3 | First scan (2026-02-27) |
| **Positions Closed** | 3 | First scan (2026-02-27) |
| **Best Consensus Size** | TBD | Track 2-whale, 3-whale, 4+ whale |
| **Worst Consensus Size** | TBD | Track underperformers |

### Strategy Details
- **Data Source:** predicting.top (whale leaderboard + analytics)
- **Entry Criteria:** 3+ whales confirmed consensus, or 2 whales early signal
- **Position Size:** Size-weighted based on whale conviction
- **Max Concentration:** 40% of portfolio from one wallet
- **Conflict Detection:** If ≥2 whales on opposite sides, pause and report
- **Rebalancing:** Auto-adjust when whale positions shift

### Recent Learnings (From Compound Learning)
- [ ] First review scheduled for 2026-03-08 02:30 SGT (18:30 UTC today)
- System will track: consensus size performance, best whales, category patterns
- Updates written to: `/docker/openclaw-uwzq/data/.openclaw/workspace-copycat/memory/compound-learning.json`

### Known Issues
- None currently (first automated scan successful 2026-02-27)

---

## Combined Performance

### Portfolio Status
- **Total Capital:** Paper trading (real amounts TBD before real money)
- **Combined P&L:** ~$335 (Stormwatch only, Copycat TBD)
- **Open Positions:** Check dashboard at https://nyx-dashboard.vercel.app

### Risk Management (To Be Set Before Real Money)
- [ ] **Total Bankroll:** Not set (currently paper)
- [ ] **Risk Per Trade:** Not set
- [ ] **Max Total Exposure:** Not set
- [ ] **Circuit Breakers:** Not set globally

### Pre-Real-Money Checklist
- [ ] Set total bankroll amount
- [ ] Define risk per trade (% or $)
- [ ] Set max total exposure limit
- [ ] Define pain threshold for auto-pause
- [ ] Test with small real stakes first ($10-25 per trade)
- [ ] Verify P&L tracking accuracy
- [ ] Confirm notification system works
- [ ] Document exit strategy for failures

---

## Compound Learning Status

### Implemented (2026-03-07)
- ✅ Stormwatch nightly self-review (18:00 UTC daily)
- ✅ Copycat nightly self-review (18:30 UTC daily)
- ✅ Pattern detection (city performance, consensus strength)
- ✅ Failure mode tracking
- ✅ Automatic insight generation

### Learning Outputs
- Stormwatch: `/docker/openclaw-uwzq/data/.openclaw/workspace-stormwatch/memory/compound-learning.json`
- Copycat: `/docker/openclaw-uwzq/data/.openclaw/workspace-copycat/memory/compound-learning.json`

### What Gets Tracked
- **Stormwatch:** City win rates, hour-of-day patterns, edge calibration, failure modes
- **Copycat:** Consensus size performance, whale wallet accuracy, category patterns, rebalancing effectiveness

---

## Update Schedule

This document should be updated:
1. **Daily:** After compound learning runs (automated via cron reports)
2. **Weekly:** Manual review of trends and adjustments
3. **Before real money shift:** Complete Pre-Real-Money Checklist
4. **After major changes:** Strategy adjustments, threshold changes, circuit breaker triggers

---

_This is a living document. Update it as we learn._
