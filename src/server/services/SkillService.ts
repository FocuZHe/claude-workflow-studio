/**
 * SkillService - 技能管理服务
 * 管理Agent的技能配置，安装后创建实际的 SKILL.md 文件
 */

const fs = require('fs');
const path = require('path');
const logger = require('../utils/logger');

export interface Skill {
  id: string;
  name: string;
  description: string;
  category: string;
  isBuiltin: boolean;
  installed?: boolean;
}

export interface InstalledSkill {
  id: string;
  skillId: string;
  agentId: string;
  installed: boolean;
  installedAt: string;
}

// 内置技能列表
const BUILTIN_SKILLS: Skill[] = [
  { id: 'skill-pdf', name: 'PDF处理', description: '处理PDF文件', category: 'document', isBuiltin: true },
  { id: 'skill-docx', name: 'Word处理', description: '处理Word文件', category: 'document', isBuiltin: true },
  { id: 'skill-excel', name: 'Excel处理', description: '处理Excel文件', category: 'document', isBuiltin: true },
  { id: 'skill-git', name: 'Git操作', description: 'Git版本控制', category: 'development', isBuiltin: true },
  { id: 'skill-docker', name: 'Docker', description: 'Docker容器管理', category: 'devops', isBuiltin: true },
  { id: 'skill-k8s', name: 'Kubernetes', description: 'K8s集群管理', category: 'devops', isBuiltin: true },
  { id: 'skill-aws', name: 'AWS', description: 'AWS云服务', category: 'cloud', isBuiltin: true },
  { id: 'skill-sql', name: 'SQL', description: '数据库查询', category: 'database', isBuiltin: true },
  { id: 'skill-api', name: 'API测试', description: 'API接口测试', category: 'testing', isBuiltin: true },
  { id: 'skill-regex', name: '正则表达式', description: '正则表达式匹配', category: 'utility', isBuiltin: true },
  { id: 'skill-json', name: 'JSON处理', description: 'JSON数据处理', category: 'utility', isBuiltin: true },
  { id: 'skill-yaml', name: 'YAML处理', description: 'YAML配置处理', category: 'utility', isBuiltin: true },
  { id: 'skill-markdown', name: 'Markdown', description: 'Markdown文档', category: 'document', isBuiltin: true },
  { id: 'skill-html', name: 'HTML', description: 'HTML页面生成', category: 'web', isBuiltin: true },
  { id: 'skill-css', name: 'CSS', description: 'CSS样式处理', category: 'web', isBuiltin: true },
  { id: 'skill-javascript', name: 'JavaScript', description: 'JS脚本编写', category: 'development', isBuiltin: true },
  { id: 'skill-python', name: 'Python', description: 'Python脚本编写', category: 'development', isBuiltin: true },
];

// Skills 目录路径
const SKILLS_DIR = path.join(process.cwd(), '.claude', 'skills');

export class SkillService {
  static skills: Skill[] = [...BUILTIN_SKILLS];
  private static installedSkills: InstalledSkill[] = [];

  /**
   * 确保 skills 目录存在
   */
  private static ensureSkillsDir(): void {
    if (!fs.existsSync(SKILLS_DIR)) {
      fs.mkdirSync(SKILLS_DIR, { recursive: true });
    }
  }

  /**
   * 创建 SKILL.md 文件
   */
  private static createSkillFile(skillId: string, name: string, description: string): void {
    this.ensureSkillsDir();
    const skillDir = path.join(SKILLS_DIR, skillId);
    if (!fs.existsSync(skillDir)) {
      fs.mkdirSync(skillDir, { recursive: true });
    }

    const skillMd = `---
name: "${skillId}"
description: "${description}"
user-invocable: true
---

# ${name}

${description}

## 使用说明

当执行与"${name}"相关的任务时，请遵循以下原则：
1. 根据任务类型选择合适的工具和方法
2. 遵循最佳实践和安全规范
3. 提供清晰的执行步骤和结果反馈
`;

    const filePath = path.join(skillDir, 'SKILL.md');
    fs.writeFileSync(filePath, skillMd, 'utf-8');
    logger.info(`[SkillService] 创建 SKILL.md: ${filePath}`);
  }

  /**
   * 删除 SKILL.md 文件
   */
  private static removeSkillFile(skillId: string): void {
    const skillDir = path.join(SKILLS_DIR, skillId);
    if (fs.existsSync(skillDir)) {
      fs.rmSync(skillDir, { recursive: true, force: true });
      logger.info(`[SkillService] 删除 SKILL.md 目录: ${skillDir}`);
    }
  }

  /**
   * 获取所有技能
   */
  static getAll(): Skill[] {
    return this.skills.map(s => ({ ...s, isBuiltin: true }));
  }

  /**
   * 获取所有技能（路由使用）
   */
  static getAllSkills(): Skill[] {
    return this.getAll();
  }

  /**
   * 获取Agent已安装的技能
   */
  static getByAgent(agentId: string): InstalledSkill[] {
    return this.installedSkills.filter(s => s.agentId === agentId);
  }

  /**
   * 获取Agent已安装的技能ID列表
   */
  static getSkillIdsByAgent(agentId: string): string[] {
    return this.installedSkills
      .filter(s => s.agentId === agentId)
      .map(s => s.skillId);
  }

  /**
   * 安装技能 - 创建实际的 SKILL.md 文件
   */
  static install(skillId: string, agentId: string | null): InstalledSkill {
    if (!agentId) {
      const { AppError } = require('../middleware/errorHandler');
      throw new AppError('VALIDATION_ERROR', 'agentId is required', 400);
    }

    // 检查是否已安装
    const existing = this.installedSkills.find(s => s.skillId === skillId && s.agentId === agentId);
    if (existing) {
      const { AppError } = require('../middleware/errorHandler');
      throw new AppError('CONFLICT', `Skill ${skillId} already installed for agent ${agentId}`, 409);
    }

    // 查找技能信息
    const skill = this.skills.find(s => s.id === skillId);
    const skillName = skill ? skill.name : skillId;
    const skillDesc = skill ? skill.description : `技能: ${skillId}`;

    // 创建实际的 SKILL.md 文件
    try {
      this.createSkillFile(skillId, skillName, skillDesc);
    } catch (e: any) {
      logger.warn(`[SkillService] 创建 SKILL.md 失败: ${e.message}`);
    }

    const entry: InstalledSkill = {
      id: skillId,
      skillId,
      agentId,
      installed: true,
      installedAt: new Date().toISOString()
    };
    this.installedSkills.push(entry);
    return entry;
  }

  /**
   * 卸载技能 - 删除 SKILL.md 文件
   */
  static uninstall(skillId: string, agentId: string): InstalledSkill {
    const index = this.installedSkills.findIndex(s => s.skillId === skillId && s.agentId === agentId);
    if (index === -1) {
      const { AppError } = require('../middleware/errorHandler');
      throw new AppError('NOT_FOUND', `Skill ${skillId} not installed for agent ${agentId}`, 404);
    }
    const entry = this.installedSkills[index];
    this.installedSkills.splice(index, 1);

    // 检查是否还有其他 agent 使用这个技能
    const stillUsed = this.installedSkills.some(s => s.skillId === skillId);
    if (!stillUsed) {
      try {
        this.removeSkillFile(skillId);
      } catch (e: any) {
        logger.warn(`[SkillService] 删除 SKILL.md 失败: ${e.message}`);
      }
    }

    return { ...entry, installed: false };
  }

  /**
   * 清空所有数据
   */
  static clear(): void {
    this.installedSkills = [];
    this.skills = [...BUILTIN_SKILLS];
  }
}

// 初始化
module.exports = SkillService;
module.exports.SkillService = SkillService;
module.exports.default = SkillService;
