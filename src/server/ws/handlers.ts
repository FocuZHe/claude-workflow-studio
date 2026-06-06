const { generateId } = require('../utils/id');
const logger = require('../utils/logger');

/**
 * WebSocket message handlers
 */
class WsHandlers {
  broadcastService: any;
  subscriptions: Map<string, Set<string>>;

  constructor(broadcastService: any) {
    this.broadcastService = broadcastService;
    this.subscriptions = new Map(); // clientId -> Set of channels
  }

  /**
   * Handle incoming WebSocket message
   */
  handleMessage(clientId: string, data: string): void {
    let parsed: any;
    try {
      parsed = JSON.parse(data);
    } catch (e) {
      this.sendError(clientId, 'Invalid JSON message');
      return;
    }

    const { type, payload } = parsed;

    switch (type) {
      case 'subscribe':
        this.handleSubscribe(clientId, payload);
        break;
      case 'unsubscribe':
        this.handleUnsubscribe(clientId, payload);
        break;
      case 'ping':
        this.handlePing(clientId);
        break;
      case 'setPage':
        this.handleSetPage(clientId, payload);
        break;
      default:
        this.sendError(clientId, `Unknown message type: ${type}`);
    }
  }

  /**
   * Handle subscribe message
   */
  handleSubscribe(clientId: string, payload: any): void {
    if (!payload || !Array.isArray(payload.channels)) {
      this.sendError(clientId, 'subscribe requires channels array');
      return;
    }

    if (!this.subscriptions.has(clientId)) {
      this.subscriptions.set(clientId, new Set());
    }

    const subs = this.subscriptions.get(clientId)!;
    for (const channel of payload.channels) {
      subs.add(channel);
    }

    logger.debug(`Client ${clientId} subscribed to: ${payload.channels.join(', ')}`);
  }

  /**
   * Handle unsubscribe message
   */
  handleUnsubscribe(clientId: string, payload: any): void {
    if (!payload || !Array.isArray(payload.channels)) {
      this.sendError(clientId, 'unsubscribe requires channels array');
      return;
    }

    const subs = this.subscriptions.get(clientId);
    if (subs) {
      for (const channel of payload.channels) {
        subs.delete(channel);
      }
    }

    logger.debug(`Client ${clientId} unsubscribed from: ${payload.channels.join(', ')}`);
  }

  /**
   * Handle ping message
   */
  handlePing(clientId: string): void {
    this.broadcastService.updateHeartbeat(clientId);
    this.broadcastService.sendToClient(clientId, 'pong', {});
  }

  /**
   * Handle setPage message
   */
  handleSetPage(clientId: string, payload: any): void {
    if (!payload || !payload.page) {
      this.sendError(clientId, 'setPage requires page field');
      return;
    }

    this.broadcastService.updateClientMetadata(clientId, { page: payload.page });
    logger.debug(`Client ${clientId} set page: ${payload.page}`);
  }

  /**
   * Send error to client
   */
  sendError(clientId: string, message: string): void {
    this.broadcastService.sendToClient(clientId, 'error', { message });
  }

  /**
   * Remove client subscriptions
   */
  removeSubscriptions(clientId: string): void {
    this.subscriptions.delete(clientId);
  }

  /**
   * Get subscriptions for a client
   */
  getSubscriptions(clientId: string): Set<string> {
    return this.subscriptions.get(clientId) || new Set();
  }
}

module.exports = WsHandlers;
