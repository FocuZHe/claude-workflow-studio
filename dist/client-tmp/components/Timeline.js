"use strict";
window.Timeline = (() => {
    const statusColors = {
        running: 'var(--accent-cyan)',
        completed: 'var(--accent-green)',
        failed: 'var(--accent-red)',
        waiting: 'var(--text-muted)',
        pending: 'var(--text-muted)',
        skipped: 'var(--text-muted)',
    };
    const statusBgs = {
        running: 'rgba(0,210,255,0.2)',
        completed: 'rgba(0,255,136,0.2)',
        failed: 'rgba(255,68,68,0.2)',
        waiting: 'rgba(128,128,128,0.15)',
        pending: 'rgba(128,128,128,0.15)',
        skipped: 'rgba(128,128,128,0.1)',
    };
    const statusLabels = {
        running: '运行中',
        completed: '已完成',
        failed: '失败',
        waiting: '等待中',
        pending: '等待中',
        skipped: '已跳过',
    };
    function formatTime(dateStr) {
        if (!dateStr)
            return '--';
        const d = new Date(dateStr);
        return d.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    }
    function calcDuration(start, end) {
        if (!start)
            return '--';
        const s = new Date(start);
        const e = end ? new Date(end) : new Date();
        const diff = Math.floor((e.getTime() - s.getTime()) / 1000);
        if (diff < 60)
            return diff + '秒';
        if (diff < 3600)
            return Math.floor(diff / 60) + '分' + (diff % 60) + '秒';
        return Math.floor(diff / 3600) + '时' + Math.floor((diff % 3600) / 60) + '分';
    }
    function render(executionData) {
        if (!executionData || !executionData.nodes || executionData.nodes.length === 0) {
            return '<div style="text-align:center;padding:24px;color:var(--text-muted);font-size:13px;">暂无执行数据</div>';
        }
        const nodes = executionData.nodes;
        const overallStart = executionData.startedAt ? new Date(executionData.startedAt).getTime() : Date.now();
        const overallEnd = executionData.endedAt ? new Date(executionData.endedAt).getTime() : Date.now();
        const totalDuration = Math.max(overallEnd - overallStart, 1);
        const rows = nodes.map((node, index) => {
            const nodeStart = node.startedAt ? new Date(node.startedAt).getTime() : overallStart;
            const nodeEnd = node.endedAt ? new Date(node.endedAt).getTime() : (node.status === 'running' ? Date.now() : nodeStart);
            const left = Math.max(0, ((nodeStart - overallStart) / totalDuration) * 100);
            const width = Math.max(2, ((nodeEnd - nodeStart) / totalDuration) * 100);
            const status = node.status || 'waiting';
            const color = statusColors[status] || statusColors.waiting;
            const bg = statusBgs[status] || statusBgs.waiting;
            return `
        <div class="timeline-row" style="display:flex;align-items:center;padding:8px 0;border-bottom:1px solid var(--border-subtle);">
          <div style="width:24px;text-align:center;color:var(--text-muted);font-size:11px;font-family:var(--font-mono);">${index + 1}</div>
          <div style="width:140px;font-size:13px;color:var(--text-primary);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;" title="${node.name || '节点 ' + (index + 1)}">
            ${node.name || '节点 ' + (index + 1)}
          </div>
          <div style="width:70px;font-size:11px;">
            <span style="color:${color};background:${bg};padding:2px 8px;border-radius:10px;">${statusLabels[status] || status}</span>
          </div>
          <div style="flex:1;position:relative;height:22px;margin:0 12px;background:var(--bg-secondary);border-radius:4px;overflow:hidden;">
            <div style="position:absolute;left:${left}%;width:${width}%;height:100%;background:${color};border-radius:4px;min-width:4px;opacity:0.8;transition:width 0.3s ease;">
              ${status === 'running' ? '<div style="position:absolute;top:0;left:0;right:0;bottom:0;background:linear-gradient(90deg,transparent,rgba(255,255,255,0.15),transparent);animation:timeline-shimmer 1.5s infinite;"></div>' : ''}
            </div>
          </div>
          <div style="width:70px;text-align:right;font-size:11px;color:var(--text-muted);font-family:var(--font-mono);">${formatTime(node.startedAt)}</div>
          <div style="width:70px;text-align:right;font-size:11px;color:var(--text-muted);font-family:var(--font-mono);">${formatTime(node.endedAt)}</div>
          <div style="width:60px;text-align:right;font-size:11px;color:var(--text-secondary);font-family:var(--font-mono);">${calcDuration(node.startedAt, node.endedAt)}</div>
        </div>
      `;
        }).join('');
        if (!document.getElementById('timeline-styles')) {
            const style = document.createElement('style');
            style.id = 'timeline-styles';
            style.textContent = `
        @keyframes timeline-shimmer {
          0% { transform: translateX(-100%); }
          100% { transform: translateX(100%); }
        }
      `;
            document.head.appendChild(style);
        }
        return `
      <div class="timeline-container" style="font-family:var(--font-sans);">
        <div style="display:flex;align-items:center;padding:8px 0;border-bottom:2px solid var(--border-subtle);font-size:11px;color:var(--text-muted);font-weight:600;">
          <div style="width:24px;text-align:center;">#</div>
          <div style="width:140px;">节点名称</div>
          <div style="width:70px;">状态</div>
          <div style="flex:1;text-align:center;">时间分布</div>
          <div style="width:70px;text-align:right;">开始时间</div>
          <div style="width:70px;text-align:right;">结束时间</div>
          <div style="width:60px;text-align:right;">耗时</div>
        </div>
        ${rows}
        <div style="display:flex;justify-content:space-between;padding:8px 0;font-size:11px;color:var(--text-muted);font-family:var(--font-mono);">
          <span>总耗时: ${calcDuration(executionData.startedAt, executionData.endedAt)}</span>
          <span>共 ${nodes.length} 个节点</span>
        </div>
      </div>
    `;
    }
    return { render };
})();
