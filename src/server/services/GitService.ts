/**
 * GitService - Git操作服务
 * 提供Git版本控制功能
 */

import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

export interface GitStatus {
  branch: string;
  modified: string[];
  added: string[];
  deleted: string[];
  untracked: string[];
}

export class GitService {
  private workspaceRoot: string;

  constructor(workspaceRoot: string) {
    this.workspaceRoot = workspaceRoot;
  }

  /**
   * 获取Git状态
   */
  async getStatus(): Promise<GitStatus> {
    try {
      const { stdout } = await execAsync('git status --porcelain', {
        cwd: this.workspaceRoot
      });

      const lines = stdout.split('\n').filter(line => line.trim());
      const modified: string[] = [];
      const added: string[] = [];
      const deleted: string[] = [];
      const untracked: string[] = [];

      for (const line of lines) {
        const status = line.substring(0, 2);
        const file = line.substring(3);

        if (status.includes('M')) modified.push(file);
        if (status.includes('A')) added.push(file);
        if (status.includes('D')) deleted.push(file);
        if (status.includes('??')) untracked.push(file);
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
    } catch (error) {
      throw new Error(`Failed to get git status: ${error}`);
    }
  }

  /**
   * 创建Git worktree
   */
  async createWorktree(agentId: string): Promise<string> {
    const worktreePath = `${this.workspaceRoot}/.worktrees/${agentId}`;
    
    try {
      await execAsync(`git worktree add "${worktreePath}" -b "agent-${agentId}"`, {
        cwd: this.workspaceRoot
      });
      return worktreePath;
    } catch (error) {
      throw new Error(`Failed to create worktree: ${error}`);
    }
  }

  /**
   * 删除Git worktree
   */
  async removeWorktree(agentId: string): Promise<void> {
    const worktreePath = `${this.workspaceRoot}/.worktrees/${agentId}`;
    
    try {
      await execAsync(`git worktree remove "${worktreePath}" --force`, {
        cwd: this.workspaceRoot
      });
    } catch (error) {
      // 忽略错误
    }
  }
}

module.exports = GitService;
