"use strict";
/**
 * GitService - Git操作服务
 * 提供Git版本控制功能
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.GitService = void 0;
const child_process_1 = require("child_process");
const util_1 = require("util");
const execAsync = (0, util_1.promisify)(child_process_1.exec);
class GitService {
    workspaceRoot;
    constructor(workspaceRoot) {
        this.workspaceRoot = workspaceRoot;
    }
    /**
     * 获取Git状态
     */
    async getStatus() {
        try {
            const { stdout } = await execAsync('git status --porcelain', {
                cwd: this.workspaceRoot
            });
            const lines = stdout.split('\n').filter(line => line.trim());
            const modified = [];
            const added = [];
            const deleted = [];
            const untracked = [];
            for (const line of lines) {
                const status = line.substring(0, 2);
                const file = line.substring(3);
                if (status.includes('M'))
                    modified.push(file);
                if (status.includes('A'))
                    added.push(file);
                if (status.includes('D'))
                    deleted.push(file);
                if (status.includes('??'))
                    untracked.push(file);
            }
            const { stdout: branchOutput } = await execAsync('git branch --show-current', {
                cwd: this.workspaceRoot
            });
            return {
                branch: branchOutput.trim(),
                modified,
                added,
                deleted,
                untracked
            };
        }
        catch (error) {
            throw new Error(`Failed to get git status: ${error}`);
        }
    }
    /**
     * 创建Git worktree
     */
    async createWorktree(agentId) {
        const worktreePath = `${this.workspaceRoot}/.worktrees/${agentId}`;
        try {
            await execAsync(`git worktree add "${worktreePath}" -b "agent-${agentId}"`, {
                cwd: this.workspaceRoot
            });
            return worktreePath;
        }
        catch (error) {
            throw new Error(`Failed to create worktree: ${error}`);
        }
    }
    /**
     * 删除Git worktree
     */
    async removeWorktree(agentId) {
        const worktreePath = `${this.workspaceRoot}/.worktrees/${agentId}`;
        try {
            await execAsync(`git worktree remove "${worktreePath}" --force`, {
                cwd: this.workspaceRoot
            });
        }
        catch (error) {
            // 忽略错误
        }
    }
}
exports.GitService = GitService;
module.exports = GitService;
//# sourceMappingURL=GitService.js.map