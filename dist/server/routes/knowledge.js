"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express = require('express');
const router = express.Router();
const KnowledgeService = require('../services/KnowledgeService');
const TagService = require('../services/TagService');
const { AppError } = require('../middleware/errorHandler');
// ---- Knowledge CRUD ----
router.get('/', (req, res, next) => {
    try {
        const { q, category, tag, page, limit } = req.query;
        res.json({
            success: true,
            data: KnowledgeService.search(q, {
                category,
                tag,
                page: parseInt(page) || 1,
                limit: parseInt(limit) || 20
            })
        });
    }
    catch (err) {
        next(err);
    }
});
router.post('/', (req, res, next) => {
    try {
        if (!req.body.title)
            throw new AppError('VALIDATION_ERROR', 'title is required', 400);
        res.status(201).json({ success: true, data: KnowledgeService.add(req.body) });
    }
    catch (err) {
        next(err);
    }
});
router.put('/:id', (req, res, next) => {
    try {
        const result = KnowledgeService.update(req.params.id, req.body);
        if (!result)
            throw new AppError('NOT_FOUND', 'Not found', 404);
        res.json({ success: true, data: result });
    }
    catch (err) {
        next(err);
    }
});
router.delete('/:id', (req, res, next) => {
    try {
        if (!KnowledgeService.delete(req.params.id))
            throw new AppError('NOT_FOUND', 'Not found', 404);
        res.json({ success: true });
    }
    catch (err) {
        next(err);
    }
});
// ---- Tags ----
router.get('/tags', (req, res, next) => {
    try {
        res.json({ success: true, data: TagService.list() });
    }
    catch (err) {
        next(err);
    }
});
router.post('/tags', (req, res, next) => {
    try {
        if (!req.body.name)
            throw new AppError('VALIDATION_ERROR', 'name is required', 400);
        const tag = TagService.create(req.body.name, req.body.color);
        if (!tag)
            throw new AppError('CONFLICT', '标签已存在', 409);
        res.status(201).json({ success: true, data: tag });
    }
    catch (err) {
        next(err);
    }
});
router.delete('/tags/:id', (req, res, next) => {
    try {
        if (!TagService.delete(req.params.id))
            throw new AppError('NOT_FOUND', 'Not found', 404);
        res.json({ success: true });
    }
    catch (err) {
        next(err);
    }
});
// ---- Export ----
router.get('/export', (req, res, next) => {
    try {
        const { format } = req.query; // json | csv | markdown
        const entries = KnowledgeService.getAll();
        if (format === 'csv') {
            const header = 'title,content,category,tags';
            const rows = entries.map((e) => {
                const escape = (s) => `"${String(s || '').replace(/"/g, '""')}"`;
                return [escape(e.title), escape(e.content), escape(e.category), escape((e.tags || []).join(';'))].join(',');
            });
            const csv = [header, ...rows].join('\n');
            res.setHeader('Content-Type', 'text/csv; charset=utf-8');
            res.setHeader('Content-Disposition', 'attachment; filename=knowledge-export.csv');
            res.send('﻿' + csv); // BOM for Excel Chinese support
        }
        else if (format === 'markdown') {
            const md = entries.map((e) => {
                let text = `# ${e.title}\n\n`;
                if (e.category)
                    text += `分类: ${e.category}\n`;
                if (e.tags?.length)
                    text += `标签: ${e.tags.join(', ')}\n`;
                text += `\n${e.content}\n\n---\n`;
                return text;
            }).join('\n');
            res.setHeader('Content-Type', 'text/markdown; charset=utf-8');
            res.setHeader('Content-Disposition', 'attachment; filename=knowledge-export.md');
            res.send(md);
        }
        else {
            // JSON (default)
            res.setHeader('Content-Type', 'application/json; charset=utf-8');
            res.setHeader('Content-Disposition', 'attachment; filename=knowledge-export.json');
            res.json({ version: 1, exportedAt: new Date().toISOString(), entries });
        }
    }
    catch (err) {
        next(err);
    }
});
// ---- Import ----
router.post('/import', (req, res, next) => {
    try {
        const { entries, format } = req.body;
        if (!Array.isArray(entries) || entries.length === 0) {
            throw new AppError('VALIDATION_ERROR', 'entries must be a non-empty array', 400);
        }
        const imported = [];
        for (const e of entries.slice(0, 500)) { // max 500
            if (!e.title)
                continue;
            const entry = KnowledgeService.add({
                title: e.title,
                content: e.content || '',
                category: e.category || 'imported',
                tags: Array.isArray(e.tags) ? e.tags : (typeof e.tags === 'string' ? e.tags.split(/[;,]/).map((t) => t.trim()).filter(Boolean) : []),
                source: 'import'
            });
            imported.push(entry);
        }
        res.json({ success: true, data: { imported: imported.length, total: entries.length } });
    }
    catch (err) {
        next(err);
    }
});
module.exports = router;
//# sourceMappingURL=knowledge.js.map