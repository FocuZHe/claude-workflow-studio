"use strict";
// ═══════════════════════════════════════════════
// API Client — Fetch wrapper
// ═══════════════════════════════════════════════
Object.defineProperty(exports, "__esModule", { value: true });
window.API = (() => {
    const BASE = '/api';
    const NEVER = new Promise(() => { });
    const API_KEY_KEY = 'claude_console_api_key';
    let _apiKey = localStorage.getItem(API_KEY_KEY) || null;
    let _keyFetchPromise = null;
    function getApiKey() {
        if (_apiKey)
            return _apiKey;
        if (_keyFetchPromise)
            return _keyFetchPromise;
        _keyFetchPromise = fetch(BASE + '/auth/key')
            .then(r => r.json())
            .then(data => {
            if (data.success && data.apiKey) {
                _apiKey = data.apiKey;
                localStorage.setItem(API_KEY_KEY, _apiKey);
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
    async function request(method, path, body = null, params = null) {
        let url = BASE + path;
        if (params) {
            const qs = new URLSearchParams(Object.entries(params).filter(([, v]) => v != null && v !== '')).toString();
            if (qs)
                url += '?' + qs;
        }
        const key = _apiKey || await getApiKey();
        const opts = {
            method,
            headers: {
                'Content-Type': 'application/json',
                ...(key ? { 'X-API-Key': key } : {}),
            },
        };
        if (body && method !== 'GET') {
            opts.body = JSON.stringify(body);
        }
        const navSeq = (typeof Router !== 'undefined' && Router.getNavSeq) ? Router.getNavSeq() : 0;
        const isStale = () => {
            if (navSeq === 0)
                return false;
            const cur = (typeof Router !== 'undefined' && Router.getNavSeq) ? Router.getNavSeq() : 0;
            return navSeq !== cur;
        };
        let res;
        try {
            res = await fetch(url, opts);
        }
        catch (e) {
            if (isStale())
                return NEVER;
            throw e;
        }
        if (isStale())
            return NEVER;
        if (res.status === 204) {
            return { success: true, data: null };
        }
        let data;
        try {
            data = await res.json();
        }
        catch (e) {
            if (isStale())
                return NEVER;
            throw e;
        }
        if (isStale())
            return NEVER;
        if (!res.ok || data.success === false) {
            const err = new Error(data.error?.message || `HTTP ${res.status}`);
            err.status = res.status;
            err.code = data.error?.code;
            err.details = data.error?.details;
            if ((res.status === 401 || res.status === 403) && _apiKey) {
                localStorage.removeItem(API_KEY_KEY);
                _apiKey = null;
                const freshKey = await getApiKey();
                if (freshKey && freshKey !== key) {
                    opts.headers['X-API-Key'] = freshKey;
                    let retryRes;
                    try {
                        retryRes = await fetch(url, opts);
                    }
                    catch (e) {
                        throw err;
                    }
                    if (retryRes.ok) {
                        let retryData;
                        try {
                            retryData = await retryRes.json();
                        }
                        catch (e) {
                            throw err;
                        }
                        if (retryData.success !== false)
                            return retryData;
                    }
                }
            }
            throw err;
        }
        return data;
    }
    const get = (path, params) => request('GET', path, null, params);
    const post = (path, body) => request('POST', path, body);
    const put = (path, body) => request('PUT', path, body);
    const del = (path, body) => request('DELETE', path, body);
    return {
        getAgents: (params) => get('/agents', params),
        getAgent: (id) => get(`/agents/${id}`),
        getAgentChildren: (id) => get(`/agents/${id}/children`),
        createAgent: (data) => post('/agents', data),
        updateAgent: (id, data) => put(`/agents/${id}`, data),
        deleteAgent: (id) => del(`/agents/${id}`),
        getAgentLogs: (id, params) => get(`/agents/${id}/logs`, params),
        getWorkflows: (params) => get('/workflows', params),
        getWorkflow: (id) => get(`/workflows/${id}`),
        createWorkflow: (data) => post('/workflows', data),
        updateWorkflow: (id, data) => put(`/workflows/${id}`, data),
        deleteWorkflow: (id) => del(`/workflows/${id}`),
        renameWorkflow: (id, name) => put(`/workflows/${id}/rename`, { name }),
        createWorkflowInAll: (data) => post('/workflows/create-in-all', data),
        executeWorkflow: (id, data) => post(`/workflows/${id}/execute`, data),
        pauseWorkflow: (id) => post(`/workflows/${id}/pause`),
        resumeWorkflow: (id) => post(`/workflows/${id}/resume`),
        getWorkflowStatus: (id) => get(`/workflows/${id}/status`),
        getWorkflowExecution: (id) => get(`/workflows/${id}/execution`),
        setWorkflowFolder: (id, folderPath) => put(`/workflows/${id}/folder`, { folderPath }),
        getNodeLogs: (workflowId, runId) => get(`/workflows/${workflowId}/runs/${runId}/node-logs`),
        getTasks: (params) => get('/tasks', params),
        getTask: (id) => get(`/tasks/${id}`),
        createTask: (data) => post('/tasks', data),
        updateTask: (id, data) => put(`/tasks/${id}`, data),
        deleteTask: (id) => del(`/tasks/${id}`),
        executeTask: (id) => post(`/tasks/${id}/execute`),
        cancelTask: (id) => post(`/tasks/${id}/cancel`),
        pauseTask: (id) => post(`/tasks/${id}/pause`),
        resumeTask: (id) => post(`/tasks/${id}/resume`),
        getTaskQueues: (params) => get('/task-queues', params),
        getTaskQueue: (id) => get(`/task-queues/${id}`),
        createTaskQueue: (data) => post('/task-queues', data),
        updateTaskQueue: (id, data) => put(`/task-queues/${id}`, data),
        deleteTaskQueue: (id) => del(`/task-queues/${id}`),
        startTaskQueue: (id) => post(`/task-queues/${id}/start`),
        pauseTaskQueue: (id) => post(`/task-queues/${id}/pause`),
        resumeTaskQueue: (id) => post(`/task-queues/${id}/resume`),
        cancelTaskQueue: (id) => post(`/task-queues/${id}/cancel`),
        addTaskQueueItem: (id, data) => post(`/task-queues/${id}/items`, data),
        removeTaskQueueItem: (id, itemId) => del(`/task-queues/${id}/items/${itemId}`),
        listFiles: (path) => get('/files', { path }),
        readFile: (path) => get('/files/read', { path }),
        writeFile: (path, content) => post('/files/write', { path, content }),
        mkdir: (path) => post('/files/mkdir', { path }),
        deleteFile: (path) => del('/files', { path }),
        renameFile: (oldPath, newPath) => post('/files/rename', { oldPath, newPath }),
        createWorkspace: (name, parentPath, template) => post('/files/workspace', { name, parentPath, template }),
        browseDirectories: (path) => get('/files/browse', { path }),
        setWorkspace: (path) => post('/files/set-workspace', { path }),
        getWorkspaceInfo: () => get('/files/workspace-info'),
        getWorkspaceState: () => get('/workspace-state'),
        getWorkspaceHistory: () => get('/workspace-history'),
        getUndoCache: (filePath) => get('/files/undo-cache', { path: filePath }),
        saveUndoCache: (data) => post('/files/undo-cache', data),
        clearUndoCache: (filePath) => del('/files/undo-cache' + (filePath ? `?path=${encodeURIComponent(filePath)}` : '')),
        importFile: (sourcePath, targetPath) => post('/files/import', { sourcePath, targetPath }),
        getParentPath: (filePath) => get('/files/parent', { path: filePath }),
        broadcast: (message, type, data) => post('/broadcast', { message, type, data }),
        getBroadcastHistory: (params) => get('/broadcast/history', params),
        getClients: () => get('/clients'),
        getApiConfigs: () => get('/api-keys'),
        createApiConfig: (data) => post('/api-keys', data),
        updateApiConfig: (id, data) => put(`/api-keys/${id}`, data),
        deleteApiConfig: (id) => del(`/api-keys/${id}`),
        setDefaultApiConfig: (id) => put(`/api-keys/${id}/default`),
        testApiConfig: (id) => get(`/api-keys/${id}/test`),
        // 注：已移除 getApiKey(id) — 服务器不再暴露解密后的明文密钥
        respondApproval: (requestId, decision, comment) => post('/workflows/approval/respond', { requestId, decision, comment }),
        stopWorkflow: (id) => post(`/workflows/${id}/stop`),
        skipWorkflowNode: (id, nodeId) => post(`/workflows/${id}/skip-node`, { nodeId }),
        getWorkflowInputRequired: (id) => get(`/workflows/${id}/input-required`),
        getHistory: (params) => get('/history', params),
        getHistoryDetail: (runId) => get(`/history/${runId}`),
        deleteHistory: (runId) => del(`/history/${runId}`),
        deleteHistoryBatch: (runIds) => del('/history/batch', { runIds }),
        deleteTasksBatch: (ids) => del('/tasks/batch', { ids }),
        deleteTaskQueuesBatch: (ids) => del('/task-queues/batch', { ids }),
        deleteWorkflowsBatch: (ids) => del('/workflows/batch', { ids }),
        deleteAgentsBatch: (ids) => del('/agents/batch', { ids }),
        getAlertConfig: () => get('/alerts/config'),
        updateAlertConfig: (data) => put('/alerts/config', data),
        getWorkflowTemplates: () => get('/workflow-templates'),
        cloneWorkflowTemplate: (id) => post(`/workflow-templates/${id}/clone`),
        getSkills: () => get('/skills'),
        installSkill: (skillId, name) => post(`/skills/${skillId}/install`, { name }),
        uninstallSkill: (skillId) => del(`/skills/${skillId}/uninstall`),
        getInstalledSkills: () => get('/skills/installed'),
        getAgentSkills: (agentId) => get(`/skills/agent/${agentId}`),
        getMcpTools: () => Promise.resolve({ success: true, data: [] }),
        getGitStatus: () => get('/git/status'),
        getGitDiff: (file) => get('/git/diff', file ? { file } : undefined),
        getGitLog: (limit) => get('/git/log', { limit: limit || 20 }),
        gitCommit: (message, files) => post('/git/commit', { message, files }),
        gitCheckout: (branch) => post('/git/checkout', { branch }),
        getGitBranches: () => get('/git/branches'),
        createGitBranch: (name) => post('/git/branch', { name }),
        stageFile: (file) => post('/git/stage', { file }),
        unstageFile: (file) => post('/git/unstage', { file }),
        checkGitRepo: () => get('/git/check'),
        createTerminal: (cwd) => post('/terminal', { cwd }),
        getTerminals: () => get('/terminal'),
        killTerminal: (id) => del('/terminal/' + id),
        sendTerminalInput: (id, data) => post('/terminal/' + id + '/input', { data }),
        getTerminalOutput: (id) => get('/terminal/' + id + '/output'),
        getTerminalHistory: (id) => get(`/terminal/${id}/history`),
        resizeTerminal: (id, cols, rows) => post(`/terminal/${id}/resize`, { cols, rows }),
        restoreTerminals: (sessions) => post('/terminal/restore', { sessions }),
        stepWorkflow: (id, nodeId) => post(`/workflows/${id}/step`, { nodeId }),
        simulateWorkflow: (id, mockData) => post(`/workflows/${id}/simulate`, { mockData }),
        testNode: (id, nodeId, testInput) => post(`/workflows/${id}/test-node`, { nodeId, testInput }),
        getWorkflowContext: (id) => get(`/workflows/${id}/context`),
        updateWorkflowContext: (id, context) => put(`/workflows/${id}/context`, { context }),
        getWorkflowVariables: (id) => get(`/workflows/${id}/variables`),
        batchExecuteWorkflow: (id, paramsArray) => post(`/workflows/${id}/batch-execute`, { paramsArray }),
        saveSnapshot: (id, name) => post(`/workflows/${id}/snapshots`, { name }),
        getSnapshots: (id) => get(`/workflows/${id}/snapshots`),
        restoreSnapshot: (id, snapshotId) => post(`/workflows/${id}/snapshots/${snapshotId}/restore`),
        deleteSnapshot: (id, snapshotId) => del(`/workflows/${id}/snapshots/${snapshotId}`),
        batchExecuteWorkflows: (ids, input) => post('/workflows/batch-execute', { workflowIds: ids, input }),
        getAuditLogs: (params) => get('/audit-logs', params),
        getWorkspaces: () => get('/workspaces'),
        activateWorkspace: (workspacePath) => post('/workspaces', { path: workspacePath }),
        deactivateWorkspace: (id) => del(`/workspaces/${id}`),
        getWorkspaceStateById: (id) => get(`/workspaces/${id}/state`),
        getWorkspaceWorkflows: (id) => get(`/workspaces/${id}/workflows`),
        getChatSessions: (params) => get('/chat', params),
        getChatSession: (id) => get(`/chat/${id}`),
        searchChatSessions: (q) => get('/chat/search', { q }),
        createChatSession: (data) => post('/chat', data),
        deleteChatSession: (id) => del(`/chat/${id}`),
        sendChatMessage: (id, content) => post(`/chat/${id}/messages`, { content }),
        archiveChatSession: (id) => post(`/chat/${id}/archive`),
        executeChatAction: (id, actionId, confirmed) => post(`/chat/${id}/execute`, { actionId, confirmed }),
        getSlashCommands: () => post('/chat/slash-commands'),
        getPromptTemplates: (params) => get('/prompt-templates', params),
        getPromptTemplate: (id) => get(`/prompt-templates/${id}`),
        createPromptTemplate: (data) => post('/prompt-templates', data),
        updatePromptTemplate: (id, data) => put(`/prompt-templates/${id}`, data),
        deletePromptTemplate: (id) => del(`/prompt-templates/${id}`),
        usePromptTemplate: (id) => post(`/prompt-templates/${id}/use`),
        getResources: () => get('/resources', { _t: Date.now() }),
        getAgentResources: () => get('/resources/agents', { _t: Date.now() }),
        getArtifacts: (params) => get('/artifacts', params),
        getArtifact: (id) => get(`/artifacts/${id}`),
        getArtifactContent: (id) => get(`/artifacts/${id}/content`),
        deleteArtifact: (id) => del(`/artifacts/${id}`),
        reindexArtifacts: () => post('/artifacts/reindex'),
        resumeWorkflowFromCheckpoint: (id, runId) => post(`/workflows/${id}/resume-from-checkpoint`, { runId }),
        getWorkflowCheckpoints: (id) => get(`/workflows/${id}/checkpoints`),
        getReports: (params) => get('/reports', params),
        getReport: (workflowId, runId) => get(`/reports/${workflowId}/${runId}`),
        deleteReport: (workflowId, runId) => del(`/reports/${workflowId}/${runId}`),
        generateReport: (data) => post('/reports/generate', data),
        exportReport: (workflowId, runId) => get(`/reports/${workflowId}/${runId}/download`),
        getWorkflowsForSelection: () => get('/workflows/list-for-selection'),
        searchMemories: (q) => get('/memory/search', { q }),
        getMemory: (workflowId) => get(`/memory/${workflowId}`),
        updateMemory: (workflowId, content) => put(`/memory/${workflowId}`, { content }),
        deleteMemory: (workflowId) => del(`/memory/${workflowId}`),
        getSharedPool: () => get('/memory/shared/pool'),
        updateSharedPool: (data) => put('/memory/shared/pool', data),
        listMemories: (params) => get('/memory/list', params),
        searchKnowledge: (q, filters) => get('/knowledge', { q, ...filters }),
        addKnowledge: (data) => post('/knowledge', data),
        updateKnowledge: (id, data) => put(`/knowledge/${id}`, data),
        deleteKnowledge: (id) => del(`/knowledge/${id}`),
        getKnowledgeTags: () => get('/knowledge/tags'),
        addKnowledgeTag: (data) => post('/knowledge/tags', data),
        deleteKnowledgeTag: (id) => del(`/knowledge/tags/${id}`),
        exportKnowledge: (format) => `/api/knowledge/export?format=${format || 'json'}`,
        importKnowledge: (entries, format) => post('/knowledge/import', { entries, format }),
        getWorkflowStatistics: () => get('/workflows/statistics'),
        getWorkflowTimeline: (params) => get('/workflows/timeline', params),
        batchDeleteExecutionLogs: (items) => post('/workflows/execution-logs/batch-delete', { items }),
        createWorkflowFromText: (description) => post('/workflows/create-from-text', { description }),
        importWorkflowMd: (content, name, workspaceId) => post('/workflows/import-md', { content, name, workspaceId }),
        getWorkflowExportMdUrl: (id) => `/api/workflows/${id}/export-md`,
        batchCloneWorkflows: (workflowIds, targetWorkspaceIds) => post('/workflows/batch-clone', { workflowIds, targetWorkspaceIds }),
        exportWorkflows: (ids) => post('/workflows/export', { ids }),
        importWorkflows: (workflows) => post('/workflows/import', { workflows }),
        get: (path, params) => get(path, params),
        post: (path, body) => post(path, body),
        put: (path, body) => put(path, body),
        del: (path, body) => del(path, body),
    };
})();
//# sourceMappingURL=api.js.map