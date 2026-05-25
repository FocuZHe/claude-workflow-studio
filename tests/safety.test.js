const { describe, it, before, after, beforeEach } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const os = require('os');

// ═══════════════════════════════════════════════
// Safety Module Tests
// ═══════════════════════════════════════════════

// ── SafetyService Tests ──
const SafetyService = require('../src/server/services/SafetyService');

describe('SafetyService', () => {
  let service;
  let tmpDir;

  before(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'safety-test-'));
    service = new SafetyService(tmpDir);
  });

  after(() => {
    // Cleanup temp directory
    try {
      const files = fs.readdirSync(tmpDir);
      for (const file of files) {
        fs.unlinkSync(path.join(tmpDir, file));
      }
      fs.rmdirSync(tmpDir);
    } catch (e) {
      // ignore cleanup errors
    }
  });

  describe('constructor and initialization', () => {
    it('should initialize with default rules when no data files exist', () => {
      assert.ok(Array.isArray(service.rules), 'rules should be an array');
      assert.ok(service.rules.length >= 5, 'should have at least 5 default rules');
    });

    it('should have the expected default rule types', () => {
      const types = service.rules.map(r => r.type);
      assert.ok(types.includes('rate-limit'), 'should have rate-limit rule');
      assert.ok(types.includes('size-limit'), 'should have size-limit rule');
      assert.ok(types.includes('pattern'), 'should have pattern rules');
    });

    it('should create data directory if it does not exist', () => {
      assert.ok(fs.existsSync(tmpDir), 'data directory should exist');
    });
  });

  describe('logThreat', () => {
    it('should log a threat and return it with an id', () => {
      const event = {
        ip: '192.168.1.1',
        type: 'sql-injection',
        pattern: "union select",
        severity: 'high',
        description: 'SQL injection detected',
        url: '/api/test',
        method: 'GET',
        timestamp: new Date().toISOString()
      };

      const result = service.logThreat(event);

      assert.ok(result.id, 'should have an id');
      assert.strictEqual(result.ip, '192.168.1.1');
      assert.strictEqual(result.type, 'sql-injection');
      assert.strictEqual(result.severity, 'high');
      assert.strictEqual(result.description, 'SQL injection detected');
    });

    it('should persist threats to file', () => {
      const filePath = path.join(tmpDir, 'safety-threats.json');
      assert.ok(fs.existsSync(filePath), 'threats file should exist');

      const data = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
      assert.ok(Array.isArray(data), 'file should contain an array');
      assert.ok(data.length > 0, 'file should have at least one threat');
    });

    it('should use defaults for missing fields', () => {
      const result = service.logThreat({});
      assert.strictEqual(result.ip, 'unknown');
      assert.strictEqual(result.type, 'unknown');
      assert.strictEqual(result.severity, 'medium');
    });
  });

  describe('getThreats', () => {
    beforeEach(() => {
      // Add some test threats
      service.threats = [];
      const now = new Date();
      for (let i = 0; i < 5; i++) {
        service.threats.push({
          id: `threat-test-${i}`,
          ip: '10.0.0.1',
          type: i < 3 ? 'sql-injection' : 'xss',
          severity: i < 2 ? 'high' : (i < 4 ? 'medium' : 'low'),
          pattern: 'test',
          description: 'test threat',
          url: '/test',
          method: 'GET',
          timestamp: new Date(now - i * 1000).toISOString()
        });
      }
    });

    it('should return paginated results', () => {
      const result = service.getThreats({ page: 1, limit: 2 });
      assert.strictEqual(result.meta.total, 5);
      assert.strictEqual(result.meta.page, 1);
      assert.strictEqual(result.meta.limit, 2);
      assert.strictEqual(result.data.length, 2);
    });

    it('should filter by type', () => {
      const result = service.getThreats({ type: 'sql-injection' });
      assert.strictEqual(result.meta.total, 3);
    });

    it('should filter by severity', () => {
      const result = service.getThreats({ severity: 'high' });
      assert.strictEqual(result.meta.total, 2);
    });

    it('should sort by timestamp descending', () => {
      const result = service.getThreats({});
      for (let i = 1; i < result.data.length; i++) {
        const prev = new Date(result.data[i - 1].timestamp);
        const curr = new Date(result.data[i].timestamp);
        assert.ok(prev >= curr, 'should be sorted newest first');
      }
    });
  });

  describe('getThreatStats', () => {
    it('should return stats with expected fields', () => {
      const stats = service.getThreatStats();
      assert.ok('todayTotal' in stats, 'should have todayTotal');
      assert.ok('totalAllTime' in stats, 'should have totalAllTime');
      assert.ok('byType' in stats, 'should have byType');
      assert.ok('bySeverity' in stats, 'should have bySeverity');
      assert.ok('blockedCount' in stats, 'should have blockedCount');
    });

    it('should count threats by severity correctly', () => {
      service.threats = [
        { type: 'xss', severity: 'high', timestamp: new Date().toISOString() },
        { type: 'xss', severity: 'medium', timestamp: new Date().toISOString() },
        { type: 'xss', severity: 'low', timestamp: new Date().toISOString() }
      ];
      const stats = service.getThreatStats();
      assert.strictEqual(stats.bySeverity.high, 1);
      assert.strictEqual(stats.bySeverity.medium, 1);
      assert.strictEqual(stats.bySeverity.low, 1);
    });
  });

  describe('getSafetyScore', () => {
    it('should return score between 0 and 100', () => {
      service.threats = [];
      const result = service.getSafetyScore();
      assert.ok(result.score >= 0 && result.score <= 100, 'score should be 0-100');
    });

    it('should deduct for high severity threats', () => {
      const baseline = service.getSafetyScore();
      service.threats = [
        { type: 'xss', severity: 'high', timestamp: new Date().toISOString() },
        { type: 'xss', severity: 'high', timestamp: new Date().toISOString() }
      ];
      const after = service.getSafetyScore();
      assert.ok(after.score < baseline.score, 'score should decrease with high threats');
      assert.ok(after.breakdown.length > 0, 'should have breakdown entries');
    });

    it('should never go below 0', () => {
      // Add many high threats
      service.threats = [];
      for (let i = 0; i < 50; i++) {
        service.threats.push({
          type: 'xss',
          severity: 'high',
          timestamp: new Date().toISOString()
        });
      }
      const result = service.getSafetyScore();
      assert.strictEqual(result.score, 0, 'score should be clamped to 0');
    });
  });

  describe('rules CRUD', () => {
    let createdRule;

    it('addRule should create a new rule', () => {
      createdRule = service.addRule({
        name: 'Test Rule',
        description: 'A test rule',
        type: 'pattern',
        config: { patterns: ['test-pattern'] }
      });

      assert.ok(createdRule.id, 'should have an id');
      assert.strictEqual(createdRule.name, 'Test Rule');
      assert.strictEqual(createdRule.type, 'pattern');
      assert.strictEqual(createdRule.enabled, true);
    });

    it('getRules should include the new rule', () => {
      const rules = service.getRules();
      const found = rules.find(r => r.id === createdRule.id);
      assert.ok(found, 'should find the created rule');
    });

    it('updateRule should modify the rule', () => {
      const updated = service.updateRule(createdRule.id, { name: 'Updated Rule' });
      assert.ok(updated, 'should return updated rule');
      assert.strictEqual(updated.name, 'Updated Rule');
      assert.strictEqual(updated.id, createdRule.id, 'id should not change');
    });

    it('updateRule returns null for non-existent id', () => {
      const result = service.updateRule('non-existent-id', { name: 'test' });
      assert.strictEqual(result, null);
    });

    it('toggleRule should flip enabled status', () => {
      const toggled = service.toggleRule(createdRule.id);
      assert.ok(toggled, 'should return toggled rule');
      assert.strictEqual(toggled.enabled, false, 'should be disabled');
    });

    it('deleteRule should remove the rule', () => {
      const result = service.deleteRule(createdRule.id);
      assert.strictEqual(result, true);
      const rules = service.getRules();
      const found = rules.find(r => r.id === createdRule.id);
      assert.strictEqual(found, undefined, 'rule should be deleted');
    });

    it('deleteRule returns false for non-existent id', () => {
      const result = service.deleteRule('non-existent-id');
      assert.strictEqual(result, false);
    });
  });

  describe('JSON persistence', () => {
    it('should persist rules to file', () => {
      const filePath = path.join(tmpDir, 'safety-rules.json');
      assert.ok(fs.existsSync(filePath), 'rules file should exist');
      const data = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
      assert.ok(Array.isArray(data), 'file should contain an array');
    });

    it('should reload rules from file', () => {
      const newService = new SafetyService(tmpDir);
      assert.deepStrictEqual(newService.rules, service.rules, 'rules should match');
    });
  });
});

// ── Safety Middleware Tests ──
const { rateLimit, sanitizeInput, detectThreats, safetyHeaders } = require('../src/server/middleware/safety');

describe('Safety Middleware', () => {
  describe('detectThreats', () => {
    function createMockReq(body, query, params) {
      return {
        body: body || {},
        query: query || {},
        params: params || {},
        ip: '127.0.0.1',
        method: 'GET',
        url: '/test',
        originalUrl: '/test',
        app: { get: () => null }
      };
    }

    function createMockRes() {
      const res = {
        _status: 200,
        _headers: {},
        _body: null,
        status(code) { res._status = code; return res; },
        json(body) { res._body = body; return res; },
        set(key, val) { res._headers[key] = val; return res; }
      };
      return res;
    }

    it('should detect SQL injection in body', () => {
      const middleware = detectThreats();
      // Use "union select" which matches one of the middleware's regex patterns
      const req = createMockReq({ query: "1 union select * from users" });
      const res = createMockRes();
      let nextCalled = false;
      middleware(req, res, () => { nextCalled = true; });

      assert.strictEqual(res._status, 403, 'should return 403');
      assert.strictEqual(res._body.error.code, 'SECURITY_THREAT_DETECTED');
      assert.strictEqual(res._body.error.type, 'sql-injection');
      assert.strictEqual(nextCalled, false, 'next should not be called');
    });

    it('should detect XSS in query params', () => {
      const middleware = detectThreats();
      const req = createMockReq({}, { search: '<script>alert(1)</script>' });
      const res = createMockRes();
      let nextCalled = false;
      middleware(req, res, () => { nextCalled = true; });

      assert.strictEqual(res._status, 403, 'should return 403');
      assert.strictEqual(res._body.error.type, 'xss');
      assert.strictEqual(nextCalled, false, 'next should not be called');
    });

    it('should detect path traversal', () => {
      const middleware = detectThreats();
      const req = createMockReq({ path: '../../../etc/passwd' });
      const res = createMockRes();
      let nextCalled = false;
      middleware(req, res, () => { nextCalled = true; });

      assert.strictEqual(res._status, 403, 'should return 403');
      assert.strictEqual(res._body.error.type, 'path-traversal');
      assert.strictEqual(nextCalled, false, 'next should not be called');
    });

    it('should detect command injection', () => {
      const middleware = detectThreats();
      const req = createMockReq({ cmd: '; rm -rf /' });
      const res = createMockRes();
      let nextCalled = false;
      middleware(req, res, () => { nextCalled = true; });

      assert.strictEqual(res._status, 403, 'should return 403');
      assert.strictEqual(res._body.error.type, 'command-injection');
      assert.strictEqual(nextCalled, false, 'next should not be called');
    });

    it('should allow normal requests', () => {
      const middleware = detectThreats();
      const req = createMockReq({ name: 'hello world', age: 25 });
      const res = createMockRes();
      let nextCalled = false;
      middleware(req, res, () => { nextCalled = true; });

      assert.strictEqual(nextCalled, true, 'next should be called for safe requests');
      assert.strictEqual(res._status, 200, 'should not block');
    });
  });

  describe('safetyHeaders', () => {
    it('should set all required security headers', () => {
      const middleware = safetyHeaders();
      const res = {
        _headers: {},
        set(key, val) { this._headers[key] = val; },
        removeHeader(key) { delete this._headers[key]; }
      };
      middleware({}, res, () => {});

      assert.strictEqual(res._headers['X-Content-Type-Options'], 'nosniff');
      assert.strictEqual(res._headers['X-Frame-Options'], 'DENY');
      assert.strictEqual(res._headers['X-XSS-Protection'], '1; mode=block');
      assert.ok(res._headers['Strict-Transport-Security'], 'should have HSTS');
      assert.ok(res._headers['Cache-Control'], 'should have Cache-Control');
      assert.strictEqual(res._headers['X-Powered-By'], undefined, 'X-Powered-By should be removed');
    });
  });

  describe('rateLimit', () => {
    it('should create a middleware function', () => {
      const middleware = rateLimit({ windowMs: 60000, max: 5 });
      assert.strictEqual(typeof middleware, 'function');
    });

    it('should set rate limit headers', () => {
      const middleware = rateLimit({ windowMs: 60000, max: 10 });
      const res = {
        _headers: {},
        _status: 200,
        set(key, val) { this._headers[key] = val; },
        status(code) { this._status = code; return this; },
        json(body) { this._body = body; return this; }
      };
      const req = { ip: '192.168.1.100', connection: {} };
      middleware(req, res, () => {});

      assert.strictEqual(res._headers['X-RateLimit-Limit'], '10');
      assert.ok(res._headers['X-RateLimit-Remaining'], 'should set remaining');
      assert.ok(res._headers['X-RateLimit-Reset'], 'should set reset time');
    });

    it('should block after max requests', () => {
      const middleware = rateLimit({ windowMs: 60000, max: 2 });
      const res = {
        _headers: {},
        _status: 200,
        _body: null,
        set(key, val) { this._headers[key] = val; },
        status(code) { this._status = code; return this; },
        json(body) { this._body = body; return this; }
      };
      const req = { ip: '10.0.0.99', connection: {} };

      // First two requests should pass
      middleware(req, res, () => {});
      assert.strictEqual(res._status, 200);
      middleware(req, res, () => {});
      assert.strictEqual(res._status, 200);

      // Third should be blocked
      let nextCalled = false;
      middleware(req, res, () => { nextCalled = true; });
      assert.strictEqual(res._status, 429);
      assert.strictEqual(res._body.error.code, 'RATE_LIMIT_EXCEEDED');
      assert.strictEqual(nextCalled, false);
    });
  });

  describe('sanitizeInput', () => {
    it('should remove script tags from body', () => {
      const middleware = sanitizeInput();
      const req = {
        body: { content: '<script>alert("xss")</script>Hello' },
        query: {},
        params: {}
      };
      middleware(req, {}, () => {});

      assert.ok(!req.body.content.includes('<script>'), 'script tags should be removed');
      assert.ok(req.body.content.includes('Hello'), 'normal content should remain');
    });

    it('should remove event handlers', () => {
      const middleware = sanitizeInput();
      const req = {
        body: { img: '<img onclick="steal()" src="x">' },
        query: {},
        params: {}
      };
      middleware(req, {}, () => {});

      assert.ok(!req.body.img.includes('onclick'), 'onclick should be removed');
    });

    it('should not modify non-string values', () => {
      const middleware = sanitizeInput();
      const req = {
        body: { count: 42, flag: true },
        query: {},
        params: {}
      };
      middleware(req, {}, () => {});

      assert.strictEqual(req.body.count, 42);
      assert.strictEqual(req.body.flag, true);
    });
  });
});
