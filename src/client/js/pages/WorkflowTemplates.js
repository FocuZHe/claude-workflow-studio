"use strict";
// ═══════════════════════════════════════════════
// Workflow Templates — Template Marketplace
// ═══════════════════════════════════════════════
window.WorkflowTemplates = (() => {
    const BUILTIN_WORKFLOW_TEMPLATES = [
        {
            id: 'wtpl-code-review',
            name: '代码审查流水线',
            category: '代码审查',
            description: '安全检查 → 代码质量 → 输出报告',
            nodes: [
                { id: 'n1', label: '代码审查', type: 'start', agentId: '', position: { x: 80, y: 200 }, config: {} },
                { id: 'n2', label: '安全检查', type: 'agent', agentId: '', position: { x: 280, y: 120 }, config: { prompt: '对代码进行安全漏洞扫描，检查SQL注入、XSS、敏感信息泄露等' } },
                { id: 'n3', label: '代码质量分析', type: 'agent', agentId: '', position: { x: 480, y: 120 }, config: { prompt: '分析代码质量，包括复杂度、可维护性、命名规范等' } },
                { id: 'n4', label: '输出报告', type: 'end', agentId: '', position: { x: 680, y: 200 }, config: {} }
            ],
            edges: [
                { id: 'e1', source: 'n1', target: 'n2' },
                { id: 'e2', source: 'n2', target: 'n3' },
                { id: 'e3', source: 'n3', target: 'n4' }
            ]
        },
        {
            id: 'wtpl-doc-gen',
            name: '文档自动生成',
            category: '文档生成',
            description: '分析结构 → 生成README → 生成API文档',
            nodes: [
                { id: 'n1', label: '文档生成', type: 'start', agentId: '', position: { x: 80, y: 200 }, config: {} },
                { id: 'n2', label: '分析项目结构', type: 'agent', agentId: '', position: { x: 280, y: 120 }, config: { prompt: '分析项目目录结构和代码文件，提取关键信息' } },
                { id: 'n3', label: '生成README', type: 'agent', agentId: '', position: { x: 480, y: 120 }, config: { prompt: '根据项目结构生成详细的README文档' } },
                { id: 'n4', label: '生成API文档', type: 'agent', agentId: '', position: { x: 480, y: 280 }, config: { prompt: '从代码中提取API接口信息，生成API文档' } },
                { id: 'n5', label: '输出文档', type: 'end', agentId: '', position: { x: 680, y: 200 }, config: {} }
            ],
            edges: [
                { id: 'e1', source: 'n1', target: 'n2' },
                { id: 'e2', source: 'n2', target: 'n3' },
                { id: 'e3', source: 'n2', target: 'n4' },
                { id: 'e4', source: 'n3', target: 'n5' },
                { id: 'e5', source: 'n4', target: 'n5' }
            ]
        },
        {
            id: 'wtpl-bug-fix',
            name: 'Bug修复助手',
            category: '测试流水线',
            description: '定位问题 → 生成修复方案 → 创建PR',
            nodes: [
                { id: 'n1', label: 'Bug修复', type: 'start', agentId: '', position: { x: 80, y: 200 }, config: {} },
                { id: 'n2', label: '定位问题', type: 'agent', agentId: '', position: { x: 280, y: 120 }, config: { prompt: '分析错误日志，定位问题代码位置和原因' } },
                { id: 'n3', label: '生成修复方案', type: 'agent', agentId: '', position: { x: 480, y: 120 }, config: { prompt: '根据问题分析结果，生成修复代码方案' } },
                { id: 'n4', label: '创建PR', type: 'agent', agentId: '', position: { x: 680, y: 120 }, config: { prompt: '创建Pull Request，包含修复说明和测试用例' } },
                { id: 'n5', label: '完成', type: 'end', agentId: '', position: { x: 880, y: 200 }, config: {} }
            ],
            edges: [
                { id: 'e1', source: 'n1', target: 'n2' },
                { id: 'e2', source: 'n2', target: 'n3' },
                { id: 'e3', source: 'n3', target: 'n4' },
                { id: 'e4', source: 'n4', target: 'n5' }
            ]
        },
        {
            id: 'wtpl-project-init',
            name: '项目初始化',
            category: '代码审查',
            description: '生成项目结构 → 安装依赖 → 配置CI',
            nodes: [
                { id: 'n1', label: '项目初始化', type: 'start', agentId: '', position: { x: 80, y: 200 }, config: {} },
                { id: 'n2', label: '生成项目结构', type: 'agent', agentId: '', position: { x: 280, y: 120 }, config: { prompt: '根据需求生成项目目录和基础文件' } },
                { id: 'n3', label: '安装依赖', type: 'agent', agentId: '', position: { x: 480, y: 120 }, config: { prompt: '自动安装项目所需的依赖包' } },
                { id: 'n4', label: '配置CI/CD', type: 'agent', agentId: '', position: { x: 680, y: 120 }, config: { prompt: '配置持续集成和部署流水线' } },
                { id: 'n5', label: '完成', type: 'end', agentId: '', position: { x: 880, y: 200 }, config: {} }
            ],
            edges: [
                { id: 'e1', source: 'n1', target: 'n2' },
                { id: 'e2', source: 'n2', target: 'n3' },
                { id: 'e3', source: 'n3', target: 'n4' },
                { id: 'e4', source: 'n4', target: 'n5' }
            ]
        },
        {
            id: 'wtpl-content',
            name: '内容创作流水线',
            category: '内容创作',
            description: '大纲生成 → 内容撰写 → 配图 → 排版',
            nodes: [
                { id: 'n1', label: '内容创作', type: 'start', agentId: '', position: { x: 80, y: 200 }, config: {} },
                { id: 'n2', label: '生成大纲', type: 'agent', agentId: '', position: { x: 280, y: 120 }, config: { prompt: '根据用户需求生成详细的内容大纲' } },
                { id: 'n3', label: '内容撰写', type: 'agent', agentId: '', position: { x: 480, y: 120 }, config: { prompt: '根据大纲撰写完整内容' } },
                { id: 'n4', label: '配图建议', type: 'agent', agentId: '', position: { x: 480, y: 280 }, config: { prompt: '为内容生成配图建议和描述' } },
                { id: 'n5', label: '排版输出', type: 'agent', agentId: '', position: { x: 680, y: 200 }, config: { prompt: '对内容进行排版美化，输出最终文档' } },
                { id: 'n6', label: '完成', type: 'end', agentId: '', position: { x: 880, y: 200 }, config: {} }
            ],
            edges: [
                { id: 'e1', source: 'n1', target: 'n2' },
                { id: 'e2', source: 'n2', target: 'n3' },
                { id: 'e3', source: 'n2', target: 'n4' },
                { id: 'e4', source: 'n3', target: 'n5' },
                { id: 'e5', source: 'n4', target: 'n5' },
                { id: 'e6', source: 'n5', target: 'n6' }
            ]
        },
        // ── 部署运维 ──
        {
            id: 'wpl-cicd-pipeline',
            name: 'CI/CD自动化流水线',
            category: '部署运维',
            description: '代码提交 → 构建 → 测试 → 部署 → 通知',
            nodes: [
                { id: 'n1', label: '接收代码变更', type: 'start', agentId: '', position: { x: 80, y: 200 }, config: {} },
                { id: 'n2', label: '代码构建', type: 'agent', agentId: '', position: { x: 280, y: 120 }, config: { prompt: '执行代码构建，编译源代码并打包产物' } },
                { id: 'n3', label: '自动化测试', type: 'agent', agentId: '', position: { x: 480, y: 120 }, config: { prompt: '运行单元测试、集成测试和端到端测试' } },
                { id: 'n4', label: '测试通过?', type: 'condition', agentId: '', position: { x: 680, y: 120 }, config: { condition: 'test_result === "passed"' } },
                { id: 'n5', label: '部署到生产', type: 'agent', agentId: '', position: { x: 880, y: 60 }, config: { prompt: '将构建产物部署到生产环境' } },
                { id: 'n6', label: '发送失败通知', type: 'agent', agentId: '', position: { x: 880, y: 260 }, config: { prompt: '发送测试失败通知，包含错误详情' } },
                { id: 'n7', label: '完成', type: 'end', agentId: '', position: { x: 1080, y: 200 }, config: {} }
            ],
            edges: [
                { id: 'e1', source: 'n1', target: 'n2' },
                { id: 'e2', source: 'n2', target: 'n3' },
                { id: 'e3', source: 'n3', target: 'n4' },
                { id: 'e4', source: 'n4', target: 'n5', label: '通过' },
                { id: 'e5', source: 'n4', target: 'n6', label: '失败' },
                { id: 'e6', source: 'n5', target: 'n7' },
                { id: 'e7', source: 'n6', target: 'n7' }
            ]
        },
        {
            id: 'wpl-monitoring-alert',
            name: '监控告警处理',
            category: '部署运维',
            description: '接收告警 → 分析原因 → 自动修复 → 通知',
            nodes: [
                { id: 'n1', label: '接收告警', type: 'start', agentId: '', position: { x: 80, y: 200 }, config: {} },
                { id: 'n2', label: '分析告警原因', type: 'agent', agentId: '', position: { x: 280, y: 120 }, config: { prompt: '分析告警日志和指标，定位根本原因' } },
                { id: 'n3', label: '执行自动修复', type: 'agent', agentId: '', position: { x: 480, y: 120 }, config: { prompt: '根据分析结果执行自动修复操作' } },
                { id: 'n4', label: '修复成功?', type: 'condition', agentId: '', position: { x: 680, y: 120 }, config: { condition: 'fix_result === "success"' } },
                { id: 'n5', label: '发送修复报告', type: 'agent', agentId: '', position: { x: 880, y: 120 }, config: { prompt: '生成修复报告并通知相关人员' } },
                { id: 'n6', label: '完成', type: 'end', agentId: '', position: { x: 1080, y: 200 }, config: {} }
            ],
            edges: [
                { id: 'e1', source: 'n1', target: 'n2' },
                { id: 'e2', source: 'n2', target: 'n3' },
                { id: 'e3', source: 'n3', target: 'n4' },
                { id: 'e4', source: 'n4', target: 'n5', label: '是' },
                { id: 'e5', source: 'n4', target: 'n5', label: '否' },
                { id: 'e6', source: 'n5', target: 'n6' }
            ]
        },
        // ── 数据分析 ──
        {
            id: 'wpl-data-pipeline',
            name: '数据处理流水线',
            category: '数据分析',
            description: '数据采集 → 清洗 → 分析 → 可视化 → 报告',
            nodes: [
                { id: 'n1', label: '数据源', type: 'start', agentId: '', position: { x: 80, y: 200 }, config: {} },
                { id: 'n2', label: '数据采集', type: 'agent', agentId: '', position: { x: 280, y: 120 }, config: { prompt: '从指定数据源采集原始数据' } },
                { id: 'n3', label: '数据清洗', type: 'agent', agentId: '', position: { x: 480, y: 120 }, config: { prompt: '清洗数据，处理缺失值、异常值和重复数据' } },
                { id: 'n4', label: '数据分析', type: 'agent', agentId: '', position: { x: 680, y: 120 }, config: { prompt: '执行统计分析和数据挖掘' } },
                { id: 'n5', label: '生成可视化', type: 'agent', agentId: '', position: { x: 880, y: 120 }, config: { prompt: '生成数据可视化图表' } },
                { id: 'n6', label: '生成报告', type: 'agent', agentId: '', position: { x: 1080, y: 120 }, config: { prompt: '汇总分析结果，生成最终报告' } },
                { id: 'n7', label: '完成', type: 'end', agentId: '', position: { x: 1280, y: 200 }, config: {} }
            ],
            edges: [
                { id: 'e1', source: 'n1', target: 'n2' },
                { id: 'e2', source: 'n2', target: 'n3' },
                { id: 'e3', source: 'n3', target: 'n4' },
                { id: 'e4', source: 'n4', target: 'n5' },
                { id: 'e5', source: 'n5', target: 'n6' },
                { id: 'e6', source: 'n6', target: 'n7' }
            ]
        },
        {
            id: 'wpl-etl-workflow',
            name: 'ETL工作流',
            category: '数据分析',
            description: '提取 → 转换 → 加载 → 验证',
            nodes: [
                { id: 'n1', label: '数据源配置', type: 'start', agentId: '', position: { x: 80, y: 200 }, config: {} },
                { id: 'n2', label: '数据提取', type: 'agent', agentId: '', position: { x: 280, y: 120 }, config: { prompt: '从源系统提取数据' } },
                { id: 'n3', label: '数据转换', type: 'agent', agentId: '', position: { x: 480, y: 120 }, config: { prompt: '按照目标格式转换数据' } },
                { id: 'n4', label: '数据加载', type: 'agent', agentId: '', position: { x: 680, y: 120 }, config: { prompt: '将转换后的数据加载到目标系统' } },
                { id: 'n5', label: '数据验证', type: 'agent', agentId: '', position: { x: 880, y: 120 }, config: { prompt: '验证加载数据的完整性和准确性' } },
                { id: 'n6', label: '完成', type: 'end', agentId: '', position: { x: 1080, y: 200 }, config: {} }
            ],
            edges: [
                { id: 'e1', source: 'n1', target: 'n2' },
                { id: 'e2', source: 'n2', target: 'n3' },
                { id: 'e3', source: 'n3', target: 'n4' },
                { id: 'e4', source: 'n4', target: 'n5' },
                { id: 'e5', source: 'n5', target: 'n6' }
            ]
        },
        // ── 安全审计 ──
        {
            id: 'wpl-security-audit',
            name: '安全审计流水线',
            category: '安全审计',
            description: '代码扫描 → 依赖检查 → 漏洞分析 → 报告',
            nodes: [
                { id: 'n1', label: '代码仓库', type: 'start', agentId: '', position: { x: 80, y: 200 }, config: {} },
                { id: 'n2', label: '静态代码扫描', type: 'agent', agentId: '', position: { x: 280, y: 120 }, config: { prompt: '对代码进行静态安全扫描，检测常见漏洞模式' } },
                { id: 'n3', label: '依赖漏洞检查', type: 'agent', agentId: '', position: { x: 480, y: 120 }, config: { prompt: '检查项目依赖中的已知安全漏洞' } },
                { id: 'n4', label: '安全漏洞分析', type: 'agent', agentId: '', position: { x: 680, y: 120 }, config: { prompt: '综合分析安全风险，评估漏洞严重程度' } },
                { id: 'n5', label: '生成安全报告', type: 'agent', agentId: '', position: { x: 880, y: 120 }, config: { prompt: '生成详细的安全审计报告，包含修复建议' } },
                { id: 'n6', label: '完成', type: 'end', agentId: '', position: { x: 1080, y: 200 }, config: {} }
            ],
            edges: [
                { id: 'e1', source: 'n1', target: 'n2' },
                { id: 'e2', source: 'n2', target: 'n3' },
                { id: 'e3', source: 'n3', target: 'n4' },
                { id: 'e4', source: 'n4', target: 'n5' },
                { id: 'e5', source: 'n5', target: 'n6' }
            ]
        },
        // ── 多Agent协作 ──
        {
            id: 'wpl-multi-agent-dev',
            name: '多Agent协作开发',
            category: '多Agent协作',
            description: '需求分析 → 前端+后端并行 → 测试 → 部署',
            nodes: [
                { id: 'n1', label: '需求输入', type: 'start', agentId: '', position: { x: 80, y: 200 }, config: {} },
                { id: 'n2', label: '需求分析与分工', type: 'agent', agentId: '', position: { x: 280, y: 120 }, config: { prompt: '分析需求，将任务拆分为前端和后端子任务' } },
                { id: 'n3', label: '前端开发', type: 'agent', agentId: '', position: { x: 520, y: 60 }, config: { prompt: '实现前端界面和交互逻辑' } },
                { id: 'n4', label: '后端开发', type: 'agent', agentId: '', position: { x: 520, y: 220 }, config: { prompt: '实现后端API和业务逻辑' } },
                { id: 'n5', label: '集成测试', type: 'agent', agentId: '', position: { x: 760, y: 120 }, config: { prompt: '执行集成测试，验证前后端协作' } },
                { id: 'n6', label: '代码审查', type: 'agent', agentId: '', position: { x: 960, y: 120 }, config: { prompt: '审查代码质量、安全性和最佳实践' } },
                { id: 'n7', label: '完成', type: 'end', agentId: '', position: { x: 1160, y: 200 }, config: {} }
            ],
            edges: [
                { id: 'e1', source: 'n1', target: 'n2' },
                { id: 'e2', source: 'n2', target: 'n3' },
                { id: 'e3', source: 'n2', target: 'n4' },
                { id: 'e4', source: 'n3', target: 'n5' },
                { id: 'e5', source: 'n4', target: 'n5' },
                { id: 'e6', source: 'n5', target: 'n6' },
                { id: 'e7', source: 'n6', target: 'n7' }
            ]
        },
        {
            id: 'wpl-research-publish',
            name: '研究发布流水线',
            category: '多Agent协作',
            description: '主题研究 → 内容撰写 → 审核 → 发布',
            nodes: [
                { id: 'n1', label: '研究主题', type: 'start', agentId: '', position: { x: 80, y: 200 }, config: {} },
                { id: 'n2', label: '资料收集', type: 'agent', agentId: '', position: { x: 280, y: 120 }, config: { prompt: '收集与研究主题相关的资料和文献' } },
                { id: 'n3', label: '内容撰写', type: 'agent', agentId: '', position: { x: 480, y: 120 }, config: { prompt: '根据收集的资料撰写研究内容' } },
                { id: 'n4', label: '内容审核', type: 'agent', agentId: '', position: { x: 680, y: 120 }, config: { prompt: '审核内容的准确性、完整性和质量' } },
                { id: 'n5', label: '审核通过?', type: 'condition', agentId: '', position: { x: 880, y: 120 }, config: { condition: 'review_result === "approved"' } },
                { id: 'n6', label: '排版发布', type: 'agent', agentId: '', position: { x: 1080, y: 60 }, config: { prompt: '对内容进行排版美化并发布' } },
                { id: 'n7', label: '返回修改', type: 'agent', agentId: '', position: { x: 1080, y: 220 }, config: { prompt: '根据审核意见修改内容' } },
                { id: 'n8', label: '完成', type: 'end', agentId: '', position: { x: 1280, y: 200 }, config: {} }
            ],
            edges: [
                { id: 'e1', source: 'n1', target: 'n2' },
                { id: 'e2', source: 'n2', target: 'n3' },
                { id: 'e3', source: 'n3', target: 'n4' },
                { id: 'e4', source: 'n4', target: 'n5' },
                { id: 'e5', source: 'n5', target: 'n6', label: '通过' },
                { id: 'e6', source: 'n5', target: 'n7', label: '不通过' },
                { id: 'e7', source: 'n6', target: 'n8' },
                { id: 'e8', source: 'n7', target: 'n4' }
            ]
        },
        // ── 翻译润色 ──
        {
            id: 'wpl-translate-polish',
            name: '翻译润色流水线',
            category: '翻译润色',
            description: '翻译 → 润色校对 → 输出',
            nodes: [
                { id: 'n1', label: '翻译润色', type: 'start', agentId: '', position: { x: 80, y: 200 }, config: {} },
                { id: 'n3', label: '初次翻译', type: 'agent', agentId: '', position: { x: 280, y: 120 }, config: { prompt: '将原文翻译为目标语言，保持原意和风格' } },
                { id: 'n4', label: '润色校对', type: 'agent', agentId: '', position: { x: 480, y: 120 }, config: { prompt: '对翻译结果进行润色，确保语言自然流畅，纠正错误' } },
                { id: 'n5', label: '输出', type: 'end', agentId: '', position: { x: 680, y: 200 }, config: {} }
            ],
            edges: [
                { id: 'e1', source: 'n1', target: 'n3' },
                { id: 'e3', source: 'n3', target: 'n4' },
                { id: 'e4', source: 'n4', target: 'n5' }
            ]
        },
        // ── API设计 ──
        {
            id: 'wpl-api-design',
            name: 'API设计与文档',
            category: '代码审查',
            description: 'API设计 → 代码生成 → 文档输出',
            nodes: [
                { id: 'n1', label: 'API设计', type: 'start', agentId: '', position: { x: 80, y: 200 }, config: {} },
                { id: 'n3', label: 'API设计', type: 'agent', agentId: '', position: { x: 280, y: 120 }, config: { prompt: '设计RESTful API接口，定义端点、请求/响应格式、状态码' } },
                { id: 'n4', label: '代码生成', type: 'agent', agentId: '', position: { x: 480, y: 120 }, config: { prompt: '根据API设计生成接口代码和数据模型' } },
                { id: 'n5', label: '文档输出', type: 'agent', agentId: '', position: { x: 480, y: 280 }, config: { prompt: '生成API文档，包含接口说明、示例和错误码' } },
                { id: 'n6', label: '完成', type: 'end', agentId: '', position: { x: 680, y: 200 }, config: {} }
            ],
            edges: [
                { id: 'e1', source: 'n1', target: 'n3' },
                { id: 'e3', source: 'n3', target: 'n4' },
                { id: 'e4', source: 'n3', target: 'n5' },
                { id: 'e5', source: 'n4', target: 'n6' },
                { id: 'e6', source: 'n5', target: 'n6' }
            ]
        },
        // ── 产品需求 ──
        {
            id: 'wpl-prd',
            name: '产品需求文档(PRD)',
            category: '文档生成',
            description: '用户故事 → 功能清单 → PRD输出',
            nodes: [
                { id: 'n1', label: 'PRD撰写', type: 'start', agentId: '', position: { x: 80, y: 200 }, config: {} },
                { id: 'n3', label: '用户故事', type: 'agent', agentId: '', position: { x: 280, y: 120 }, config: { prompt: '将需求拆解为用户故事和使用场景' } },
                { id: 'n4', label: '功能清单', type: 'agent', agentId: '', position: { x: 480, y: 120 }, config: { prompt: '生成功能清单、优先级和里程碑规划' } },
                { id: 'n5', label: 'PRD撰写', type: 'agent', agentId: '', position: { x: 680, y: 120 }, config: { prompt: '撰写完整的PRD文档' } },
                { id: 'n6', label: '完成', type: 'end', agentId: '', position: { x: 880, y: 200 }, config: {} }
            ],
            edges: [
                { id: 'e1', source: 'n1', target: 'n3' },
                { id: 'e3', source: 'n3', target: 'n4' },
                { id: 'e4', source: 'n4', target: 'n5' },
                { id: 'e5', source: 'n5', target: 'n6' }
            ]
        },
        // ── 测试用例 ──
        {
            id: 'wpl-test-gen',
            name: '测试用例生成',
            category: '测试流水线',
            description: '分析逻辑 → 生成测试 → 覆盖率报告',
            nodes: [
                { id: 'n1', label: '测试生成', type: 'start', agentId: '', position: { x: 80, y: 200 }, config: {} },
                { id: 'n3', label: '分析代码逻辑', type: 'agent', agentId: '', position: { x: 280, y: 120 }, config: { prompt: '分析代码的函数、分支和边界条件' } },
                { id: 'n4', label: '生成单元测试', type: 'agent', agentId: '', position: { x: 480, y: 60 }, config: { prompt: '生成覆盖正常路径和边界情况的单元测试' } },
                { id: 'n5', label: '生成集成测试', type: 'agent', agentId: '', position: { x: 480, y: 220 }, config: { prompt: '生成模块间交互的集成测试' } },
                { id: 'n6', label: '覆盖率报告', type: 'agent', agentId: '', position: { x: 680, y: 120 }, config: { prompt: '运行测试并生成覆盖率报告' } },
                { id: 'n7', label: '完成', type: 'end', agentId: '', position: { x: 880, y: 200 }, config: {} }
            ],
            edges: [
                { id: 'e1', source: 'n1', target: 'n3' },
                { id: 'e3', source: 'n3', target: 'n4' },
                { id: 'e4', source: 'n3', target: 'n5' },
                { id: 'e5', source: 'n4', target: 'n6' },
                { id: 'e6', source: 'n5', target: 'n6' },
                { id: 'e7', source: 'n6', target: 'n7' }
            ]
        },
        // ── 会议纪要 ──
        {
            id: 'wpl-meeting-notes',
            name: '会议纪要生成',
            category: '文档生成',
            description: '提取要点 → 生成纪要 → 行动项',
            nodes: [
                { id: 'n1', label: '会议纪要', type: 'start', agentId: '', position: { x: 80, y: 200 }, config: {} },
                { id: 'n3', label: '提取要点', type: 'agent', agentId: '', position: { x: 280, y: 120 }, config: { prompt: '从会议内容中提取关键讨论点和决策' } },
                { id: 'n4', label: '生成纪要', type: 'agent', agentId: '', position: { x: 480, y: 120 }, config: { prompt: '生成结构化的会议纪要' } },
                { id: 'n5', label: '提取行动项', type: 'agent', agentId: '', position: { x: 480, y: 280 }, config: { prompt: '提取会议中的行动项、负责人和截止日期' } },
                { id: 'n6', label: '输出', type: 'end', agentId: '', position: { x: 680, y: 200 }, config: {} }
            ],
            edges: [
                { id: 'e1', source: 'n1', target: 'n3' },
                { id: 'e3', source: 'n3', target: 'n4' },
                { id: 'e4', source: 'n3', target: 'n5' },
                { id: 'e5', source: 'n4', target: 'n6' },
                { id: 'e6', source: 'n5', target: 'n6' }
            ]
        },
        // ── 性能优化 ──
        {
            id: 'wpl-perf-opt',
            name: '性能优化分析',
            category: '代码审查',
            description: '性能分析 → 瓶颈定位 → 优化方案 → 验证',
            nodes: [
                { id: 'n1', label: '性能优化', type: 'start', agentId: '', position: { x: 80, y: 200 }, config: {} },
                { id: 'n3', label: '性能分析', type: 'agent', agentId: '', position: { x: 280, y: 120 }, config: { prompt: '分析代码性能瓶颈，识别热点函数和慢查询' } },
                { id: 'n4', label: '优化方案', type: 'agent', agentId: '', position: { x: 480, y: 120 }, config: { prompt: '生成具体的优化方案和代码修改建议' } },
                { id: 'n5', label: '验证测试', type: 'agent', agentId: '', position: { x: 680, y: 120 }, config: { prompt: '生成性能测试用例验证优化效果' } },
                { id: 'n6', label: '完成', type: 'end', agentId: '', position: { x: 880, y: 200 }, config: {} }
            ],
            edges: [
                { id: 'e1', source: 'n1', target: 'n3' },
                { id: 'e3', source: 'n3', target: 'n4' },
                { id: 'e4', source: 'n4', target: 'n5' },
                { id: 'e5', source: 'n5', target: 'n6' }
            ]
        },
        // ── 数据库设计 ──
        {
            id: 'wpl-db-design',
            name: '数据库设计',
            category: '代码审查',
            description: 'ER设计 → 建表SQL → 索引优化',
            nodes: [
                { id: 'n1', label: '数据库设计', type: 'start', agentId: '', position: { x: 80, y: 200 }, config: {} },
                { id: 'n3', label: 'ER模型设计', type: 'agent', agentId: '', position: { x: 280, y: 120 }, config: { prompt: '设计实体关系模型，定义表结构和字段' } },
                { id: 'n4', label: '生成建表SQL', type: 'agent', agentId: '', position: { x: 480, y: 60 }, config: { prompt: '生成建表SQL语句，包含约束和默认值' } },
                { id: 'n5', label: '索引优化', type: 'agent', agentId: '', position: { x: 480, y: 220 }, config: { prompt: '分析查询模式，设计索引策略' } },
                { id: 'n6', label: '完成', type: 'end', agentId: '', position: { x: 680, y: 200 }, config: {} }
            ],
            edges: [
                { id: 'e1', source: 'n1', target: 'n3' },
                { id: 'e3', source: 'n3', target: 'n4' },
                { id: 'e4', source: 'n3', target: 'n5' },
                { id: 'e5', source: 'n4', target: 'n6' },
                { id: 'e6', source: 'n5', target: 'n6' }
            ]
        }
    ];
    const CATEGORIES = ['全部', '代码审查', '文档生成', '测试流水线', '内容创作', '部署运维', '数据分析', '安全审计', '多Agent协作', '翻译润色'];
    let activeCategory = '全部';
    let searchQuery = '';
    function getFilteredTemplates() {
        let filtered = BUILTIN_WORKFLOW_TEMPLATES;
        if (activeCategory !== '全部') {
            filtered = filtered.filter(t => t.category === activeCategory);
        }
        if (searchQuery.trim()) {
            const q = searchQuery.trim().toLowerCase();
            filtered = filtered.filter(t => (t.name || '').toLowerCase().includes(q) ||
                (t.description || '').toLowerCase().includes(q) ||
                (t.category || '').toLowerCase().includes(q));
        }
        return filtered;
    }
    function render(containerId) {
        const templates = getFilteredTemplates();
        const container = containerId ? document.getElementById(containerId) : document.getElementById('content');
        if (!container)
            return;
        container.innerHTML = `
      <div class="page-enter">
        <div style="display:flex;gap:8px;margin-bottom:12px;flex-wrap:wrap;align-items:center;">
          <input type="text" id="tpl-search-input" placeholder="搜索模板名称、描述..." value="${escapeHtml(searchQuery)}" style="flex:1;min-width:200px;padding:6px 12px;border:1px solid var(--border-subtle);border-radius:6px;background:var(--bg-deep);color:var(--text-primary);font-size:13px;outline:none;">
          <span id="tpl-count-info" style="font-size:12px;color:var(--text-muted);">共 ${BUILTIN_WORKFLOW_TEMPLATES.length} 个模板，显示 ${templates.length} 个</span>
        </div>
        <div style="display:flex;gap:8px;margin-bottom:16px;flex-wrap:wrap;">
          ${CATEGORIES.map(cat => `
            <button class="btn btn-sm ${activeCategory === cat ? 'btn-primary' : 'btn-secondary'} tpl-cat-btn" data-cat="${cat}">
              ${cat}
            </button>
          `).join('')}
        </div>
        <div id="tpl-results" class="grid-3 stagger">
          ${templates.map(tpl => renderTemplateCard(tpl)).join('')}
        </div>
        ${templates.length === 0 ? `
          <div class="empty-state">
            <div class="empty-icon">${Icon.svg('workflow', 40)}</div>
            <div class="empty-title">暂无模板</div>
            <div class="empty-desc">当前分类下没有可用的模板</div>
          </div>
        ` : ''}
      </div>
    `;
        container.querySelectorAll('.tpl-cat-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                activeCategory = btn.dataset.cat;
                render(containerId);
            });
        });
        const searchInput = document.getElementById('tpl-search-input');
        if (searchInput) {
            let _timer;
            function doSearch(value) {
                searchQuery = value;
                clearTimeout(_timer);
                _timer = setTimeout(() => {
                    const templates = getFilteredTemplates();
                    const resultsEl = document.getElementById('tpl-results');
                    const countInfo = document.getElementById('tpl-count-info');
                    if (resultsEl) {
                        resultsEl.innerHTML = templates.length > 0
                            ? templates.map(tpl => renderTemplateCard(tpl)).join('')
                            : `<div class="empty-state">
                  <div class="empty-icon">${Icon.svg('workflow', 40)}</div>
                  <div class="empty-title">暂无模板</div>
                  <div class="empty-desc">当前分类下没有可用的模板</div>
                 </div>`;
                    }
                    if (countInfo) {
                        countInfo.textContent = `共 ${BUILTIN_WORKFLOW_TEMPLATES.length} 个模板，显示 ${templates.length} 个`;
                    }
                }, 300);
            }
            searchInput.addEventListener('input', (e) => {
                if (e.isComposing)
                    return;
                doSearch(e.target.value);
            });
            searchInput.addEventListener('compositionend', (e) => {
                doSearch(e.target.value || e.data || '');
            });
        }
        container.querySelectorAll('.tpl-use-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                cloneTemplate(btn.dataset.id);
            });
        });
    }
    function renderTemplateCard(tpl) {
        const nodeCount = (tpl.nodes || []).length;
        return `
      <div class="card hover-lift" data-id="${tpl.id}">
        <div class="card-header">
          <div class="card-title">${escapeHtml(tpl.name)}</div>
          <span class="status-badge" style="font-size:11px;padding:2px 8px;background:var(--accent-cyan);color:var(--bg-deep);border-radius:4px;">${escapeHtml(tpl.category)}</span>
        </div>
        <div class="card-body">
          <div style="font-size:12px;color:var(--text-tertiary);margin-bottom:8px;">
            ${escapeHtml(tpl.description)}
          </div>
          <div style="font-size:11px;color:var(--text-muted);font-family:var(--font-mono);">
            ${nodeCount} 个节点
          </div>
        </div>
        <div style="margin-top:12px;">
          <button class="btn btn-sm btn-primary tpl-use-btn" data-id="${tpl.id}">使用模板</button>
        </div>
      </div>
    `;
    }
    function open(onSelect) {
        const templates = BUILTIN_WORKFLOW_TEMPLATES;
        Modal.open({
            title: '工作流模板市场',
            body: `
        <div style="max-height:500px;overflow-y:auto;">
          <div style="display:flex;gap:8px;margin-bottom:12px;flex-wrap:wrap;">
            ${CATEGORIES.map(cat => `
              <button class="btn btn-sm ${activeCategory === cat ? 'btn-primary' : 'btn-secondary'} modal-tpl-cat-btn" data-cat="${cat}">
                ${cat}
              </button>
            `).join('')}
          </div>
          <div class="grid-2" style="gap:8px;">
            ${templates.map(tpl => `
              <div class="card hover-lift modal-tpl-item" data-id="${tpl.id}" style="cursor:pointer;padding:12px;">
                <div style="font-size:13px;font-weight:600;margin-bottom:4px;">${escapeHtml(tpl.name)}</div>
                <div style="font-size:11px;color:var(--text-muted);margin-bottom:4px;">${escapeHtml(tpl.category)}</div>
                <div style="font-size:12px;color:var(--text-tertiary);">${escapeHtml(tpl.description)}</div>
                <div style="font-size:11px;color:var(--text-muted);font-family:var(--font-mono);margin-top:6px;">${(tpl.nodes || []).length} 个节点</div>
              </div>
            `).join('')}
          </div>
        </div>
      `,
            footer: `
        <button class="btn btn-secondary" onclick="Modal.close()">取消</button>
      `,
        });
        document.querySelectorAll('.modal-tpl-cat-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                activeCategory = btn.dataset.cat;
                Modal.close();
                open(onSelect);
            });
        });
        document.querySelectorAll('.modal-tpl-item').forEach(el => {
            el.addEventListener('click', () => {
                const tpl = templates.find(t => t.id === el.dataset.id);
                if (tpl && onSelect) {
                    Modal.close();
                    onSelect(tpl);
                }
            });
        });
    }
    async function cloneTemplate(templateId) {
        const tpl = BUILTIN_WORKFLOW_TEMPLATES.find(t => t.id === templateId);
        if (!tpl) {
            Toast.error('模板不存在');
            return;
        }
        // Show confirmation modal
        const result = await new Promise((resolve) => {
            Modal.open({
                title: '安装模板: ' + tpl.name,
                body: `
          <div class="form-group">
            <label class="form-label">安装确认</label>
            <div style="font-size:12px;color:var(--text-muted);">将安装到当前工作区</div>
          </div>
          <div style="margin-top:12px;">
            <label style="display:flex;align-items:center;gap:8px;cursor:pointer;font-size:13px;">
              <input type="checkbox" id="tpl-install-all-ws"> 同时在所有工作区安装
            </label>
          </div>
        `,
                footer: `
          <button class="btn btn-secondary" id="tpl-scope-cancel">取消</button>
          <button class="btn btn-primary" id="tpl-scope-confirm">确认安装</button>
        `,
            });
            document.getElementById('tpl-scope-cancel').addEventListener('click', () => {
                Modal.close();
                resolve(null);
            });
            document.getElementById('tpl-scope-confirm').addEventListener('click', () => {
                const installAll = document.getElementById('tpl-install-all-ws')?.checked || false;
                Modal.close();
                resolve({ installAll });
            });
        });
        if (!result)
            return;
        try {
            const payload = {
                name: tpl.name,
                description: tpl.description,
                nodes: JSON.parse(JSON.stringify(tpl.nodes)),
                edges: JSON.parse(JSON.stringify(tpl.edges))
            };
            if (result.installAll) {
                await API.createWorkflowInAll(payload);
                Toast.success('模板已安装到所有工作区');
            }
            else {
                const res = await API.createWorkflow(payload);
                Toast.success('模板已安装到当前工作区');
                return res.data;
            }
        }
        catch (e) {
            Toast.error(e.message || '克隆模板失败');
        }
    }
    function escapeHtml(str) {
        const d = document.createElement('div');
        d.textContent = str || '';
        return d.innerHTML;
    }
    return { render, open, cloneTemplate };
})();
