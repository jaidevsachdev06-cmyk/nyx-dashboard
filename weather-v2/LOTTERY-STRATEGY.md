# Lottery Trade Strategy

## Overview
Lottery trades are high-risk, high-reward positions on extreme longshots. They represent a small fraction of trades but historically contributed 47% of total profit.

## Configuration (as of 2026-03-08)

```json
{
  "lottery": {
    "enabled": true,
    "maxDailyTrades": 3,
    "maxSizeUSDC": 2,
    "minEdgePct": 25,
    "maxEntryPrice": 0.15
  }
}
```

## Entry Criteria

A trade qualifies as lottery when ALL conditions met:
1. **Entry price < 15¢** (market thinks it's unlikely)
2. **Edge ≥ 25%** (model disagrees significantly)
3. **Model probability ≥ 5%** (model sees non-trivial chance)
4. **Lottery enabled** in config

## Risk Controls

### Daily Quota: 3 trades max
- Prevents overexposure to low-probability events
- Resets daily at 00:00 UTC
- Hard cap enforced in entry.js

### Position Sizing: $2 max
- Conservative sizing vs $12 default
- Limits downside on individual losses
- Historical: 12 losses @ avg -$12 = -$144, 2 wins @ avg +$230 = +$460

### Edge Filter: 25% minimum
- Ensures model has strong conviction
- Filters noise from genuine opportunities
- Historical lottery trades averaged 30% edge

## Historical Performance

**14 lottery trades closed (all-time):**
- **P&L: +$296.76** (47% of total $330 profit)
- **Win rate: 14.3%** (2W/12L)
- **Avg P&L/trade: +$21.20**

**Comparison to non-lottery:**
- Non-lottery: $0.90 avg/trade, 51% WR
- Lottery: **$21.20 avg/trade**, 14% WR
- **23x higher profit per trade** (when sizing normalized)

**Best wins:**
1. Paris 16°C YES: **+$437.05** (5.4¢ entry, 2% edge)
2. Miami 82-83°F YES: +$23.50 (5.0¢ entry, 12% edge)

**Pattern:** Low-probability YES bets (5-10¢) with model giving 10-20% chance

## Why Lottery Works

### Market Inefficiency
- Low-liquidity tail outcomes often mispriced
- Retail traders avoid <15¢ prices (psychological barrier)
- Whales focus on high-conviction plays (>50¢)

### Asymmetric Payoff
- Max loss: $2 (per trade)
- Max gain: $400+ (if market resolves YES from 5¢)
- **80:1 upside:downside ratio**

### Portfolio Theory
- Uncorrelated with main strategy (different price ranges)
- Acts as tail-risk hedge (lottery wins offset main losses)
- Kelly optimal when edge exists despite low win rate

## What Changed (March 2026 Overhaul)

### OLD Strategy (disabled Feb 28 - Mar 7):
- No edge filter → took bad lottery bets
- $5 sizing → too aggressive
- City/boundary filters killed lottery sources

### NEW Strategy (re-enabled Mar 8):
- **25% edge minimum** → quality gate
- **$2 sizing** → risk management
- **3/day quota** → exposure control
- Still blacklists London/Toronto/Miami boundaries

## Expected Performance

With new filters (25% edge, $2 sizing, 3/day):
- Estimated: 1-2 lottery entries per week
- Expected WR: 10-20% (longshots by nature)
- Expected P&L/trade: $10-25 (lower than historical due to smaller size)
- Annual contribution: ~$500-1000 (if historical pattern holds)

## Monitoring & Adjustment

### Track metrics:
- Daily lottery quota usage
- Win rate on lottery vs non-lottery
- Edge accuracy (predicted vs actual)
- City/bucket patterns

### Red flags:
- Win rate <5% over 20 lottery trades
- Avg loss >$10 (should be ~$2 with new sizing)
- Lottery trades clustering in one city (model bias)

### Adjustment triggers:
- If 10 consecutive lottery losses → disable for 7 days
- If win rate >30% over 20 trades → consider increasing size
- If quota not filling → loosen edge requirement to 20%

## Philosophy

Lottery trades are **NOT** the core strategy. They are:
- **Opportunistic** tail-risk bets
- **Strictly limited** in exposure
- **High-conviction** model disagreements
- **Asymmetric** payoff structures

The main strategy (range buckets, 60-95% model prob) generates consistent returns. Lottery adds optionality and captures rare mispricings.

---

**Status:** ✅ Enabled as of 2026-03-08 02:15 UTC  
**Next review:** After 10 lottery trades or 30 days  
**Owner:** Stormwatch
