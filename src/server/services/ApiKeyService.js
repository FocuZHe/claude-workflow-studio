const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const logger = require('../utils/logger');
const { generateId } = require('../utils/id');

/**
 * API Key 管理服务 — 多配置支持
 * 每个配置包含名称、API Key、Base URL、模型名
 * 支持多配置随时切换，密钥 AES-256-GCM 加密存储
 */
class ApiKeyService {
  static _dataDir = path.join(process.cwd(), 'data');
  static _filePath = path.join(ApiKeyService._dataDir, 'api-keys.enc.json');
  static _encryptionKey = null;

  static _getEncryptionKey() {
    if (ApiKeyService._encryptionKey) return ApiKeyService._encryptionKey;
    const keyFile = path.join(ApiKeyService._dataDir, '.keyfile');
    try {
      if (fs.existsSync(keyFile)) {
        ApiKeyService._encryptionKey = Buffer.from(fs.readFileSync(keyFile, 'utf-8').trim(), 'hex');
      } else {
        ApiKeyService._encryptionKey = crypto.randomBytes(32);
        fs.writeFileSync(keyFile, ApiKeyService._encryptionKey.toString('hex'), 'utf-8');
      }
    } catch (e) {
      logger.warn('Failed to load/generate encryption key, using fallback');
      ApiKeyService._encryptionKey = crypto.createHash('sha256').update(process.cwd()).digest();
    }
    return ApiKeyService._encryptionKey;
  }

  static encrypt(plaintext) {
    const key = ApiKeyService._getEncryptionKey();
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
    const encrypted = Buffer.concat([cipher.update(plaintext, 'utf-8'), cipher.final()]);
    const authTag = cipher.getAuthTag();
    return JSON.stringify({ iv: iv.toString('hex'), data: encrypted.toString('hex'), tag: authTag.toString('hex') });
  }

  static decrypt(encryptedJson) {
    try {
      const { iv, data, tag } = JSON.parse(encryptedJson);
      const key = ApiKeyService._getEncryptionKey();
      const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(iv, 'hex'));
      decipher.setAuthTag(Buffer.from(tag, 'hex'));
      const decrypted = Buffer.concat([decipher.update(Buffer.from(data, 'hex')), decipher.final()]);
      return decrypted.toString('utf-8');
    } catch (e) { return null; }
  }

  static load() {
    try {
      if (fs.existsSync(ApiKeyService._filePath)) {
        const raw = JSON.parse(fs.readFileSync(ApiKeyService._filePath, 'utf-8'));
        return { configs: raw.configs || [], defaultId: raw.defaultId || null };
      }
    } catch (e) { logger.warn(`Failed to load API key config: ${e.message}`); }
    return { configs: [], defaultId: null };
  }

  static save(data) {
    try {
      if (!fs.existsSync(ApiKeyService._dataDir)) fs.mkdirSync(ApiKeyService._dataDir, { recursive: true });
      fs.writeFileSync(ApiKeyService._filePath, JSON.stringify(data, null, 2), 'utf-8');
    } catch (e) { logger.error(`Failed to save API key config: ${e.message}`); throw e; }
  }

  /** Get all configs (keys hidden, only last 4 chars shown) */
  static getAllConfigs() {
    const data = ApiKeyService.load();
    const configs = Array.isArray(data.configs) ? data.configs : [];
    return configs.map(c => ({
      id: c.id,
      name: c.name,
      model: c.model || '',
      baseUrl: c.baseUrl || '',
      hasKey: !!c.apiKeyEncrypted,
      keySuffix: c.apiKeyEncrypted ? '••••' + (ApiKeyService.decrypt(c.apiKeyEncrypted) || '').slice(-4) : '',
      isDefault: c.id === data.defaultId,
      createdAt: c.createdAt,
      updatedAt: c.updatedAt,
    }));
  }

  /** Create a new config */
  static createConfig({ name, apiKey, baseUrl, model }) {
    if (!name || !apiKey) throw new Error('name and apiKey are required');
    const data = ApiKeyService.load();
    const config = {
      id: generateId(),
      name,
      apiKeyEncrypted: ApiKeyService.encrypt(apiKey),
      baseUrl: (baseUrl || '').replace(/\/+$/, ''),
      model: model || '',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    data.configs.push(config);
    if (!data.defaultId) data.defaultId = config.id;
    ApiKeyService.save(data);
    logger.info(`API config created: ${config.name}`);
    return { id: config.id, name: config.name };
  }

  /** Update a config */
  static updateConfig(id, { name, apiKey, baseUrl, model }) {
    const data = ApiKeyService.load();
    const config = data.configs.find(c => c.id === id);
    if (!config) throw new Error(`Config '${id}' not found`);
    if (name !== undefined) config.name = name;
    if (apiKey !== undefined && apiKey !== '') config.apiKeyEncrypted = ApiKeyService.encrypt(apiKey);
    if (baseUrl !== undefined) config.baseUrl = baseUrl.replace(/\/+$/, '');
    if (model !== undefined) config.model = model;
    config.updatedAt = new Date().toISOString();
    ApiKeyService.save(data);
    logger.info(`API config updated: ${config.name}`);
    return { id, name: config.name };
  }

  /** Delete a config */
  static deleteConfig(id) {
    const data = ApiKeyService.load();
    const idx = data.configs.findIndex(c => c.id === id);
    if (idx === -1) throw new Error(`Config '${id}' not found`);
    const name = data.configs[idx].name;
    data.configs.splice(idx, 1);
    if (data.defaultId === id) data.defaultId = data.configs[0]?.id || null;
    ApiKeyService.save(data);
    logger.info(`API config deleted: ${name}`);
    return { deleted: true };
  }

  /** Set default config */
  static setDefault(id) {
    const data = ApiKeyService.load();
    if (!data.configs.find(c => c.id === id)) throw new Error(`Config '${id}' not found`);
    data.defaultId = id;
    ApiKeyService.save(data);
    return { defaultId: id };
  }

  /** Get client config for SDK use (resolves model + apiKey from default config) */
  static getClientConfig() {
    const data = ApiKeyService.load();
    const config = data.configs.find(c => c.id === data.defaultId);
    if (!config) throw new Error('未配置 API Key，请在设置页面添加 API 配置');
    const apiKey = ApiKeyService.decrypt(config.apiKeyEncrypted);
    if (!apiKey) throw new Error('API Key 解密失败，请重新配置');
    return {
      apiKey,
      baseUrl: config.baseUrl || null,
      model: config.model || 'claude-sonnet-4-6',
      configName: config.name,
    };
  }

  /** Resolve a model alias using the default config's model */
  static resolveModel(alias) {
    const clientConfig = ApiKeyService.getClientConfig();
    return clientConfig.model || alias;
  }

  /** Test a specific config */
  static async testConfig(id) {
    const data = ApiKeyService.load();
    const config = data.configs.find(c => c.id === id);
    if (!config) throw new Error(`Config '${id}' not found`);
    const apiKey = ApiKeyService.decrypt(config.apiKeyEncrypted);
    if (!apiKey) throw new Error('密钥解密失败');
    const { Anthropic } = require('@anthropic-ai/sdk');
    const opts = { apiKey };
    if (config.baseUrl) opts.baseURL = config.baseUrl;
    const client = new Anthropic(opts);
    const start = Date.now();
    const response = await client.messages.create({
      model: config.model || 'claude-haiku-4-5-20251001',
      max_tokens: 10,
      messages: [{ role: 'user', content: 'hi' }],
    });
    return { valid: true, latencyMs: Date.now() - start, modelUsed: response.model };
  }
}

module.exports = ApiKeyService;
