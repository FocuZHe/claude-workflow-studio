const { WebSocketServer } = require('ws');
const url = require('url');
const { generateId } = require('../utils/id');
const WsHandlers = require('./handlers');
const config = require('../config');
const logger = require('../utils/logger');
const { getApiKey } = require('../middleware/auth');

/**
 * WebSocket server setup and management
 */
class WsServer {
  broadcastService: any;
  handlers: any;
  wss: any;
  heartbeatInterval: any;

  constructor(broadcastService: any) {
    this.broadcastService = broadcastService;
    this.handlers = new WsHandlers(broadcastService);
    this.wss = null;
    this.heartbeatInterval = null;
  }

  /**
   * Attach WebSocket server to HTTP server
   */
  attach(server: any): void {
    this.wss = new WebSocketServer({
      noServer: true
    });

    // Handle upgrade manually to enforce API key auth
    server.on('upgrade', (req: any, socket: any, head: any) => {
      const pathname = url.parse(req.url).pathname;
      if (pathname !== config.ws.path) {
        socket.destroy();
        return;
      }

      // Validate API key from query param or header
      const query = url.parse(req.url, true).query;
      const providedKey = query.api_key || req.headers['x-api-key'];
      const validKey = getApiKey();

      if (!providedKey || providedKey !== validKey) {
        logger.warn('WebSocket connection rejected: invalid API key');
        socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
        socket.destroy();
        return;
      }

      this.wss.handleUpgrade(req, socket, head, (ws: any) => {
        this.wss.emit('connection', ws, req);
      });
    });

    this.wss.on('connection', (ws: any, req: any) => {
      this.handleConnection(ws, req);
    });

    this.wss.on('error', (error: any) => {
      logger.error('WebSocket server error', { error: error.message });
    });

    // Start heartbeat checker
    this.startHeartbeat();

    logger.info(`WebSocket server attached at path: ${config.ws.path}`);
  }

  /**
   * Handle new WebSocket connection
   */
  handleConnection(ws: any, req: any): void {
    const clientId = generateId();
    const userAgent = req.headers['user-agent'] || '';

    // Register client
    this.broadcastService.addClient(clientId, ws, { userAgent });

    logger.info(`WebSocket client connected: ${clientId}`);

    // Handle messages
    ws.on('message', (data: any) => {
      try {
        this.handlers.handleMessage(clientId, data.toString());
      } catch (err: any) {
        logger.error(`Error handling WS message from ${clientId}`, { error: err.message });
      }
    });

    // Handle pong (response to our ping)
    ws.on('pong', () => {
      this.broadcastService.updateHeartbeat(clientId);
    });

    // Handle close
    ws.on('close', () => {
      logger.info(`WebSocket client disconnected: ${clientId}`);
      this.broadcastService.removeClient(clientId);
      this.handlers.removeSubscriptions(clientId);
    });

    // Handle error
    ws.on('error', (error: any) => {
      logger.error(`WebSocket client error: ${clientId}`, { error: error.message });
    });

    // Send welcome message
    this.broadcastService.sendToClient(clientId, 'welcome', {
      clientId,
      message: 'Connected to Multi-Agent Platform WebSocket'
    });
  }

  /**
   * Start heartbeat ping interval
   */
  startHeartbeat(): void {
    this.heartbeatInterval = setInterval(() => {
      if (!this.wss) return;

      // Send ping to all clients
      for (const [clientId, client] of this.broadcastService.clients) {
        if (client.ws.readyState === 1) { // WebSocket.OPEN
          try {
            client.ws.ping();
          } catch (e) {
            logger.warn(`Failed to ping client ${clientId}`);
          }
        }
      }

      // Cleanup stale clients
      this.broadcastService.cleanupStaleClients();
    }, config.ws.heartbeatInterval);
  }

  /**
   * Stop heartbeat and close server
   */
  close(): void {
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
      this.heartbeatInterval = null;
    }

    if (this.wss) {
      this.wss.close();
      this.wss = null;
    }

    logger.info('WebSocket server closed');
  }

  /**
   * Get connected client count
   */
  getClientCount(): number {
    return this.broadcastService.clients.size;
  }
}

module.exports = WsServer;
