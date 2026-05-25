const path = require('path');
const fs = require('fs');
const config = require('../config');
const BACKUP_DIR = path.join(config.data.dir, 'skills');

if (!fs.existsSync(BACKUP_DIR)) {
  fs.mkdirSync(BACKUP_DIR, { recursive: true });
}

const BUILTIN_SKILLS = [
  // ═══ 文档 ═══
  { id: 'skill-pdf', name: 'PDF 处理', category: '文档', description: '读取、创建、编辑、合并、拆分 PDF，OCR 识别', isBuiltin: true, config: {} },
  { id: 'skill-pptx', name: 'PPT 制作', category: '文档', description: '生成演示文稿，支持图表和自定义布局', isBuiltin: true, config: {} },
  { id: 'skill-docx', name: 'Word 文档', category: '文档', description: '创建和编辑 Word 文档，支持批注、修订、模板', isBuiltin: true, config: {} },
  { id: 'skill-xlsx', name: 'Excel 表格', category: '文档', description: '创建和编辑 Excel 表格，公式计算、数据透视表、图表', isBuiltin: true, config: {} },
  { id: 'skill-markdown', name: 'Markdown 处理', category: '文档', description: 'Markdown 编写、格式转换、渲染输出', isBuiltin: true, config: {} },

  // ═══ 前端 ═══
  { id: 'skill-frontend-design', name: 'Frontend Design', category: '前端', description: '创建生产级前端界面，内置设计系统', isBuiltin: true, config: {} },
  { id: 'skill-web-design', name: '网页设计规范', category: '前端', description: '响应式布局、无障碍访问、SEO 优化', isBuiltin: true, config: {} },

  // ═══ 开发 ═══
  { id: 'skill-git', name: 'Git 操作', category: '开发', description: '版本控制：提交、分支、合并、冲突解决', isBuiltin: true, config: {} },
  { id: 'skill-docker', name: 'Docker 操作', category: '开发', description: '容器管理，构建镜像、编写 Compose、优化', isBuiltin: true, config: {} },
  { id: 'skill-testing', name: '测试生成', category: '开发', description: '自动生成单元测试、集成测试、E2E 测试代码', isBuiltin: true, config: {} },
  { id: 'skill-refactor', name: '代码重构', category: '开发', description: '代码重构、优化、清理，消除技术债务', isBuiltin: true, config: {} },
  { id: 'skill-performance', name: '性能优化', category: '开发', description: '性能分析和优化：内存、加载速度、渲染性能', isBuiltin: true, config: {} },
  { id: 'skill-debugging', name: '调试诊断', category: '开发', description: '系统化定位和修复 Bug，分析堆栈和错误日志', isBuiltin: true, config: {} },
  { id: 'skill-code-review', name: '代码审查', category: '开发', description: '全面代码审查：质量、安全、可维护性', isBuiltin: true, config: {} },
  { id: 'skill-code-gen', name: '代码生成', category: '开发', description: '从需求描述生成完整可运行代码，含类型定义和错误处理', isBuiltin: true, config: {} },
  { id: 'skill-dependency', name: '依赖管理', category: '开发', description: '分析和管理项目依赖，检测过期包，安全漏洞扫描', isBuiltin: true, config: {} },

  // ═══ API & 后端 ═══
  { id: 'skill-api-design', name: 'API 开发', category: '后端', description: 'RESTful API 设计、文档、测试、版本管理', isBuiltin: true, config: {} },
  { id: 'skill-sql', name: 'SQL 操作', category: '后端', description: 'SQL 查询编写、优化、数据库设计和迁移', isBuiltin: true, config: {} },
  { id: 'skill-database', name: '数据库管理', category: '后端', description: '数据库迁移脚本生成、备份恢复、性能调优', isBuiltin: true, config: {} },
  { id: 'skill-config', name: '配置管理', category: '后端', description: '生成和管理项目配置文件（env、yaml、json schema）', isBuiltin: true, config: {} },
  { id: 'skill-logging', name: '日志分析', category: '后端', description: '日志解析、异常模式识别、运维报告自动生成', isBuiltin: true, config: {} },

  // ═══ 安全 ═══
  { id: 'skill-security', name: '安全审查', category: '安全', description: '代码安全审查、漏洞检测、OWASP Top 10', isBuiltin: true, config: {} },
  { id: 'skill-secret-scan', name: '密钥检测', category: '安全', description: '扫描代码中的硬编码密钥、Token、密码等敏感信息', isBuiltin: true, config: {} },

  // ═══ 工具 ═══
  { id: 'skill-regex', name: '正则表达式', category: '工具', description: '正则表达式编写、测试和优化', isBuiltin: true, config: {} },
  { id: 'skill-json', name: 'JSON 处理', category: '工具', description: 'JSON 解析、转换、Schema 验证、格式化', isBuiltin: true, config: {} },
  { id: 'skill-yaml', name: 'YAML 处理', category: '工具', description: 'YAML 配置文件读写、校验和转换', isBuiltin: true, config: {} },
  { id: 'skill-web-search', name: '网络搜索', category: '工具', description: '搜索网络获取最新信息、文档和解决方案', isBuiltin: true, config: {} },
  { id: 'skill-image', name: '图片处理', category: '工具', description: '图片识别、OCR、格式转换、批量处理', isBuiltin: true, config: {} },
  { id: 'skill-batch-process', name: '批量处理', category: '工具', description: '批量文件重命名、格式转换、内容替换、归档压缩', isBuiltin: true, config: {} },

  // ═══ 数据 ═══
  { id: 'skill-csv', name: 'CSV 处理', category: '数据', description: 'CSV 读写、转换、数据清洗和分析', isBuiltin: true, config: {} },
  { id: 'skill-data-analysis', name: '数据分析', category: '数据', description: '数据清洗、统计、可视化、报告生成', isBuiltin: true, config: {} },
  { id: 'skill-data-migration', name: '数据迁移', category: '数据', description: '跨系统数据迁移脚本、ETL 流程、校验与回滚', isBuiltin: true, config: {} },

  // ═══ 运维 ═══
  { id: 'skill-deployment', name: '自动部署', category: '运维', description: '生成部署脚本、CI/CD 配置、环境初始化', isBuiltin: true, config: {} },
  { id: 'skill-monitoring', name: '监控告警', category: '运维', description: '生成监控配置、告警规则、健康检查脚本', isBuiltin: true, config: {} },
  { id: 'skill-backup', name: '备份恢复', category: '运维', description: '自动化备份脚本、增量备份策略、恢复流程', isBuiltin: true, config: {} },
];

class SkillService {
  /** @type {Set<string>} globally installed skill IDs */
  static installedSkills = new Set();

  /** @type {Map<string, Object>} Custom skills from market */
  static customSkills = new Map();

  /**
   * Get all available skills (built-in + custom)
   */
  static getAll() {
    return [...BUILTIN_SKILLS, ...SkillService.customSkills.values()];
  }

  /**
   * Get all installed skills (global, not per-Agent)
   */
  static getInstalled() {
    const all = SkillService.getAll();
    return all.filter(s => SkillService.installedSkills.has(s.id));
  }

  /**
   * Get skills by name or ID list (used by Agent to resolve its skillNames)
   */
  static getByNames(names) {
    if (!Array.isArray(names) || names.length === 0) return [];
    const all = SkillService.getAll();
    return all.filter(s => names.includes(s.name) || names.includes(s.id));
  }

  /**
   * Get a single skill by ID
   */
  static getById(id) {
    const all = SkillService.getAll();
    return all.find(s => s.id === id) || null;
  }

  /**
   * Install a skill globally (no longer per-agent)
   */
  static install(skillId, agentId, options = {}) {
    let skill = BUILTIN_SKILLS.find(s => s.id === skillId);
    if (!skill) {
      skill = SkillService.customSkills.get(skillId);
      if (!skill) {
        const displayName = options.name || skillId;
        skill = { id: skillId, name: displayName, category: 'market', description: '', isBuiltin: false, config: {} };
        SkillService.customSkills.set(skillId, skill);
      }
    }

    SkillService._backupSkill(skill);
    SkillService.installedSkills.add(skillId);

    // Execute install command if available
    if (options.installCmd) {
      try {
        const { execSync } = require('child_process');
        execSync(options.installCmd, { timeout: 60000, stdio: 'pipe' });
      } catch (e) {
        console.warn(`Skill install command failed (${options.installCmd}): ${e.message}`);
      }
    }

    SkillService.saveInstallations();
    return { skillId, installed: true };
  }

  /**
   * Uninstall a skill globally
   */
  static uninstall(skillId, agentId) {
    if (!SkillService.installedSkills.has(skillId)) {
      const err = new Error(`Skill '${skillId}' not found`);
      err.code = 'NOT_FOUND';
      throw err;
    }
    SkillService.installedSkills.delete(skillId);
    SkillService.saveInstallations();
    return { skillId, installed: false };
  }

  /**
   * Get all skills installed for a specific agent (backward compat)
   */
  static getByAgent(agentId) {
    try {
      const AgentModel = require('../models/Agent');
      const agent = AgentModel.findById(agentId);
      if (!agent || !agent.skillNames) return [];
      return SkillService.getByNames(agent.skillNames);
    } catch (_) {
      return [];
    }
  }

  /**
   * Backup skill info to disk for later use by new agents
   */
  static _backupSkill(skill) {
    try {
      if (!fs.existsSync(BACKUP_DIR)) {
        fs.mkdirSync(BACKUP_DIR, { recursive: true });
      }
      const backupFile = path.join(BACKUP_DIR, `${skill.id}.json`);
      fs.writeFileSync(backupFile, JSON.stringify(skill, null, 2), 'utf-8');
    } catch (e) {
      console.error(`Failed to backup skill ${skill.id}:`, e.message);
    }
  }

  /**
   * Get all backed-up skill IDs for auto-assignment to new agents
   */
  static getBackedUpSkills() {
    try {
      if (!fs.existsSync(BACKUP_DIR)) return [];
      const files = fs.readdirSync(BACKUP_DIR).filter(f => f.endsWith('.json'));
      return files.map(f => {
        try {
          const data = JSON.parse(fs.readFileSync(path.join(BACKUP_DIR, f), 'utf-8'));
          return data.id;
        } catch { return null; }
      }).filter(Boolean);
    } catch { return []; }
  }

  /**
   * Assign all backed-up skills to a newly created agent
   */
  static assignToNewAgent(agentId) {
    const assigned = [];

    // 1. Assign globally installed skills (__ALL__)
    for (const [skillId, agents] of SkillService.installations) {
      if (agents.includes('__ALL__') && !agents.includes(agentId)) {
        agents.push(agentId);
        assigned.push(skillId);
      }
    }

    // 2. Assign backed-up skills
    const backedUp = SkillService.getBackedUpSkills();
    for (const skillId of backedUp) {
      if (!SkillService.installations.has(skillId)) {
        SkillService.installations.set(skillId, []);
      }
      const agents = SkillService.installations.get(skillId);
      if (!agents.includes(agentId)) {
        agents.push(agentId);
        if (!assigned.includes(skillId)) assigned.push(skillId);
      }
    }

    if (assigned.length > 0) {
      SkillService.saveInstallations();
    }

    return assigned;
  }

  /**
   * Reload installed skills from saved state (supports old format too)
   */
  static reload(installedSkillsArray) {
    SkillService.installedSkills.clear();
    if (Array.isArray(installedSkillsArray)) {
      for (const entry of installedSkillsArray) {
        if (typeof entry === 'string') {
          SkillService.installedSkills.add(entry);
        } else if (entry && entry.skillId) {
          SkillService.installedSkills.add(entry.skillId);
        }
      }
    }
  }

  /**
   * Save current installations
   */
  static saveInstallations() {
    const result = [...SkillService.installedSkills];

    try {
      const FileService = require('./FileService');
      const workspaceRoot = FileService.runtimeWorkspaceRoot;
      if (workspaceRoot) {
        const WorkspaceStateService = require('./WorkspaceStateService');
        WorkspaceStateService.saveState(workspaceRoot, 'skills', { installed: result });
      } else {
        const dataDir = path.join(config.data.dir, 'skills.json');
        fs.writeFileSync(dataDir, JSON.stringify({ installed: result }, null, 2), 'utf-8');
      }
    } catch (e) { /* ignore */ }

    return result;
  }

  /**
   * Clear all installations (for testing)
   */
  static clear() {
    SkillService.installedSkills.clear();
  }
}

module.exports = SkillService;
