/**
 * Claude Agent SDK 类型定义
 * 基于 @anthropic-ai/claude-agent-sdk 的类型
 */

import { EventEmitter } from 'events';

// SDK 消息类型
export interface SDKMessage {
  type: string;
  subtype?: string;
  content?: Array<{ type: string; text?: string }>;
  result?: string;
  error?: string;
}

// SDK 选项类型
export interface ClaudeAgentOptions {
  cwd?: string;
  model?: string;
  systemPrompt?: string;
  permissionMode?: 'bypassPermissions' | 'acceptEdits' | 'default';
  maxTurns?: number;
  allowedTools?: string[];
  abortController?: AbortController;
  sessionStore?: SessionStore;
  agents?: Record<string, AgentDefinition>;
}

// 会话存储接口
export interface SessionStore {
  append(key: SessionKey, entries: SessionStoreEntry[]): Promise<void>;
  load(key: SessionKey): Promise<SessionStoreEntry[] | null>;
}

export interface SessionKey {
  projectKey: string;
  sessionId: string;
  subpath?: string;
}

export interface SessionStoreEntry {
  type: string;
  uuid?: string;
  timestamp?: string;
  [key: string]: unknown;
}

// Agent 定义
export interface AgentDefinition {
  description: string;
  prompt: string;
  model?: string;
  tools?: string[];
}

// Query 返回类型
export interface Query extends AsyncGenerator<SDKMessage, void> {}

// 任务接口
export interface Task {
  id: string;
  description: string;
  model?: string;
  timeout?: number;
  allowedFiles?: string[];
}

export interface TaskWithWorktree extends Task {
  worktree: string;
}

// Agent 结果
export interface AgentResult {
  taskId: string;
  success: boolean;
  data?: any;
  error?: string;
}

// 状态存储
export interface StateEntry {
  agentId: string;
  status: 'running' | 'completed' | 'failed';
  taskConfig?: Task;
  error?: string;
  timestamp: string;
}
