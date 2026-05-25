const express = require('express');
const router = express.Router();
const ApiKeyService = require('../services/ApiKeyService');

// GET /api/keys — list all configs
router.get('/', (req, res) => {
  try {
    const configs = ApiKeyService.getAllConfigs();
    res.json({ success: true, data: configs });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// POST /api/keys — create config
router.post('/', (req, res) => {
  try {
    const { name, apiKey, baseUrl, model } = req.body;
    if (!name) return res.status(400).json({ success: false, error: 'name is required' });
    if (!apiKey) return res.status(400).json({ success: false, error: 'apiKey is required' });
    const result = ApiKeyService.createConfig({ name, apiKey, baseUrl, model });
    res.status(201).json({ success: true, data: result });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// PUT /api/keys/:id — update config
router.put('/:id', (req, res) => {
  try {
    const { name, apiKey, baseUrl, model } = req.body;
    const result = ApiKeyService.updateConfig(req.params.id, { name, apiKey, baseUrl, model });
    res.json({ success: true, data: result });
  } catch (err) {
    res.status(err.message.includes('not found') ? 404 : 500).json({ success: false, error: err.message });
  }
});

// GET /api/keys/:id/key — get decrypted key
router.get('/:id/key', (req, res) => {
  try {
    const data = ApiKeyService.load();
    const config = data.configs.find(c => c.id === req.params.id);
    if (!config) return res.status(404).json({ success: false, error: 'not found' });
    const key = ApiKeyService.decrypt(config.apiKeyEncrypted);
    if (!key) return res.status(400).json({ success: false, error: 'decrypt failed' });
    res.json({ success: true, data: { key } });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// DELETE /api/keys/:id — delete config
router.delete('/:id', (req, res) => {
  try {
    const result = ApiKeyService.deleteConfig(req.params.id);
    res.json({ success: true, data: result });
  } catch (err) {
    res.status(err.message.includes('not found') ? 404 : 500).json({ success: false, error: err.message });
  }
});

// PUT /api/keys/:id/default — set as default
router.put('/:id/default', (req, res) => {
  try {
    const result = ApiKeyService.setDefault(req.params.id);
    res.json({ success: true, data: result });
  } catch (err) {
    res.status(err.message.includes('not found') ? 404 : 500).json({ success: false, error: err.message });
  }
});

// GET /api/keys/:id/test — test config
router.get('/:id/test', async (req, res) => {
  try {
    const result = await ApiKeyService.testConfig(req.params.id);
    res.json({ success: true, data: result });
  } catch (err) {
    res.json({ success: true, data: { valid: false, error: err.message } });
  }
});

module.exports = router;
