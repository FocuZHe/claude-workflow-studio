const os = require('os');
const { execFile } = require('child_process');
const logger = require('../utils/logger');

/**
 * Resource monitoring service
 * Provides system CPU, memory, uptime, and agent process stats.
 */
class ResourceService {
  /**
   * Get system resource stats
   * @returns {Promise<object>}
   */
  static async getStats() {
    const totalMem = os.totalmem();
    const freeMem = os.freemem();
    const usedMem = totalMem - freeMem;
    const uptime = os.uptime();

    // Sample CPU twice with 500ms gap for current usage
    const cpuUsage = await ResourceService._sampleCpuUsage(500);
    const cpus = os.cpus();

    return {
      cpu: {
        usage: Math.round(cpuUsage * 100) / 100,
        cores: cpus.length,
        model: cpus[0] ? cpus[0].model : 'Unknown'
      },
      memory: {
        total: totalMem,
        used: usedMem,
        free: freeMem,
        usagePercent: Math.round((usedMem / totalMem) * 10000) / 100
      },
      uptime: Math.floor(uptime),
      platform: os.platform(),
      hostname: os.hostname()
    };
  }

  /**
   * Sample CPU usage by comparing two snapshots
   * @param {number} delayMs - Delay between samples
   * @returns {Promise<number>} CPU usage percentage
   */
  static _sampleCpuUsage(delayMs = 500) {
    return new Promise((resolve) => {
      const snapshot1 = os.cpus();
      setTimeout(() => {
        const snapshot2 = os.cpus();
        let totalIdle = 0, totalTick = 0;
        for (let i = 0; i < snapshot1.length; i++) {
          const c1 = snapshot1[i].times;
          const c2 = snapshot2[i].times;
          const idle = c2.idle - c1.idle;
          const tick = (c2.user - c1.user) + (c2.nice - c1.nice) + (c2.sys - c1.sys) + (c2.irq - c1.irq) + idle;
          totalIdle += idle;
          totalTick += tick;
        }
        resolve(totalTick > 0 ? ((totalTick - totalIdle) / totalTick * 100) : 0);
      }, delayMs);
    });
  }

  /**
   * Get agent (Claude CLI) process stats
   * @returns {Promise<Array>}
   */
  static async getAgentProcesses() {
    const claudeService = global.__claudeService;
    if (!claudeService || !claudeService.activeProcesses) {
      return [];
    }

    const processes = [];
    for (const [taskId, procInfo] of claudeService.activeProcesses.entries()) {
      const proc = procInfo.process;
      if (!proc || !proc.pid) continue;

      processes.push({
        taskId,
        pid: proc.pid,
        startedAt: procInfo.startedAt,
        status: proc.exitCode !== null ? 'exited' : 'running'
      });
    }

    return processes;
  }

  /**
   * Get all processes (for future use)
   * On Windows, uses tasklist; on Linux, uses ps
   * @returns {Promise<Array>}
   */
  static async getAllProcesses() {
    return new Promise((resolve) => {
      if (process.platform === 'win32') {
        execFile('tasklist', ['/FO', 'CSV', '/NH'], {
          windowsHide: true,
          creationFlags: 0x08000000,
          timeout: 5000
        }, (error, stdout) => {
          if (error) {
            resolve([]);
            return;
          }
          const procs = stdout.split('\n')
            .filter(Boolean)
            .map(line => {
              const parts = line.split(',').map(p => p.replace(/"/g, '').trim());
              return {
                name: parts[0] || '',
                pid: parseInt(parts[1], 10) || 0,
                memory: parts[4] || '0'
              };
            })
            .filter(p => p.pid > 0);
          resolve(procs);
        });
      } else {
        execFile('ps', ['aux'], {
          windowsHide: true,
          timeout: 5000
        }, (error, stdout) => {
          if (error) {
            resolve([]);
            return;
          }
          const procs = stdout.split('\n')
            .slice(1)
            .filter(Boolean)
            .map(line => {
              const parts = line.split(/\s+/);
              return {
                user: parts[0],
                pid: parseInt(parts[1], 10) || 0,
                cpu: parts[2],
                memory: parts[3],
                name: parts[10] || ''
              };
            })
            .filter(p => p.pid > 0);
          resolve(procs);
        });
      }
    });
  }
}

module.exports = ResourceService;
