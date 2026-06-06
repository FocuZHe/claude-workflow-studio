/**
 * API Key 管理服务 — 多配置支持
 * 每个配置包含名称、API Key、Base URL、模型名
 * 支持多配置随时切换，密钥 AES-256-GCM 加密存储
 * 支持为 haiku/sonnet/opus 分别配置映射模型
 */
export interface ApiKeyConfig {
    id: string;
    name: string;
    apiKeyEncrypted: string;
    baseUrl: string;
    model: string;
    modelMappings?: {
        haiku?: string;
        sonnet?: string;
        opus?: string;
    };
    createdAt: string;
    updatedAt: string;
}
export interface ApiKeyData {
    configs: ApiKeyConfig[];
    defaultId: string | null;
}
export interface ApiKeyConfigSummary {
    id: string;
    name: string;
    model: string;
    modelMappings?: {
        haiku?: string;
        sonnet?: string;
        opus?: string;
    };
    baseUrl: string;
    hasKey: boolean;
    keySuffix: string;
    isDefault: boolean;
    createdAt: string;
    updatedAt: string;
}
export interface CreateConfigInput {
    name: string;
    apiKey: string;
    baseUrl?: string;
    model?: string;
    modelMappings?: {
        haiku?: string;
        sonnet?: string;
        opus?: string;
    };
}
export interface UpdateConfigInput {
    name?: string;
    apiKey?: string;
    baseUrl?: string;
    model?: string;
    modelMappings?: {
        haiku?: string;
        sonnet?: string;
        opus?: string;
    };
}
export interface ClientConfig {
    apiKey: string;
    baseUrl: string | null;
    model: string;
    modelMappings: {
        haiku: string;
        sonnet: string;
        opus: string;
    };
    configName: string;
}
export interface TestResult {
    valid: boolean;
    latencyMs: number;
    modelUsed: string;
}
export declare class ApiKeyService {
    static _dataDir: string;
    static _filePath: string;
    static _encryptionKey: Buffer | null;
    static REQUIRED_MODEL_TYPES: string[];
    static _getEncryptionKey(): Buffer;
    static encrypt(plaintext: string): string;
    static decrypt(encryptedJson: string): string | null;
    static load(): ApiKeyData;
    static save(data: ApiKeyData): void;
    /** Get all configs (keys hidden, only last 4 chars shown) */
    static getAllConfigs(): ApiKeyConfigSummary[];
    /** Create a new config */
    static createConfig({ name, apiKey, baseUrl, model, modelMappings }: CreateConfigInput): {
        id: string;
        name: string;
    };
    /** Update a config */
    static updateConfig(id: string, { name, apiKey, baseUrl, model, modelMappings }: UpdateConfigInput): {
        id: string;
        name: string;
    };
    /** Delete a config */
    static deleteConfig(id: string): {
        deleted: boolean;
    };
    /** Set default config */
    static setDefault(id: string): {
        defaultId: string;
    };
    /** Get client config for SDK use (resolves model + apiKey from default config) */
    static getClientConfig(): ClientConfig;
    /** Resolve a model alias to actual model ID */
    static resolveModel(alias?: string): string;
    /** Test a specific config */
    static testConfig(id: string): Promise<TestResult>;
}
//# sourceMappingURL=ApiKeyService.d.ts.map