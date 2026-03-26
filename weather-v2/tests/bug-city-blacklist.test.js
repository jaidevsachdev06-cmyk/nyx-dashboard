/**
 * BUG REGRESSION TEST: City Blacklist Enforcement
 * 
 * Issue: Miami was not in cityBlacklist config, allowing a low-edge (9.8%)
 * trade to enter (oc-mn3zddjc-b8dq74, 2026-03-24).
 * 
 * Test verifies that cityBlacklist in config.json includes all three
 * blacklisted cities: London, Toronto, Miami.
 */

const fs = require('fs');
const path = require('path');

describe('City Blacklist Configuration', () => {
  it('should include London, Toronto, and Miami in cityBlacklist', () => {
    const configPath = path.join(__dirname, '../config.json');
    const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    
    const blacklist = config.risk.cityBlacklist || [];
    const required = ['London', 'Toronto', 'Miami'];
    
    required.forEach(city => {
      expect(blacklist).toContain(city, `${city} must be in cityBlacklist`);
    });
  });
});

module.exports = {};
