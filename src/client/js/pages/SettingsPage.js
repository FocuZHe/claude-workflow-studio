"use strict";
// ═══════════════════════════════════════════════
// Settings Page — Global Settings + Audit Logs
// ═══════════════════════════════════════════════
window.SettingsPage = (() => {
    let currentTab = 'settings';
    let settings = {};
    let auditLogs = [];
    let auditPage = 1;
    let auditTotal = 0;
    const AUDIT_PAGE_SIZE = 20;
    async function render() {
        const el = document.getElementById('content');
        if (!el)
            return;
        el.innerHTML = `
      <div class="page-enter">
        <div class="page-header">
          <h1 class="page-title"><span class="page-icon">${Icon.svg('settings', 20)}</span> 设置</h1>
        </div>
        <div class="tabs">
          <div class="tab ${currentTab === 'settings' ? 'active' : ''} settings-tab-btn" data-tab="settings">全局设置</div>
          <div class="tab ${currentTab === 'keys' ? 'active' : ''} settings-tab-btn" data-tab="keys">API 密钥</div>
          <div class="tab ${currentTab === 'templates' ? 'active' : ''} settings-tab-btn" data-tab="templates">提示词模板</div>
          <div class="tab ${currentTab === 'audit' ? 'active' : ''} settings-tab-btn" data-tab="audit">操作审计</div>
        </div>
        <div id="settings-content"></div>
      </div>
    `;
        el.querySelectorAll('.settings-tab-btn').forEach((btn) => {
            btn.addEventListener('click', () => {
                currentTab = btn.dataset.tab || 'settings';
                el.querySelectorAll('.settings-tab-btn').forEach((b) => {
                    b.className = 'tab ' + (b.dataset.tab === currentTab ? 'active' : '') + ' settings-tab-btn';
                });
                renderTabContent();
            });
        });
        await renderTabContent();
    }
    async function renderTabContent() {
        const container = document.getElementById('settings-content');
        if (!container)
            return;
        if (currentTab === 'settings') {
            await loadSettings(container);
        }
        else if (currentTab === 'keys') {
            await loadApiKeys(container);
        }
        else if (currentTab === 'templates') {
            await loadPromptTemplates(container);
        }
        else {
            await loadAuditLogs(container);
        }
    }
    async function loadSettings(container) {
        try {
            const res = await API.getAlertConfig();
            settings = res.data || {};
        }
        catch (e) {
            settings = {};
        }
        const longRunningThreshold = settings.longRunningThreshold ?? 300;
        const failureNotify = settings.failureNotify ?? true;
        container.innerHTML = `
      <div class="card" style="padding:24px;max-width:640px;">
        <h3 style="font-size:15px;font-weight:600;margin:0 0 20px;">全局设置</h3>

        <div class="form-group" style="margin-bottom:20px;">
          <div class="form-label">长运行阈值（秒）</div>
          <div style="font-size:11px;color:var(--text-muted);margin-bottom:8px;">Agent 运行超过此时间将触发告警</div>
          <input type="number" id="settings-long-running" class="input" value="${longRunningThreshold}" min="30"
                 style="width:200px;font-family:var(--font-mono);">
        </div>

        <div class="form-group" style="margin-bottom:20px;">
          <div style="display:flex;align-items:center;justify-content:space-between;padding:12px 16px;background:var(--bg-deep);border-radius:var(--border-radius-md);border:1px solid var(--border-subtle);">
            <div>
              <div style="font-size:13px;font-weight:600;">失败通知</div>
              <div style="font-size:11px;color:var(--text-muted);margin-top:4px;">Agent 执行失败时发送通知</div>
            </div>
            <label class="toggle-switch">
              <input type="checkbox" id="settings-failure-notify" ${failureNotify ? 'checked' : ''}>
              <span class="toggle-track">
                <span class="toggle-thumb"></span>
              </span>
            </label>
          </div>
        </div>

        <button class="btn btn-primary" id="settings-save" style="margin-top:8px;">保存设置</button>
      </div>
    `;
        document.getElementById('settings-save')?.addEventListener('click', async () => {
            const btn = document.getElementById('settings-save');
            const longRunningInput = document.getElementById('settings-long-running');
            const failureNotifyInput = document.getElementById('settings-failure-notify');
            const newSettings = {
                longRunningThreshold: parseInt(longRunningInput?.value || '300', 10) || 300,
                failureNotify: failureNotifyInput?.checked ?? true,
            };
            if (btn) {
                btn.disabled = true;
                btn.textContent = '保存中...';
            }
            try {
                await API.updateAlertConfig(newSettings);
                settings = newSettings;
                Toast.success('设置已保存');
            }
            catch (e) {
                Toast.error('保存失败: ' + e.message);
            }
            finally {
                if (btn) {
                    btn.disabled = false;
                    btn.textContent = '保存设置';
                }
            }
        });
    }
    async function loadAuditLogs(container) {
        container.innerHTML = `
      <div class="card" style="padding:16px;">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px;">
          <h3 style="font-size:15px;font-weight:600;margin:0;">操作审计日志</h3>
          <button class="btn btn-sm btn-secondary" id="audit-refresh">刷新</button>
        </div>
        <div id="audit-table-container">
          <div style="text-align:center;padding:40px;color:var(--text-muted);">加载中...</div>
        </div>
        <div id="audit-pagination" class="pagination-info"></div>
      </div>
    `;
        document.getElementById('audit-refresh')?.addEventListener('click', () => {
            auditPage = 1;
            fetchAndRenderAuditLogs();
        });
        await fetchAndRenderAuditLogs();
    }
    async function fetchAndRenderAuditLogs() {
        const tableContainer = document.getElementById('audit-table-container');
        if (!tableContainer)
            return;
        try {
            const res = await API.getAuditLogs({ page: auditPage, limit: AUDIT_PAGE_SIZE });
            const logs = Array.isArray(res.data) ? res.data : (res.data?.items || []);
            auditTotal = res.meta?.total || res.data?.total || 0;
            auditLogs = logs;
            if (auditLogs.length === 0) {
                tableContainer.innerHTML = '<div style="text-align:center;padding:40px;color:var(--text-muted);">暂无审计日志</div>';
                const paginationEl = document.getElementById('audit-pagination');
                if (paginationEl)
                    paginationEl.innerHTML = '';
                return;
            }
            tableContainer.innerHTML = `
        <div style="overflow-x:auto;">
          <table class="audit-table">
            <thead>
              <tr>
                <th style="white-space:nowrap;">时间</th>
                <th>操作</th>
                <th>对象</th>
                <th>详情</th>
                <th style="text-align:center;white-space:nowrap;">敏感标记</th>
              </tr>
            </thead>
            <tbody>
              ${auditLogs.map((log) => `
                <tr>
                  <td style="white-space:nowrap;font-family:var(--font-mono);font-size:11px;">
                    ${new Date(log.timestamp || log.createdAt || '').toLocaleString()}
                  </td>
                  <td>
                    <span class="badge badge-${getActionBadgeClass(log.action)}" style="font-size:10px;">
                      ${escapeHtml(log.action || '-')}
                    </span>
                  </td>
                  <td>
                    ${escapeHtml(log.target || log.object || '-')}
                  </td>
                  <td style="color:var(--text-tertiary);max-width:300px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">
                    ${escapeHtml(log.details || log.description || '-')}
                  </td>
                  <td style="text-align:center;">
                    ${log.sensitive || log.isSensitive ? '<span style="color:var(--accent-red);font-size:14px;" title="敏感操作">⚑</span>' : '<span style="color:var(--text-muted);">-</span>'}
                  </td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>
      `;
            renderAuditPagination();
        }
        catch (e) {
            tableContainer.innerHTML = `<div style="text-align:center;padding:40px;color:var(--accent-red);">加载失败: ${escapeHtml(e.message)}</div>`;
        }
    }
    function renderAuditPagination() {
        const paginationEl = document.getElementById('audit-pagination');
        if (!paginationEl)
            return;
        const totalPages = Math.ceil(auditTotal / AUDIT_PAGE_SIZE);
        if (totalPages <= 1) {
            paginationEl.innerHTML = `<span style="font-size:11px;color:var(--text-muted);">共 ${auditTotal} 条记录</span>`;
            return;
        }
        paginationEl.innerHTML = `
      <button class="btn btn-sm btn-ghost" id="audit-prev" ${auditPage <= 1 ? 'disabled' : ''}>上一页</button>
      <span style="font-size:11px;color:var(--text-muted);">第 ${auditPage} / ${totalPages} 页 (共 ${auditTotal} 条)</span>
      <button class="btn btn-sm btn-ghost" id="audit-next" ${auditPage >= totalPages ? 'disabled' : ''}>下一页</button>
    `;
        document.getElementById('audit-prev')?.addEventListener('click', () => {
            if (auditPage > 1) {
                auditPage--;
                fetchAndRenderAuditLogs();
            }
        });
        document.getElementById('audit-next')?.addEventListener('click', () => {
            if (auditPage < totalPages) {
                auditPage++;
                fetchAndRenderAuditLogs();
            }
        });
    }
    function getActionBadgeClass(action) {
        if (!action)
            return 'idle';
        const a = action.toLowerCase();
        if (a.includes('delete') || a.includes('remove'))
            return 'failed';
        if (a.includes('create') || a.includes('add'))
            return 'completed';
        if (a.includes('update') || a.includes('edit'))
            return 'running';
        if (a.includes('execute') || a.includes('run'))
            return 'running';
        return 'idle';
    }
    // ── Prompt Templates ──
    async function loadApiKeys(container) {
        // Delete old state vars and use new ones
        let configs = [];
        try {
            const res = await API.getApiConfigs();
            configs = Array.isArray(res.data) ? res.data : [];
        }
        catch (_) {
            configs = [];
        }
        const esc = (s) => { const d = document.createElement('div'); d.textContent = s || ''; return d.innerHTML; };
        let cardsHtml = configs.length === 0
            ? `<div style="text-align:center;padding:40px;color:var(--text-muted);">暂无 API 配置，点击下方按钮添加</div>`
            : configs.map((c) => `
        <div style="margin-bottom:12px;padding:16px;background:var(--bg-deep);border-radius:8px;border:1px solid ${c.isDefault ? 'var(--accent-cyan)' : 'var(--border-subtle)'};">
          <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px;">
            <div style="display:flex;align-items:center;gap:8px;">
              <strong style="font-size:14px;">${esc(c.name)}</strong>
              ${c.isDefault ? '<span class="badge badge-cyan" style="font-size:10px;">使用中</span>' : ''}
              ${c.hasKey ? '<span class="badge badge-green" style="font-size:10px;">已配置</span>' : '<span class="badge" style="font-size:10px;">未配置</span>'}
            </div>
            <div style="display:flex;gap:4px;">
              ${!c.isDefault ? `<button class="btn btn-xs btn-primary use-config-btn" data-id="${c.id}">启用</button>` : ''}
              <button class="btn btn-xs btn-ghost edit-config-btn" data-id="${c.id}">编辑</button>
              <button class="btn btn-xs btn-danger del-config-btn" data-id="${c.id}">删除</button>
            </div>
          </div>
          <div style="font-size:11px;color:var(--text-muted);display:flex;gap:16px;">
            ${c.baseUrl ? `<span>URL: ${esc(c.baseUrl)}</span>` : ''}
            <span>Key: ${c.hasKey ? '••••' + esc(c.keySuffix || '') : '未设置'}</span>
          </div>
          <div style="font-size:11px;color:var(--text-muted);margin-top:6px;display:flex;gap:12px;">
            <span style="color:var(--accent-green);">Haiku: ${esc(c.modelMappings?.haiku || '未配置')}</span>
            <span style="color:var(--accent-cyan);">Sonnet: ${esc(c.modelMappings?.sonnet || '未配置')}</span>
            <span style="color:var(--accent-purple);">Opus: ${esc(c.modelMappings?.opus || '未配置')}</span>
          </div>
        </div>
      `).join('');
        container.innerHTML = `
      <div class="card" style="padding:24px;max-width:760px;">
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:16px;">
          <div>
            <h3 style="font-size:15px;font-weight:600;margin:0;">API 配置</h3>
            <p style="font-size:11px;color:var(--text-muted);margin:4px 0 0;">此 API 仅用于 SDK 主代理调用，子代理和其余功能使用 Claude Code CLI 的配置。</p>
          </div>
          <button class="btn btn-primary add-config-btn" style="flex-shrink:0;">+ 添加配置</button>
        </div>
        ${cardsHtml}
      </div>
    `;
        // Add button
        container.querySelector('.add-config-btn')?.addEventListener('click', () => showConfigModal(null));
        // Edit / Delete / Use buttons
        container.querySelectorAll('.edit-config-btn').forEach((btn) => {
            btn.addEventListener('click', () => {
                const cfg = configs.find((c) => c.id === btn.dataset.id);
                if (cfg)
                    showConfigModal(cfg);
            });
        });
        container.querySelectorAll('.del-config-btn').forEach((btn) => {
            btn.addEventListener('click', async () => {
                if (!confirm('确认删除此配置？'))
                    return;
                try {
                    await API.deleteApiConfig(btn.dataset.id);
                    Toast.success('已删除');
                    await loadApiKeys(container);
                }
                catch (e) {
                    Toast.error(e.message);
                }
            });
        });
        container.querySelectorAll('.use-config-btn').forEach((btn) => {
            btn.addEventListener('click', async () => {
                try {
                    await API.setDefaultApiConfig(btn.dataset.id);
                    Toast.success('已切换');
                    await loadApiKeys(container);
                }
                catch (e) {
                    Toast.error(e.message);
                }
            });
        });
    }
    async function showConfigModal(existing) {
        const isEdit = !!existing;
        // 安全策略：编辑时不再从服务器拉取解密后的明文密钥
        // 留空表示沿用原密钥（updateConfig 已支持空值跳过更新）
        Modal.open({
            title: isEdit ? '编辑 API 配置' : '添加 API 配置',
            body: `
        <div class="form-group">
          <label class="form-label">名称 *</label>
          <input type="text" class="input" id="cfg-name" value="${escapeHtml(existing?.name || '')}" placeholder="如: 我的 Claude" style="width:100%;">
        </div>
        <div class="form-group">
          <label class="form-label">API Key ${isEdit ? '（留空不修改）' : '*'}</label>
          <div style="position:relative;">
            <input type="password" class="input" id="cfg-apikey" value="" placeholder="${isEdit ? '••••••••（留空不修改）' : 'sk-ant-...'}" style="width:100%;padding-right:36px;">
            <button id="cfg-eye-btn" title="显示" style="position:absolute;right:4px;top:50%;transform:translateY(-50%);background:none;border:none;cursor:pointer;color:var(--text-muted);">${Icon.svg('eye-off', 14)}</button>
          </div>
        </div>
        <div class="form-group">
          <label class="form-label">Base URL（可选）</label>
          <input type="text" class="input" id="cfg-url" value="${escapeHtml(existing?.baseUrl || '')}" placeholder="留空使用 Anthropic 官方" style="width:100%;">
        </div>
        <div style="border-top:1px solid var(--border-subtle);margin:16px 0;padding-top:16px;">
          <label class="form-label" style="font-weight:600;margin-bottom:12px;display:block;">模型映射 * <span style="font-weight:normal;color:var(--text-muted);font-size:11px;">（为三种模型级别分别指定实际使用的模型）</span></label>
          <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:12px;">
            <div>
              <label class="form-label" style="font-size:12px;color:var(--accent-green);">Haiku（快速）</label>
              <input type="text" class="input" id="cfg-map-haiku" value="${escapeHtml(existing?.modelMappings?.haiku || '')}" placeholder="如: mimo-v2.5-pro" style="width:100%;font-size:12px;">
            </div>
            <div>
              <label class="form-label" style="font-size:12px;color:var(--accent-cyan);">Sonnet（均衡）</label>
              <input type="text" class="input" id="cfg-map-sonnet" value="${escapeHtml(existing?.modelMappings?.sonnet || '')}" placeholder="如: mimo-v2.5-pro" style="width:100%;font-size:12px;">
            </div>
            <div>
              <label class="form-label" style="font-size:12px;color:var(--accent-purple);">Opus（强大）</label>
              <input type="text" class="input" id="cfg-map-opus" value="${escapeHtml(existing?.modelMappings?.opus || '')}" placeholder="如: mimo-v2.5-pro" style="width:100%;font-size:12px;">
            </div>
          </div>
        </div>
        ${isEdit ? `<div style="display:flex;gap:8px;margin-top:8px;">
          <button class="btn btn-sm btn-ghost" id="cfg-test-btn">测试连接</button>
          <span id="cfg-test-result" style="font-size:11px;align-self:center;"></span>
        </div>` : ''}
      `,
            footer: `
        <button class="btn btn-secondary" onclick="Modal.close()">取消</button>
        <button class="btn btn-primary" id="cfg-save-btn">${isEdit ? '保存' : '添加'}</button>
      `,
        });
        // Eye toggle
        setTimeout(() => {
            document.getElementById('cfg-eye-btn')?.addEventListener('click', () => {
                const inp = document.getElementById('cfg-apikey');
                const btn = document.getElementById('cfg-eye-btn');
                if (inp.type === 'password') {
                    inp.type = 'text';
                    btn.innerHTML = Icon.svg('eye', 14);
                }
                else {
                    inp.type = 'password';
                    btn.innerHTML = Icon.svg('eye-off', 14);
                }
            });
        }, 100);
        // Save
        document.getElementById('cfg-save-btn')?.addEventListener('click', async () => {
            const nameInput = document.getElementById('cfg-name');
            const apiKeyInput = document.getElementById('cfg-apikey');
            const baseUrlInput = document.getElementById('cfg-url');
            const mapHaikuInput = document.getElementById('cfg-map-haiku');
            const mapSonnetInput = document.getElementById('cfg-map-sonnet');
            const mapOpusInput = document.getElementById('cfg-map-opus');
            const name = nameInput?.value.trim() || '';
            const apiKey = apiKeyInput?.value.trim() || '';
            const baseUrl = baseUrlInput?.value.trim() || '';
            const mapHaiku = mapHaikuInput?.value.trim() || '';
            const mapSonnet = mapSonnetInput?.value.trim() || '';
            const mapOpus = mapOpusInput?.value.trim() || '';
            if (!name) {
                Toast.warning('名称必填');
                return;
            }
            if (!isEdit && !apiKey) {
                Toast.warning('API Key 必填');
                return;
            }
            if (!mapHaiku) {
                Toast.warning('请配置 Haiku 模型映射');
                return;
            }
            if (!mapSonnet) {
                Toast.warning('请配置 Sonnet 模型映射');
                return;
            }
            if (!mapOpus) {
                Toast.warning('请配置 Opus 模型映射');
                return;
            }
            const modelMappings = { haiku: mapHaiku, sonnet: mapSonnet, opus: mapOpus };
            try {
                if (isEdit) {
                    const updateData = { name, modelMappings };
                    if (apiKey)
                        updateData.apiKey = apiKey;
                    updateData.baseUrl = baseUrl;
                    await API.updateApiConfig(existing.id, updateData);
                }
                else {
                    await API.createApiConfig({ name, apiKey, baseUrl, modelMappings });
                }
                Toast.success(isEdit ? '已更新' : '已添加');
                Modal.close();
                const container = document.getElementById('settings-content');
                if (container)
                    await loadApiKeys(container);
            }
            catch (e) {
                Toast.error(e.message);
            }
        });
        // Test button (edit mode only)
        if (isEdit) {
            document.getElementById('cfg-test-btn')?.addEventListener('click', async () => {
                const btn = document.getElementById('cfg-test-btn');
                const resultEl = document.getElementById('cfg-test-result');
                btn.disabled = true;
                btn.textContent = '测试中...';
                try {
                    const res = await API.testApiConfig(existing.id);
                    if (res.data?.valid) {
                        resultEl.innerHTML = `<span style="color:var(--accent-green);">✓ 连接成功 (${escapeHtml(String(res.data.latencyMs))}ms, ${escapeHtml(res.data.modelUsed)})</span>`;
                    }
                    else {
                        resultEl.innerHTML = `<span style="color:var(--accent-red);">✗ ${escapeHtml(res.data?.error || '失败')}</span>`;
                    }
                }
                catch (e) {
                    resultEl.innerHTML = `<span style="color:var(--accent-red);">✗ ${escapeHtml(e.message)}</span>`;
                }
                btn.disabled = false;
                btn.textContent = '测试连接';
            });
        }
    }
    function escapeHtml(str) {
        const d = document.createElement('div');
        d.textContent = str || '';
        return d.innerHTML;
    }
    function renderTemplateCard(t, isPreset) {
        const borderColor = isPreset ? 'var(--accent-cyan)' : 'var(--border-subtle)';
        const badgeColor = isPreset ? 'var(--accent-cyan)' : 'var(--text-tertiary)';
        const badgeBg = isPreset ? 'rgba(0,200,255,0.1)' : 'var(--bg-deep)';
        const badgeText = isPreset ? '预设' : (t.category || '自定义');
        return `
      <div class="template-card" style="${isPreset ? 'border-color:var(--accent-cyan);background:linear-gradient(135deg,var(--bg-card) 0%,rgba(0,200,255,0.03) 100%);' : ''}">
        <div style="display:flex;justify-content:space-between;align-items:flex-start;">
          <div style="flex:1;min-width:0;">
            <div style="display:flex;align-items:center;gap:6px;">
              <span style="font-size:14px;">${isPreset ? Icon.svg('shield', 14) : Icon.svg('edit', 14)}</span>
              <span style="font-size:14px;font-weight:600;color:var(--text-primary);">${escapeHtml(t.name)}</span>
            </div>
            ${t.description ? `<div style="font-size:12px;color:var(--text-muted);margin-top:4px;">${escapeHtml(t.description)}</div>` : ''}
            <span style="display:inline-block;font-size:10px;padding:2px 8px;background:${badgeBg};border-radius:10px;color:${badgeColor};margin-top:6px;">${escapeHtml(badgeText)}</span>
          </div>
          <div style="display:flex;gap:4px;flex-shrink:0;">
            <button class="btn btn-sm btn-ghost template-view-btn" data-id="${t.id}" title="查看内容">${Icon.svg('eye', 14)}</button>
            <button class="btn btn-sm btn-ghost template-copy-btn" data-id="${t.id}" title="复制内容">${Icon.svg('copy', 14)}</button>
            ${!isPreset ? `
              <button class="btn btn-sm btn-ghost template-edit-btn" data-id="${t.id}" title="编辑">${Icon.svg('edit', 14)}</button>
              <button class="btn btn-sm btn-ghost template-delete-btn" data-id="${t.id}" title="删除">${Icon.svg('delete', 14)}</button>
            ` : ''}
          </div>
        </div>
        <div style="margin-top:8px;font-family:var(--font-mono);font-size:12px;color:var(--text-secondary);background:var(--bg-deep);padding:8px;border-radius:var(--border-radius);max-height:60px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">
          ${escapeHtml((t.content || '').substring(0, 100))}${(t.content || '').length > 100 ? '...' : ''}
        </div>
        <div style="font-size:10px;color:var(--text-tertiary);margin-top:6px;">
          ${isPreset ? '系统内置' : `使用次数: ${t.usageCount || 0}`} · 创建于 ${t.createdAt ? new Date(t.createdAt).toLocaleDateString() : '--'}
        </div>
      </div>
    `;
    }
    function showTemplateDetail(tpl) {
        Modal.open({
            title: tpl.name,
            body: `
        <div style="margin-bottom:8px;display:flex;gap:8px;align-items:center;">
          <span style="font-size:11px;padding:2px 8px;border-radius:10px;background:var(--bg-deep);color:var(--text-muted);">${escapeHtml(tpl.category || '自定义')}</span>
          ${tpl.preset ? '<span style="font-size:11px;color:var(--accent-cyan);">预设模板</span>' : ''}
        </div>
        ${tpl.description ? `<div style="font-size:12px;color:var(--text-muted);margin-bottom:12px;">${escapeHtml(tpl.description)}</div>` : ''}
        <div style="background:var(--bg-deep);padding:12px;border-radius:8px;font-family:var(--font-mono);font-size:12px;white-space:pre-wrap;max-height:400px;overflow-y:auto;color:var(--text-primary);">${escapeHtml(tpl.content || '')}</div>
      `,
            footer: `<button class="btn btn-secondary" onclick="Modal.close()">关闭</button>
        <button class="btn btn-primary" id="modal-copy-btn">复制内容</button>`,
        });
        setTimeout(() => {
            document.getElementById('modal-copy-btn')?.addEventListener('click', async () => {
                try {
                    await navigator.clipboard.writeText(tpl.content || '');
                    Toast.success('已复制');
                }
                catch (_) {
                    Toast.error('复制失败');
                }
            });
        }, 100);
    }
    function openTemplateForm(tpl) {
        const isEdit = !!tpl;
        Modal.open({
            title: isEdit ? '编辑模板' : '新建提示词模板',
            body: `
        <div style="display:flex;flex-direction:column;gap:14px;">
          <div>
            <label style="font-size:12px;font-weight:600;display:block;margin-bottom:4px;">名称 *</label>
            <input class="input" id="tpl-name" value="${escapeHtml(tpl?.name || '')}" placeholder="如: 代码审查">
          </div>
          <div>
            <label style="font-size:12px;font-weight:600;display:block;margin-bottom:4px;">描述</label>
            <input class="input" id="tpl-desc" value="${escapeHtml(tpl?.description || '')}" placeholder="简要说明用途">
          </div>
          <div>
            <label style="font-size:12px;font-weight:600;display:block;margin-bottom:4px;">分类</label>
            <input class="input" id="tpl-category" value="${escapeHtml(tpl?.category || '')}" placeholder="如: 开发、测试、文档">
          </div>
          <div>
            <label style="font-size:12px;font-weight:600;display:block;margin-bottom:4px;">模板内容 *</label>
            <textarea class="input" id="tpl-content" rows="8" placeholder="输入提示词模板内容...&#10;可用 {{变量名}} 定义变量">${escapeHtml(tpl?.content || '')}</textarea>
          </div>
        </div>
      `,
            footer: `
        <button class="btn btn-secondary" onclick="Modal.close()">取消</button>
        <button class="btn btn-primary" id="tpl-save-btn">${isEdit ? '保存' : '创建'}</button>
      `,
        });
        document.getElementById('tpl-save-btn')?.addEventListener('click', async () => {
            const nameInput = document.getElementById('tpl-name');
            const contentInput = document.getElementById('tpl-content');
            const descInput = document.getElementById('tpl-desc');
            const categoryInput = document.getElementById('tpl-category');
            const name = nameInput?.value?.trim() || '';
            const content = contentInput?.value?.trim() || '';
            if (!name || !content) {
                Toast.warning('名称和内容不能为空');
                return;
            }
            const data = {
                name,
                content,
                description: descInput?.value?.trim() || '',
                category: categoryInput?.value?.trim() || '',
            };
            try {
                if (isEdit) {
                    await API.updatePromptTemplate(tpl.id, data);
                    Toast.success('模板已更新');
                }
                else {
                    await API.createPromptTemplate(data);
                    Toast.success('模板已创建');
                }
                Modal.close();
                await renderTabContent();
            }
            catch (e) {
                Toast.error(e.message || '保存失败');
            }
        });
    }
    async function loadPromptTemplates(container) {
        let templates = [];
        try {
            const res = await API.getPromptTemplates();
            templates = res.data?.items || res.data || [];
        }
        catch (e) {
            console.warn('加载模板失败:', e.message);
        }
        const presetTemplates = templates.filter((t) => t.preset === true);
        const customTemplates = templates.filter((t) => t.preset !== true);
        container.innerHTML = `
      <!-- Preset Templates Section -->
      <div style="margin-bottom:24px;">
        <div style="display:flex;align-items:center;gap:8px;margin-bottom:12px;">
          <span style="font-size:16px;">${Icon.svg('shield', 16)}</span>
          <h3 style="font-size:15px;font-weight:600;margin:0;">预设模板</h3>
          <span style="font-size:11px;color:var(--text-muted);background:var(--bg-deep);padding:2px 8px;border-radius:10px;">系统内置，不可编辑</span>
        </div>
        <div id="preset-template-list" style="display:grid;grid-template-columns:repeat(auto-fill,minmax(320px,1fr));gap:12px;">
          ${presetTemplates.length === 0
            ? '<div style="text-align:center;padding:40px;color:var(--text-muted);grid-column:1/-1;">暂无预设模板</div>'
            : presetTemplates.map((t) => renderTemplateCard(t, true)).join('')}
        </div>
      </div>

      <!-- Custom Templates Section -->
      <div>
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;">
          <div style="display:flex;align-items:center;gap:8px;">
            <span style="font-size:16px;">${Icon.svg('edit', 16)}</span>
            <h3 style="font-size:15px;font-weight:600;margin:0;">自定义模板</h3>
            <span style="font-size:11px;color:var(--text-muted);background:var(--bg-deep);padding:2px 8px;border-radius:10px;">共 ${customTemplates.length} 个</span>
          </div>
          <button class="btn btn-primary" id="add-template-btn">+ 添加模板</button>
        </div>
        <div id="custom-template-list" style="display:grid;grid-template-columns:repeat(auto-fill,minmax(320px,1fr));gap:12px;">
          ${customTemplates.length === 0
            ? '<div style="text-align:center;padding:40px;color:var(--text-muted);grid-column:1/-1;">暂无自定义模板，点击上方按钮添加</div>'
            : customTemplates.map((t) => renderTemplateCard(t, false)).join('')}
        </div>
      </div>
    `;
        document.getElementById('add-template-btn')?.addEventListener('click', () => openTemplateForm());
        container.querySelectorAll('.template-edit-btn').forEach((btn) => {
            btn.addEventListener('click', () => {
                const tpl = templates.find((t) => t.id === btn.dataset.id);
                if (tpl)
                    openTemplateForm(tpl);
            });
        });
        container.querySelectorAll('.template-delete-btn').forEach((btn) => {
            btn.addEventListener('click', async () => {
                if (!await Modal.confirm('删除模板', '确定删除此自定义模板？'))
                    return;
                try {
                    await API.deletePromptTemplate(btn.dataset.id);
                    Toast.success('模板已删除');
                    await loadPromptTemplates(container);
                }
                catch (e) {
                    Toast.error(e.message || '删除失败');
                }
            });
        });
        container.querySelectorAll('.template-view-btn').forEach((btn) => {
            btn.addEventListener('click', () => {
                const tpl = templates.find((t) => t.id === btn.dataset.id);
                if (tpl)
                    showTemplateDetail(tpl);
            });
        });
        container.querySelectorAll('.template-copy-btn').forEach((btn) => {
            btn.addEventListener('click', async () => {
                const tpl = templates.find((t) => t.id === btn.dataset.id);
                if (tpl) {
                    try {
                        await navigator.clipboard.writeText(tpl.content || '');
                        Toast.success('模板内容已复制到剪贴板');
                    }
                    catch (e) {
                        Toast.error('复制失败');
                    }
                }
            });
        });
    }
    return { render };
})();
