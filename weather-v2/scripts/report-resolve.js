#!/usr/bin/env node
/**
 * report-resolve.js — Reads stdin JSON from run-resolve.js, posts summary to Telegram
 * Usage: node run-resolve.js | node report-resolve.js
 */

const { execSync } = require('child_process');

const TELEGRAM_CHAT = '-1003762193481:topic:2'; // NYX Mission Control > Stormwatch thread

async function main() {
  let input = '';
  process.stdin.setEncoding('utf8');
  
  for await (const chunk of process.stdin) {
    input += chunk;
  }

  const lines = input.trim().split('\n');
  const jsonLine = lines.find(l => l.startsWith('{') && l.includes('"resolved"'));
  
  if (!jsonLine) {
    console.error('[report-resolve] No JSON result found in input');
    return;
  }

  const result = JSON.parse(jsonLine);
  const { checked, resolved, pending, wins = 0, losses = 0, pnl = 0 } = result;

  // Only notify if positions resolved
  if (resolved === 0) {
    console.log('[report-resolve] No positions resolved, skipping notification');
    return;
  }

  let msg = `🌪️ Weather Positions Resolved\n\n`;
  msg += `📊 Checked: ${checked} | Resolved: ${resolved} | Pending: ${pending}\n`;
  msg += `${wins}W / ${losses}L`;
  
  if (wins + losses > 0) {
    const wr = ((wins / (wins + losses)) * 100).toFixed(1);
    msg += ` (${wr}% WR)`;
  }
  
  msg += `\n💰 Session P&L: ${pnl >= 0 ? '+' : ''}$${pnl.toFixed(2)}`;

  // Send via openclaw message tool
  try {
    execSync(`openclaw message send --channel telegram --to "${TELEGRAM_CHAT}" --message "${msg.replace(/"/g, '\\"')}"`, {
      stdio: 'inherit'
    });
    console.log('[report-resolve] Notification sent');
  } catch (err) {
    console.error('[report-resolve] Failed to send notification:', err.message);
  }
}

main().catch(err => {
  console.error('[report-resolve] Fatal:', err);
  process.exit(1);
});
