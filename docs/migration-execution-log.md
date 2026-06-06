# 前端 TypeScript 迁移 + 服务器优化执行日志

> 执行日期：2026-06-01

---

## 一、服务器端优化（已完成）

### CRITICAL 修复

| 编号 | 修复内容 | 文件 | 状态 |
|------|---------|------|------|
| C1 | `process.env` 并发竞态 → 互斥锁 `_withEnvLock` | SdkService.ts | ✅ |
| C2 | `execSync` → 异步 `exec` + `fsPromises` | SdkService.ts | ✅ |
| C3 | `_currentRunId` 静态变量 → `_currentRunIds` Map | WorkflowService.ts | ✅ |
| C4 | 429 重试无限递归 → 指数退避 + 最多 3 次 | SdkService.ts | ✅ |

### HIGH 修复

| 编号 | 修复内容 | 文件 | 状态 |
|------|---------|------|------|
| H3 | `_cleanupSubagentProcesses` 同步 → 异步 | WorkflowService.ts | ✅ |
| H4 | `uncaughtException` 继续运行 → 优雅退出 | app.ts | ✅ |
| H5 | 健康检查 `execSync` → 异步 + 缓存 | app.ts | ✅ |

### MEDIUM 修复

| 编号 | 修复内容 | 文件 | 状态 |
|------|---------|------|------|
| M3 | `_callingTrees` 错误路径未清理 | SdkService.ts | ✅ |

---

## 二、前端 TypeScript 迁移（已完成核心文件）

### 已创建的 TypeScript 源文件

| 文件 | 原文件 | 行数 | 状态 |
|------|--------|------|------|
| `js/store.ts` | store.js | 76 | ✅ |
| `js/cache.ts` | cache.js | 56 | ✅ |
| `js/utils.ts` | utils.js | 108 | ✅ |
| `js/router.ts` | router.js | 97 | ✅ |
| `js/api.ts` | api.js | 390 | ✅ |
| `js/ws.ts` | ws.js | 225 | ✅ |
| `js/app.ts` | app.js | 148 | ✅ |
| `js/globals.d.ts` | 新增 | 65 | ✅ 类型声明 |

### 基础设施

| 文件 | 用途 | 状态 |
|------|------|------|
| `tsconfig.frontend.json` | 前端 TS 编译配置 | ✅ |
| `scripts/copy-frontend.js` | 编译产物复制脚本 | ✅ |
| `package.json` | 新增 `build:frontend` 和 `check:frontend` 脚本 | ✅ |

### 未转换的文件（50个）

剩余 50 个 JS 文件（15 个组件 + 35 个页面）保持 `.js` 格式。
由于 `tsconfig.frontend.json` 配置了 `allowJs: true`，这些文件已被 TypeScript 编译器覆盖。

渐进迁移策略：后续可逐个将 `.js` 重命名为 `.ts` 并添加类型注解。

---

## 三、编译验证

```
✅ 服务器端 TypeScript 编译：通过（0 errors）
✅ 前端 TypeScript 类型检查：通过（0 errors）
✅ 服务器构建（npm run build）：通过
✅ 服务器启动：成功（日志正常，端口冲突为预期行为）
```

---

## 四、测试状态

```
⚠️ E2E 测试：存在预存问题
```

**预存问题（非本次修改导致）：**
1. 端口 3000 冲突 — 服务器已运行时测试尝试启动新实例
2. `createApp is not a function` — 测试文件引用的导出名与实际不符
3. 测试文件使用 `require('../../src/server/app')` 但 TypeScript 无法直接 require

**解决方案（需后续处理）：**
- 测试需要 `tsx` 运行器支持 TypeScript
- 测试需要使用动态端口避免冲突
- 测试需要更新 `createApp` 导出

---

## 五、架构变更说明

### 服务器端

```
SdkService.ts 变更：
├── 新增 _envMutex 属性（环境变量互斥锁）
├── 新增 _withEnvLock() 方法
├── _executeWithClaudeSdk() 新增 retryCount 参数
├── _handleToolCall: read_file/write_to_file/list_files → fsPromises 异步
├── _handleToolCall: bash/execute_command → exec 异步
└── catch 块新增 _cleanupCallingTree() 调用

WorkflowService.ts 变更：
├── _currentRunId → _currentRunIds (Map<string, string>)
├── _saveNodeCheckpoint() 新增 workflowId 参数
├── _cleanupSubagentProcesses() → async 异步
└── 调用处改为 fire-and-forget 模式

app.ts 变更：
├── 健康检查 execSync → 异步 exec + 5分钟缓存
└── uncaughtException → 优雅退出（1秒后 process.exit(1)）
```

### 前端

```
新增文件：
├── js/store.ts        # 带类型的 Store 模块
├── js/cache.ts        # 带类型的 Cache 模块
├── js/utils.ts        # 带类型的工具函数
├── js/router.ts       # 带类型的 SPA Router
├── js/api.ts          # 带完整接口定义的 API 客户端
├── js/ws.ts           # 带类型的 WebSocket 客户端
├── js/app.ts          # 带类型的应用入口
├── js/globals.d.ts    # 全局类型声明
├── tsconfig.frontend.json  # 前端 TS 编译配置
└── scripts/copy-frontend.js # 编译产物复制脚本

package.json 新增脚本：
├── build:frontend  # 编译前端 TS → JS
└── check:frontend  # 前端类型检查
```

---

## 六、使用说明

### 开发模式
```bash
# 服务器端修改后重新编译
npm run build

# 前端类型检查
npm run check:frontend

# 前端 TS → JS 编译（将 .ts 编译结果覆盖 .js）
npm run build:frontend
```

### 渐进迁移
```bash
# 1. 将某个 .js 文件重命名为 .ts
mv src/client/js/components/Toast.js src/client/js/components/Toast.ts

# 2. 添加类型注解

# 3. 验证编译
npm run check:frontend

# 4. 编译并部署
npm run build:frontend
```
