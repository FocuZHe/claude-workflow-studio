const config = require('../config');
const logger = require('../utils/logger');

/**
 * Broadcast service - manages message broadcasting to WebSocket clients
 */
class BroadcastService {
  constructor() {
    this.clients = new Map(); // clientId -> { ws, metadata }
    this.history = []; // Recent broadcast messages
  }

  /**
   * Register a WebSocket client
   */
  addClient(clientId, ws, metadata = {}) {
    this.clients.set(clientId, {
      ws,
      connectedAt: new Date(),
      lastHeartbeat: new Date(),
      metadata: {
        userAgent: metadata.userAgent || '',
        page: metadata.page || ''
      }
    });
    logger.debug(`Client connected: ${clientId}`, { total: this.clients.size });

    // Broadcast updated client count
    this.broadcastClientCount();
    return clientId;
  }

  /**
   * Remove a WebSocket client
   */
  removeClient(clientId) {
    this.clients.delete(clientId);
    logger.debug(`Client disconnected: ${clientId}`, { total: this.clients.size });
    this.broadcastClientCount();
  }

  /**
   * Update client metadata
   */
  updateClientMetadata(clientId, metadata) {
    const client = this.clients.get(clientId);
    if (client) {
      Object.assign(client.metadata, metadata);
    }
  }

  /**
   * Update client heartbeat
   */
  updateHeartbeat(clientId) {
    const client = this.clients.get(clientId);
    if (client) {
      client.lastHeartbeat = new Date();
    }
  }

  /**
   * Get all connected clients info
   */
  getClients() {
    const clients = [];
    for (const [id, client] of this.clients) {
      clients.push({
        id,
        connectedAt: client.connectedAt,
        lastHeartbeat: client.lastHeartbeat,
        metadata: client.metadata
      });
    }
    return {
      count: this.clients.size,
      clients
    };
  }

  /**
   * Send message to a specific client
   */
  sendToClient(clientId, type, payload) {
    const client = this.clients.get(clientId);
    if (!client || client.ws.readyState !== 1) return false;

    const message = JSON.stringify({
      type,
      payload,
      timestamp: new Date().toISOString()
    });

    try {
      client.ws.send(message);
      return true;
    } catch (err) {
      logger.warn(`Failed to send to client ${clientId}: ${err.message}`);
      return false;
    }
  }

  /**
   * Broadcast message to all connected clients
   */
  broadcast(type, payload) {
    const message = JSON.stringify({
      type,
      payload,
      timestamp: new Date().toISOString()
    });

    let sent = 0;
    for (const [clientId, client] of this.clients) {
      if (client.ws.readyState === 1) { // WebSocket.OPEN
        try {
          client.ws.send(message);
          sent++;
        } catch (err) {
          logger.warn(`Failed to broadcast to client ${clientId}: ${err.message}`);
        }
      }
    }

    return sent;
  }

  /**
   * Broadcast and save to history
   */
  broadcastMessage(message, type = 'info', data = null) {
    const payload = { message, type, data };

    // Save to history
    this.history.push({
      ...payload,
      timestamp: new Date().toISOString()
    });

    // Trim history
    if (this.history.length > config.broadcast.maxHistory) {
      this.history = this.history.slice(-config.broadcast.maxHistory);
    }

    const sent = this.broadcast('broadcast', payload);
    logger.info(`Broadcast sent to ${sent} clients`, { type, message: message.substring(0, 50) });

    return sent;
  }

  /**
   * Get broadcast history
   */
  getHistory(limit = 50) {
    return this.history.slice(-limit);
  }

  /**
   * Broadcast client count to all clients
   */
  broadcastClientCount() {
    this.broadcast('client.count', { count: this.clients.size });
  }

  /**
   * Check and remove stale clients
   */
  cleanupStaleClients() {
    const now = Date.now();
    const timeout = config.ws.heartbeatTimeout;

    for (const [clientId, client] of this.clients) {
      if (now - client.lastHeartbeat.getTime() > timeout) {
        logger.warn(`Removing stale client: ${clientId}`);
        try {
          client.ws.terminate();
        } catch (e) {
          // Ignore
        }
        this.removeClient(clientId);
      }
    }
  }
}

module.exports = BroadcastService;
