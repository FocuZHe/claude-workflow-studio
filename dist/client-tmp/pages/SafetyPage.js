"use strict";
// ═══════════════════════════════════════════════
// Safety Page — Security Monitoring Dashboard
// ═══════════════════════════════════════════════
window.SafetyPage = (() => {
    // ── State ──
    let currentTab = 'overview';
    let stats = { safeScore: 0, todayThreats: 0, activeRules: 0, blockedRequests: 0 };
    let threats = [];
    let threatsPage = 1;
    let threatsTotal = 0;
    const THREATS_PAGE_SIZE = 20;
    let threatFilters = { type: '', severity: '' };
    let rules = [];
    // ── Styles ──
    const styles = `
    .safety-card {
      background: var(--bg-secondary);
      border: 1px solid var(--border-subtle);
      border-radius: var(--border-radius-lg);
      padding: 20px;
      position: relative;
      overflow: hidden;
      transition: all 0.2s var(--ease-out);
    }
    .safety-card:hover {
      border-color: var(--border-default);
      box-shadow: var(--shadow-md);
    }
    .safety-card::before {
      content: '';
      position: absolute;
      top: 0;
      left: 0;
      right: 0;
      height: 3px;
    }
    .safety-card.score::before { background: var(--accent-cyan); }
    .safety-card.threats::before { background: var(--accent-red); }
    .safety-card.rules::before { background: var(--accent-green); }
    .safety-card.blocked::before { background: var(--accent-amber); }

    .safety-stat-value {
      font-size: 32px;
      font-weight: 700;
      font-family: var(--font-mono);
      line-height: 1;
      margin-bottom: 4px;
    }
    .safety-stat-label {
      font-size: 12px;
      color: var(--text-muted);
      text-transform: uppercase;
      letter-spacing: 0.5px;
    }

    .score-good { color: var(--accent-green); }
    .score-warning { color: var(--accent-amber); }
    .score-danger { color: var(--accent-red); }

    .severity-badge {
      display: inline-block;
      padding: 2px 8px;
      border-radius: 10px;
      font-size: 11px;
      font-weight: 600;
      text-transform: uppercase;
    }
    .severity-high {
      background: rgba(255, 61, 90, 0.15);
      color: var(--accent-red);
    }
    .severity-medium {
      background: rgba(255, 176, 32, 0.15);
      color: var(--accent-amber);
    }
    .severity-low {
      background: rgba(0, 230, 118, 0.15);
      color: var(--accent-green);
    }

    .status-badge {
      display: inline-block;
      padding: 2px 8px;
      border-radius: 10px;
      font-size: 11px;
      font-weight: 500;
    }
    .status-pending {
      background: rgba(255, 176, 32, 0.15);
      color: var(--accent-amber);
    }
    .status-resolved {
      background: rgba(0, 230, 118, 0.15);
      color: var(--accent-green);
    }
    .status-blocked {
      background: rgba(255, 61, 90, 0.15);
      color: var(--accent-red);
    }

    .rule-type-badge {
      display: inline-block;
      padding: 2px 8px;
      border-radius: 10px;
      font-size: 11px;
      font-weight: 500;
      background: rgba(168, 85, 247, 0.15);
      color: var(--accent-purple);
    }

    .toggle-switch {
      position: relative;
      display: inline-block;
      width: 40px;
      height: 22px;
      flex-shrink: 0;
    }
    .toggle-switch input {
      opacity: 0;
      width: 0;
      height: 0;
    }
    .toggle-slider {
      position: absolute;
      cursor: pointer;
      top: 0;
      left: 0;
      right: 0;
      bottom: 0;
      background-color: var(--bg-tertiary);
      border: 1px solid var(--border-subtle);
      border-radius: 11px;
      transition: 0.3s;
    }
    .toggle-slider::before {
      content: '';
      position: absolute;
      height: 16px;
      width: 16px;
      left: 2px;
      bottom: 2px;
      background-color: var(--text-muted);
      border-radius: 50%;
      transition: 0.3s;
    }
    .toggle-switch input:checked + .toggle-slider {
      background-color: var(--accent-cyan);
      border-color: var(--accent-cyan);
    }
    .toggle-switch input:checked + .toggle-slider::before {
      transform: translateX(18px);
      background-color: white;
    }

    .table-container {
      overflow-x: auto;
    }
    .table-container table {
      width: 100%;
      border-collapse: collapse;
      font-size: 13px;
    }
    .table-container th {
      padding: 10px 12px;
      text-align: left;
      color: var(--text-muted);
      font-weight: 600;
      font-size: 12px;
      border-bottom: 2px solid var(--border-subtle);
      white-space: nowrap;
    }
    .table-container td {
      padding: 10px 12px;
      border-bottom: 1px solid var(--border-subtle);
    }
    .table-container tr:nth-child(even) {
      background: rgba(255, 255, 255, 0.02);
    }
    .table-container tr:hover {
      background: var(--bg-hover);
    }

    .filter-group {
      display: flex;
      gap: 8px;
      flex-wrap: wrap;
      align-items: center;
    }
    .filter-select, .filter-input {
      padding: 6px 12px;
      background: var(--bg-secondary);
      border: 1px solid var(--border-subtle);
      border-radius: var(--border-radius);
      color: var(--text-primary);
      font-size: 13px;
    }
    .filter-select:focus, .filter-input:focus {
      outline: none;
      border-color: var(--accent-cyan);
    }

    .pagination {
      display: flex;
      justify-content: center;
      align-items: center;
      gap: 12px;
      margin-top: 16px;
    }
    .pagination-info {
      font-size: 12px;
      color: var(--text-muted);
    }
    .pagination-btn {
      padding: 6px 12px;
      background: var(--bg-secondary);
      border: 1px solid var(--border-subtle);
      border-radius: var(--border-radius);
      color: var(--text-primary);
      font-size: 12px;
      cursor: pointer;
      transition: all 0.2s;
    }
    .pagination-btn:hover:not(:disabled) {
      background: var(--bg-hover);
      border-color: var(--accent-cyan);
    }
    .pagination-btn:disabled {
      opacity: 0.5;
      cursor: not-allowed;
    }

    .empty-state {
      text-align: center;
      padding: 40px;
      color: var(--text-muted);
      font-size: 13px;
    }
  `;
    // ── Render ──
    function render() {
        // Inject styles
        if (!document.getElementById('safety-page-styles')) {
            const styleEl = document.createElement('style');
            styleEl.id = 'safety-page-styles';
            styleEl.textContent = styles;
            document.head.appendChild(styleEl);
        }
        const el = document.getElementById('content');
        if (!el)
            return;
        el.innerHTML = `
      <div class="page-enter">
        <div class="page-header">
          <h1 class="page-title"><span class="page-icon">${Icon.svg('shield', 20)}</span> 安全监控</h1>
          <button class="btn btn-secondary" id="safety-refresh">刷新</button>
        </div>

        <!-- Stats Cards -->
        <div id="safety-stats" style="display:grid;grid-template-columns:repeat(auto-fill,minmax(200px,1fr));gap:16px;margin-bottom:24px;">
          <div class="safety-card score" style="text-align:center;">
            <div class="safety-stat-value" id="stat-safe-score" style="color:var(--accent-cyan);">--</div>
            <div class="safety-stat-label">安全评分</div>
          </div>
          <div class="safety-card threats" style="text-align:center;">
            <div class="safety-stat-value" id="stat-today-threats" style="color:var(--accent-red);">--</div>
            <div class="safety-stat-label">今日威胁数</div>
          </div>
          <div class="safety-card rules" style="text-align:center;">
            <div class="safety-stat-value" id="stat-active-rules" style="color:var(--accent-green);">--</div>
            <div class="safety-stat-label">活跃规则数</div>
          </div>
          <div class="safety-card blocked" style="text-align:center;">
            <div class="safety-stat-value" id="stat-blocked-requests" style="color:var(--accent-amber);">--</div>
            <div class="safety-stat-label">被拦截请求</div>
          </div>
        </div>

        <!-- Tab Navigation -->
        <div style="display:flex;gap:8px;margin-bottom:16px;">
          <button class="btn ${currentTab === 'overview' ? 'btn-primary' : 'btn-secondary'} safety-tab-btn" data-tab="overview">威胁列表</button>
          <button class="btn ${currentTab === 'rules' ? 'btn-primary' : 'btn-secondary'} safety-tab-btn" data-tab="rules">安全规则</button>
        </div>

        <!-- Tab Content -->
        <div id="safety-content"></div>
      </div>
    `;
        // Tab button handlers
        el.querySelectorAll('.safety-tab-btn').forEach((btn) => {
            btn.addEventListener('click', () => {
                currentTab = btn.dataset.tab || 'overview';
                el.querySelectorAll('.safety-tab-btn').forEach((b) => {
                    b.className = 'btn ' + (b.dataset.tab === currentTab ? 'btn-primary' : 'btn-secondary') + ' safety-tab-btn';
                });
                renderTabContent();
            });
        });
        // Refresh button
        document.getElementById('safety-refresh')?.addEventListener('click', loadStats);
        loadStats();
        renderTabContent();
    }
    // ── Load Stats ──
    async function loadStats() {
        try {
            const res = await API.get('/safety/stats');
            stats = res.data || {};
            updateStatsUI();
        }
        catch (e) {
            console.warn('Failed to load safety stats:', e.message);
            // Use mock data for demo
            stats = { safeScore: 85, todayThreats: 12, activeRules: 8, blockedRequests: 47 };
            updateStatsUI();
        }
    }
    function updateStatsUI() {
        const scoreEl = document.getElementById('stat-safe-score');
        const threatsEl = document.getElementById('stat-today-threats');
        const rulesEl = document.getElementById('stat-active-rules');
        const blockedEl = document.getElementById('stat-blocked-requests');
        if (scoreEl) {
            const score = stats.safeScore || 0;
            scoreEl.textContent = String(score);
            if (score >= 80) {
                scoreEl.className = 'safety-stat-value score-good';
            }
            else if (score >= 50) {
                scoreEl.className = 'safety-stat-value score-warning';
            }
            else {
                scoreEl.className = 'safety-stat-value score-danger';
            }
        }
        if (threatsEl)
            threatsEl.textContent = String(stats.todayThreats || 0);
        if (rulesEl)
            rulesEl.textContent = String(stats.activeRules || 0);
        if (blockedEl)
            blockedEl.textContent = String(stats.blockedRequests || 0);
    }
    // ── Tab Content ──
    function renderTabContent() {
        const container = document.getElementById('safety-content');
        if (!container)
            return;
        if (currentTab === 'overview') {
            renderThreatsList(container);
        }
        else {
            renderRulesList(container);
        }
    }
    // ── Threats List ──
    function renderThreatsList(container) {
        container.innerHTML = `
      <div class="card">
        <div class="card-header">
          <div class="filter-group">
            <select id="threat-type-filter" class="filter-select">
              <option value="">全部类型</option>
              <option value="sql-injection">SQL 注入</option>
              <option value="xss">XSS 攻击</option>
              <option value="path-traversal">路径遍历</option>
              <option value="rate-limit">速率限制</option>
              <option value="malicious-request">恶意请求</option>
              <option value="unauthorized-access">未授权访问</option>
            </select>
            <select id="threat-severity-filter" class="filter-select">
              <option value="">全部严重程度</option>
              <option value="high">高</option>
              <option value="medium">中</option>
              <option value="low">低</option>
            </select>
          </div>
          <button class="btn btn-secondary btn-sm" id="threats-refresh">刷新</button>
        </div>
        <div class="card-body" id="threats-table-container">
          <div class="empty-state">加载中...</div>
        </div>
        <div id="threats-pagination" class="pagination"></div>
      </div>
    `;
        document.getElementById('threat-type-filter')?.addEventListener('change', (e) => {
            threatFilters.type = e.target.value;
            threatsPage = 1;
            loadThreats();
        });
        document.getElementById('threat-severity-filter')?.addEventListener('change', (e) => {
            threatFilters.severity = e.target.value;
            threatsPage = 1;
            loadThreats();
        });
        document.getElementById('threats-refresh')?.addEventListener('click', () => {
            threatsPage = 1;
            loadThreats();
        });
        loadThreats();
    }
    async function loadThreats() {
        const tableContainer = document.getElementById('threats-table-container');
        if (!tableContainer)
            return;
        try {
            const params = {
                page: threatsPage,
                limit: THREATS_PAGE_SIZE,
                type: threatFilters.type || undefined,
                severity: threatFilters.severity || undefined
            };
            const res = await API.get('/safety/threats', params);
            threats = Array.isArray(res.data) ? res.data : (res.data?.items || []);
            threatsTotal = res.meta?.total || res.data?.total || 0;
            if (threats.length === 0) {
                tableContainer.innerHTML = '<div class="empty-state">暂无威胁事件</div>';
                document.getElementById('threats-pagination').innerHTML = '';
                return;
            }
            tableContainer.innerHTML = `
        <div class="table-container">
          <table>
            <thead>
              <tr>
                <th>时间</th>
                <th>来源 IP</th>
                <th>威胁类型</th>
                <th>威胁描述</th>
                <th>严重程度</th>
                <th>处理状态</th>
              </tr>
            </thead>
            <tbody>
              ${threats.map((t) => renderThreatRow(t)).join('')}
            </tbody>
          </table>
        </div>
      `;
            renderThreatsPagination();
        }
        catch (e) {
            tableContainer.innerHTML = `<div class="empty-state" style="color:var(--accent-red);">加载失败: ${escapeHtml(e.message)}</div>`;
        }
    }
    function renderThreatRow(threat) {
        const time = threat.timestamp || threat.createdAt;
        const formattedTime = time ? new Date(time).toLocaleString('zh-CN') : '--';
        const severityClass = getSeverityClass(threat.severity);
        const statusClass = getStatusClass(threat.status);
        return `
      <tr>
        <td style="font-family:var(--font-mono);font-size:12px;color:var(--text-secondary);white-space:nowrap;">
          ${formattedTime}
        </td>
        <td style="font-family:var(--font-mono);color:var(--text-primary);">
          ${escapeHtml(threat.sourceIp || threat.ip || '--')}
        </td>
        <td>
          ${escapeHtml(threat.type || '--')}
        </td>
        <td style="color:var(--text-secondary);max-width:300px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">
          ${escapeHtml(threat.description || '--')}
        </td>
        <td>
          <span class="severity-badge ${severityClass}">${getSeverityLabel(threat.severity)}</span>
        </td>
        <td>
          <span class="status-badge ${statusClass}">${getStatusLabel(threat.status)}</span>
        </td>
      </tr>
    `;
    }
    function renderThreatsPagination() {
        const paginationEl = document.getElementById('threats-pagination');
        if (!paginationEl)
            return;
        const totalPages = Math.ceil(threatsTotal / THREATS_PAGE_SIZE);
        if (totalPages <= 1) {
            paginationEl.innerHTML = `<span class="pagination-info">共 ${threatsTotal} 条记录</span>`;
            return;
        }
        paginationEl.innerHTML = `
      <button class="pagination-btn" id="threats-prev" ${threatsPage <= 1 ? 'disabled' : ''}>上一页</button>
      <span class="pagination-info">第 ${threatsPage} / ${totalPages} 页 (共 ${threatsTotal} 条)</span>
      <button class="pagination-btn" id="threats-next" ${threatsPage >= totalPages ? 'disabled' : ''}>下一页</button>
    `;
        document.getElementById('threats-prev')?.addEventListener('click', () => {
            if (threatsPage > 1) {
                threatsPage--;
                loadThreats();
            }
        });
        document.getElementById('threats-next')?.addEventListener('click', () => {
            if (threatsPage < totalPages) {
                threatsPage++;
                loadThreats();
            }
        });
    }
    // ── Rules List ──
    function renderRulesList(container) {
        container.innerHTML = `
      <div class="card">
        <div class="card-header" style="display:flex;justify-content:space-between;align-items:center;">
          <h3 style="font-size:15px;font-weight:600;margin:0;">安全规则</h3>
          <button class="btn btn-primary" id="add-rule-btn">+ 添加规则</button>
        </div>
        <div class="card-body" id="rules-table-container">
          <div class="empty-state">加载中...</div>
        </div>
      </div>
    `;
        document.getElementById('add-rule-btn')?.addEventListener('click', () => openRuleForm());
        loadRules();
    }
    async function loadRules() {
        const tableContainer = document.getElementById('rules-table-container');
        if (!tableContainer)
            return;
        try {
            const res = await API.get('/safety/rules');
            rules = Array.isArray(res.data) ? res.data : (res.data?.items || []);
            if (rules.length === 0) {
                tableContainer.innerHTML = '<div class="empty-state">暂无安全规则，点击上方按钮添加</div>';
                return;
            }
            tableContainer.innerHTML = `
        <div class="table-container">
          <table>
            <thead>
              <tr>
                <th>名称</th>
                <th>描述</th>
                <th>类型</th>
                <th>状态</th>
                <th>操作</th>
              </tr>
            </thead>
            <tbody>
              ${rules.map((r) => renderRuleRow(r)).join('')}
            </tbody>
          </table>
        </div>
      `;
            // Bind toggle switches
            tableContainer.querySelectorAll('.rule-toggle').forEach((toggle) => {
                toggle.addEventListener('change', async (e) => {
                    const ruleId = toggle.dataset.id;
                    const enabled = toggle.checked;
                    try {
                        await API.put(`/safety/rules/${ruleId}`, { enabled });
                        Toast.success(`规则已${enabled ? '启用' : '禁用'}`);
                        await loadStats();
                    }
                    catch (err) {
                        toggle.checked = !enabled;
                        Toast.error('操作失败: ' + err.message);
                    }
                });
            });
            // Bind edit buttons
            tableContainer.querySelectorAll('.rule-edit-btn').forEach((btn) => {
                btn.addEventListener('click', () => {
                    const rule = rules.find((r) => r.id === btn.dataset.id);
                    if (rule)
                        openRuleForm(rule);
                });
            });
            // Bind delete buttons
            tableContainer.querySelectorAll('.rule-delete-btn').forEach((btn) => {
                btn.addEventListener('click', async () => {
                    if (!await Modal.confirm('删除规则', '确定删除此安全规则？此操作不可撤销。'))
                        return;
                    try {
                        await API.del(`/safety/rules/${btn.dataset.id}`);
                        Toast.success('规则已删除');
                        await loadRules();
                        await loadStats();
                    }
                    catch (err) {
                        Toast.error('删除失败: ' + err.message);
                    }
                });
            });
        }
        catch (e) {
            tableContainer.innerHTML = `<div class="empty-state" style="color:var(--accent-red);">加载失败: ${escapeHtml(e.message)}</div>`;
        }
    }
    function renderRuleRow(rule) {
        const typeBadge = getRuleTypeLabel(rule.type);
        return `
      <tr>
        <td style="font-weight:500;color:var(--text-primary);">
          ${escapeHtml(rule.name || '--')}
        </td>
        <td style="color:var(--text-secondary);max-width:250px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">
          ${escapeHtml(rule.description || '--')}
        </td>
        <td>
          <span class="rule-type-badge">${typeBadge}</span>
        </td>
        <td>
          <label class="toggle-switch">
            <input type="checkbox" class="rule-toggle" data-id="${rule.id}" ${rule.enabled !== false ? 'checked' : ''}>
            <span class="toggle-slider"></span>
          </label>
        </td>
        <td>
          <div style="display:flex;gap:4px;">
            <button class="btn btn-sm btn-ghost rule-edit-btn" data-id="${rule.id}" title="编辑">编辑</button>
            <button class="btn btn-sm btn-danger rule-delete-btn" data-id="${rule.id}" title="删除">删除</button>
          </div>
        </td>
      </tr>
    `;
    }
    // ── Rule Form Modal ──
    function openRuleForm(rule) {
        const isEdit = !!rule;
        Modal.open({
            title: isEdit ? '编辑安全规则' : '添加安全规则',
            body: `
        <div style="display:flex;flex-direction:column;gap:14px;">
          <div>
            <label style="font-size:12px;font-weight:600;display:block;margin-bottom:4px;">规则名称 *</label>
            <input class="input" id="rule-name" value="${escapeHtml(rule?.name || '')}" placeholder="如: 限制登录尝试">
          </div>
          <div>
            <label style="font-size:12px;font-weight:600;display:block;margin-bottom:4px;">描述</label>
            <input class="input" id="rule-desc" value="${escapeHtml(rule?.description || '')}" placeholder="简要说明规则用途">
          </div>
          <div>
            <label style="font-size:12px;font-weight:600;display:block;margin-bottom:4px;">规则类型 *</label>
            <select class="input" id="rule-type">
              <option value="rate-limit" ${rule?.type === 'rate-limit' ? 'selected' : ''}>速率限制 (rate-limit)</option>
              <option value="block-ip" ${rule?.type === 'block-ip' ? 'selected' : ''}>IP 封禁 (block-ip)</option>
              <option value="pattern" ${rule?.type === 'pattern' ? 'selected' : ''}>模式匹配 (pattern)</option>
              <option value="size-limit" ${rule?.type === 'size-limit' ? 'selected' : ''}>大小限制 (size-limit)</option>
            </select>
          </div>
          <div id="rule-config-fields">
            ${renderRuleConfigFields(rule)}
          </div>
          <div>
            <label style="font-size:12px;font-weight:600;display:block;margin-bottom:4px;">启用状态</label>
            <label class="toggle-switch">
              <input type="checkbox" id="rule-enabled" ${rule?.enabled !== false ? 'checked' : ''}>
              <span class="toggle-slider"></span>
            </label>
          </div>
        </div>
      `,
            footer: `
        <button class="btn btn-secondary" onclick="Modal.close()">取消</button>
        <button class="btn btn-primary" id="rule-save-btn">${isEdit ? '保存' : '创建'}</button>
      `
        });
        // Dynamic config fields based on type
        document.getElementById('rule-type')?.addEventListener('change', (e) => {
            const configContainer = document.getElementById('rule-config-fields');
            if (configContainer) {
                configContainer.innerHTML = renderRuleConfigFields({ type: e.target.value });
            }
        });
        document.getElementById('rule-save-btn')?.addEventListener('click', async () => {
            const nameEl = document.getElementById('rule-name');
            const typeEl = document.getElementById('rule-type');
            const descEl = document.getElementById('rule-desc');
            const enabledEl = document.getElementById('rule-enabled');
            const name = nameEl?.value?.trim() || '';
            const type = typeEl?.value || '';
            const description = descEl?.value?.trim() || '';
            const enabled = enabledEl?.checked ?? true;
            if (!name || !type) {
                Toast.warning('名称和类型不能为空');
                return;
            }
            // Collect config based on type
            const config = {};
            if (type === 'rate-limit') {
                config.maxRequests = parseInt(document.getElementById('config-max-requests')?.value, 10) || 100;
                config.windowMs = parseInt(document.getElementById('config-window-ms')?.value, 10) || 60000;
            }
            else if (type === 'block-ip') {
                config.ipAddresses = document.getElementById('config-ip-addresses')?.value?.trim() || '';
            }
            else if (type === 'pattern') {
                config.pattern = document.getElementById('config-pattern')?.value?.trim() || '';
                config.target = document.getElementById('config-target')?.value || 'url';
            }
            else if (type === 'size-limit') {
                config.maxSize = parseInt(document.getElementById('config-max-size')?.value, 10) || 1048576;
            }
            const data = { name, type, description, enabled, config };
            try {
                if (isEdit) {
                    await API.put(`/safety/rules/${rule.id}`, data);
                    Toast.success('规则已更新');
                }
                else {
                    await API.post('/safety/rules', data);
                    Toast.success('规则已创建');
                }
                Modal.close();
                await loadRules();
                await loadStats();
            }
            catch (err) {
                Toast.error(err.message || '保存失败');
            }
        });
    }
    function renderRuleConfigFields(rule) {
        const type = rule?.type || 'rate-limit';
        const config = rule?.config || {};
        switch (type) {
            case 'rate-limit':
                return `
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;">
            <div>
              <label style="font-size:12px;font-weight:600;display:block;margin-bottom:4px;">最大请求数</label>
              <input class="input" id="config-max-requests" type="number" value="${config.maxRequests || 100}" placeholder="100">
            </div>
            <div>
              <label style="font-size:12px;font-weight:600;display:block;margin-bottom:4px;">时间窗口 (ms)</label>
              <input class="input" id="config-window-ms" type="number" value="${config.windowMs || 60000}" placeholder="60000">
            </div>
          </div>
        `;
            case 'block-ip':
                return `
          <div>
            <label style="font-size:12px;font-weight:600;display:block;margin-bottom:4px;">IP 地址 (逗号分隔)</label>
            <input class="input" id="config-ip-addresses" value="${escapeHtml(config.ipAddresses || '')}" placeholder="192.168.1.100, 10.0.0.1">
          </div>
        `;
            case 'pattern':
                return `
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;">
            <div>
              <label style="font-size:12px;font-weight:600;display:block;margin-bottom:4px;">匹配模式 (正则)</label>
              <input class="input" id="config-pattern" value="${escapeHtml(config.pattern || '')}" placeholder="<script>">
            </div>
            <div>
              <label style="font-size:12px;font-weight:600;display:block;margin-bottom:4px;">匹配目标</label>
              <select class="input" id="config-target">
                <option value="url" ${config.target === 'url' ? 'selected' : ''}>URL</option>
                <option value="body" ${config.target === 'body' ? 'selected' : ''}>请求体</option>
                <option value="headers" ${config.target === 'headers' ? 'selected' : ''}>请求头</option>
              </select>
            </div>
          </div>
        `;
            case 'size-limit':
                return `
          <div>
            <label style="font-size:12px;font-weight:600;display:block;margin-bottom:4px;">最大大小 (字节)</label>
            <input class="input" id="config-max-size" type="number" value="${config.maxSize || 1048576}" placeholder="1048576">
            <div style="font-size:11px;color:var(--text-muted);margin-top:4px;">默认 1MB (1048576 字节)</div>
          </div>
        `;
            default:
                return '<div style="color:var(--text-muted);font-size:12px;">选择规则类型以配置参数</div>';
        }
    }
    // ── Helper Functions ──
    function getSeverityClass(severity) {
        switch (severity?.toLowerCase()) {
            case 'high': return 'severity-high';
            case 'medium': return 'severity-medium';
            case 'low': return 'severity-low';
            default: return 'severity-low';
        }
    }
    function getSeverityLabel(severity) {
        switch (severity?.toLowerCase()) {
            case 'high': return '高';
            case 'medium': return '中';
            case 'low': return '低';
            default: return severity || '--';
        }
    }
    function getStatusClass(status) {
        switch (status?.toLowerCase()) {
            case 'pending': return 'status-pending';
            case 'resolved': return 'status-resolved';
            case 'blocked': return 'status-blocked';
            default: return 'status-pending';
        }
    }
    function getStatusLabel(status) {
        switch (status?.toLowerCase()) {
            case 'pending': return '待处理';
            case 'resolved': return '已解决';
            case 'blocked': return '已拦截';
            default: return status || '待处理';
        }
    }
    function getRuleTypeLabel(type) {
        switch (type) {
            case 'rate-limit': return '速率限制';
            case 'block-ip': return 'IP 封禁';
            case 'pattern': return '模式匹配';
            case 'size-limit': return '大小限制';
            default: return type || '--';
        }
    }
    function escapeHtml(str) {
        if (!str)
            return '';
        const d = document.createElement('div');
        d.textContent = String(str);
        return d.innerHTML;
    }
    // ── Public API ──
    return { render };
})();
