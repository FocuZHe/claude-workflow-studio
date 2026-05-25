// ═══════════════════════════════════════════════
// AgentTemplates — Preset Agent Templates
// ═══════════════════════════════════════════════

window.AgentTemplates = (() => {
  const BUILTIN_TEMPLATES = [
    {
      id: 'tpl-architect',
      name: '🏗️ 架构师',
      role: 'planner',
      description: '系统设计、技术选型、架构评审',
      model: 'opus',
      systemPrompt: '你是一位资深软件架构师，擅长系统设计和技术选型。分析需求时考虑可扩展性、可维护性和性能。输出清晰的架构方案、技术选型理由和风险评估。'
    },
    {
      id: 'tpl-fullstack',
      name: '💻 全栈开发者',
      role: 'developer',
      description: '前后端开发、数据库、API',
      model: 'sonnet',
      systemPrompt: '你是一位全栈开发工程师，精通前后端开发。编写清晰、高效、可维护的代码。熟悉 RESTful API 设计、数据库建模和现代框架。提交前确保代码通过测试。'
    },
    {
      id: 'tpl-tester',
      name: '🧪 测试工程师',
      role: 'tester',
      description: '编写测试、发现Bug、回归测试',
      model: 'sonnet',
      systemPrompt: '你是一位专业的测试工程师。编写全面的单元测试、集成测试和边界测试。擅长发现隐蔽的Bug和边界情况。确保测试覆盖率高且测试用例有意义。'
    },
    {
      id: 'tpl-docs',
      name: '📝 文档撰写者',
      role: 'documenter',
      description: 'README、API文档、技术博客',
      model: 'haiku',
      systemPrompt: '你是一位技术文档撰写专家。编写清晰、结构化的文档，包括 README、API 文档、使用指南和架构说明。注重准确性和易读性，使用恰当的 Markdown 格式。'
    },
    {
      id: 'tpl-reviewer',
      name: '🔍 代码审查员',
      role: 'reviewer',
      description: 'PR审查、代码质量、安全检查',
      model: 'sonnet',
      systemPrompt: '你是一位严格的代码审查员。仔细审查代码的安全性、性能、可维护性和最佳实践。提供具体、可操作的改进建议。关注潜在的安全漏洞和性能瓶颈。'
    },
    {
      id: 'tpl-debugger',
      name: '🐛 调试专家',
      role: 'debugger',
      description: '问题定位、错误分析、修复方案',
      model: 'sonnet',
      systemPrompt: '你是一位调试专家。系统地分析错误日志和堆栈跟踪，定位问题根因，提出修复方案。优先考虑最小化修改的影响范围，确保修复不会引入新问题。'
    },
    {
      id: 'tpl-frontend',
      name: '🎨 前端设计师',
      role: 'developer',
      description: 'UI界面、响应式布局、交互设计',
      model: 'sonnet',
      systemPrompt: '你是一位前端设计师，擅长 UI 界面设计和交互实现。编写语义化的 HTML、优雅的 CSS 和高效的 JavaScript。注重响应式布局、无障碍访问和用户体验。'
    }
  ];

  function render() {
    return `
      <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(240px,1fr));gap:12px;padding:4px 0;">
        ${BUILTIN_TEMPLATES.map(tpl => `
          <div class="card template-card" data-tpl-id="${tpl.id}" style="cursor:pointer;transition:transform 0.15s,box-shadow 0.15s;padding:16px;">
            <div style="font-size:15px;font-weight:600;margin-bottom:6px;color:var(--text-primary);">${tpl.name}</div>
            <div style="font-size:12px;color:var(--text-secondary);margin-bottom:10px;min-height:32px;">${tpl.description}</div>
            <div style="display:flex;align-items:center;justify-content:space-between;">
              <span style="font-size:10px;padding:2px 6px;background:var(--accent-primary-dim);color:var(--accent-primary);border-radius:4px;">${tpl.model.split('-').slice(0,3).join('-')}</span>
              <button class="btn btn-primary btn-sm template-use-btn" data-tpl-id="${tpl.id}">使用模板</button>
            </div>
          </div>
        `).join('')}
      </div>
    `;
  }

  function open(onSelect) {
    Modal.open({
      title: '选择智能体模板',
      body: render(),
      footer: `<button class="btn btn-secondary" onclick="Modal.close()">取消</button>`,
    });
    bindEvents(onSelect);
  }

  function bindEvents(onSelect) {
    // Button click
    document.querySelectorAll('.template-use-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const tplId = btn.dataset.tplId;
        const tpl = BUILTIN_TEMPLATES.find(t => t.id === tplId);
        if (tpl && onSelect) {
          onSelect(tpl);
          Modal.close();
        }
      });
    });

    // Card hover effects
    document.querySelectorAll('.template-card').forEach(card => {
      card.addEventListener('mouseenter', () => {
        card.style.transform = 'translateY(-2px)';
        card.style.boxShadow = '0 4px 12px rgba(0,0,0,0.15)';
      });
      card.addEventListener('mouseleave', () => {
        card.style.transform = '';
        card.style.boxShadow = '';
      });
      // Card click (same as button)
      card.addEventListener('click', (e) => {
        if (e.target.closest('.template-use-btn')) return;
        const tplId = card.dataset.tplId;
        const tpl = BUILTIN_TEMPLATES.find(t => t.id === tplId);
        if (tpl && onSelect) {
          onSelect(tpl);
          Modal.close();
        }
      });
    });
  }

  return { open, render, BUILTIN_TEMPLATES };
})();
