import fs from 'fs';
import path from 'path';
import { execFile } from 'child_process';
import { promisify } from 'util';

const execFileAsync = promisify(execFile);

export interface GitFileStatus {
  path: string;
  status: string;
  staged: boolean;
}

export interface GitStatus {
  branch: string;
  modified: string[];
  added: string[];
  deleted: string[];
  untracked: string[];
  files: GitFileStatus[];
}

function normalizeCwd(cwd: string): string {
  if (!cwd || typeof cwd !== 'string') {
    throw new Error('Git cwd is required');
  }
  const resolved = path.resolve(cwd);
  if (!fs.existsSync(resolved) || !fs.statSync(resolved).isDirectory()) {
    throw new Error(`Git cwd is not a directory: ${cwd}`);
  }
  return resolved;
}

function classifyStatus(indexStatus: string, worktreeStatus: string): string {
  const combined = `${indexStatus}${worktreeStatus}`;
  if (combined.includes('?')) return 'untracked';
  if (combined.includes('D')) return 'deleted';
  if (combined.includes('A')) return 'added';
  if (combined.includes('R')) return 'renamed';
  if (combined.includes('C')) return 'copied';
  if (combined.includes('M')) return 'modified';
  return 'unknown';
}

export class GitService {
  private workspaceRoot: string;

  constructor(workspaceRoot: string) {
    this.workspaceRoot = normalizeCwd(workspaceRoot);
  }

  private static async runGit(cwd: string, args: string[]): Promise<string> {
    const resolved = normalizeCwd(cwd);
    try {
      const { stdout } = await execFileAsync('git', args, {
        cwd: resolved,
        windowsHide: true,
        maxBuffer: 10 * 1024 * 1024
      });
      return String(stdout || '');
    } catch (error: any) {
      const stderr = error?.stderr ? String(error.stderr).trim() : '';
      const message = stderr || error?.message || String(error);
      throw new Error(message);
    }
  }

  static async isGitRepo(cwd: string): Promise<boolean> {
    try {
      const stdout = await GitService.runGit(cwd, ['rev-parse', '--is-inside-work-tree']);
      return stdout.trim() === 'true';
    } catch (_) {
      return false;
    }
  }

  static async getStatus(cwd: string): Promise<GitStatus> {
    const stdout = await GitService.runGit(cwd, ['status', '--porcelain']);
    const branchOutput = await GitService.runGit(cwd, ['branch', '--show-current']);
    const modified: string[] = [];
    const added: string[] = [];
    const deleted: string[] = [];
    const untracked: string[] = [];
    const files: GitFileStatus[] = [];

    for (const line of stdout.split('\n').filter(Boolean)) {
      const indexStatus = line[0] || ' ';
      const worktreeStatus = line[1] || ' ';
      const rawPath = line.substring(3);
      const filePath = rawPath.includes(' -> ') ? rawPath.split(' -> ').pop()! : rawPath;
      const status = classifyStatus(indexStatus, worktreeStatus);
      const staged = indexStatus !== ' ' && indexStatus !== '?';

      if (status === 'modified') modified.push(filePath);
      if (status === 'added') added.push(filePath);
      if (status === 'deleted') deleted.push(filePath);
      if (status === 'untracked') untracked.push(filePath);
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

  static async getDiff(cwd: string, file?: string): Promise<string> {
    const args = ['diff'];
    if (file) args.push('--', String(file));
    return GitService.runGit(cwd, args);
  }

  static async getLog(cwd: string, limit = 20): Promise<string> {
    const safeLimit = Number.isInteger(limit) && limit > 0 ? Math.min(limit, 100) : 20;
    return GitService.runGit(cwd, ['log', `--max-count=${safeLimit}`, '--oneline']);
  }

  static async getBranches(cwd: string): Promise<string[]> {
    const stdout = await GitService.runGit(cwd, ['branch', '--format=%(refname:short)']);
    return stdout.split('\n').map(line => line.trim()).filter(Boolean);
  }

  static async commit(cwd: string, message: string, files?: string[]): Promise<string> {
    const trimmed = typeof message === 'string' ? message.trim() : '';
    if (!trimmed) {
      throw new Error('Commit message is required');
    }

    if (Array.isArray(files) && files.length > 0) {
      await GitService.runGit(cwd, ['add', '--', ...files.map(String)]);
    } else {
      await GitService.runGit(cwd, ['add', '-A']);
    }

    return GitService.runGit(cwd, ['commit', '-m', trimmed]);
  }

  static async checkout(cwd: string, branch: string): Promise<string> {
    if (!branch || typeof branch !== 'string') {
      throw new Error('Branch is required');
    }
    return GitService.runGit(cwd, ['checkout', '--', branch]);
  }

  static async createBranch(cwd: string, name: string): Promise<string> {
    if (!name || typeof name !== 'string') {
      throw new Error('Branch name is required');
    }
    return GitService.runGit(cwd, ['checkout', '-b', name]);
  }

  static async stageFile(cwd: string, file: string): Promise<string> {
    if (!file || typeof file !== 'string') {
      throw new Error('File is required');
    }
    return GitService.runGit(cwd, ['add', '--', file]);
  }

  static async unstageFile(cwd: string, file: string): Promise<string> {
    if (!file || typeof file !== 'string') {
      throw new Error('File is required');
    }
    return GitService.runGit(cwd, ['restore', '--staged', '--', file]);
  }

  async getStatus(): Promise<GitStatus> {
    return GitService.getStatus(this.workspaceRoot);
  }

  async createWorktree(agentId: string): Promise<string> {
    if (!agentId || typeof agentId !== 'string') {
      throw new Error('agentId is required');
    }
    const worktreePath = path.join(this.workspaceRoot, '.worktrees', agentId);
    await GitService.runGit(this.workspaceRoot, ['worktree', 'add', worktreePath, '-b', `agent-${agentId}`]);
    return worktreePath;
  }

  async removeWorktree(agentId: string): Promise<void> {
    if (!agentId || typeof agentId !== 'string') return;
    const worktreePath = path.join(this.workspaceRoot, '.worktrees', agentId);
    try {
      await GitService.runGit(this.workspaceRoot, ['worktree', 'remove', worktreePath, '--force']);
    } catch (_) {
      // Ignore cleanup failures for compatibility with existing behavior.
    }
  }
}

module.exports = GitService;
module.exports.GitService = GitService;
module.exports.default = GitService;
