"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express = require('express');
const router = express.Router();
const SkillService = require('../services/SkillService');
const { AppError } = require('../middleware/errorHandler');
/**
 * GET /api/skills - List all skills
 */
router.get('/', (req, res, next) => {
    try {
        const skills = SkillService.getAll();
        res.json({ success: true, data: skills });
    }
    catch (err) {
        next(err);
    }
});
/**
 * GET /api/skills/installed - Get all globally installed skills
 */
router.get('/installed', (req, res, next) => {
    try {
        const skills = SkillService.getInstalled ? SkillService.getInstalled() : [];
        res.json({ success: true, data: skills });
    }
    catch (err) {
        next(err);
    }
});
/**
 * GET /api/skills/agent/:agentId - Get skills installed for an agent
 */
router.get('/agent/:agentId', (req, res) => {
    const skills = SkillService.getByAgent(req.params.agentId);
    res.json({ success: true, data: skills });
});
/**
 * POST /api/skills/:id/install - Install skill
 */
router.post('/:id/install', (req, res, next) => {
    try {
        const { agentId, installCmd, name } = req.body;
        const result = SkillService.install(req.params.id, agentId || null, { installCmd, name });
        res.status(201).json({ success: true, data: { skillId: req.params.id, agentId: agentId || null, ...result } });
    }
    catch (err) {
        next(err);
    }
});
/**
 * DELETE /api/skills/:id/uninstall/:agentId - Uninstall skill for agent
 */
router.delete('/:id/uninstall/:agentId', (req, res, next) => {
    try {
        const result = SkillService.uninstall(req.params.id, req.params.agentId);
        res.json({ success: true, data: result });
    }
    catch (err) {
        next(err);
    }
});
/**
 * DELETE /api/skills/:id/uninstall - Uninstall skill globally (fallback)
 */
router.delete('/:id/uninstall', (req, res, next) => {
    try {
        const result = SkillService.uninstall(req.params.id, 'all');
        res.json({ success: true, data: result });
    }
    catch (err) {
        next(err);
    }
});
module.exports = router;
//# sourceMappingURL=skills.js.map