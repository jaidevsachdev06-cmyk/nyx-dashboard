/**
 * core/sdk-order.js — Place real orders via @polymarket/clob-client SDK
 * 
 * Uses the CORRECT gnosis-safe proxy (0x8dC9) so orders show on polymarket.com.
 * The CLI binary has a bug (PR #22) that derives the wrong proxy address.
 * This module bypasses the CLI for order placement only.
 */

const { ClobClient, SignatureType } = require('@polymarket/clob-client');
const ethers = require('ethers');
const fs = require('fs');
const path = require('path');

const CLOB_HOST = 'https://clob.polymarket.com';
const CHAIN_ID = 137;
const CORRECT_SAFE = '0x8dC9c96Edd3dab3E5A79f1db49Cd7764E8Ff7C94';

const AUDIT_LOG = path.resolve(__dirname, '..', 'real-order-log.jsonl');

// Load private key from polymarket CLI config
function getPrivateKey() {
  const configPath = path.join(process.env.HOME || '/root', '.config', 'polymarket', 'config.json');
  const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
  return config.private_key;
}

// Cached client instance
let _client = null;
let _creds = null;

async function getClient() {
  if (_client) return _client;

  const key = getPrivateKey();
  const wallet = new ethers.Wallet(key);

  // Derive API credentials (cached for session)
  const tmpClient = new ClobClient(CLOB_HOST, CHAIN_ID, wallet);
  _creds = await tmpClient.createOrDeriveApiKey();

  // Create client with correct funder address (6th param)
  _client = new ClobClient(CLOB_HOST, CHAIN_ID, wallet, _creds, SignatureType.POLY_GNOSIS_SAFE, CORRECT_SAFE);
  return _client;
}

/**
 * Convert hex token ID to decimal (CLOB format)
 */
function hexToDecimal(hexTokenId) {
  if (!hexTokenId.startsWith('0x')) return hexTokenId; // already decimal
  return BigInt(hexTokenId).toString();
}

/**
 * Place a real order on the correct proxy (visible on polymarket.com)
 * 
 * @param {Object} params
 * @param {string} params.tokenId - Token ID (hex or decimal)
 * @param {string} params.side - 'BUY' or 'SELL'
 * @param {number} params.price - Price (0.01 to 0.99)
 * @param {number} params.size - Number of shares (>= 5)
 * @returns {Object} { orderID, success, filled, status }
 */
async function placeOrder({ tokenId, side, price, size }) {
  const tag = '[sdk-order]';

  // Emergency kill switch
  const KILL_FILE = '/tmp/stormwatch-kill-real-trading';
  if (fs.existsSync(KILL_FILE)) {
    throw new Error(`${tag} EMERGENCY KILL SWITCH ACTIVE`);
  }

  // Validate
  if (!tokenId) throw new Error(`${tag} missing tokenId`);
  if (!['BUY', 'SELL'].includes(side.toUpperCase())) throw new Error(`${tag} invalid side "${side}"`);
  if (price < 0.01 || price > 0.99) throw new Error(`${tag} price ${price} out of range`);
  if (size < 5) throw new Error(`${tag} size ${size} below CLOB minimum 5`);

  // Round price to tick size (0.01 for most, 0.001 for neg-risk weather)
  // Use 0.01 rounding for safety
  const roundedPrice = Math.round(price * 100) / 100;
  const roundedSize = Math.floor(size);
  const costUSDC = roundedPrice * roundedSize;

  const decimalTokenId = hexToDecimal(tokenId);

  console.log(`${tag} ${side} ${roundedSize} @ ${roundedPrice} ($${costUSDC.toFixed(2)}) | token: ${decimalTokenId.slice(0, 20)}...`);

  const client = await getClient();

  const order = await client.createOrder({
    tokenID: decimalTokenId,
    price: roundedPrice,
    side: side.toUpperCase(),
    size: roundedSize,
    feeRateBps: 0,
  });

  const result = await client.postOrder(order);

  if (!result.success) {
    throw new Error(`${tag} Order rejected: ${result.errorMsg || JSON.stringify(result).slice(0, 200)}`);
  }

  const orderID = result.orderID;

  // Audit log
  try {
    const auditLine = JSON.stringify({
      timestamp: new Date().toISOString(),
      orderID,
      tokenId: decimalTokenId,
      side: side.toUpperCase(),
      price: roundedPrice,
      size: roundedSize,
      costUSDC,
      proxy: 'gnosis-safe',
      via: 'sdk'
    }) + '\n';
    fs.appendFileSync(AUDIT_LOG, auditLine);
  } catch (_) { /* non-fatal */ }

  console.log(`${tag} ✅ ${side} order posted | orderID: ${orderID}`);

  // Check if it filled immediately
  const filled = (result.takingAmount && result.takingAmount !== '0') || 
                 (result.makingAmount && result.makingAmount !== '0');

  return {
    orderID,
    success: true,
    filled: filled || null,
    status: result.status || 'live',
    paper: false
  };
}

/**
 * Cancel an order
 */
async function cancelOrder(orderID) {
  const client = await getClient();
  return client.cancelOrder(orderID);
}

/**
 * Get CLOB balance on the correct proxy
 */
async function getBalance() {
  const client = await getClient();
  const result = await client.getBalanceAllowance({ asset_type: 'COLLATERAL' });
  return parseFloat(result.balance) / 1e6; // Convert from raw to USDC
}

module.exports = { placeOrder, cancelOrder, getBalance, hexToDecimal };
