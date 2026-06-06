/**
 * 模块类型声明
 * 为没有类型定义的 JavaScript 模块提供类型声明
 */

declare module './config' {
  const config: {
    port: number;
    [key: string]: any;
  };
  export default config;
}

declare module './utils/logger' {
  const logger: {
    info: (message: string, ...args: any[]) => void;
    warn: (message: string, ...args: any[]) => void;
    error: (message: string, ...args: any[]) => void;
    debug: (message: string, ...args: any[]) => void;
  };
  export default logger;
}

declare module './middleware/errorHandler' {
  import { Request, Response, NextFunction } from 'express';
  export function errorHandler(err: any, req: Request, res: Response, next: NextFunction): void;
  export function notFoundHandler(req: Request, res: Response, next: NextFunction): void;
  export class AppError extends Error {
    code: string;
    statusCode: number;
    constructor(code: string, message: string, statusCode?: number);
  }
}

declare module './ws/server' {
  import { Server } from 'http';
  import { BroadcastService } from './services/BroadcastService';
  export class WsServer {
    constructor(server: Server, broadcastService: BroadcastService);
  }
}

declare module './routes/*' {
  import { Router } from 'express';
  const router: Router;
  export default router;
}
