/**
 * core/schema.js — Trade Schema & Validator
 * 
 * RULE: Nothing gets written to trades.json without passing validateTrade().
 * This is the single enforcement point for data integrity.
 */

const VALID_STATUSES = ['candidate', 'entered', 'open', 'resolved', 'closed'];
const VALID_SIDES = ['YES', 'NO'];
const VALID_RESULTS = ['win', 'loss', 'push', null];

// Status transition rules — no skipping steps
const VALID_TRANSITIONS = {
  candidate: ['entered', 'closed'],   // closed = abandoned candidate
  entered:   ['open', 'closed'],       // closed = order rejected/cancelled
  open:      ['resolved'],
  resolved:  ['closed'],
  closed:    []                        // terminal state
};

/**
 * The canonical trade schema.
 * Every field listed here is the ONLY set of fields allowed.
 */
const TRADE_SCHEMA = {
  // Identity
  id:            { type: 'string',  required: true  },
  conditionId:   { type: 'string',  required: true,  pattern: /^0x[a-fA-F0-9]{64}$/ },
  tokenId:       { type: 'string',  required: true  },
  tokenSide:     { type: 'string',  required: false, enum: ['YES', 'NO'] }, // which side the tokenId belongs to
  marketSlug:    { type: 'string',  required: true  },

  // Market context
  city:          { type: 'string',  required: true  },
  date:          { type: 'string',  required: true,  pattern: /^\d{4}-\d{2}-\d{2}$/ },
  bucket:        { type: 'string',  required: true  },
  question:      { type: 'string',  required: true  },

  // Position
  side:          { type: 'string',  required: true,  enum: VALID_SIDES },
  entryPrice:    { type: 'number',  required: false, min: 0, max: 1 },
  size:          { type: 'number',  required: false, min: 0 },
  sizeUSDC:      { type: 'number',  required: false, min: 0 },

  // Lifecycle
  status:        { type: 'string',  required: true,  enum: VALID_STATUSES },
  result:        { type: 'string',  required: false, enum: VALID_RESULTS, nullable: true },
  
  // Resolution (filled by polymarket resolver, NOT weather data)
  resolutionPrice:  { type: 'number',  required: false, min: 0, max: 1 },
  resolutionSource: { type: 'string',  required: false },  // always "polymarket"
  resolvedAt:       { type: 'string',  required: false },

  // P&L (computed from resolution, not weather)
  pnlUSDC:       { type: 'number',  required: false, nullable: true },

  // Timestamps
  createdAt:     { type: 'string',  required: true  },
  enteredAt:     { type: 'string',  required: false },
  closedAt:      { type: 'string',  required: false },

  // Execution
  orderId:       { type: 'string',  required: false },
  txHash:        { type: 'string',  required: false, nullable: true },

  // Price tracking (updated by price sync)
  currentPrice:  { type: 'number',  required: false, min: 0, max: 1 },
  updatedAt:     { type: 'string',  required: false },

  // Signal metadata (for feedback loop)
  signal: {
    type: 'object',
    required: false,
    properties: {
      forecastTemp:   { type: 'number' },
      forecastSource: { type: 'string' },
      impliedProb:    { type: 'number', min: 0, max: 1 },
      modelProb:      { type: 'number', min: 0, max: 1 },
      edge:           { type: 'number' }
    }
  },

  // Human-readable reasoning (for dashboard display)
  notes: { type: 'string', required: false }
};

/**
 * Validate a trade object against the schema.
 * Returns { valid: boolean, errors: string[] }
 */
function validateTrade(trade) {
  const errors = [];

  if (typeof trade !== 'object' || trade === null) {
    return { valid: false, errors: ['Trade must be a non-null object'] };
  }

  // Check for unknown fields (no extra garbage)
  const knownFields = Object.keys(TRADE_SCHEMA);
  for (const key of Object.keys(trade)) {
    if (!knownFields.includes(key)) {
      errors.push(`Unknown field: "${key}". Only schema-defined fields are allowed.`);
    }
  }

  // Validate each schema field
  for (const [field, rules] of Object.entries(TRADE_SCHEMA)) {
    const value = trade[field];

    // Required check
    if (rules.required && (value === undefined || value === null || value === '')) {
      errors.push(`Missing required field: "${field}"`);
      continue;
    }

    // Skip optional fields that aren't present
    if (value === undefined || (value === null && rules.nullable)) {
      continue;
    }

    if (value === null && !rules.nullable) {
      errors.push(`Field "${field}" cannot be null`);
      continue;
    }

    // Type check
    if (rules.type === 'object') {
      if (typeof value !== 'object' || value === null) {
        errors.push(`Field "${field}" must be an object`);
      }
      // Nested validation for signal object
      if (rules.properties && typeof value === 'object') {
        for (const [subField, subRules] of Object.entries(rules.properties)) {
          const subVal = value[subField];
          if (subVal !== undefined && subVal !== null) {
            if (typeof subVal !== subRules.type) {
              errors.push(`Field "signal.${subField}" must be type ${subRules.type}`);
            }
            if (subRules.min !== undefined && subVal < subRules.min) {
              errors.push(`Field "signal.${subField}" must be >= ${subRules.min}`);
            }
            if (subRules.max !== undefined && subVal > subRules.max) {
              errors.push(`Field "signal.${subField}" must be <= ${subRules.max}`);
            }
          }
        }
      }
    } else if (typeof value !== rules.type) {
      errors.push(`Field "${field}" must be type ${rules.type}, got ${typeof value}`);
      continue;
    }

    // Enum check
    if (rules.enum && !rules.enum.includes(value)) {
      errors.push(`Field "${field}" must be one of: ${rules.enum.join(', ')}. Got: "${value}"`);
    }

    // Pattern check
    if (rules.pattern && typeof value === 'string' && !rules.pattern.test(value)) {
      errors.push(`Field "${field}" failed pattern check: ${rules.pattern}`);
    }

    // Range checks
    if (rules.min !== undefined && value < rules.min) {
      errors.push(`Field "${field}" must be >= ${rules.min}`);
    }
    if (rules.max !== undefined && value > rules.max) {
      errors.push(`Field "${field}" must be <= ${rules.max}`);
    }
  }

  // Cross-field validation: status + result consistency
  if (trade.status && trade.result) {
    if (['candidate', 'entered', 'open'].includes(trade.status) && trade.result !== null) {
      errors.push(`Trade with status "${trade.status}" cannot have a result yet`);
    }
  }

  // Cross-field: resolved/closed must have result
  if (trade.status === 'resolved' && !trade.result) {
    errors.push('Resolved trades must have a result (win/loss/push)');
  }

  // Cross-field: P&L on open trades = unrealized (from price sync), on resolved/closed = realized
  // Both are valid

  // Cross-field: resolutionSource must be "polymarket" or "price-inferred"
  if (trade.resolutionSource && !['polymarket', 'price-inferred'].includes(trade.resolutionSource)) {
    errors.push(`resolutionSource must be "polymarket" or "price-inferred", got "${trade.resolutionSource}"`);
  }

  // Placeholder detection — catch fake conditionIds
  if (trade.conditionId) {
    const suspiciousPatterns = [
      /^0x0{64}$/,           // all zeros
      /^0x1{64}$/,           // all ones
      /placeholder/i,
      /test/i,
      /fake/i,
      /TODO/i
    ];
    for (const pat of suspiciousPatterns) {
      if (pat.test(trade.conditionId)) {
        errors.push(`Suspicious conditionId detected (possible placeholder): ${trade.conditionId}`);
      }
    }
  }

  return { valid: errors.length === 0, errors };
}

/**
 * Validate a status transition.
 */
function validateTransition(fromStatus, toStatus) {
  const allowed = VALID_TRANSITIONS[fromStatus];
  if (!allowed) {
    return { valid: false, error: `Unknown status: "${fromStatus}"` };
  }
  if (!allowed.includes(toStatus)) {
    return { 
      valid: false, 
      error: `Invalid transition: ${fromStatus} → ${toStatus}. Allowed: ${allowed.join(', ') || 'none (terminal)'}` 
    };
  }
  return { valid: true };
}

/**
 * Generate a unique trade ID.
 */
function generateTradeId() {
  const ts = Date.now().toString(36);
  const rand = Math.random().toString(36).substring(2, 8);
  return `oc-${ts}-${rand}`;
}

/**
 * Create a new candidate trade with required fields.
 * This is the ONLY way to create a trade object.
 */
function createCandidate({ conditionId, tokenId, tokenSide, marketSlug, city, date, bucket, question, side, signal, notes }) {
  const trade = {
    id: generateTradeId(),
    conditionId,
    tokenId,
    tokenSide: tokenSide || side, // default to position side if not specified
    marketSlug,
    city,
    date,
    bucket,
    question,
    side,
    status: 'candidate',
    result: null,
    pnlUSDC: null,
    createdAt: new Date().toISOString(),
    signal: signal || null,
    notes: notes || null
  };

  const validation = validateTrade(trade);
  if (!validation.valid) {
    throw new Error(`Cannot create candidate: ${validation.errors.join('; ')}`);
  }

  return trade;
}

module.exports = {
  TRADE_SCHEMA,
  VALID_STATUSES,
  VALID_SIDES,
  VALID_TRANSITIONS,
  validateTrade,
  validateTransition,
  createCandidate,
  generateTradeId
};
