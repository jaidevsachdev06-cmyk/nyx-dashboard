/**
 * core/timing.js — Intraday timing optimization
 * 
 * Same-day markets: forecast converges throughout the day
 * Early morning: MAE ~2°F, market hasn't updated
 * Afternoon: MAE ~0.8°F, market more efficient
 * 
 * Strategy:
 * - NO trades: enter early (better prices, forecast good enough)
 * - YES trades: enter afternoon (forecast converges, prices haven't caught up)
 */

/**
 * Should we scan for this city+date combo right now?
 * @param {string} city - City name
 * @param {string} marketDate - YYYY-MM-DD
 * @param {string} cityTimezone - e.g. 'America/New_York'
 * @returns {object} { shouldScan, reason, nextScanHour }
 */
function shouldScanNow(city, marketDate, cityTimezone) {
  const now = new Date();
  
  // Market date is the local date — Polymarket measures "high temp on March 27 in Dallas"
  // Resolution happens after the day ends (next morning ~6am local when data is available)
  // We approximate this as: marketDate + 1 day at 6am local time
  const nextDay = new Date(marketDate);
  nextDay.setDate(nextDay.getDate() + 1);
  const resolutionTimeLocal = nextDay.toLocaleDateString('en-US', { timeZone: cityTimezone }) + ' 06:00:00';
  
  // Convert local resolution time to UTC for comparison
  // NOTE: This is an approximation — proper implementation would use a timezone library
  // For now, use simple calculation: marketDate end-of-day + 6h
  const marketDateEnd = new Date(marketDate + 'T23:59:59Z');
  const hoursToEvent = (marketDateEnd - now) / 3600000;
  
  // Get current hour in city's local time
  const localHour = parseInt(now.toLocaleString('en-US', { 
    timeZone: cityTimezone, 
    hour: 'numeric', 
    hour12: false 
  }));
  
  // 1-day-out markets: scan anytime
  if (hoursToEvent >= 24) {
    return { shouldScan: true, reason: '1-day-out', nextScanHour: null };
  }
  
  // Same-day markets: timing strategy
  if (hoursToEvent >= 6 && hoursToEvent < 24) {
    // Morning (6am-11am local): Good for NO trades (market not updated yet)
    // Skip YES trades — forecast not converged enough
    if (localHour >= 6 && localHour < 12) {
      return { 
        shouldScan: true, 
        reason: 'same-day-morning-NO-only',
        yesOnly: false,
        noOnly: true,
        nextScanHour: 14
      };
    }
    
    // Afternoon (2pm-8pm local): Best for YES trades (forecast converged, market slow to update)
    // Also good for NO trades
    if (localHour >= 14 && localHour < 20) {
      return {
        shouldScan: true,
        reason: 'same-day-afternoon-optimal',
        yesOnly: false,
        noOnly: false,
        nextScanHour: null
      };
    }
    
    // Early morning / late night: Skip (forecast not ready OR market resolved soon)
    return {
      shouldScan: false,
      reason: 'same-day-suboptimal-hour',
      nextScanHour: 6
    };
  }
  
  // Less than 6h to event: too risky (market about to resolve)
  if (hoursToEvent < 6) {
    return {
      shouldScan: false,
      reason: 'too-close-to-resolution',
      nextScanHour: null
    };
  }
  
  // More than 48h: skip (forecast error too high)
  return {
    shouldScan: false,
    reason: '2day-horizon-too-far',
    nextScanHour: null
  };
}

/**
 * Adjust forecast MAE based on time of day for same-day markets
 * Morning: higher MAE (more uncertainty)
 * Afternoon: lower MAE (day progressing, forecast converging)
 */
function adjustMAEForTimeOfDay(baseMAE, marketDate, cityTimezone) {
  const now = new Date();
  const marketDateObj = new Date(marketDate + 'T12:00:00Z');
  const hoursToEvent = (marketDateObj - now) / 3600000;
  
  // Only adjust for same-day markets
  if (hoursToEvent >= 24 || hoursToEvent < 0) {
    return baseMAE;
  }
  
  const localHour = parseInt(now.toLocaleString('en-US', { 
    timeZone: cityTimezone, 
    hour: 'numeric', 
    hour12: false 
  }));
  
  // Early morning (midnight-8am): MAE 1.3x base (peak uncertainty)
  if (localHour < 8) {
    return baseMAE * 1.3;
  }
  
  // Morning (8am-noon): MAE 1.1x base
  if (localHour < 12) {
    return baseMAE * 1.1;
  }
  
  // Afternoon (noon-6pm): MAE at base (forecast converging)
  if (localHour < 18) {
    return baseMAE;
  }
  
  // Evening (6pm-midnight): MAE 0.8x base (most of day observed)
  return baseMAE * 0.8;
}

/**
 * Get recommended scan frequency for a city
 * Same-day markets: scan every 30min starting at noon local
 * 1-day markets: scan every 2h
 */
function getRecommendedScanInterval(cityTimezone) {
  const now = new Date();
  const localHour = parseInt(now.toLocaleString('en-US', { 
    timeZone: cityTimezone, 
    hour: 'numeric', 
    hour12: false 
  }));
  
  // Peak hours for same-day YES trades: scan every 30min
  if (localHour >= 14 && localHour < 20) {
    return 30; // minutes
  }
  
  // Normal hours: every 2h
  return 120; // minutes
}

module.exports = {
  shouldScanNow,
  adjustMAEForTimeOfDay,
  getRecommendedScanInterval
};
