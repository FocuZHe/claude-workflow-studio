// ═══════════════════════════════════════════════
// API Client — Fetch wrapper
// ═══════════════════════════════════════════════

interface ApiResponse<T = any> {
  success: boolean;
  data?: T;
  error?: { message: string; code?: string; details?: any };
}

interface ApiError extends Error {
  status?: number;
  code?: string;
  details?: any;
}

interface ApiAPI {
  getAgents: (params?: any) => Promise<any>;
  getAgent: (id: string) => Promise<any>;
  getAgentChildren: (id: string) => Promise<any>;
  createAgent: (data: any) => Promise<any>;
  updateAgent: (id: string, data: any) => Promise<any>;
  deleteAgent: (id: string) => Promise<any>;
  getAgentLogs: (id: string, params?: any) => Promise<any>;
  getWorkflows: (params?: any) => Promise<any>;
  getWorkflow: (id: string) => Promise<any>;
  createWorkflow: (data: any) => Promise<any>;
  updateWorkflow: (id: string, data: any) => Promise<any>;
  deleteWorkflow: (id: string) => Promise<any>;
  renameWorkflow: (id: string, name: string) => Promise<any>;
  createWorkflowInAll: (data: any) => Promise<any>;
  executeWorkflow: (id: string, data?: any) => Promise<any>;
  pauseWorkflow: (id: string) => Promise<any>;
  resumeWorkflow: (id: string) => Promise<any>;
  getWorkflowStatus: (id: string) => Promise<any>;
  getWorkflowExecution: (id: string) => Promise<any>;
  setWorkflowFolder: (id: string, folderPath: string) => Promise<any>;
  getNodeLogs: (workflowId: string, runId: string) => Promise<any>;
  getTasks: (params?: any) => Promise<any>;
  getTask: (id: string) => Promise<any>;
  createTask: (data: any) => Promise<any>;
  updateTask: (id: string, data: any) => Promise<any>;
  deleteTask: (id: string) => Promise<any>;
  executeTask: (id: string) => Promise<any>;
  cancelTask: (id: string) => Promise<any>;
  pauseTask: (id: string) => Promise<any>;
  resumeTask: (id: string) => Promise<any>;
  getTaskQueues: (params?: any) => Promise<any>;
  getTaskQueue: (id: string) => Promise<any>;
  createTaskQueue: (data: any) => Promise<any>;
  updateTaskQueue: (id: string, data: any) => Promise<any>;
  deleteTaskQueue: (id: string) => Promise<any>;
  startTaskQueue: (id: string) => Promise<any>;
  pauseTaskQueue: (id: string) => Promise<any>;
  resumeTaskQueue: (id: string) => Promise<any>;
  cancelTaskQueue: (id: string) => Promise<any>;
  addTaskQueueItem: (id: string, data: any) => Promise<any>;
  removeTaskQueueItem: (id: string, itemId: string) => Promise<any>;
  listFiles: (path: string) => Promise<any>;
  readFile: (path: string) => Promise<any>;
  writeFile: (path: string, content: string) => Promise<any>;
  mkdir: (path: string) => Promise<any>;
  deleteFile: (path: string) => Promise<any>;
  renameFile: (oldPath: string, newPath: string) => Promise<any>;
  createWorkspace: (name: string, parentPath?: string, template?: string) => Promise<any>;
  browseDirectories: (path: string) => Promise<any>;
  setWorkspace: (path: string) => Promise<any>;
  getWorkspaceInfo: () => Promise<any>;
  getWorkspaceState: () => Promise<any>;
  getWorkspaceHistory: () => Promise<any>;
  getUndoCache: (filePath: string) => Promise<any>;
  saveUndoCache: (data: any) => Promise<any>;
  clearUndoCache: (filePath?: string) => Promise<any>;
  importFile: (sourcePath: string, targetPath: string) => Promise<any>;
  getParentPath: (filePath: string) => Promise<any>;
  broadcast: (message: string, type?: string, data?: any) => Promise<any>;
  getBroadcastHistory: (params?: any) => Promise<any>;
  getClients: () => Promise<any>;
  getApiConfigs: () => Promise<any>;
  createApiConfig: (data: any) => Promise<any>;
  updateApiConfig: (id: string, data: any) => Promise<any>;
  deleteApiConfig: (id: string) => Promise<any>;
  setDefaultApiConfig: (id: string) => Promise<any>;
  testApiConfig: (id: string) => Promise<any>;
  // 注：已移除 getApiKey(id) — 服务器不再暴露解密后的明文密钥
  respondApproval: (requestId: string, decision: string, comment?: string) => Promise<any>;
  stopWorkflow: (id: string) => Promise<any>;
  skipWorkflowNode: (id: string, nodeId: string) => Promise<any>;
  getWorkflowInputRequired: (id: string) => Promise<any>;
  getHistory: (params?: any) => Promise<any>;
  getHistoryDetail: (runId: string) => Promise<any>;
  deleteHistory: (runId: string) => Promise<any>;
  deleteHistoryBatch: (runIds: string[]) => Promise<any>;
  deleteTasksBatch: (ids: string[]) => Promise<any>;
  deleteTaskQueuesBatch: (ids: string[]) => Promise<any>;
  deleteWorkflowsBatch: (ids: string[]) => Promise<any>;
  deleteAgentsBatch: (ids: string[]) => Promise<any>;
  getAlertConfig: () => Promise<any>;
  updateAlertConfig: (data: any) => Promise<any>;
  getWorkflowTemplates: () => Promise<any>;
  cloneWorkflowTemplate: (id: string) => Promise<any>;
  getSkills: () => Promise<any>;
  installSkill: (skillId: string, name?: string) => Promise<any>;
  uninstallSkill: (skillId: string) => Promise<any>;
  getInstalledSkills: () => Promise<any>;
  getAgentSkills: (agentId: string) => Promise<any>;
  getMcpTools: () => Promise<any>;
  getGitStatus: () => Promise<any>;
  getGitDiff: (file?: string) => Promise<any>;
  getGitLog: (limit?: number) => Promise<any>;
  gitCommit: (message: string, files?: string[]) => Promise<any>;
  gitCheckout: (branch: string) => Promise<any>;
  getGitBranches: () => Promise<any>;
  createGitBranch: (name: string) => Promise<any>;
  stageFile: (file: string) => Promise<any>;
  unstageFile: (file: string) => Promise<any>;
  checkGitRepo: () => Promise<any>;
  createTerminal: (cwd?: string) => Promise<any>;
  getTerminals: () => Promise<any>;
  killTerminal: (id: string) => Promise<any>;
  sendTerminalInput: (id: string, data: string) => Promise<any>;
  getTerminalOutput: (id: string) => Promise<any>;
  getTerminalHistory: (id: string) => Promise<any>;
  resizeTerminal: (id: string, cols: number, rows: number) => Promise<any>;
  restoreTerminals: (sessions: any[]) => Promise<any>;
  stepWorkflow: (id: string, nodeId: string) => Promise<any>;
  simulateWorkflow: (id: string, mockData: any) => Promise<any>;
  testNode: (id: string, nodeId: string, testInput: any) => Promise<any>;
  getWorkflowContext: (id: string) => Promise<any>;
  updateWorkflowContext: (id: string, context: any) => Promise<any>;
  getWorkflowVariables: (id: string) => Promise<any>;
  batchExecuteWorkflow: (id: string, paramsArray: any[]) => Promise<any>;
  saveSnapshot: (id: string, name: string) => Promise<any>;
  getSnapshots: (id: string) => Promise<any>;
  restoreSnapshot: (id: string, snapshotId: string) => Promise<any>;
  deleteSnapshot: (id: string, snapshotId: string) => Promise<any>;
  batchExecuteWorkflows: (ids: string[], input?: any) => Promise<any>;
  getAuditLogs: (params?: any) => Promise<any>;
  getWorkspaces: () => Promise<any>;
  activateWorkspace: (workspacePath: string) => Promise<any>;
  deactivateWorkspace: (id: string) => Promise<any>;
  getWorkspaceStateById: (id: string) => Promise<any>;
  getWorkspaceWorkflows: (id: string) => Promise<any>;
  getChatSessions: (params?: any) => Promise<any>;
  getChatSession: (id: string) => Promise<any>;
  searchChatSessions: (q: string) => Promise<any>;
  createChatSession: (data: any) => Promise<any>;
  deleteChatSession: (id: string) => Promise<any>;
  sendChatMessage: (id: string, content: string) => Promise<any>;
  archiveChatSession: (id: string) => Promise<any>;
  executeChatAction: (id: string, actionId: string, confirmed?: boolean) => Promise<any>;
  getSlashCommands: () => Promise<any>;
  getPromptTemplates: (params?: any) => Promise<any>;
  getPromptTemplate: (id: string) => Promise<any>;
  createPromptTemplate: (data: any) => Promise<any>;
  updatePromptTemplate: (id: string, data: any) => Promise<any>;
  deletePromptTemplate: (id: string) => Promise<any>;
  usePromptTemplate: (id: string) => Promise<any>;
  getResources: () => Promise<any>;
  getAgentResources: () => Promise<any>;
  getArtifacts: (params?: any) => Promise<any>;
  getArtifact: (id: string) => Promise<any>;
  getArtifactContent: (id: string) => Promise<any>;
  deleteArtifact: (id: string) => Promise<any>;
  reindexArtifacts: () => Promise<any>;
  resumeWorkflowFromCheckpoint: (id: string, runId: string) => Promise<any>;
  getWorkflowCheckpoints: (id: string) => Promise<any>;
  getReports: (params?: any) => Promise<any>;
  getReport: (workflowId: string, runId: string) => Promise<any>;
  deleteReport: (workflowId: string, runId: string) => Promise<any>;
  generateReport: (data: any) => Promise<any>;
  exportReport: (workflowId: string, runId: string) => Promise<any>;
  getWorkflowsForSelection: () => Promise<any>;
  searchMemories: (q: string) => Promise<any>;
  getMemory: (workflowId: string) => Promise<any>;
  updateMemory: (workflowId: string, content: string) => Promise<any>;
  deleteMemory: (workflowId: string) => Promise<any>;
  getSharedPool: () => Promise<any>;
  updateSharedPool: (data: any) => Promise<any>;
  listMemories: (params?: any) => Promise<any>;
  searchKnowledge: (q: string, filters?: any) => Promise<any>;
  addKnowledge: (data: any) => Promise<any>;
  updateKnowledge: (id: string, data: any) => Promise<any>;
  deleteKnowledge: (id: string) => Promise<any>;
  getKnowledgeTags: () => Promise<any>;
  addKnowledgeTag: (data: any) => Promise<any>;
  deleteKnowledgeTag: (id: string) => Promise<any>;
  exportKnowledge: (format?: string) => string;
  importKnowledge: (entries: any[], format?: string) => Promise<any>;
  getWorkflowStatistics: () => Promise<any>;
  getWorkflowTimeline: (params?: any) => Promise<any>;
  batchDeleteExecutionLogs: (items: any[]) => Promise<any>;
  createWorkflowFromText: (description: string) => Promise<any>;
  importWorkflowMd: (content: string, name?: string, workspaceId?: string) => Promise<any>;
  getWorkflowExportMdUrl: (id: string) => string;
  batchCloneWorkflows: (workflowIds: string[], targetWorkspaceIds: string[]) => Promise<any>;
  exportWorkflows: (ids: string[]) => Promise<any>;
  importWorkflows: (workflows: any[]) => Promise<any>;
  get: (path: string, params?: any) => Promise<any>;
  post: (path: string, body?: any) => Promise<any>;
  put: (path: string, body?: any) => Promise<any>;
  del: (path: string, body?: any) => Promise<any>;
}

(window as any).API = ((): ApiAPI => {
  const BASE = '/api';
  const NEVER = new Promise(() => {}) as Promise<any>;

  const API_KEY_KEY = 'claude_console_api_key';
  let _apiKey: string | null = localStorage.getItem(API_KEY_KEY) || null;
  let _keyFetchPromise: Promise<string | null> | null = null;

  function getApiKey(): string | null | Promise<string | null> {
    if (_apiKey) return _apiKey;
    if (_keyFetchPromise) return _keyFetchPromise;
    _keyFetchPromise = fetch(BASE + '/auth/key')
      .then(r => r.json())
      .then(data => {
        if (data.success && data.apiKey) {
          _apiKey = data.apiKey;
          localStorage.setItem(API_KEY_KEY, _apiKey!);
        }
        _keyFetchPromise = null;
        return _apiKey;
      })
      .catch(() => {
        _keyFetchPromise = null;
        return null;
      });
    return _keyFetchPromise;
  }

  getApiKey();

  async function request(method: string, path: string, body: any = null, params: any = null): Promise<any> {
    let url = BASE + path;
    if (params) {
      const qs = new URLSearchParams(
        Object.entries(params).filter(([, v]) => v != null && v !== '') as [string, string][]
      ).toString();
      if (qs) url += '?' + qs;
    }

    const key = _apiKey || await getApiKey();

    const opts: RequestInit = {
      method,
      headers: {
        'Content-Type': 'application/json',
        ...(key ? { 'X-API-Key': key } : {}),
      },
    };
    if (body && method !== 'GET') {
      opts.body = JSON.stringify(body);
    }

    const navSeq = (typeof Router !== 'undefined' && (Router as any).getNavSeq) ? (Router as any).getNavSeq() : 0;
    const isStale = (): boolean => {
      if (navSeq === 0) return false;
      const cur = (typeof Router !== 'undefined' && (Router as any).getNavSeq) ? (Router as any).getNavSeq() : 0;
      return navSeq !== cur;
    };

    let res: Response;
    try {
      res = await fetch(url, opts);
    } catch (e) {
      if (isStale()) return NEVER;
      throw e;
    }
    if (isStale()) return NEVER;

    if (res.status === 204) {
      return { success: true, data: null };
    }

    let data: any;
    try {
      data = await res.json();
    } catch (e) {
      if (isStale()) return NEVER;
      throw e;
    }
    if (isStale()) return NEVER;

    if (!res.ok || data.success === false) {
      const err: ApiError = new Error(data.error?.message || `HTTP ${res.status}`);
      err.status = res.status;
      err.code = data.error?.code;
      err.details = data.error?.details;

      if ((res.status === 401 || res.status === 403) && _apiKey) {
        localStorage.removeItem(API_KEY_KEY);
        _apiKey = null;
        const freshKey = await getApiKey();
        if (freshKey && freshKey !== key) {
          (opts.headers as Record<string, string>)['X-API-Key'] = freshKey as string;
          let retryRes: Response;
          try { retryRes = await fetch(url, opts); } catch (e) { throw err; }
          if (retryRes.ok) {
            let retryData: any;
            try { retryData = await retryRes.json(); } catch (e) { throw err; }
            if (retryData.success !== false) return retryData;
          }
        }
      }

      throw err;
    }

    return data;
  }

  const get = (path: string, params?: any) => request('GET', path, null, params);
  const post = (path: string, body?: any) => request('POST', path, body);
  const put = (path: string, body?: any) => request('PUT', path, body);
  const del = (path: string, body?: any) => request('DELETE', path, body);

  return {
    getAgents: (params?: any) => get('/agents', params),
    getAgent: (id: string) => get(`/agents/${id}`),
    getAgentChildren: (id: string) => get(`/agents/${id}/children`),
    createAgent: (data: any) => post('/agents', data),
    updateAgent: (id: string, data: any) => put(`/agents/${id}`, data),
    deleteAgent: (id: string) => del(`/agents/${id}`),
    getAgentLogs: (id: string, params?: any) => get(`/agents/${id}/logs`, params),

    getWorkflows: (params?: any) => get('/workflows', params),
    getWorkflow: (id: string) => get(`/workflows/${id}`),
    createWorkflow: (data: any) => post('/workflows', data),
    updateWorkflow: (id: string, data: any) => put(`/workflows/${id}`, data),
    deleteWorkflow: (id: string) => del(`/workflows/${id}`),
    renameWorkflow: (id: string, name: string) => put(`/workflows/${id}/rename`, { name }),
    createWorkflowInAll: (data: any) => post('/workflows/create-in-all', data),
    executeWorkflow: (id: string, data?: any) => post(`/workflows/${id}/execute`, data),
    pauseWorkflow: (id: string) => post(`/workflows/${id}/pause`),
    resumeWorkflow: (id: string) => post(`/workflows/${id}/resume`),
    getWorkflowStatus: (id: string) => get(`/workflows/${id}/status`),
    getWorkflowExecution: (id: string) => get(`/workflows/${id}/execution`),
    setWorkflowFolder: (id: string, folderPath: string) => put(`/workflows/${id}/folder`, { folderPath }),
    getNodeLogs: (workflowId: string, runId: string) => get(`/workflows/${workflowId}/runs/${runId}/node-logs`),

    getTasks: (params?: any) => get('/tasks', params),
    getTask: (id: string) => get(`/tasks/${id}`),
    createTask: (data: any) => post('/tasks', data),
    updateTask: (id: string, data: any) => put(`/tasks/${id}`, data),
    deleteTask: (id: string) => del(`/tasks/${id}`),
    executeTask: (id: string) => post(`/tasks/${id}/execute`),
    cancelTask: (id: string) => post(`/tasks/${id}/cancel`),
    pauseTask: (id: string) => post(`/tasks/${id}/pause`),
    resumeTask: (id: string) => post(`/tasks/${id}/resume`),

    getTaskQueues: (params?: any) => get('/task-queues', params),
    getTaskQueue: (id: string) => get(`/task-queues/${id}`),
    createTaskQueue: (data: any) => post('/task-queues', data),
    updateTaskQueue: (id: string, data: any) => put(`/task-queues/${id}`, data),
    deleteTaskQueue: (id: string) => del(`/task-queues/${id}`),
    startTaskQueue: (id: string) => post(`/task-queues/${id}/start`),
    pauseTaskQueue: (id: string) => post(`/task-queues/${id}/pause`),
    resumeTaskQueue: (id: string) => post(`/task-queues/${id}/resume`),
    cancelTaskQueue: (id: string) => post(`/task-queues/${id}/cancel`),
    addTaskQueueItem: (id: string, data: any) => post(`/task-queues/${id}/items`, data),
    removeTaskQueueItem: (id: string, itemId: string) => del(`/task-queues/${id}/items/${itemId}`),

    listFiles: (path: string) => get('/files', { path }),
    readFile: (path: string) => get('/files/read', { path }),
    writeFile: (path: string, content: string) => post('/files/write', { path, content }),
    mkdir: (path: string) => post('/files/mkdir', { path }),
    deleteFile: (path: string) => del('/files', { path }),
    renameFile: (oldPath: string, newPath: string) => post('/files/rename', { oldPath, newPath }),
    createWorkspace: (name: string, parentPath?: string, template?: string) => post('/files/workspace', { name, parentPath, template }),
    browseDirectories: (path: string) => get('/files/browse', { path }),
    setWorkspace: (path: string) => post('/files/set-workspace', { path }),
    getWorkspaceInfo: () => get('/files/workspace-info'),
    getWorkspaceState: () => get('/workspace-state'),
    getWorkspaceHistory: () => get('/workspace-history'),

    getUndoCache: (filePath: string) => get('/files/undo-cache', { path: filePath }),
    saveUndoCache: (data: any) => post('/files/undo-cache', data),
    clearUndoCache: (filePath?: string) => del('/files/undo-cache' + (filePath ? `?path=${encodeURIComponent(filePath)}` : '')),

    importFile: (sourcePath: string, targetPath: string) => post('/files/import', { sourcePath, targetPath }),
    getParentPath: (filePath: string) => get('/files/parent', { path: filePath }),

    broadcast: (message: string, type?: string, data?: any) => post('/broadcast', { message, type, data }),
    getBroadcastHistory: (params?: any) => get('/broadcast/history', params),
    getClients: () => get('/clients'),

    getApiConfigs: () => get('/api-keys'),
    createApiConfig: (data: any) => post('/api-keys', data),
    updateApiConfig: (id: string, data: any) => put(`/api-keys/${id}`, data),
    deleteApiConfig: (id: string) => del(`/api-keys/${id}`),
    setDefaultApiConfig: (id: string) => put(`/api-keys/${id}/default`),
    testApiConfig: (id: string) => get(`/api-keys/${id}/test`),
    // 注：已移除 getApiKey(id) — 服务器不再暴露解密后的明文密钥

    respondApproval: (requestId: string, decision: string, comment?: string) => post('/workflows/approval/respond', { requestId, decision, comment }),
    stopWorkflow: (id: string) => post(`/workflows/${id}/stop`),
    skipWorkflowNode: (id: string, nodeId: string) => post(`/workflows/${id}/skip-node`, { nodeId }),
    getWorkflowInputRequired: (id: string) => get(`/workflows/${id}/input-required`),

    getHistory: (params?: any) => get('/history', params),
    getHistoryDetail: (runId: string) => get(`/history/${runId}`),
    deleteHistory: (runId: string) => del(`/history/${runId}`),
    deleteHistoryBatch: (runIds: string[]) => del('/history/batch', { runIds }),

    deleteTasksBatch: (ids: string[]) => del('/tasks/batch', { ids }),
    deleteTaskQueuesBatch: (ids: string[]) => del('/task-queues/batch', { ids }),
    deleteWorkflowsBatch: (ids: string[]) => del('/workflows/batch', { ids }),
    deleteAgentsBatch: (ids: string[]) => del('/agents/batch', { ids }),

    getAlertConfig: () => get('/alerts/config'),
    updateAlertConfig: (data: any) => put('/alerts/config', data),

    getWorkflowTemplates: () => get('/workflow-templates'),
    cloneWorkflowTemplate: (id: string) => post(`/workflow-templates/${id}/clone`),

    getSkills: () => get('/skills'),
    installSkill: (skillId: string, name?: string) => post(`/skills/${skillId}/install`, { name }),
    uninstallSkill: (skillId: string) => del(`/skills/${skillId}/uninstall`),
    getInstalledSkills: () => get('/skills/installed'),
    getAgentSkills: (agentId: string) => get(`/skills/agent/${agentId}`),

    getMcpTools: () => Promise.resolve({ success: true, data: [] }),

    getGitStatus: () => get('/git/status'),
    getGitDiff: (file?: string) => get('/git/diff', file ? { file } : undefined),
    getGitLog: (limit?: number) => get('/git/log', { limit: limit || 20 }),
    gitCommit: (message: string, files?: string[]) => post('/git/commit', { message, files }),
    gitCheckout: (branch: string) => post('/git/checkout', { branch }),
    getGitBranches: () => get('/git/branches'),
    createGitBranch: (name: string) => post('/git/branch', { name }),
    stageFile: (file: string) => post('/git/stage', { file }),
    unstageFile: (file: string) => post('/git/unstage', { file }),
    checkGitRepo: () => get('/git/check'),

    createTerminal: (cwd?: string) => post('/terminal', { cwd }),
    getTerminals: () => get('/terminal'),
    killTerminal: (id: string) => del('/terminal/' + id),
    sendTerminalInput: (id: string, data: string) => post('/terminal/' + id + '/input', { data }),
    getTerminalOutput: (id: string) => get('/terminal/' + id + '/output'),
    getTerminalHistory: (id: string) => get(`/terminal/${id}/history`),
    resizeTerminal: (id: string, cols: number, rows: number) => post(`/terminal/${id}/resize`, { cols, rows }),
    restoreTerminals: (sessions: any[]) => post('/terminal/restore', { sessions }),

    stepWorkflow: (id: string, nodeId: string) => post(`/workflows/${id}/step`, { nodeId }),
    simulateWorkflow: (id: string, mockData: any) => post(`/workflows/${id}/simulate`, { mockData }),
    testNode: (id: string, nodeId: string, testInput: any) => post(`/workflows/${id}/test-node`, { nodeId, testInput }),

    getWorkflowContext: (id: string) => get(`/workflows/${id}/context`),
    updateWorkflowContext: (id: string, context: any) => put(`/workflows/${id}/context`, { context }),
    getWorkflowVariables: (id: string) => get(`/workflows/${id}/variables`),

    batchExecuteWorkflow: (id: string, paramsArray: any[]) => post(`/workflows/${id}/batch-execute`, { paramsArray }),

    saveSnapshot: (id: string, name: string) => post(`/workflows/${id}/snapshots`, { name }),
    getSnapshots: (id: string) => get(`/workflows/${id}/snapshots`),
    restoreSnapshot: (id: string, snapshotId: string) => post(`/workflows/${id}/snapshots/${snapshotId}/restore`),
    deleteSnapshot: (id: string, snapshotId: string) => del(`/workflows/${id}/snapshots/${snapshotId}`),

    batchExecuteWorkflows: (ids: string[], input?: any) => post('/workflows/batch-execute', { workflowIds: ids, input }),

    getAuditLogs: (params?: any) => get('/audit-logs', params),

    getWorkspaces: () => get('/workspaces'),
    activateWorkspace: (workspacePath: string) => post('/workspaces', { path: workspacePath }),
    deactivateWorkspace: (id: string) => del(`/workspaces/${id}`),
    getWorkspaceStateById: (id: string) => get(`/workspaces/${id}/state`),
    getWorkspaceWorkflows: (id: string) => get(`/workspaces/${id}/workflows`),

    getChatSessions: (params?: any) => get('/chat', params),
    getChatSession: (id: string) => get(`/chat/${id}`),
    searchChatSessions: (q: string) => get('/chat/search', { q }),
    createChatSession: (data: any) => post('/chat', data),
    deleteChatSession: (id: string) => del(`/chat/${id}`),
    sendChatMessage: (id: string, content: string) => post(`/chat/${id}/messages`, { content }),
    archiveChatSession: (id: string) => post(`/chat/${id}/archive`),
    executeChatAction: (id: string, actionId: string, confirmed?: boolean) => post(`/chat/${id}/execute`, { actionId, confirmed }),
    getSlashCommands: () => post('/chat/slash-commands'),

    getPromptTemplates: (params?: any) => get('/prompt-templates', params),
    getPromptTemplate: (id: string) => get(`/prompt-templates/${id}`),
    createPromptTemplate: (data: any) => post('/prompt-templates', data),
    updatePromptTemplate: (id: string, data: any) => put(`/prompt-templates/${id}`, data),
    deletePromptTemplate: (id: string) => del(`/prompt-templates/${id}`),
    usePromptTemplate: (id: string) => post(`/prompt-templates/${id}/use`),

    getResources: () => get('/resources', { _t: Date.now() }),
    getAgentResources: () => get('/resources/agents', { _t: Date.now() }),

    getArtifacts: (params?: any) => get('/artifacts', params),
    getArtifact: (id: string) => get(`/artifacts/${id}`),
    getArtifactContent: (id: string) => get(`/artifacts/${id}/content`),
    deleteArtifact: (id: string) => del(`/artifacts/${id}`),
    reindexArtifacts: () => post('/artifacts/reindex'),

    resumeWorkflowFromCheckpoint: (id: string, runId: string) => post(`/workflows/${id}/resume-from-checkpoint`, { runId }),
    getWorkflowCheckpoints: (id: string) => get(`/workflows/${id}/checkpoints`),

    getReports: (params?: any) => get('/reports', params),
    getReport: (workflowId: string, runId: string) => get(`/reports/${workflowId}/${runId}`),
    deleteReport: (workflowId: string, runId: string) => del(`/reports/${workflowId}/${runId}`),
    generateReport: (data: any) => post('/reports/generate', data),
    exportReport: (workflowId: string, runId: string) => get(`/reports/${workflowId}/${runId}/download`),

    getWorkflowsForSelection: () => get('/workflows/list-for-selection'),

    searchMemories: (q: string) => get('/memory/search', { q }),
    getMemory: (workflowId: string) => get(`/memory/${workflowId}`),
    updateMemory: (workflowId: string, content: string) => put(`/memory/${workflowId}`, { content }),
    deleteMemory: (workflowId: string) => del(`/memory/${workflowId}`),
    getSharedPool: () => get('/memory/shared/pool'),
    updateSharedPool: (data: any) => put('/memory/shared/pool', data),
    listMemories: (params?: any) => get('/memory/list', params),

    searchKnowledge: (q: string, filters?: any) => get('/knowledge', { q, ...filters }),
    addKnowledge: (data: any) => post('/knowledge', data),
    updateKnowledge: (id: string, data: any) => put(`/knowledge/${id}`, data),
    deleteKnowledge: (id: string) => del(`/knowledge/${id}`),
    getKnowledgeTags: () => get('/knowledge/tags'),
    addKnowledgeTag: (data: any) => post('/knowledge/tags', data),
    deleteKnowledgeTag: (id: string) => del(`/knowledge/tags/${id}`),
    exportKnowledge: (format?: string) => `/api/knowledge/export?format=${format || 'json'}`,
    importKnowledge: (entries: any[], format?: string) => post('/knowledge/import', { entries, format }),

    getWorkflowStatistics: () => get('/workflows/statistics'),
    getWorkflowTimeline: (params?: any) => get('/workflows/timeline', params),
    batchDeleteExecutionLogs: (items: any[]) => post('/workflows/execution-logs/batch-delete', { items }),

    createWorkflowFromText: (description: string) => post('/workflows/create-from-text', { description }),

    importWorkflowMd: (content: string, name?: string, workspaceId?: string) => post('/workflows/import-md', { content, name, workspaceId }),
    getWorkflowExportMdUrl: (id: string) => `/api/workflows/${id}/export-md`,

    batchCloneWorkflows: (workflowIds: string[], targetWorkspaceIds: string[]) => post('/workflows/batch-clone', { workflowIds, targetWorkspaceIds }),

    exportWorkflows: (ids: string[]) => post('/workflows/export', { ids }),
    importWorkflows: (workflows: any[]) => post('/workflows/import', { workflows }),

    get: (path: string, params?: any) => get(path, params),
    post: (path: string, body?: any) => post(path, body),
    put: (path: string, body?: any) => put(path, body),
    del: (path: string, body?: any) => del(path, body),
  };
})();
