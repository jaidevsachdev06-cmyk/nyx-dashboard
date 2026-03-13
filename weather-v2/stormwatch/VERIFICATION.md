# VERIFICATION CHECKLIST - Before Each Scanner Run

## MANDATORY PRE-FLIGHT CHECKS:

1. **Multi-source is ACTUALLY running**
   - Check last trade: `signal.sources` must be >= 2
   - Check last trade: `signal.forecastSource` must show "multi-source"
   
2. **Risk limits are enforced**
   - minEdgePct: 75%
   - minForecastSources: 2
   - maxTradesPerCity: 1
   - maxTradesPerDay: 3
   - defaultSizeUSDC: 6
   
3. **Bucket blacklist working**
   - NO specific-degree NO positions (e.g., "12°C NO")
   - Only YES on strong forecasts OR boundary bets

4. **Test with dry-run first**
   - Run scanner in test mode
   - Verify signals use multi-source
   - Verify edge calculations correct

## NEVER SKIP THIS AGAIN

If any check fails, STOP and fix before enabling real trades.

Last verified: NEVER (this is why we lost $42.82)
Next verification: BEFORE re-enabling scanner
