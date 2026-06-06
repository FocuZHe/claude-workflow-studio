"use strict";
window.AgentCreate = (() => {
    const ROLE_PRESETS = {
        developer: {
            systemPrompt: '你是一名高级软件开发者。编写清晰、高效、可维护的代码。遵循最佳实践和设计模式。提交前确保代码通过所有测试。',
            model: 'sonnet',
            temperature: 0.3
        },
        reviewer: {
            systemPrompt: '你是一名代码审查专家。仔细审查代码的安全性、性能、可维护性和最佳实践。提供具体、可操作的改进建议。',
            model: 'sonnet',
            temperature: 0.2
        },
        tester: {
            systemPrompt: '你是一名测试工程师。编写全面的单元测试、集成测试和边界测试。确保测试覆盖率高且测试用例有意义。',
            model: 'sonnet',
            temperature: 0.3
        },
        planner: {
            systemPrompt: '你是一名技术规划师。分析任务需求，制定详细的实施计划，识别风险和依赖关系。输出清晰的步骤和时间线。',
            model: 'sonnet',
            temperature: 0.5
        },
        debugger: {
            systemPrompt: '你是一名调试专家。系统地分析错误日志和堆栈跟踪，定位问题根因，提出修复方案。优先考虑最小化修改的影响范围。',
            model: 'sonnet',
            temperature: 0.2
        },
        documenter: {
            systemPrompt: '你是一名技术文档编写者。编写清晰、结构化的文档，包括API文档、使用指南和架构说明。注重准确性和易读性。',
            model: 'sonnet',
            temperature: 0.4
        },
        custom: {
            systemPrompt: '',
            model: 'sonnet',
            temperature: 0.7
        }
    };
    function open(onSubmit) {
        Modal.open({
            title: '创建新智能体',
            body: renderForm(),
            footer: `
        <button class="btn btn-secondary" onclick="Modal.close()">取消</button>
        <button class="btn btn-primary" id="agent-submit-btn">创建智能体</button>
      `,
        });
        document.getElementById('agent-submit-btn').addEventListener('click', () => {
            const { valid, errors } = FormValidator.validate('agent-form', {
                'agent-name': { required: true, minLength: 1, maxLength: 50 },
                'agent-role': { required: true }
            });
            if (!valid)
                return;
            const data = collectFormData();
            if (!data.name || !data.role) {
                Toast.warning('名称和角色为必填项');
                return;
            }
            // 智能体无记忆，统一设为全局，不受工作区切换影响
            data.workspaceId = null;
            onSubmit(data);
        });
        // Bind role preset auto-fill
        const roleEl = document.getElementById('agent-role');
        if (roleEl) {
            roleEl.addEventListener('change', (e) => {
                const target = e.target;
                const preset = ROLE_PRESETS[target.value];
                if (preset) {
                    const promptEl = document.getElementById('agent-prompt');
                    const modelEl = document.getElementById('agent-model');
                    const tempEl = document.getElementById('agent-temp');
                    if (promptEl && !promptEl.dataset.userModified)
                        promptEl.value = preset.systemPrompt;
                    if (modelEl && !modelEl.dataset.userModified)
                        modelEl.value = preset.model;
                    if (tempEl && !tempEl.dataset.userModified)
                        tempEl.value = String(preset.temperature);
                }
            });
        }
        // Load installed Skills into form
        loadSkillsIntoForm();
        // Track user modifications so auto-fill doesn't overwrite them
        ['agent-prompt', 'agent-model', 'agent-temp'].forEach(id => {
            const el = document.getElementById(id);
            if (el) {
                el.addEventListener('input', () => { el.dataset.userModified = 'true'; });
                el.addEventListener('change', () => { el.dataset.userModified = 'true'; });
            }
        });
    }
    function renderForm() {
        return `
      <div id="agent-form">
      <div class="form-group">
        <label class="form-label">名称 *</label>
        <input class="input" id="agent-name" placeholder="例如: 代码审查员" maxlength="50">
        <div class="form-error"></div>
      </div>
      <div class="form-group">
        <label class="form-label">角色 *</label>
        <select class="select" id="agent-role">
          <option value="">请选择角色...</option>
          <option value="developer">开发者 — 编写和重构代码</option>
          <option value="reviewer">审查员 — 审查代码质量和安全性</option>
          <option value="tester">测试员 — 编写和运行测试</option>
          <option value="planner">规划师 — 分析任务并制定计划</option>
          <option value="debugger">调试员 — 调查和修复缺陷</option>
          <option value="documenter">文档员 — 编写文档</option>
          <option value="custom">自定义</option>
        </select>
        <div class="form-error"></div>
      </div>
      <div class="form-group">
        <label class="form-label">描述</label>
        <textarea class="textarea" id="agent-desc" placeholder="此 Claude Code 智能体的功能是什么？" maxlength="500" rows="2"></textarea>
      </div>
      <div class="form-group">
        <label class="form-label">系统提示词</label>
        <div class="form-hint" style="margin-bottom:4px;">定义此智能体通过 Claude Code 执行任务时行为方式的指令</div>
        <textarea class="textarea" id="agent-prompt" placeholder="例如: 你是一名高级开发者。始终使用严格类型编写 TypeScript。提交前运行测试。" rows="4"></textarea>
      </div>
      <div class="grid-2">
        <div class="form-group">
          <label class="form-label">模型</label>
          <select class="select" id="agent-model">
            <option value="sonnet">Claude Sonnet</option>
            <option value="opus">Claude Opus</option>
            <option value="haiku">Claude Haiku</option>
          </select>
        </div>
        <div class="form-group">
          <label class="form-label">温度</label>
          <input class="input" id="agent-temp" type="number" min="0" max="1" step="0.1" value="0.7">
        </div>
      </div>
      <div class="form-group">
        <label class="form-label">工具权限</label>
        <div class="form-hint" style="margin-bottom:6px;">配置此智能体可以使用的工具</div>
        <div style="display:flex;flex-wrap:wrap;gap:12px;">
          <label style="display:flex;align-items:center;gap:4px;cursor:pointer;font-size:13px;">
            <input type="checkbox" name="perm-executeCommand" checked> 执行命令
          </label>
          <label style="display:flex;align-items:center;gap:4px;cursor:pointer;font-size:13px;">
            <input type="checkbox" name="perm-browser" checked> 浏览器
          </label>
          <label style="display:flex;align-items:center;gap:4px;cursor:pointer;font-size:13px;">
            <input type="checkbox" name="perm-search" checked> 搜索
          </label>
        </div>
      </div>
      <div class="form-group">
        <label class="form-label">已安装的技能 (Skills)</label>
        <div class="form-hint" style="margin-bottom:6px;">勾选此 Agent 可以使用的技能（可多选）</div>
        <div id="agent-skills-list" style="display:flex;flex-wrap:wrap;gap:8px;font-size:12px;color:var(--text-muted);">加载中...</div>
      </div>
      </div>
    `;
    }
    function collectToolPermissions() {
        const keys = ['executeCommand', 'browser', 'search'];
        const perms = {};
        keys.forEach((k) => {
            const el = document.querySelector(`[name="perm-${k}"]`);
            perms[k] = el ? el.checked : true;
        });
        return perms;
    }
    function collectFormData() {
        const temp = parseFloat(document.getElementById('agent-temp')?.value);
        const skillNames = [];
        document.querySelectorAll('.agent-skill-cb:checked').forEach((cb) => {
            skillNames.push(cb.value);
        });
        return {
            name: document.getElementById('agent-name')?.value.trim(),
            role: document.getElementById('agent-role')?.value,
            description: document.getElementById('agent-desc')?.value.trim(),
            config: {
                systemPrompt: document.getElementById('agent-prompt')?.value.trim(),
                model: document.getElementById('agent-model')?.value,
                temperature: isNaN(temp) ? 0.7 : Math.min(1, Math.max(0, temp)),
            },
            toolPermissions: collectToolPermissions(),
            skillNames,
        };
    }
    async function loadSkillsIntoForm() {
        const container = document.getElementById('agent-skills-list');
        if (!container)
            return;
        try {
            const res = await API.getInstalledSkills();
            const skills = Array.isArray(res.data) ? res.data : [];
            if (skills.length === 0) {
                container.innerHTML = '<span style="color:var(--text-muted);padding:8px;">暂未安装任何技能，可从技能市场安装</span>';
                return;
            }
            // Group by category
            const cats = {};
            skills.forEach((s) => {
                const cat = s.category || '其他';
                if (!cats[cat])
                    cats[cat] = [];
                cats[cat].push(s);
            });
            const catNames = Object.keys(cats).sort();
            container.innerHTML = `
        <input type="text" id="skill-search" class="input" placeholder="搜索技能..."
          style="width:100%;margin-bottom:8px;font-size:12px;padding:4px 8px;"
          oninput="document.querySelectorAll('.skill-cat-group').forEach(g=>{const t=g.querySelector('.skill-cat-label').textContent;const items=g.querySelectorAll('.skill-item');let vis=0;items.forEach(i=>{const m=i.textContent.toLowerCase().includes(this.value.toLowerCase());i.style.display=m?'':'none';vis+=m?1:0});g.style.display=vis>0?'':'none'})">
        ${catNames.map((cat) => `
          <div class="skill-cat-group" style="margin-bottom:8px;">
            <div class="skill-cat-label" style="font-size:11px;font-weight:600;color:var(--accent-cyan);margin-bottom:4px;cursor:pointer;user-select:none;"
              onclick="const items=this.nextElementSibling;items.style.display=items.style.display==='none'?'':'none'">
              ▾ ${cat} (${cats[cat].length})
            </div>
            <div style="display:flex;flex-wrap:wrap;gap:4px;">
              ${cats[cat].map((s) => `
                <label class="skill-item" style="display:flex;align-items:center;gap:3px;cursor:pointer;font-size:11px;padding:2px 6px;border:1px solid var(--border-subtle);border-radius:3px;">
                  <input type="checkbox" class="agent-skill-cb" value="${s.name.replace(/"/g, '&quot;')}">
                  <span title="${(s.description || '').replace(/"/g, '&quot;')}">${s.name.replace(/"/g, '&quot;')}</span>
                </label>
              `).join('')}
            </div>
          </div>
        `).join('')}
      `;
        }
        catch (_) {
            container.innerHTML = '<span style="color:var(--text-muted);">加载技能失败</span>';
        }
    }
    return { open };
})();
