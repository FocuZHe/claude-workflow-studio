# 前端 TypeScript 迁移 + 服务器强化方案

> 目标：前端 JS→TS，服务器稳定性提升，通信延迟降低

---

## 一、现状分析

| 维度 | 当前状态 | 问题 |
|------|---------|------|
| 前端语言 | 57 个 JS 文件，原生 ES Module | 无类型检查，重构风险高 |
| 构建系统 | 无（静态文件直接 serve） | 无 HMR、无 tree-shaking、无代码分割 |
| 后端框架 | Express 4.x | 中间件链开销，WebSocket 需挂载 |
| 通信方式 | WebSocket (ws 库) | 已实现，但缺少消息缓冲/合流 |
| 类型共享 | 无 | 前后端数据结构靠手写，易出错 |

---

## 二、方案选型决策

### 2.1 后端框架：保留 Express，不换 Fastify

**理由：**
- 项目已有 ~30 个路由文件全部基于 Express Router，重写工作量巨大
- Express 的性能瓶颈在高频中间件链，但本项目是**本地单用户**场景，QPS 极低
- 真正的延迟来源是 SDK 调用（30s+），不是 Express 本身（<1ms）
- Fastify 的优势在高并发 Web 服务，本地工具场景收益微乎其微

**替代方案：** 仅在 WebSocket 层做优化（见第四章）

### 2.2 前端构建：引入 Vite

**理由：**
- 原生 TypeScript 支持（零配置）
- HMR 热更新 < 100ms
- 开发时按需编译，不需全量 tsc
- 生产构建自动 tree-shaking + code-splitting

**不用 Webpack 的理由：** 配置复杂，HMR 慢，Vite 更适合本项目规模

### 2.3 类型共享：Monorepo 工作区

**理由：**
- 前后端共享 WebSocket 事件类型、API 请求/响应类型
- 修改后端接口时前端编译阶段即报错
- 无需 tRPC（过度工程化），用简单的共享类型即可

### 2.4 通信优化：WebSocket 消息缓冲

**理由：**
- 5 个 Agent 并发时每秒 200+ token 包
- 无缓冲直接推送会导致浏览器渲染卡死
- 50ms 合流缓冲对人类无感，但渲染压力降 90%

---

## 三、目录结构设计

### 3.1 迁移后结构

```
my-project/
├── packages/                    # Monorepo 工作区
│   ├── shared/                  # 共享类型包
│   │   ├── src/
│   │   │   ├── types/
│   │   │   │   ├── websocket.ts    # WS 事件类型
│   │   │   │   ├── api.ts          # API 请求/响应类型
│   │   │   │   ├── agent.ts        # Agent 相关类型
│   │   │   │   ├── workflow.ts     # 工作流相关类型
│   │   │   │   ├── task.ts         # 任务相关类型
│   │   │   │   └── index.ts        # 统一导出
│   │   │   └── index.ts
│   │   ├── package.json
│   │   └── tsconfig.json
│   │
│   ├── server/                  # 后端包（迁移现有 src/server/）
│   │   ├── src/
│   │   │   ├── services/        # 现有服务层（搬入）
│   │   │   ├── routes/          # 现有路由（搬入）
│   │   │   ├── middleware/      # 中间件
│   │   │   ├── types/           # 服务端专用类型
│   │   │   ├── app.ts           # 入口（迁移）
│   │   │   └── config.ts        # 配置（迁移）
│   │   ├── package.json
│   │   └── tsconfig.json
│   │
│   └── client/                  # 前端包（迁移 src/client/）
│       ├── src/
│       │   ├── core/            # 核心模块（迁移 js/）
│       │   │   ├── app.ts
│       │   │   ├── api.ts
│       │   │   ├── router.ts
│       │   │   ├── store.ts
│       │   │   ├── ws.ts
│       │   │   └── utils.ts
│       │   ├── components/      # 组件（迁移 js/components/）
│       │   │   ├── Sidebar.ts
│       │   │   ├── Navbar.ts
│       │   │   ├── Modal.ts
│       │   │   └── ...
│       │   ├── pages/           # 页面（迁移 js/pages/）
│       │   │   ├── DashboardPage.ts
│       │   │   ├── AgentsPage.ts
│       │   │   ├── WorkflowsPage.ts
│       │   │   └── ...
│       │   ├── styles/          # 样式（迁移 css/）
│       │   ├── assets/          # 静态资源（迁移 icons.svg 等）
│       │   └── main.ts          # Vite 入口
│       ├── index.html           # HTML 入口（迁移）
│       ├── vite.config.ts
│       ├── package.json
│       └── tsconfig.json
│
├── package.json                 # 根 package.json（pnpm workspace）
├── pnpm-workspace.yaml
├── tsconfig.base.json           # 共享 TS 基础配置
└── ...
```

### 3.2 与现有结构的映射

| 现有路径 | 迁移后路径 | 说明 |
|---------|-----------|------|
| `src/client/js/*.js` | `packages/client/src/core/*.ts` | 核心模块 |
| `src/client/js/components/*.js` | `packages/client/src/components/*.ts` | 组件 |
| `src/client/js/pages/*.js` | `packages/client/src/pages/*.ts` | 页面 |
| `src/client/css/*` | `packages/client/src/styles/*` | 样式 |
| `src/client/index.html` | `packages/client/index.html` | HTML 入口 |
| `src/server/*` | `packages/server/src/*` | 后端代码 |
| `data/` | `data/`（不变） | 数据目录保持原位 |

---

## 四、分阶段实施计划

### 阶段 0：基础设施搭建（预计 1 小时）

**目标：** 建立 Monorepo 骨架，不破坏现有功能

**步骤：**
1. 创建 `pnpm-workspace.yaml`
2. 创建 `tsconfig.base.json`（共享配置）
3. 创建 `packages/shared/` 包骨架
4. 创建 `packages/server/` 包骨架（搬入现有 server 代码）
5. 创建 `packages/client/` 包骨架（Vite 初始化）
6. 更新根 `package.json` 的 scripts

**验收：** `pnpm install` 成功，`pnpm -F server build` 能编译

### 阶段 1：共享类型定义（预计 2 小时）

**目标：** 定义前后端共享的类型契约

**步骤：**
1. 从现有 `api.js` 提取所有 API 端点的请求/响应类型
2. 从现有 `ws.js` 提取所有 WebSocket 事件类型
3. 定义 Agent、Workflow、Task 等核心数据模型类型
4. 编写 `packages/shared/src/types/*.ts`

**关键类型示例：**
```typescript
// packages/shared/src/types/websocket.ts
export interface WSEvent<T = unknown> {
  type: string;
  payload: T;
  timestamp?: string;
}

export interface AgentProgressPayload {
  agentId: string;
  agentName: string;
  progress: number;
  message: string;
}

export interface ToolUsePayload {
  agentId: string;
  toolName: string;
  toolInput: Record<string, unknown>;
}

// packages/shared/src/types/api.ts
export interface ApiResponse<T = unknown> {
  success: boolean;
  data?: T;
  error?: {
    message: string;
    code?: string;
    details?: unknown;
  };
}

export interface AgentData {
  id: string;
  name: string;
  type: 'general-purpose' | 'Explore';
  status: 'idle' | 'running' | 'error';
  // ...
}
```

**验收：** `pnpm -F shared build` 成功，生成 `.d.ts` 文件

### 阶段 2：前端 JS→TS 逐文件迁移（预计 6-8 小时）

**目标：** 将 57 个 JS 文件逐步转为 TS

**迁移策略：** 从底层工具模块开始，逐层向上

**迁移顺序：**

```
第 1 批（核心，无依赖）：
├── utils.ts          ← utils.js
├── cache.ts          ← cache.js
└── store.ts          ← store.js

第 2 批（基础设施）：
├── api.ts            ← api.js（使用 shared 类型）
├── ws.ts             ← ws.js（使用 shared 类型）
└── router.ts         ← router.js

第 3 �批（组件层）：
├── components/Toast.ts
├── components/Modal.ts
├── components/Sidebar.ts
├── components/Navbar.ts
└── ... (11 个组件)

第 4 批（页面层）：
├── pages/DashboardPage.ts
├── pages/AgentsPage.ts
├── pages/WorkflowsPage.ts
├── pages/ChatPage.ts
└── ... (34 个页面)

第 5 扡（入口）：
├── main.ts           ← app.js
└── XtermTerminal.ts  ← XtermTerminal.js
```

**单文件迁移模板：**
```typescript
// 迁移前 (utils.js)
window.Utils = {
  formatTime(date) { ... },
  escapeHtml(str) { ... }
};

// 迁移后 (utils.ts)
export function formatTime(date: Date | string): string { ... }
export function escapeHtml(str: string): string { ... }

// 类型声明（如果需要全局访问）
declare global {
  interface Window {
    Utils: typeof import('./utils');
  }
}
```

**验收：** 每批迁移后 `pnpm -F client build` 成功，浏览器功能正常

### 阶段 3：Vite 构建集成（预计 1 小时）

**目标：** 配置 Vite 开发服务器和生产构建

**步骤：**
1. 配置 `vite.config.ts`
2. 配置开发时 API 代理（指向 Express 后端）
3. 配置 WebSocket 代理
4. 更新 `index.html` 入口（改为引用 `/src/main.ts`）
5. 配置生产构建输出到 `dist/client/`

**vite.config.ts 关键配置：**
```typescript
import { defineConfig } from 'vite';

export default defineConfig({
  root: 'packages/client',
  build: {
    outDir: '../../dist/client',
    emptyOutDir: true,
  },
  server: {
    port: 5173,
    proxy: {
      '/api': 'http://127.0.0.1:3000',
      '/ws': {
        target: 'ws://127.0.0.1:3000',
        ws: true,
      },
    },
  },
});
```

**验收：** `pnpm -F client dev` 启动 Vite，HMR 正常，API 代理正常

### 阶段 4：WebSocket 消息缓冲（预计 1 小时）

**目标：** 解决高频 token 推送导致的浏览器卡顿

**后端改动（SdkService.ts）：**
```typescript
// 新增消息缓冲池
class MessageBuffer {
  private buffer: WSEvent[] = [];
  private timer: NodeJS.Timeout | null = null;
  private readonly flushInterval = 50; // 50ms

  push(event: WSEvent) {
    this.buffer.push(event);
    if (!this.timer) {
      this.timer = setTimeout(() => this.flush(), this.flushInterval);
    }
  }

  private flush() {
    if (this.buffer.length === 0) return;
    const batch = this.buffer.splice(0);
    this.timer = null;
    // 一次性发送合并后的消息
    broadcast({ type: 'batch', payload: batch });
  }
}
```

**前端改动（ws.ts）：**
```typescript
// 处理批量消息
ws.onmessage = (e) => {
  const msg = JSON.parse(e.data);
  if (msg.type === 'batch' && Array.isArray(msg.payload)) {
    msg.payload.forEach((event: WSEvent) => emit(event.type, event.payload));
  } else {
    emit(msg.type, msg.payload);
  }
};
```

**验收：** 5 个 Agent 并发时浏览器不卡顿，CPU 占用降低

### 阶段 5：服务器稳定性强化（预计 2 小时）

**目标：** 防止服务器崩溃，提升容错能力

#### 5.1 全局错误处理
```typescript
// packages/server/src/middleware/errorHandler.ts
export function errorHandler(err: Error, req: Request, res: Response, next: NextFunction) {
  console.error(`[ERROR] ${req.method} ${req.path}:`, err);
  
  // 不要让未捕获异常崩溃进程
  if (!res.headersSent) {
    res.status(500).json({
      success: false,
      error: { message: 'Internal server error', code: 'INTERNAL_ERROR' }
    });
  }
}

// process 级别兜底
process.on('uncaughtException', (err) => {
  console.error('[FATAL] Uncaught exception:', err);
  // 不退出进程，记录错误继续运行
});

process.on('unhandledRejection', (reason) => {
  console.error('[FATAL] Unhandled rejection:', reason);
});
```

#### 5.2 WebSocket 连接保活
```typescript
// 心跳检测 + 自动清理死连接
const HEARTBEAT_INTERVAL = 30000;

setInterval(() => {
  wss.clients.forEach((ws) => {
    if (ws.isAlive === false) {
      return ws.terminate(); // 清理死连接
    }
    ws.isAlive = false;
    ws.ping(); // 发送 ping
  });
}, HEARTBEAT_INTERVAL);
```

#### 5.3 SDK 调用超时保护
```typescript
// 防止 SDK 调用无限挂起
const SDK_TIMEOUT = 5 * 60 * 1000; // 5 分钟

async function executeWithTimeout<T>(promise: Promise<T>, timeout = SDK_TIMEOUT): Promise<T> {
  const timeoutPromise = new Promise<never>((_, reject) => {
    setTimeout(() => reject(new Error('SDK call timed out')), timeout);
  });
  return Promise.race([promise, timeoutPromise]);
}
```

#### 5.4 内存监控 + 告警
```typescript
// 定期检查内存使用
setInterval(() => {
  const usage = process.memoryUsage();
  const heapUsedMB = usage.heapUsed / 1024 / 1024;
  
  if (heapUsedMB > 500) { // 超过 500MB 告警
    console.warn(`[MEMORY] High heap usage: ${heapUsedMB.toFixed(0)}MB`);
    // 触发 GC（如果可能）
    if (global.gc) global.gc();
  }
}, 60000);
```

**验收：** 模拟异常输入不会崩溃，长时间运行内存稳定

---

## 五、脚本配置

### 5.1 根 package.json
```json
{
  "name": "claude-workflow-studio",
  "private": true,
  "scripts": {
    "dev": "concurrently \"pnpm -F server dev\" \"pnpm -F client dev\"",
    "build": "pnpm -F shared build && pnpm -F server build && pnpm -F client build",
    "start": "pnpm -F server start",
    "test": "pnpm -F server test && pnpm -F client test"
  },
  "devDependencies": {
    "concurrently": "^9.0.0",
    "typescript": "^5.5.0"
  }
}
```

### 5.2 pnpm-workspace.yaml
```yaml
packages:
  - 'packages/*'
```

### 5.3 tsconfig.base.json
```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "resolveJsonModule": true,
    "declaration": true,
    "declarationMap": true,
    "sourceMap": true
  }
}
```

---

## 六、风险与应对

| 风险 | 影响 | 应对措施 |
|------|------|---------|
| 迁移期间功能中断 | 用户无法使用 | 保留旧 `src/client/` 直到迁移完成 |
| JS→TS 类型错误多 | 编译失败 | 初始阶段关闭 strict，逐步开启 |
| Vite 与 Express 端口冲突 | 开发体验差 | Vite 用 5173，Express 用 3000 |
| pnpm 兼容性问题 | 安装失败 | 可回退到 npm workspaces |
| 浏览器全局变量丢失 | 功能异常 | 使用 `declare global` 保持兼容 |

---

## 七、迁移后收益

| 维度 | 迁移前 | 迁移后 |
|------|-------|--------|
| 类型安全 | 无 | 端到端类型检查 |
| 开发体验 | 手动刷新 | HMR 热更新 <100ms |
| 构建产物 | 57 个独立 JS 文件 | 单个 bundle + code-splitting |
| WebSocket 延迟 | 每个 token 单独推送 | 50ms 合流缓冲 |
| 服务器稳定性 | 未捕获异常可崩溃 | 全局错误兜底 |
| 重构信心 | 手动检查 | 编译器自动检查 |

---

## 八、不做的事（明确排除）

1. **不换 Fastify** — 收益不明显，重写成本高
2. **不用 tRPC** — 过度工程化，共享类型已足够
3. **不用 React/Vue** — 保持原生 TS，避免引入框架开销
4. **不改数据存储** — JSON/SQLite 机制保持不变
5. **不改 SDK 调用方式** — Claude Agent SDK 集成保持不变

---

## 九、时间估算

| 阶段 | 预计工时 | 可中断点 |
|------|---------|---------|
| 阶段 0：基础设施 | 1 小时 | ✅ 每步可独立验收 |
| 阶段 1：共享类型 | 2 小时 | ✅ 类型可逐步添加 |
| 阶段 2：JS→TS 迁移 | 6-8 小时 | ✅ 按批次迁移 |
| 阶段 3：Vite 集成 | 1 小时 | ✅ |
| 阶段 4：WS 缓冲 | 1 小时 | ✅ |
| 阶段 5：服务器强化 | 2 小时 | ✅ 各措施独立 |
| **总计** | **13-15 小时** | 可分多天完成 |

---

## 十、下一步行动

确认方案后，从**阶段 0**开始执行：
1. 初始化 pnpm workspace
2. 创建 packages/shared 骨架
3. 迁移 server 代码到 packages/server
4. 初始化 Vite 项目到 packages/client
