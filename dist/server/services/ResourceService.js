"use strict";
/**
 * ResourceService - 资源管理服务
 * 管理工作区资源
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.ResourceService = void 0;
class ResourceService {
    static resources = new Map();
    /**
     * 添加资源
     */
    static addResource(name, type, path, size) {
        const resource = {
            id: Math.random().toString(36).substring(7),
            name,
            type,
            path,
            size,
            createdAt: new Date(),
            updatedAt: new Date()
        };
        this.resources.set(resource.id, resource);
        return resource;
    }
    /**
     * 获取资源
     */
    static getResource(resourceId) {
        return this.resources.get(resourceId);
    }
    /**
     * 获取所有资源
     */
    static getAllResources() {
        return Array.from(this.resources.values());
    }
    /**
     * 删除资源
     */
    static deleteResource(resourceId) {
        return this.resources.delete(resourceId);
    }
    /**
     * 获取系统资源统计
     */
    // 上一次CPU采样数据
    static _lastCpuSample = null;
    static async getStats() {
        const os = require('os');
        // 计算CPU使用率（基于两次采样的差值，获取实时使用率）
        const cpus = os.cpus();
        let totalIdle = 0;
        let totalTick = 0;
        for (const cpu of cpus) {
            for (const type in cpu.times) {
                totalTick += cpu.times[type];
            }
            totalIdle += cpu.times.idle;
        }
        let cpuUsage = 0;
        if (this._lastCpuSample) {
            const idleDiff = totalIdle - this._lastCpuSample.idle;
            const totalDiff = totalTick - this._lastCpuSample.total;
            cpuUsage = totalDiff > 0 ? Math.round((1 - idleDiff / totalDiff) * 100) : 0;
        }
        // 保存本次采样
        this._lastCpuSample = { idle: totalIdle, total: totalTick };
        return {
            cpu: {
                cores: cpus.length,
                model: cpus[0]?.model || 'unknown',
                usage: cpuUsage
            },
            memory: {
                total: os.totalmem(),
                free: os.freemem(),
                used: os.totalmem() - os.freemem(),
                usagePercent: Math.round(((os.totalmem() - os.freemem()) / os.totalmem()) * 100)
            },
            disk: { available: true },
            uptime: os.uptime(),
            processUptime: process.uptime(),
            platform: os.platform(),
            hostname: os.hostname(),
            arch: os.arch(),
            nodeVersion: process.version,
            resourceCount: this.resources.size
        };
    }
    /**
     * 获取Agent进程信息
     */
    static async getAgentProcesses() {
        return [];
    }
}
exports.ResourceService = ResourceService;
module.exports = ResourceService;
//# sourceMappingURL=ResourceService.js.map