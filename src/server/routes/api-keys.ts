const express = require('express');
const router = express.Router();
const ApiKeyService = require('../services/ApiKeyService');
const logger = require('../utils/logger');

// GET /api/keys — list all configs
router.get('/', (req: any, res: any, next: any) => {
  try {
    const configs = ApiKeyService.getAllConfigs();
    res.json({ success: true, data: configs });
  } catch (err) {
    logger.error('Failed to list API key configs:', err);
    next(err);
  }
});

// POST /api/keys — create config
router.post('/', (req: any, res: any, next: any) => {
  try {
    const { name, apiKey, baseUrl, model, modelMappings } = req.body;
    if (!name) return res.status(400).json({ success: false, error: 'name is required' });
    if (!apiKey) return res.status(400).json({ success: false, error: 'apiKey is required' });
    const result = ApiKeyService.createConfig({ name, apiKey, baseUrl, model, modelMappings });
    res.status(201).json({ success: true, data: result });
  } catch (err) {
    logger.error('Failed to create API key config:', err);
    next(err);
  }
});

// PUT /api/keys/:id — update config
router.put('/:id', (req: any, res: any, next: any) => {
  try {
    const { name, apiKey, baseUrl, model, modelMappings } = req.body;
    const result = ApiKeyService.updateConfig(req.params.id, { name, apiKey, baseUrl, model, modelMappings });
    res.json({ success: true, data: result });
  } catch (err) {
    logger.error('Failed to update API key config:', err);
    if (err.message && err.message.includes('not found')) {
      return res.status(404).json({ success: false, error: '配置不存在' });
    }
    next(err);
  }
});

// 注：已移除 GET /api/keys/:id/key 端点（返回解密后的明文密钥属于安全风险）
// 编辑配置时，前端 API Key 字段留空表示不修改原密钥（见 SettingsPage）

// DELETE /api/keys/:id — delete config
router.delete('/:id', (req: any, res: any, next: any) => {
  try {
    const result = ApiKeyService.deleteConfig(req.params.id);
    res.json({ success: true, data: result });
  } catch (err) {
    logger.error('Failed to delete API key config:', err);
    if (err.message && err.message.includes('not found')) {
      return res.status(404).json({ success: false, error: '配置不存在' });
    }
    next(err);
  }
});

// PUT /api/keys/:id/default — set as default
router.put('/:id/default', (req: any, res: any, next: any) => {
  try {
    const result = ApiKeyService.setDefault(req.params.id);
    res.json({ success: true, data: result });
  } catch (err) {
    logger.error('Failed to set default API key:', err);
    if (err.message && err.message.includes('not found')) {
      return res.status(404).json({ success: false, error: '配置不存在' });
    }
    next(err);
  }
});

// GET /api/keys/:id/test — test config
router.get('/:id/test', async (req: any, res: any, next: any) => {
  try {
    const result = await ApiKeyService.testConfig(req.params.id);
    res.json({ success: true, data: result });
  } catch (err) {
    logger.error('Failed to test API key config:', err);
    // For test endpoint, the error is the test result (connection failed reason)
    // Return it as test failure data, not as an error response
    res.json({ success: true, data: { valid: false, error: '连接测试失败' } });
  }
});

module.exports = router;
