"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.GitService = void 0;
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const child_process_1 = require("child_process");
const util_1 = require("util");
const execFileAsync = (0, util_1.promisify)(child_process_1.execFile);
function normalizeCwd(cwd) {
    if (!cwd || typeof cwd !== 'string') {
        throw new Error('Git cwd is required');
    }
    const resolved = path_1.default.resolve(cwd);
    if (!fs_1.default.existsSync(resolved) || !fs_1.default.statSync(resolved).isDirectory()) {
        throw new Error(`Git cwd is not a directory: ${cwd}`);
    }
    return resolved;
}
function classifyStatus(indexStatus, worktreeStatus) {
    const combined = `${indexStatus}${worktreeStatus}`;
    if (combined.includes('?'))
        return 'untracked';
    if (combined.includes('D'))
        return 'deleted';
    if (combined.includes('A'))
        return 'added';
    if (combined.includes('R'))
        return 'renamed';
    if (combined.includes('C'))
        return 'copied';
    if (combined.includes('M'))
        return 'modified';
    return 'unknown';
}
class GitService {
    workspaceRoot;
    constructor(workspaceRoot) {
        this.workspaceRoot = normalizeCwd(workspaceRoot);
    }
    static async runGit(cwd, args) {
        const resolved = normalizeCwd(cwd);
        try {
            const { stdout } = await execFileAsync('git', args, {
                cwd: resolved,
                windowsHide: true,
                maxBuffer: 10 * 1024 * 1024
            });
            return String(stdout || '');
        }
        catch (error) {
            const stderr = error?.stderr ? String(error.stderr).trim() : '';
            const message = stderr || error?.message || String(error);
            throw new Error(message);
        }
    }
    static async isGitRepo(cwd) {
        try {
            const stdout = await GitService.runGit(cwd, ['rev-parse', '--is-inside-work-tree']);
            return stdout.trim() === 'true';
        }
        catch (_) {
            return false;
        }
    }
    static async getStatus(cwd) {
        const stdout = await GitService.runGit(cwd, ['status', '--porcelain']);
        const branchOutput = await GitService.runGit(cwd, ['branch', '--show-current']);
        const modified = [];
        const added = [];
        const deleted = [];
        const untracked = [];
        const files = [];
        for (const line of stdout.split('\n').filter(Boolean)) {
            const indexStatus = line[0] || ' ';
            const worktreeStatus = line[1] || ' ';
            const rawPath = line.substring(3);
            const filePath = rawPath.includes(' -> ') ? rawPath.split(' -> ').pop() : rawPath;
            const status = classifyStatus(indexStatus, worktreeStatus);
            const staged = indexStatus !== ' ' && indexStatus !== '?';
            if (status === 'modified')
                modified.push(filePath);
            if (status === 'added')
                added.push(filePath);
            if (status === 'deleted')
                deleted.push(filePath);
            if (status === 'untracked')
                untracked.push(filePath);
            files.push({ path: filePath, status, staged });
        }
        return {
            branch: branchOutput.trim(),
            modified,
            added,
            deleted,
            untracked,
            files
        };
    }
    static async getDiff(cwd, file) {
        const args = ['diff'];
        if (file)
            args.push('--', String(file));
        return GitService.runGit(cwd, args);
    }
    static async getLog(cwd, limit = 20) {
        const safeLimit = Number.isInteger(limit) && limit > 0 ? Math.min(limit, 100) : 20;
        return GitService.runGit(cwd, ['log', `--max-count=${safeLimit}`, '--oneline']);
    }
    static async getBranches(cwd) {
        const stdout = await GitService.runGit(cwd, ['branch', '--format=%(refname:short)']);
        return stdout.split('\n').map(line => line.trim()).filter(Boolean);
    }
    static async commit(cwd, message, files) {
        const trimmed = typeof message === 'string' ? message.trim() : '';
        if (!trimmed) {
            throw new Error('Commit message is required');
        }
        if (Array.isArray(files) && files.length > 0) {
            await GitService.runGit(cwd, ['add', '--', ...files.map(String)]);
        }
        else {
            await GitService.runGit(cwd, ['add', '-A']);
        }
        return GitService.runGit(cwd, ['commit', '-m', trimmed]);
    }
    static async checkout(cwd, branch) {
        if (!branch || typeof branch !== 'string') {
            throw new Error('Branch is required');
        }
        return GitService.runGit(cwd, ['checkout', '--', branch]);
    }
    static async createBranch(cwd, name) {
        if (!name || typeof name !== 'string') {
            throw new Error('Branch name is required');
        }
        return GitService.runGit(cwd, ['checkout', '-b', name]);
    }
    static async stageFile(cwd, file) {
        if (!file || typeof file !== 'string') {
            throw new Error('File is required');
        }
        return GitService.runGit(cwd, ['add', '--', file]);
    }
    static async unstageFile(cwd, file) {
        if (!file || typeof file !== 'string') {
            throw new Error('File is required');
        }
        return GitService.runGit(cwd, ['restore', '--staged', '--', file]);
    }
    async getStatus() {
        return GitService.getStatus(this.workspaceRoot);
    }
    async createWorktree(agentId) {
        if (!agentId || typeof agentId !== 'string') {
            throw new Error('agentId is required');
        }
        const worktreePath = path_1.default.join(this.workspaceRoot, '.worktrees', agentId);
        await GitService.runGit(this.workspaceRoot, ['worktree', 'add', worktreePath, '-b', `agent-${agentId}`]);
        return worktreePath;
    }
    async removeWorktree(agentId) {
        if (!agentId || typeof agentId !== 'string')
            return;
        const worktreePath = path_1.default.join(this.workspaceRoot, '.worktrees', agentId);
        try {
            await GitService.runGit(this.workspaceRoot, ['worktree', 'remove', worktreePath, '--force']);
        }
        catch (_) {
            // Ignore cleanup failures for compatibility with existing behavior.
        }
    }
}
exports.GitService = GitService;
module.exports = GitService;
module.exports.GitService = GitService;
module.exports.default = GitService;
//# sourceMappingURL=GitService.js.map