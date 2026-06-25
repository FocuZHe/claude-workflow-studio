"use strict";
/**
 * API Key 管理服务 — 多配置支持
 * 每个配置包含名称、API Key、Base URL、模型名
 * 支持多配置随时切换，密钥 AES-256-GCM 加密存储
 * 支持为 haiku/sonnet/opus 分别配置映射模型
 */
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.ApiKeyService = void 0;
const crypto_1 = __importDefault(require("crypto"));
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const logger = require('../utils/logger');
const { generateId } = require('../utils/id');
class ApiKeyService {
    static _dataDir = path_1.default.join(process.cwd(), 'data');
    static _filePath = path_1.default.join(ApiKeyService._dataDir, 'api-keys.enc.json');
    static _encryptionKey = null;
    // 模型映射验证 - 必须填写
    static REQUIRED_MODEL_TYPES = ['haiku', 'sonnet', 'opus'];
    static _getEncryptionKey() {
        if (ApiKeyService._encryptionKey)
            return ApiKeyService._encryptionKey;
        const keyFile = path_1.default.join(ApiKeyService._dataDir, '.keyfile');
        try {
            if (fs_1.default.existsSync(keyFile)) {
                ApiKeyService._encryptionKey = Buffer.from(fs_1.default.readFileSync(keyFile, 'utf-8').trim(), 'hex');
            }
            else {
                ApiKeyService._encryptionKey = crypto_1.default.randomBytes(32);
                // 设置文件权限 0600：仅所有者可读写
                fs_1.default.writeFileSync(keyFile, ApiKeyService._encryptionKey.toString('hex'), { encoding: 'utf-8', mode: 0o600 });
            }
        }
        catch (e) {
            // 不再使用 process.cwd() 等公开信息作为弱密钥回退，直接抛错阻止启动
            throw new Error(`Failed to load/generate encryption key file (${keyFile}): ${e.message}. Aborting to prevent weak key.`);
        }
        return ApiKeyService._encryptionKey;
    }
    static encrypt(plaintext) {
        const key = ApiKeyService._getEncryptionKey();
        const iv = crypto_1.default.randomBytes(12);
        const cipher = crypto_1.default.createCipheriv('aes-256-gcm', key, iv);
        const encrypted = Buffer.concat([cipher.update(plaintext, 'utf-8'), cipher.final()]);
        const authTag = cipher.getAuthTag();
        return JSON.stringify({ iv: iv.toString('hex'), data: encrypted.toString('hex'), tag: authTag.toString('hex') });
    }
    static decrypt(encryptedJson) {
        try {
            const { iv, data, tag } = JSON.parse(encryptedJson);
            const key = ApiKeyService._getEncryptionKey();
            const decipher = crypto_1.default.createDecipheriv('aes-256-gcm', key, Buffer.from(iv, 'hex'));
            decipher.setAuthTag(Buffer.from(tag, 'hex'));
            const decrypted = Buffer.concat([decipher.update(Buffer.from(data, 'hex')), decipher.final()]);
            return decrypted.toString('utf-8');
        }
        catch (e) {
            return null;
        }
    }
    static load() {
        try {
            if (fs_1.default.existsSync(ApiKeyService._filePath)) {
                const raw = JSON.parse(fs_1.default.readFileSync(ApiKeyService._filePath, 'utf-8'));
                return { configs: raw.configs || [], defaultId: raw.defaultId || null };
            }
        }
        catch (e) {
            logger.warn(`Failed to load API key config: ${e.message}`);
        }
        return { configs: [], defaultId: null };
    }
    static save(data) {
        try {
            if (!fs_1.default.existsSync(ApiKeyService._dataDir))
                fs_1.default.mkdirSync(ApiKeyService._dataDir, { recursive: true });
            // 写入前备份现有文件
            if (fs_1.default.existsSync(ApiKeyService._filePath)) {
                const bakPath = ApiKeyService._filePath + '.bak';
                fs_1.default.copyFileSync(ApiKeyService._filePath, bakPath);
            }
            fs_1.default.writeFileSync(ApiKeyService._filePath, JSON.stringify(data, null, 2), 'utf-8');
        }
        catch (e) {
            logger.error(`Failed to save API key config: ${e.message}`);
            throw e;
        }
    }
    /** Get all configs (keys hidden, only last 4 chars shown) */
    static getAllConfigs() {
        const data = ApiKeyService.load();
        const configs = Array.isArray(data.configs) ? data.configs : [];
        return configs.map(c => ({
            id: c.id,
            name: c.name,
            model: c.model || '',
            modelMappings: c.modelMappings || undefined,
            baseUrl: c.baseUrl || '',
            hasKey: !!c.apiKeyEncrypted,
            keySuffix: c.apiKeyEncrypted ? '••••' + (ApiKeyService.decrypt(c.apiKeyEncrypted) || '').slice(-4) : '',
            isDefault: c.id === data.defaultId,
            createdAt: c.createdAt,
            updatedAt: c.updatedAt,
        }));
    }
    /** Create a new config */
    static createConfig({ name, apiKey, baseUrl, model, modelMappings }) {
        if (!name || !apiKey)
            throw new Error('name and apiKey are required');
        // 验证模型映射必填
        if (!modelMappings?.haiku || !modelMappings?.sonnet || !modelMappings?.opus) {
            throw new Error('请配置 haiku、sonnet、opus 三种模型的映射');
        }
        const data = ApiKeyService.load();
        const config = {
            id: generateId(),
            name,
            apiKeyEncrypted: ApiKeyService.encrypt(apiKey),
            baseUrl: (baseUrl || '').replace(/\/+$/, ''),
            model: model || '',
            modelMappings: {
                haiku: modelMappings.haiku,
                sonnet: modelMappings.sonnet,
                opus: modelMappings.opus,
            },
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
        };
        data.configs.push(config);
        if (!data.defaultId)
            data.defaultId = config.id;
        ApiKeyService.save(data);
        logger.info(`API config created: ${config.name}`);
        return { id: config.id, name: config.name };
    }
    /** Update a config */
    static updateConfig(id, { name, apiKey, baseUrl, model, modelMappings }) {
        const data = ApiKeyService.load();
        const config = data.configs.find(c => c.id === id);
        if (!config)
            throw new Error(`Config '${id}' not found`);
        if (name !== undefined)
            config.name = name;
        if (apiKey !== undefined && apiKey !== '')
            config.apiKeyEncrypted = ApiKeyService.encrypt(apiKey);
        if (baseUrl !== undefined)
            config.baseUrl = baseUrl.replace(/\/+$/, '');
        if (model !== undefined)
            config.model = model;
        if (modelMappings !== undefined) {
            // 验证模型映射完整性
            const merged = { ...config.modelMappings, ...modelMappings };
            if (!merged.haiku || !merged.sonnet || !merged.opus) {
                throw new Error('请配置 haiku、sonnet、opus 三种模型的映射');
            }
            config.modelMappings = merged;
        }
        config.updatedAt = new Date().toISOString();
        ApiKeyService.save(data);
        logger.info(`API config updated: ${config.name}`);
        return { id, name: config.name };
    }
    /** Delete a config */
    static deleteConfig(id) {
        const data = ApiKeyService.load();
        const idx = data.configs.findIndex(c => c.id === id);
        if (idx === -1)
            throw new Error(`Config '${id}' not found`);
        const name = data.configs[idx].name;
        data.configs.splice(idx, 1);
        if (data.defaultId === id)
            data.defaultId = data.configs[0]?.id || null;
        ApiKeyService.save(data);
        logger.info(`API config deleted: ${name}`);
        return { deleted: true };
    }
    /** Set default config */
    static setDefault(id) {
        const data = ApiKeyService.load();
        if (!data.configs.find(c => c.id === id))
            throw new Error(`Config '${id}' not found`);
        data.defaultId = id;
        ApiKeyService.save(data);
        return { defaultId: id };
    }
    /** Get client config for SDK use (resolves model + apiKey from default config) */
    static getClientConfig() {
        const data = ApiKeyService.load();
        const config = data.configs.find(c => c.id === data.defaultId);
        if (!config)
            throw new Error('未配置 API Key，请在设置页面添加 API 配置');
        const apiKey = ApiKeyService.decrypt(config.apiKeyEncrypted);
        if (!apiKey)
            throw new Error('API Key 解密失败，请重新配置');
        // 检查模型映射是否完整
        if (!config.modelMappings?.haiku || !config.modelMappings?.sonnet || !config.modelMappings?.opus) {
            throw new Error('模型映射不完整，请在设置页面配置 haiku/sonnet/opus 的映射模型');
        }
        return {
            apiKey,
            baseUrl: config.baseUrl || null,
            model: config.model || 'claude-sonnet-4-6',
            modelMappings: {
                haiku: config.modelMappings.haiku,
                sonnet: config.modelMappings.sonnet,
                opus: config.modelMappings.opus,
            },
            configName: config.name,
        };
    }
    /** Resolve a model alias to actual model ID */
    static resolveModel(alias) {
        if (!alias) {
            const clientConfig = ApiKeyService.getClientConfig();
            return clientConfig.model || '';
        }
        const lowerAlias = alias.toLowerCase();
        // 首先检查是否是 haiku/sonnet/opus 别名
        if (['haiku', 'sonnet', 'opus'].includes(lowerAlias)) {
            const clientConfig = ApiKeyService.getClientConfig();
            // 使用配置中的映射
            return clientConfig.modelMappings[lowerAlias] || alias;
        }
        // 否则使用默认配置的模型
        const clientConfig = ApiKeyService.getClientConfig();
        return clientConfig.model || alias;
    }
    /** Test a specific config */
    static async testConfig(id) {
        const data = ApiKeyService.load();
        const config = data.configs.find(c => c.id === id);
        if (!config)
            throw new Error(`Config '${id}' not found`);
        // 验证模型映射是否配置
        if (!config.modelMappings?.haiku || !config.modelMappings?.sonnet || !config.modelMappings?.opus) {
            throw new Error('请先配置 haiku、sonnet、opus 三种模型的映射');
        }
        const apiKey = ApiKeyService.decrypt(config.apiKeyEncrypted);
        if (!apiKey)
            throw new Error('密钥解密失败');
        const { Anthropic } = require('@anthropic-ai/sdk');
        const opts = { apiKey };
        if (config.baseUrl)
            opts.baseURL = config.baseUrl;
        const client = new Anthropic(opts);
        // 使用 haiku 模型进行测试（最快最便宜）
        const testModel = config.modelMappings.haiku;
        const start = Date.now();
        try {
            const response = await client.messages.create({
                model: testModel,
                max_tokens: 10,
                messages: [{ role: 'user', content: 'hi' }],
            });
            return {
                valid: true,
                latencyMs: Date.now() - start,
                modelUsed: response.model
            };
        }
        catch (err) {
            // 如果 haiku 失败，尝试 sonnet
            if (config.modelMappings.sonnet !== testModel) {
                try {
                    const response = await client.messages.create({
                        model: config.modelMappings.sonnet,
                        max_tokens: 10,
                        messages: [{ role: 'user', content: 'hi' }],
                    });
                    return {
                        valid: true,
                        latencyMs: Date.now() - start,
                        modelUsed: response.model
                    };
                }
                catch (err2) {
                    throw new Error(`连接测试失败: ${err2.message}`);
                }
            }
            throw new Error(`连接测试失败: ${err.message}`);
        }
    }
}
exports.ApiKeyService = ApiKeyService;
// 使用 CommonJS 导出以保持与现有路由的兼容性
module.exports = ApiKeyService;
module.exports.ApiKeyService = ApiKeyService;
module.exports.default = ApiKeyService;
//# sourceMappingURL=ApiKeyService.js.map