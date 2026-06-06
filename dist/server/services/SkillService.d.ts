/**
 * SkillService - 技能管理服务
 * 管理Agent的技能配置，安装后创建实际的 SKILL.md 文件
 */
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
export declare class SkillService {
    static skills: Skill[];
    private static installedSkills;
    /**
     * 确保 skills 目录存在
     */
    private static ensureSkillsDir;
    /**
     * 创建 SKILL.md 文件
     */
    private static createSkillFile;
    /**
     * 删除 SKILL.md 文件
     */
    private static removeSkillFile;
    /**
     * 获取所有技能
     */
    static getAll(): Skill[];
    /**
     * 获取所有技能（路由使用）
     */
    static getAllSkills(): Skill[];
    /**
     * 获取Agent已安装的技能
     */
    static getByAgent(agentId: string): InstalledSkill[];
    /**
     * 获取Agent已安装的技能ID列表
     */
    static getSkillIdsByAgent(agentId: string): string[];
    /**
     * 安装技能 - 创建实际的 SKILL.md 文件
     */
    static install(skillId: string, agentId: string | null): InstalledSkill;
    /**
     * 卸载技能 - 删除 SKILL.md 文件
     */
    static uninstall(skillId: string, agentId: string): InstalledSkill;
    /**
     * 清空所有数据
     */
    static clear(): void;
}
//# sourceMappingURL=SkillService.d.ts.map