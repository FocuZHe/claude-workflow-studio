const fs = require('fs');
const path = require('path');
const logger = require('../utils/logger');

/**
 * Safety service - provides centralized security management
 * Handles threat logging, security rules, and safety scoring
 */
class SafetyService {
  /**
   * @param {string} dataDir - Directory for storing safety data files
   */
  constructor(dataDir) {
    this.dataDir = dataDir || path.join(__dirname, '../../workspace/WORKFLOWS');
    this.threatsFile = path.join(this.dataDir, 'safety-threats.json');
    this.rulesFile = path.join(this.dataDir, 'safety-rules.json');

    // In-memory storage
    this.threats = [];
    this.rules = [];

    // Maximum threats to keep
    this.MAX_THREATS = 10000;

    // Default security rules
    this.DEFAULT_RULES = [
      {
        id: 'default-rate-limit',
        name: '默认速率限制',
        description: '限制每个IP在指定时间窗口内的请求数量',
        type: 'rate-limit',
        config: {
          windowMs: 60000,
          max: 100
        },
        enabled: true,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      },
      {
        id: 'default-size-limit',
        name: '请求体大小限制',
        description: '限制请求体的最大大小',
        type: 'size-limit',
        config: {
          maxSize: 10485760 // 10MB
        },
        enabled: true,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      },
      {
        id: 'default-sql-detection',
        name: 'SQL注入检测',
        description: '检测SQL注入攻击模式',
        type: 'pattern',
        config: {
          patterns: [
            'union select',
            'drop table',
            'insert into',
            'delete from'
          ]
        },
        enabled: true,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      },
      {
        id: 'default-xss-detection',
        name: 'XSS攻击检测',
        description: '检测跨站脚本攻击模式',
        type: 'pattern',
        config: {
          patterns: [
            '<script>',
            'javascript:',
            'onerror=',
            'onload='
          ]
        },
        enabled: true,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      },
      {
        id: 'default-path-traversal',
        name: '路径遍历检测',
        description: '检测路径遍历攻击模式',
        type: 'pattern',
        config: {
          patterns: [
            '../',
            '..\\'
          ]
        },
        enabled: true,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      }
    ];

    // Initialize data directory and load data
    this.init();
  }

  /**
   * Initialize service - ensure directory exists and load data
   */
  init() {
    try {
      // Ensure data directory exists
      if (!fs.existsSync(this.dataDir)) {
        fs.mkdirSync(this.dataDir, { recursive: true });
        logger.info(`Created safety data directory: ${this.dataDir}`);
      }

      // Load existing data
      this.loadThreats();
      this.loadRules();

      logger.info('SafetyService initialized successfully');
    } catch (err) {
      logger.error(`Failed to initialize SafetyService: ${err.message}`);
      // Initialize with empty arrays as fallback
      this.threats = [];
      this.rules = [...this.DEFAULT_RULES];
    }
  }

  /**
   * Load threats from file
   */
  loadThreats() {
    try {
      if (fs.existsSync(this.threatsFile)) {
        const data = fs.readFileSync(this.threatsFile, 'utf-8');
        this.threats = JSON.parse(data);
        logger.info(`Loaded ${this.threats.length} threat records`);
      } else {
        this.threats = [];
      }
    } catch (err) {
      logger.error(`Failed to load threats: ${err.message}`);
      this.threats = [];
    }
  }

  /**
   * Save threats to file
   */
  saveThreats() {
    try {
      // Trim to max size if needed
      if (this.threats.length > this.MAX_THREATS) {
        this.threats = this.threats.slice(this.threats.length - this.MAX_THREATS);
      }
      fs.writeFileSync(this.threatsFile, JSON.stringify(this.threats, null, 2));
    } catch (err) {
      logger.error(`Failed to save threats: ${err.message}`);
    }
  }

  /**
   * Load rules from file
   */
  loadRules() {
    try {
      if (fs.existsSync(this.rulesFile)) {
        const data = fs.readFileSync(this.rulesFile, 'utf-8');
        this.rules = JSON.parse(data);
        logger.info(`Loaded ${this.rules.length} security rules`);
      } else {
        // Initialize with default rules
        this.rules = [...this.DEFAULT_RULES];
        this.saveRules();
        logger.info('Initialized with default security rules');
      }
    } catch (err) {
      logger.error(`Failed to load rules: ${err.message}`);
      this.rules = [...this.DEFAULT_RULES];
    }
  }

  /**
   * Save rules to file
   */
  saveRules() {
    try {
      fs.writeFileSync(this.rulesFile, JSON.stringify(this.rules, null, 2));
    } catch (err) {
      logger.error(`Failed to save rules: ${err.message}`);
    }
  }

  /**
   * Log a threat event
   * @param {Object} event - Threat event object
   * @param {string} event.ip - Source IP address
   * @param {string} event.type - Threat type (sql-injection, xss, path-traversal, command-injection)
   * @param {string} event.pattern - Matched pattern
   * @param {string} event.severity - Severity level (high, medium, low)
   * @param {string} event.description - Human-readable description
   * @param {string} event.url - Request URL
   * @param {string} event.method - HTTP method
   * @param {string} event.timestamp - ISO timestamp
   * @returns {Object} Saved threat event with id
   */
  logThreat(event) {
    const threat = {
      id: `threat-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      ip: event.ip || 'unknown',
      type: event.type || 'unknown',
      pattern: event.pattern || '',
      severity: event.severity || 'medium',
      description: event.description || 'Unknown threat detected',
      url: event.url || '',
      method: event.method || 'UNKNOWN',
      timestamp: event.timestamp || new Date().toISOString()
    };

    this.threats.push(threat);
    this.saveThreats();

    logger.warn(`Threat logged: ${threat.type} from ${threat.ip}`, {
      id: threat.id,
      severity: threat.severity,
      url: threat.url
    });

    return threat;
  }

  /**
   * Query threats with filtering and pagination
   * @param {Object} options - Query options
   * @param {number} options.page - Page number (default: 1)
   * @param {number} options.limit - Items per page (default: 20)
   * @param {string} options.type - Filter by threat type
   * @param {string} options.severity - Filter by severity
   * @param {string} options.startDate - Filter by start date (ISO string)
   * @param {string} options.endDate - Filter by end date (ISO string)
   * @returns {Object} { data: Threat[], meta: { total, page, limit, totalPages } }
   */
  getThreats(options = {}) {
    const {
      page = 1,
      limit = 20,
      type,
      severity,
      startDate,
      endDate
    } = options;

    let filtered = [...this.threats];

    // Apply filters
    if (type) {
      filtered = filtered.filter(t => t.type === type);
    }
    if (severity) {
      filtered = filtered.filter(t => t.severity === severity);
    }
    if (startDate) {
      const start = new Date(startDate);
      filtered = filtered.filter(t => new Date(t.timestamp) >= start);
    }
    if (endDate) {
      const end = new Date(endDate);
      filtered = filtered.filter(t => new Date(t.timestamp) <= end);
    }

    // Sort by timestamp descending (newest first)
    filtered.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));

    // Calculate pagination
    const total = filtered.length;
    const totalPages = Math.ceil(total / limit);
    const startIndex = (page - 1) * limit;
    const paginatedData = filtered.slice(startIndex, startIndex + limit);

    return {
      data: paginatedData,
      meta: {
        total,
        page,
        limit,
        totalPages
      }
    };
  }

  /**
   * Get threat statistics
   * @returns {Object} Statistics object
   */
  getThreatStats() {
    const now = new Date();
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    todayStart.setHours(0, 0, 0, 0);

    // Filter today's threats
    const todayThreats = this.threats.filter(t => {
      const threatDate = new Date(t.timestamp);
      return threatDate >= todayStart;
    });

    // Count by type
    const byType = {};
    for (const threat of todayThreats) {
      byType[threat.type] = (byType[threat.type] || 0) + 1;
    }

    // Count by severity
    const bySeverity = {
      high: 0,
      medium: 0,
      low: 0
    };
    for (const threat of todayThreats) {
      if (bySeverity.hasOwnProperty(threat.severity)) {
        bySeverity[threat.severity]++;
      }
    }

    // Count blocked (high severity)
    const blockedCount = todayThreats.filter(t => t.severity === 'high').length;

    return {
      todayTotal: todayThreats.length,
      totalAllTime: this.threats.length,
      byType,
      bySeverity,
      blockedCount
    };
  }

  /**
   * Get all security rules
   * @returns {Object[]} Array of rules
   */
  getRules() {
    return [...this.rules];
  }

  /**
   * Add a new security rule
   * @param {Object} rule - Rule to add
   * @param {string} rule.name - Rule name
   * @param {string} rule.description - Rule description
   * @param {string} rule.type - Rule type (rate-limit, size-limit, pattern)
   * @param {Object} rule.config - Rule configuration
   * @param {boolean} rule.enabled - Whether rule is enabled
   * @returns {Object} Created rule with id
   */
  addRule(rule) {
    const newRule = {
      id: `rule-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      name: rule.name || 'Unnamed Rule',
      description: rule.description || '',
      type: rule.type || 'pattern',
      config: rule.config || {},
      enabled: rule.enabled !== false,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };

    this.rules.push(newRule);
    this.saveRules();

    logger.info(`Security rule added: ${newRule.name}`, { id: newRule.id });

    return newRule;
  }

  /**
   * Update an existing security rule
   * @param {string} id - Rule ID
   * @param {Object} updates - Fields to update
   * @returns {Object|null} Updated rule or null if not found
   */
  updateRule(id, updates) {
    const index = this.rules.findIndex(r => r.id === id);
    if (index === -1) {
      logger.warn(`Security rule not found: ${id}`);
      return null;
    }

    // Apply updates (don't allow id to be changed)
    const { id: _, ...updateData } = updates;
    this.rules[index] = {
      ...this.rules[index],
      ...updateData,
      id, // Ensure id stays the same
      updatedAt: new Date().toISOString()
    };

    this.saveRules();

    logger.info(`Security rule updated: ${id}`);

    return this.rules[index];
  }

  /**
   * Delete a security rule
   * @param {string} id - Rule ID
   * @returns {boolean} True if deleted, false if not found
   */
  deleteRule(id) {
    const index = this.rules.findIndex(r => r.id === id);
    if (index === -1) {
      logger.warn(`Security rule not found: ${id}`);
      return false;
    }

    const deleted = this.rules.splice(index, 1)[0];
    this.saveRules();

    logger.info(`Security rule deleted: ${deleted.name}`, { id });

    return true;
  }

  /**
   * Toggle a rule's enabled/disabled status
   * @param {string} id - Rule ID
   * @returns {Object|null} Updated rule or null if not found
   */
  toggleRule(id) {
    const rule = this.rules.find(r => r.id === id);
    if (!rule) {
      logger.warn(`Security rule not found: ${id}`);
      return null;
    }

    rule.enabled = !rule.enabled;
    rule.updatedAt = new Date().toISOString();

    this.saveRules();

    logger.info(`Security rule toggled: ${rule.name}`, { id, enabled: rule.enabled });

    return rule;
  }

  /**
   * Calculate safety score (0-100)
   * @returns {Object} { score, breakdown }
   */
  getSafetyScore() {
    let score = 100;
    const breakdown = [];

    const now = new Date();
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    todayStart.setHours(0, 0, 0, 0);

    // Get today's threats
    const todayThreats = this.threats.filter(t => {
      const threatDate = new Date(t.timestamp);
      return threatDate >= todayStart;
    });

    // Deduct for high severity threats: -5 each
    const highCount = todayThreats.filter(t => t.severity === 'high').length;
    if (highCount > 0) {
      const deduction = highCount * 5;
      score -= deduction;
      breakdown.push({
        reason: `今日高危威胁 ${highCount} 个`,
        deduction
      });
    }

    // Deduct for medium severity threats: -2 each
    const mediumCount = todayThreats.filter(t => t.severity === 'medium').length;
    if (mediumCount > 0) {
      const deduction = mediumCount * 2;
      score -= deduction;
      breakdown.push({
        reason: `今日中危威胁 ${mediumCount} 个`,
        deduction
      });
    }

    // Deduct for low severity threats: -0.5 each
    const lowCount = todayThreats.filter(t => t.severity === 'low').length;
    if (lowCount > 0) {
      const deduction = Math.ceil(lowCount * 0.5);
      score -= deduction;
      breakdown.push({
        reason: `今日低危威胁 ${lowCount} 个`,
        deduction
      });
    }

    // Check for rate limit rule
    const hasRateLimit = this.rules.some(r => r.type === 'rate-limit' && r.enabled);
    if (!hasRateLimit) {
      score -= 10;
      breakdown.push({
        reason: '缺少速率限制规则',
        deduction: 10
      });
    }

    // Check for IP ban rule (we check if there's any blocking mechanism)
    const hasBlocking = this.rules.some(r =>
      (r.type === 'ip-ban' || r.type === 'block') && r.enabled
    );
    if (!hasBlocking) {
      score -= 5;
      breakdown.push({
        reason: '缺少IP封禁规则',
        deduction: 5
      });
    }

    // Clamp score between 0 and 100
    score = Math.max(0, Math.min(100, score));

    return {
      score,
      breakdown,
      evaluatedAt: new Date().toISOString()
    };
  }

  /**
   * Comprehensive request safety check
   * @param {Object} req - Express request object
   * @returns {Object} { safe, threats[], score }
   */
  checkRequest(req) {
    const threats = [];
    let safe = true;

    // Check all enabled pattern rules
    const enabledRules = this.rules.filter(r => r.enabled && r.type === 'pattern');

    // Extract strings from request
    const extractStrings = (obj) => {
      if (obj === null || obj === undefined) return [];
      if (typeof obj === 'string') return [obj];
      if (Array.isArray(obj)) return obj.flatMap(extractStrings);
      if (typeof obj === 'object') return Object.values(obj).flatMap(extractStrings);
      return [];
    };

    const sources = [
      { name: 'body', data: req.body },
      { name: 'query', data: req.query },
      { name: 'params', data: req.params }
    ];

    for (const rule of enabledRules) {
      const patterns = rule.config.patterns || [];

      for (const source of sources) {
        if (!source.data) continue;

        const strings = extractStrings(source.data);
        const fullText = strings.join(' ').toLowerCase();

        for (const pattern of patterns) {
          if (fullText.includes(pattern.toLowerCase())) {
            const threat = {
              ruleId: rule.id,
              ruleName: rule.name,
              type: rule.type,
              pattern,
              source: source.name,
              severity: 'high'
            };
            threats.push(threat);
            safe = false;

            // Log the threat
            this.logThreat({
              ip: req.ip || req.connection?.remoteAddress || 'unknown',
              type: rule.type,
              pattern,
              severity: 'high',
              description: `匹配安全规则: ${rule.name}`,
              url: req.originalUrl || req.url,
              method: req.method,
              timestamp: new Date().toISOString()
            });
          }
        }
      }
    }

    const { score } = this.getSafetyScore();

    return {
      safe,
      threats,
      score,
      checkedAt: new Date().toISOString()
    };
  }
}

module.exports = SafetyService;
