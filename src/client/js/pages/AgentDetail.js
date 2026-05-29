// ═══════════════════════════════════════════════
// AgentDetail — View/Edit Modal
// ═══════════════════════════════════════════════

window.AgentDetail = (() => {
  async function open(agent, onSubmit) {
    Modal.open({
      title: `编辑: ${agent.name}`,
      body: renderForm(agent),
      footer: `
        <button class="btn btn-secondary" onclick="Modal.close()">取消</button>
        <button class="btn btn-primary" id="agent-save-btn">保存更改</button>
      `,
    });

    // Load installed skills for editing
    loadSkillsForEdit(agent.skillNames || []);

    document.getElementById('agent-save-btn').addEventListener('click', () => {
      const data = collectFormData();
      onSubmit(data);
    });
  }

  async function loadSkillsForEdit(currentSkillNames) {
    const container = document.getElementById('agent-skills-list');
    if (!container) return;
    try {
      const res = await API.getInstalledSkills();
      const skills = Array.isArray(res.data) ? res.data : [];
      if (skills.length === 0) {
        container.innerHTML = '<span style="color:var(--text-muted);padding:8px;">暂未安装技能</span>';
        return;
      }
      // Group by category
      const cats = {};
      skills.forEach(s => {
        const cat = s.category || '其他';
        if (!cats[cat]) cats[cat] = [];
        cats[cat].push(s);
      });
      const catNames = Object.keys(cats).sort();

      container.innerHTML = `
        <input type="text" id="skill-search" class="input" placeholder="搜索技能..."
          style="width:100%;margin-bottom:8px;font-size:12px;padding:4px 8px;"
          oninput="document.querySelectorAll('.skill-cat-group').forEach(g=>{const items=g.querySelectorAll('.skill-item');let vis=0;items.forEach(i=>{const m=i.textContent.toLowerCase().includes(this.value.toLowerCase());i.style.display=m?'':'none';vis+=m?1:0});g.style.display=vis>0?'':'none'})">
        ${catNames.map(cat => `
          <div class="skill-cat-group" style="margin-bottom:8px;">
            <div class="skill-cat-label" style="font-size:11px;font-weight:600;color:var(--accent-cyan);margin-bottom:4px;cursor:pointer;user-select:none;"
              onclick="const items=this.nextElementSibling;items.style.display=items.style.display==='none'?'':'none'">
              ▾ ${escapeHtml(cat)} (${cats[cat].length})
            </div>
            <div style="display:flex;flex-wrap:wrap;gap:4px;">
              ${cats[cat].map(s => `
                <label class="skill-item" style="display:flex;align-items:center;gap:3px;cursor:pointer;font-size:11px;padding:2px 6px;border:1px solid var(--border-subtle);border-radius:3px;">
                  <input type="checkbox" class="agent-skill-cb" value="${escapeHtml(s.name)}" ${currentSkillNames.includes(s.name) ? 'checked' : ''}>
                  <span>${escapeHtml(s.name)}</span>
                </label>
              `).join('')}
            </div>
          </div>
        `).join('')}
      `;
    } catch (_) { container.innerHTML = '<span style="color:var(--text-muted);">加载失败</span>'; }
  }

  function openDetail(agent, logs) {
    Modal.open({
      title: agent.name,
      body: renderDetail(agent, logs),
      footer: `<button class="btn btn-secondary" onclick="Modal.close()">关闭</button>`,
    });

    // Load conversation history
    loadAgentHistory(agent.id);
  }

  function renderForm(agent) {
    const perms = agent.toolPermissions || {};

    return `
      <div class="form-group">
        <label class="form-label">名称</label>
        <input class="input" id="agent-name" value="${escapeAttr(agent.name)}" maxlength="50">
      </div>
      <div class="form-group">
        <label class="form-label">角色</label>
        <select class="select" id="agent-role">
          ${['developer','reviewer','tester','planner','debugger','documenter','custom'].map(r =>
            `<option value="${r}" ${agent.role === r ? 'selected' : ''}>${r}</option>`
          ).join('')}
        </select>
      </div>
      <div class="form-group">
        <label class="form-label">状态</label>
        <select class="select" id="agent-status">
          ${['idle','busy','error','offline'].map(s =>
            `<option value="${s}" ${agent.status === s ? 'selected' : ''}>${s}</option>`
          ).join('')}
        </select>
      </div>
      <div class="form-group">
        <label class="form-label">描述</label>
        <textarea class="textarea" id="agent-desc" rows="3">${escapeHtml(agent.description || '')}</textarea>
      </div>
      <div class="form-group">
        <label class="form-label">系统提示词</label>
        <textarea class="textarea" id="agent-prompt" rows="3">${escapeHtml(agent.config?.systemPrompt || '')}</textarea>
      </div>
      <div class="form-group">
        <label class="form-label">工具权限</label>
        <div style="display:flex;flex-wrap:wrap;gap:12px;">
          ${['executeCommand','browser','search'].map(k => {
            const labels = { executeCommand: '执行命令', browser: '浏览器', search: '搜索' };
            const checked = perms.hasOwnProperty(k) ? perms[k] : true;
            return `<label style="display:flex;align-items:center;gap:4px;cursor:pointer;font-size:13px;">
              <input type="checkbox" name="perm-${k}" ${checked ? 'checked' : ''}> ${labels[k]}
            </label>`;
          }).join('')}
        </div>
      </div>
      <div class="form-group">
        <label class="form-label">已安装技能 (Skills)</label>
        <div id="agent-skills-list" style="display:flex;flex-wrap:wrap;gap:8px;font-size:12px;color:var(--text-muted);">加载中...</div>
      </div>
    `;
  }

  function renderDetail(agent, logs) {
    return `
      <div style="margin-bottom:16px;">
        <div style="display:flex;align-items:center;gap:12px;margin-bottom:12px;">
          ${StatusBadge.render(agent.status)}
          <span class="badge badge-${agent.role}">${agent.role}</span>
        </div>
        <p style="color:var(--text-secondary);font-size:13px;">${escapeHtml(agent.description || '暂无描述')}</p>
      </div>
      <div style="margin-bottom:12px;font-size:12px;color:var(--text-tertiary);">
        模型: <span style="color:var(--text-secondary);">${agent.config?.model || '默认'}</span>
        &nbsp;|&nbsp; 温度: <span style="color:var(--text-secondary);">${agent.config?.temperature ?? 0.7}</span>
        &nbsp;|&nbsp; 创建时间: <span style="color:var(--text-secondary);">${new Date(agent.createdAt).toLocaleString()}</span>
      </div>
      ${renderToolPermissionsDetail(agent.toolPermissions)}
      ${(agent.skillNames || []).length > 0 ? `<div style="margin-bottom:12px;font-size:12px;color:var(--text-tertiary);">技能: ${agent.skillNames.map(s => `<span style="color:var(--accent-cyan);">${escapeHtml(s)}</span>`).join(', ')}</div>` : ''}
      <div style="font-size:12px;font-weight:600;margin-bottom:8px;color:var(--text-secondary);">对话历史</div>
      <div id="agent-history-list" style="margin-bottom:16px;max-height:200px;overflow-y:auto;">
        <div style="color:var(--text-muted);font-size:12px;">加载中...</div>
      </div>
      <div style="font-size:12px;font-weight:600;margin-bottom:8px;color:var(--text-secondary);">日志</div>
      ${LogViewer.render(logs, 'agent-detail-logs')}
    `;
  }

  async function loadAgentHistory(agentId) {
    const container = document.getElementById('agent-history-list');
    if (!container) return;
    try {
      const res = await API.getTasks({ assignedAgentId: agentId, limit: 10 });
      const tasks = res.data?.items || res.data || [];
      if (tasks.length === 0) {
        container.innerHTML = '<div style="color:var(--text-muted);font-size:12px;">暂无执行历史</div>';
        return;
      }
      container.innerHTML = tasks.map(t => `
        <div style="padding:6px 8px;border-bottom:1px solid var(--border-subtle);font-size:12px;display:flex;justify-content:space-between;align-items:center;">
          <div style="flex:1;min-width:0;">
            <div style="font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${escapeHtml(t.title || t.name || t.id)}</div>
            <div style="color:var(--text-muted);font-size:11px;">${t.createdAt ? new Date(t.createdAt).toLocaleString() : '--'}</div>
          </div>
          ${StatusBadge.render(t.status)}
        </div>
      `).join('');
    } catch (e) {
      container.innerHTML = '<div style="color:var(--text-muted);font-size:12px;">加载失败</div>';
    }
  }

  function collectToolPermissions() {
    const keys = ['executeCommand', 'browser', 'search'];
    const perms = {};
    keys.forEach(k => {
      const el = document.querySelector(`[name="perm-${k}"]`);
      perms[k] = el ? el.checked : true;
    });
    return perms;
  }

  function collectFormData() {
    return {
      name: document.getElementById('agent-name')?.value.trim(),
      role: document.getElementById('agent-role')?.value,
      status: document.getElementById('agent-status')?.value,
      description: document.getElementById('agent-desc')?.value.trim(),
      config: {
        systemPrompt: document.getElementById('agent-prompt')?.value.trim(),
      },
      toolPermissions: collectToolPermissions(),
      skillNames: [...document.querySelectorAll('.agent-skill-cb:checked')].map(cb => cb.value),
    };
  }

  function renderToolPermissionsDetail(perms) {
    if (!perms) return '';
    const labels = { executeCommand: '执行命令', browser: '浏览器', search: '搜索' };
    const enabled = Object.entries(perms).filter(([, v]) => v).map(([k]) => labels[k] || k);
    if (enabled.length === 0) return '';
    return `<div style="margin-bottom:8px;font-size:12px;color:var(--text-tertiary);">
      工具权限: ${enabled.map(l => `<span style="display:inline-block;padding:1px 6px;margin:0 2px;background:var(--bg-secondary);border-radius:4px;font-size:11px;">${l}</span>`).join('')}
    </div>`;
  }

  function escapeHtml(str) {
    const d = document.createElement('div');
    d.textContent = str || '';
    return d.innerHTML;
  }

  function escapeAttr(str) {
    return String(str).replace(/&/g,'&amp;').replace(/"/g,'&quot;').replace(/'/g,'&#39;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  }

  return { open, openDetail };
})();
