const { execFile } = require('child_process');
const path = require('path');
const logger = require('../utils/logger');

/**
 * Git operations service
 * Executes git commands in the workspace directory.
 */
class GitService {
  /**
   * Execute a git command and return stdout
   * @param {string} cwd - Working directory
   * @param {string[]} args - Git command arguments
   * @returns {Promise<string>}
   */
  static _exec(cwd, args) {
    return new Promise((resolve, reject) => {
      execFile('git', args, {
        cwd,
        windowsHide: true,
        ...(process.platform === 'win32' ? { creationFlags: 0x08000000 } : {})
      }, (error, stdout, stderr) => {
        if (error) {
          logger.error(`Git command failed: git ${args.join(' ')}`, { error: error.message, stderr });
          reject(new Error(stderr || error.message));
          return;
        }
        resolve(stdout.trim());
      });
    });
  }

  /**
   * Get git status
   * @param {string} cwd - Working directory
   * @returns {Promise<{branch: string, files: Array}>}
   */
  static async getStatus(cwd) {
    const [statusOutput, branch] = await Promise.all([
      this._exec(cwd, ['status', '--porcelain']),
      this._exec(cwd, ['branch', '--show-current'])
    ]);

    const files = statusOutput
      ? statusOutput.split('\n').filter(Boolean).map(line => {
          const statusCode = line.substring(0, 2).trim();
          const filePath = line.substring(3);
          let status = 'unknown';
          if (statusCode === 'M' || statusCode === 'MM') status = 'modified';
          else if (statusCode === 'A') status = 'added';
          else if (statusCode === 'D') status = 'deleted';
          else if (statusCode === '??') status = 'untracked';
          else if (statusCode === 'R') status = 'renamed';
          else if (statusCode === 'C') status = 'copied';
          else if (statusCode.startsWith('M')) status = 'modified';

          return { path: filePath, status, statusCode };
        })
      : [];

    return { branch, files };
  }

  /**
   * Get git diff
   * @param {string} cwd - Working directory
   * @param {string} [file] - Specific file, or all files
   * @returns {Promise<string>}
   */
  static async getDiff(cwd, file) {
    const args = ['diff'];
    if (file) args.push(file);
    return this._exec(cwd, args);
  }

  /**
   * Get git log
   * @param {string} cwd - Working directory
   * @param {number} [limit=20] - Number of commits
   * @returns {Promise<string>}
   */
  static async getLog(cwd, limit = 20) {
    return this._exec(cwd, ['log', '--oneline', `--max-count=${limit}`]);
  }

  /**
   * Commit files
   * @param {string} cwd - Working directory
   * @param {string} message - Commit message
   * @param {string[]} [files] - Specific files to stage, or all
   * @returns {Promise<string>}
   */
  static async commit(cwd, message, files) {
    if (files && files.length > 0) {
      await this._exec(cwd, ['add', ...files]);
    } else {
      await this._exec(cwd, ['add', '.']);
    }
    return this._exec(cwd, ['commit', '-m', message]);
  }

  /**
   * Checkout a branch
   * @param {string} cwd - Working directory
   * @param {string} branch - Branch name
   * @returns {Promise<string>}
   */
  static async checkout(cwd, branch) {
    return this._exec(cwd, ['checkout', branch]);
  }

  /**
   * Get all branches
   * @param {string} cwd - Working directory
   * @returns {Promise<string[]>}
   */
  static async getBranches(cwd) {
    const output = await this._exec(cwd, ['branch', '-a']);
    return output
      .split('\n')
      .filter(Boolean)
      .map(b => b.replace(/^\*?\s+/, '').trim());
  }

  /**
   * Create a new branch
   * @param {string} cwd - Working directory
   * @param {string} name - Branch name
   * @returns {Promise<string>}
   */
  static async createBranch(cwd, name) {
    return this._exec(cwd, ['checkout', '-b', name]);
  }

  /**
   * Stage a file
   * @param {string} cwd - Working directory
   * @param {string} file - File path
   * @returns {Promise<string>}
   */
  static async stageFile(cwd, file) {
    return this._exec(cwd, ['add', file]);
  }

  /**
   * Unstage a file
   * @param {string} cwd - Working directory
   * @param {string} file - File path
   * @returns {Promise<string>}
   */
  static async unstageFile(cwd, file) {
    return this._exec(cwd, ['reset', 'HEAD', file]);
  }

  /**
   * Check if directory is inside a git repo
   * @param {string} cwd - Working directory
   * @returns {Promise<boolean>}
   */
  static async isGitRepo(cwd) {
    try {
      await this._exec(cwd, ['rev-parse', '--is-inside-work-tree']);
      return true;
    } catch {
      return false;
    }
  }
}

module.exports = GitService;
