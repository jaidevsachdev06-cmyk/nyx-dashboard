#!/usr/bin/env node
/**
 * report-scan.js — Reads stdin JSON from run-scan.js, posts summary to Telegram
 * Usage: node run-scan.js | node report-scan.js
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
  const jsonLine = lines.find(l => l.startsWith('{') && l.includes('"scanned"'));
  
  if (!jsonLine) {
    console.error('[report-scan] No JSON result found in input');
    return;
  }

  const result = JSON.parse(jsonLine);
  const { scanned, passing, entered } = result;

  // Only notify if trades entered OR high-edge opportunities skipped
  if (entered === 0 && passing === 0) {
    console.log('[report-scan] No action taken, skipping notification');
    return;
  }

  let msg = `🌪️ Weather Scan Complete\n\n`;
  msg += `📊 Markets evaluated: ${scanned}\n`;
  msg += `✅ Edge threshold passed: ${passing}\n`;
  msg += `💰 Trades entered: ${entered}\n`;

  if (entered > 0) {
    msg += `\nCheck dashboard for details.`;
  } else if (passing > 0) {
    msg += `\n⚠️ ${passing} candidates passed edge threshold but were not entered (likely duplicates or liquidity issues)`;
  }

  // Send via openclaw message tool (assumes openclaw CLI available)
  try {
    execSync(`openclaw message send --channel telegram --to "${TELEGRAM_CHAT}" --message "${msg.replace(/"/g, '\\"')}"`, {
      stdio: 'inherit'
    });
    console.log('[report-scan] Notification sent');
  } catch (err) {
    console.error('[report-scan] Failed to send notification:', err.message);
  }
}

main().catch(err => {
  console.error('[report-scan] Fatal:', err);
  process.exit(1);
});
