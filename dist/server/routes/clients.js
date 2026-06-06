"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express = require('express');
const router = express.Router();
/**
 * Client routes - requires broadcastService to be injected
 */
module.exports = function createClientsRouter(broadcastService) {
    /**
     * GET /api/clients - List connected clients
     */
    router.get('/', (req, res, next) => {
        try {
            const clientsInfo = broadcastService.getClients();
            res.json({ success: true, data: clientsInfo });
        }
        catch (err) {
            next(err);
        }
    });
    return router;
};
//# sourceMappingURL=clients.js.map