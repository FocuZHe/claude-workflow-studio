"use strict";
// ═══════════════════════════════════════════════
// Notification Manager — Browser + In-page Toast
// ═══════════════════════════════════════════════
window.NotificationManager = (() => {
    let notifications = [];
    let permissionGranted = false;
    function init() {
        if ('Notification' in window) {
            if (Notification.permission === 'granted') {
                permissionGranted = true;
            }
            else if (Notification.permission !== 'denied') {
                Notification.requestPermission().then((perm) => {
                    permissionGranted = perm === 'granted';
                });
            }
        }
        listen();
    }
    function listen() {
        WS.on('alert.notification', (payload) => {
            addNotification({
                title: payload.title || '系统通知',
                body: payload.body || payload.message || '',
                type: payload.type || 'info',
                time: new Date().toISOString(),
            });
        });
        WS.on('workflow.statusUpdate', (payload) => {
            if (payload.status === 'failed' || payload.status === 'error') {
                addNotification({
                    title: '工作流执行失败',
                    body: `工作流 "${payload.workflowName || payload.workflowId}" 执行失败${payload.error ? ': ' + payload.error : ''}`,
                    type: 'error',
                    time: new Date().toISOString(),
                });
            }
            if (payload.status === 'completed') {
                const summary = payload.summary || '';
                addNotification({
                    title: `工作流完成 — ${payload.workflowName || payload.workflowId}`,
                    body: summary || `工作流 "${payload.workflowName || payload.workflowId}" 已成功完成`,
                    type: 'success',
                    time: new Date().toISOString(),
                });
            }
        });
        // File generation notifications
        WS.on('files.generated', (payload) => {
            const allFiles = [...(payload.newFiles || []), ...(payload.misplacedFiles || [])];
            if (allFiles.length === 0)
                return;
            const fileList = allFiles.map((f) => f.name).join('、');
            addNotification({
                title: '文件已生成',
                body: `生成了 ${allFiles.length} 个文件：${fileList}`,
                type: 'success',
                time: new Date().toISOString(),
            });
        });
        WS.on('files.misplaced', (payload) => {
            if (!payload.misplacedFiles || payload.misplacedFiles.length === 0)
                return;
            const fileList = payload.misplacedFiles.map((f) => f.name).join('、');
            addNotification({
                title: '文件生成位置异常',
                body: `以下文件生成在工作区外：${fileList}`,
                type: 'warning',
                time: new Date().toISOString(),
            });
        });
        // Approval request from workflow
        WS.on('workflow.approvalRequested', (payload) => {
            showApprovalModal(payload);
        });
    }
    function showApprovalModal(payload) {
        const { workflowId, requestId, title, description, context, timeout } = payload;
        const approvalRequestId = requestId; // 兼容两种字段名
        const esc = (s) => { const d = document.createElement('div'); d.textContent = s || ''; return d.innerHTML; };
        Modal.open({
            title: `审核: ${title || '请求'}`,
            body: `
        <div style="font-size:13px;margin-bottom:8px;">${esc(description || '请审核以下内容：')}</div>
        ${context ? `<div style="margin-top:8px;padding:8px;background:var(--bg-deep);border-radius:4px;font-size:11px;font-family:var(--font-mono);max-height:150px;overflow-y:auto;white-space:pre-wrap;">${esc(context)}</div>` : ''}
        <div style="font-size:11px;color:var(--text-muted);margin-top:8px;">超时时间: ${timeout ? Math.round(timeout / 60) + '分钟' : '未知'}</div>
        <div style="margin-top:12px;">
          <label style="font-size:12px;color:var(--text-secondary);display:block;margin-bottom:4px;">审核备注（可选）</label>
          <textarea id="approval-comment" rows="3" placeholder="输入审核意见或备注..." style="width:100%;padding:8px;border:1px solid var(--border-subtle);border-radius:4px;background:var(--bg-deep);color:var(--text-primary);font-size:12px;resize:vertical;"></textarea>
        </div>
      `,
            footer: `<button class="btn btn-danger approval-reject-btn">拒绝</button>
        <button class="btn btn-primary approval-approve-btn">通过</button>`,
        });
        // Modal.open 后 DOM 立即可用，直接绑定事件（无需 setTimeout）
        document.querySelector('.approval-approve-btn')?.addEventListener('click', async () => {
            const comment = document.getElementById('approval-comment')?.value.trim() || '';
            try {
                await API.respondApproval(approvalRequestId, 'approve', comment);
                Toast.success('已通过');
                Modal.close();
            }
            catch (e) {
                Toast.error(e.message);
            }
        });
        document.querySelector('.approval-reject-btn')?.addEventListener('click', async () => {
            const comment = document.getElementById('approval-comment')?.value.trim() || '';
            if (!comment) {
                Toast.warning('请填写拒绝原因');
                return;
            }
            try {
                await API.respondApproval(approvalRequestId, 'reject', comment);
                Toast.info('已拒绝');
                Modal.close();
            }
            catch (e) {
                Toast.error(e.message);
            }
        });
        addNotification({ title: `审核请求: ${title}`, body: description || '', type: 'info', time: new Date().toISOString() });
    }
    function addNotification(notification) {
        notification.id = Date.now() + '-' + Math.random().toString(36).slice(2, 6);
        notification.read = false;
        notifications.unshift(notification);
        // Keep max 50
        if (notifications.length > 50)
            notifications = notifications.slice(0, 50);
        showNotification(notification.title, notification.body, notification.type);
        updateBadge();
    }
    function showNotification(title, body, type) {
        // Browser Notification
        if (permissionGranted && document.hidden) {
            try {
                new Notification(title, { body: body, icon: '/favicon.ico' });
            }
            catch (e) {
                // Ignore notification errors
            }
        }
        // In-page Toast
        const toastType = type === 'error' ? 'error' : type === 'warning' ? 'warning' : 'info';
        Toast.show(`${title}: ${body}`, toastType, 5000);
    }
    function updateBadge() {
        const badge = document.getElementById('notification-badge');
        if (!badge)
            return;
        const unread = notifications.filter((n) => !n.read).length;
        if (unread > 0) {
            badge.textContent = unread > 99 ? '99+' : String(unread);
            badge.style.display = 'flex';
        }
        else {
            badge.style.display = 'none';
        }
    }
    function markAllRead() {
        notifications.forEach((n) => n.read = true);
        updateBadge();
    }
    function deleteNotification(id) {
        notifications = notifications.filter((n) => n.id !== id);
        updateBadge();
        const body = document.getElementById('notification-list-body');
        if (body) {
            body.innerHTML = renderNotificationList();
            bindDeleteButtons();
        }
    }
    function clearAllNotifications() {
        notifications = [];
        updateBadge();
        const body = document.getElementById('notification-list-body');
        if (body) {
            body.innerHTML = renderNotificationList();
        }
    }
    function bindDeleteButtons() {
        document.querySelectorAll('.notification-delete').forEach((btn) => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                deleteNotification(btn.dataset.id);
            });
        });
    }
    function getNotifications() {
        return notifications;
    }
    function renderNotificationList() {
        if (notifications.length === 0) {
            return '<div style="padding:24px;text-align:center;color:var(--text-muted);font-size:13px;">暂无通知</div>';
        }
        return notifications.map((n) => {
            const iconMap = { error: Icon.svg('error', 14), warning: Icon.svg('warning', 14), info: Icon.svg('info', 14), success: Icon.svg('check', 14) };
            const colorMap = { error: 'var(--accent-red)', warning: 'var(--accent-amber)', info: 'var(--accent-cyan)', success: 'var(--accent-green)' };
            const type = n.type || 'info';
            const time = n.time ? new Date(n.time).toLocaleString('zh-CN') : '';
            return `
        <div class="notification-item" style="display:flex;gap:10px;padding:10px 16px;border-bottom:1px solid var(--border-subtle);${n.read ? 'opacity:0.6;' : ''}">
          <span style="color:${colorMap[type]};font-size:14px;flex-shrink:0;">${iconMap[type] || iconMap.info}</span>
          <div style="flex:1;min-width:0;">
            <div style="font-size:13px;font-weight:600;color:var(--text-primary);margin-bottom:2px;">${n.title}</div>
            <div style="font-size:12px;color:var(--text-secondary);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${n.body}</div>
          </div>
          <span style="font-size:11px;color:var(--text-muted);white-space:nowrap;font-family:var(--font-mono);">${time}</span>
          <button class="notification-delete" data-id="${n.id}" style="background:none;border:none;color:var(--text-muted);cursor:pointer;font-size:14px;flex-shrink:0;padding:2px;" title="删除">${Icon.svg('close', 14)}</button>
        </div>
      `;
        }).join('');
    }
    function togglePanel() {
        let panel = document.getElementById('notification-panel');
        if (panel) {
            panel.remove();
            return;
        }
        markAllRead();
        panel = document.createElement('div');
        panel.id = 'notification-panel';
        panel.style.cssText = `
      position:fixed;top:52px;right:16px;width:380px;max-height:480px;background:var(--bg-primary);
      border:1px solid var(--border-subtle);border-radius:var(--border-radius-lg);box-shadow:0 8px 32px rgba(0,0,0,0.4);
      z-index:1000;overflow:hidden;display:flex;flex-direction:column;
    `;
        panel.innerHTML = `
      <div style="display:flex;justify-content:space-between;align-items:center;padding:12px 16px;border-bottom:1px solid var(--border-subtle);">
        <span style="font-size:14px;font-weight:600;color:var(--text-primary);">通知中心</span>
        <div style="display:flex;align-items:center;gap:8px;">
          <button id="notification-clear-all" style="background:none;border:none;color:var(--text-muted);cursor:pointer;font-size:12px;">清空</button>
          <button id="notification-panel-close" style="background:none;border:none;color:var(--text-muted);cursor:pointer;font-size:16px;">${Icon.svg('close', 16)}</button>
        </div>
      </div>
      <div style="overflow-y:auto;flex:1;" id="notification-list-body">
        ${renderNotificationList()}
      </div>
    `;
        document.body.appendChild(panel);
        document.getElementById('notification-panel-close').addEventListener('click', () => panel.remove());
        document.getElementById('notification-clear-all').addEventListener('click', clearAllNotifications);
        bindDeleteButtons();
        document.addEventListener('click', function closePanel(e) {
            if (!panel.contains(e.target) && !e.target.closest('.notification-bell')) {
                panel.remove();
                document.removeEventListener('click', closePanel);
            }
        });
    }
    return { init, listen, showNotification, togglePanel, getNotifications, updateBadge, deleteNotification, clearAllNotifications };
})();
