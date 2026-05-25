const { generateId } = require('../utils/id');
const WorkflowModel = require('../models/Workflow');

const BUILTIN_WORKFLOW_TEMPLATES = [
  {
    id: 'wtpl-code-review',
    name: '代码审查流水线',
    category: '代码审查',
    description: '接收代码 → 安全检查 → 代码质量 → 输出报告',
    nodes: [
      { id: 'start', type: 'start', position: { x: 60, y: 200 }, label: '开始' },
      { id: 'security', type: 'agent', position: { x: 300, y: 100 }, label: '安全检查', skillNames: ['安全审查', '密钥检测'], config: { systemPrompt: '审查代码安全问题：1) OWASP Top 10 漏洞（注入、XSS、认证缺陷）；2) 敏感数据泄露（密钥硬编码、日志打印密码）；3) 权限校验缺失；4) 依赖库已知漏洞。按严重度分级输出，使用 write_to_file 保存 security-report.md。', model: 'sonnet' } },
      { id: 'quality', type: 'agent', position: { x: 300, y: 300 }, label: '代码质量', skillNames: ['代码审查', '调试诊断'], config: { systemPrompt: '审查代码质量：1) 命名规范和代码风格；2) 函数复杂度（过长、嵌套过深）；3) 重复代码和可复用性；4) 错误处理完整性；5) 测试覆盖率评估。给出具体行号和修改建议，使用 write_to_file 保存 quality-report.md。', model: 'sonnet' } },
      { id: 'end', type: 'end', position: { x: 540, y: 200 }, label: '结束' }
    ],
    edges: [
      { id: 'e1', source: 'start', target: 'security' },
      { id: 'e2', source: 'start', target: 'quality' },
      { id: 'e3', source: 'security', target: 'end' },
      { id: 'e4', source: 'quality', target: 'end' }
    ],
    isBuiltin: true
  },
  {
    id: 'wtpl-project-init',
    name: '项目初始化流水线',
    category: '项目管理',
    description: '创建项目结构 → 配置依赖 → 设置 CI/CD → 文档初始化',
    nodes: [
      { id: 'start', type: 'start', position: { x: 60, y: 200 }, label: '开始' },
      { id: 'scaffold', skillNames: ["代码生成"], type: 'agent', position: { x: 250, y: 200 }, label: '创建项目结构', skillNames: ["代码生成"], config: { systemPrompt: '根据用户需求创建项目目录结构：1) 创建标准目录（src/、tests/、docs/、config/）；2) 生成 package.json 含常用 scripts；3) 创建 .gitignore 模板；4) 创建 README.md 骨架。使用 write_to_file 保存所有文件。', model: 'sonnet' } },
      { id: 'deps', skillNames: ["依赖管理","配置管理"], type: 'agent', position: { x: 440, y: 200 }, label: '配置依赖', skillNames: ["依赖管理","配置管理"], config: { systemPrompt: '根据项目类型配置依赖：1) 读取上游的项目结构；2) 安装核心依赖包到 package.json；3) 安装开发依赖（格式、测试、类型检查）；4) 添加配置文件（ESLint、Prettier、tsconfig 等）。输出安装清单和版本说明。', model: 'sonnet' } },
      { id: 'cicd', skillNames: ["自动部署","Git操作"], type: 'agent', position: { x: 630, y: 200 }, label: '设置 CI/CD', skillNames: ["自动部署","Git操作"], config: { systemPrompt: '配置 CI/CD 流水线：1) 选择适合项目类型的 CI 平台（GitHub Actions 或 GitLab CI）；2) 编写配置实现：安装→构建→测试→部署；3) 添加代码质量检查步骤；4) 配置缓存策略加速构建。使用 write_to_file 保存 CI 配置文件。', model: 'haiku' } },
      { id: 'docs', skillNames: ["Markdown处理"], type: 'agent', position: { x: 820, y: 200 }, label: '文档初始化', config: { systemPrompt: '生成项目文档：1) 完善 README（安装、使用、配置、贡献指南）；2) 编写 CONTRIBUTING.md；3) 添加 CHANGELOG.md；4) 如有 API 则添加基本 API 文档。使用 write_to_file 保存所有文档。', model: 'haiku' } },
      { id: 'end', type: 'end', position: { x: 1010, y: 200 }, label: '结束' }
    ],
    edges: [
      { id: 'e1', source: 'start', target: 'scaffold' },
      { id: 'e2', source: 'scaffold', target: 'deps' },
      { id: 'e3', source: 'deps', target: 'cicd' },
      { id: 'e4', source: 'cicd', target: 'docs' },
      { id: 'e5', source: 'docs', target: 'end' }
    ],
    isBuiltin: true
  },
  {
    id: 'wtpl-doc-gen',
    name: '文档生成流水线',
    category: '文档',
    description: '收集需求 → 生成文档 → 审查 → 发布',
    nodes: [
      { id: 'start', type: 'start', position: { x: 60, y: 200 }, label: '开始' },
      { id: 'collect', skillNames: ["网络搜索"], type: 'agent', position: { x: 250, y: 200 }, label: '收集需求', skillNames: ["网络搜索"], config: { systemPrompt: '收集文档需求：1) 读取项目代码和现有文档；2) 确定文档类型（README/API/用户手册/架构文档）；3) 列出需要覆盖的模块和接口；4) 确定文档结构和章节大纲。使用 write_to_file 保存 doc-plan.md。', model: 'sonnet' } },
      { id: 'generate', skillNames: ["Markdown处理","Word文档"], type: 'agent', position: { x: 440, y: 200 }, label: '生成文档', skillNames: ["Markdown处理","Word文档"], config: { systemPrompt: '根据文档计划生成完整文档：1) 按大纲逐章节编写；2) 代码示例必须可运行；3) 表格展示参数和配置项；4) 添加图表描述（文本方式）；5) 交叉引用和链接。使用 write_to_file 保存所有文档文件。', model: 'opus' } },
      { id: 'review', type: 'agent', position: { x: 630, y: 200 }, label: '文档审查', skillNames: ["代码审查"], config: { systemPrompt: '审查生成的文档质量：1) 内容准确性（与代码一致）；2) 结构完整性和逻辑连贯性；3) 排版和格式规范；4) 示例代码正确性；5) 拼写和语法检查。按问题严重度列出修改建议，使用 write_to_file 保存 review-notes.md。', model: 'sonnet' } },
      { id: 'publish', skillNames: ["Markdown处理"], type: 'agent', position: { x: 820, y: 200 }, label: '发布', config: { systemPrompt: '根据审查反馈修正文档并准备发布：1) 逐一处理审查意见；2) 更新版本号和日期；3) 确认所有交叉引用有效；4) 生成最终文件清单。使用 write_to_file 保存最终版本文档。', model: 'haiku' } },
      { id: 'end', type: 'end', position: { x: 1010, y: 200 }, label: '结束' }
    ],
    edges: [
      { id: 'e1', source: 'start', target: 'collect' },
      { id: 'e2', source: 'collect', target: 'generate' },
      { id: 'e3', source: 'generate', target: 'review' },
      { id: 'e4', source: 'review', target: 'publish' },
      { id: 'e5', source: 'publish', target: 'end' }
    ],
    isBuiltin: true
  },
  {
    id: 'wtpl-bug-fix',
    name: 'Bug 修复流水线',
    category: '代码审查',
    description: '问题复现 → 根因分析 → 修复 → 回归测试',
    nodes: [
      { id: 'start', type: 'start', position: { x: 60, y: 200 }, label: '开始' },
      { id: 'reproduce', skillNames: ["调试诊断"], type: 'agent', position: { x: 250, y: 200 }, label: '问题复现', skillNames: ["调试诊断"], config: { systemPrompt: '尝试复现 Bug：1) 根据错误描述构建复现环境；2) 记录复现步骤和必要条件；3) 确认 Bug 的实际表现；4) 最小化复现用例。输出复现报告含步骤、截图描述、成功复现确认。使用 write_to_file 保存 reproduce-report.md。', model: 'sonnet' } },
      { id: 'analyze', skillNames: ["调试诊断","日志分析"], type: 'agent', position: { x: 440, y: 200 }, label: '根因分析', skillNames: ["调试诊断","日志分析"], config: { systemPrompt: '分析 Bug 根因：1) 阅读相关代码和复现报告；2) 使用调试方法定位问题代码；3) 分析为什么现有测试没发现；4) 确认影响范围（哪些功能受影响）。输出根因分析报告含问题代码位置和逻辑缺陷说明。使用 write_to_file 保存 root-cause.md。', model: 'opus' } },
      { id: 'fix', skillNames: ["代码生成","测试生成"], type: 'agent', position: { x: 630, y: 200 }, label: '代码修复', config: { systemPrompt: '实施修复：1) 根据根因分析编写修复代码；2) 确保不引入新问题；3) 添加或更新相关测试用例；4) 标注修复的核心改动点。使用 write_to_file 保存修复后的源文件和修复说明。', model: 'sonnet' } },
      { id: 'regression', skillNames: ["测试生成"], type: 'agent', position: { x: 820, y: 200 }, label: '回归测试', config: { systemPrompt: '执行回归测试：1) 验证原始 Bug 已修复；2) 运行完整测试套件确保无回归；3) 测试边缘情况；4) 验证修复不影响其他模块。输出测试报告含通过/失败结果和覆盖率。使用 write_to_file 保存 regression-report.md。', model: 'haiku' } },
      { id: 'end', type: 'end', position: { x: 1010, y: 200 }, label: '结束' }
    ],
    edges: [
      { id: 'e1', source: 'start', target: 'reproduce' },
      { id: 'e2', source: 'reproduce', target: 'analyze' },
      { id: 'e3', source: 'analyze', target: 'fix' },
      { id: 'e4', source: 'fix', target: 'regression' },
      { id: 'e5', source: 'regression', target: 'end' }
    ],
    isBuiltin: true
  },
  {
    id: 'wtpl-content-creation',
    name: '内容创作流水线',
    category: '内容',
    description: '主题研究 → 大纲设计 → 内容撰写 → 审校发布',
    nodes: [
      { id: 'start', type: 'start', position: { x: 60, y: 200 }, label: '开始' },
      { id: 'research', skillNames: ["网络搜索"], type: 'agent', position: { x: 250, y: 200 }, label: '主题研究', skillNames: ["网络搜索"], config: { systemPrompt: '研究指定主题：1) 搜索相关资料和权威来源；2) 提取关键观点和数据；3) 整理不同观点的对比；4) 确定内容的核心论点。使用 write_to_file 保存 research-notes.md。', model: 'sonnet' } },
      { id: 'outline', type: 'agent', position: { x: 440, y: 200 }, label: '大纲设计', config: { systemPrompt: '基于研究设计内容大纲：1) 确定文章结构和章节划分；2) 每章标注核心观点和支撑论据；3) 规划段落长度和重点分布；4) 设计引人入胜的开头和有力的结尾。使用 write_to_file 保存 content-outline.md。', model: 'opus' } },
      { id: 'write', skillNames: ["Markdown处理"], type: 'agent', position: { x: 630, y: 200 }, label: '内容撰写', skillNames: ["Markdown处理"], config: { systemPrompt: '根据大纲撰写完整内容：1) 按章节逐一撰写；2) 使用具体案例和数据支撑；3) 语言风格适应目标读者；4) 每个章节末尾设置过渡。使用 write_to_file 保存 draft-content.md。', model: 'sonnet' } },
      { id: 'review', type: 'agent', position: { x: 820, y: 200 }, label: '审校发布', config: { systemPrompt: '审校并最终定稿：1) 检查事实准确性和数据来源；2) 优化语言流畅度和可读性；3) 统一术语和风格；4) 添加标题层级和排版优化。使用 write_to_file 保存 final-content.md。', model: 'sonnet' } },
      { id: 'end', type: 'end', position: { x: 1010, y: 200 }, label: '结束' }
    ],
    edges: [
      { id: 'e1', source: 'start', target: 'research' },
      { id: 'e2', source: 'research', target: 'outline' },
      { id: 'e3', source: 'outline', target: 'write' },
      { id: 'e4', source: 'write', target: 'review' },
      { id: 'e5', source: 'review', target: 'end' }
    ],
    isBuiltin: true
  },
  {
    id: 'tpl-data-analysis',
    name: '数据分析流水线',
    category: '数据',
    description: '数据收集、清洗、分析、可视化报告',
    nodes: [
      { id: 'n1', label: '开始', type: 'start', position: { x: 60, y: 200 } },
      { id: 'n2', label: '数据收集', skillNames: ["网络搜索","CSV处理"], type: 'agent', position: { x: 250, y: 100 }, config: { systemPrompt: '你是一个数据采集专家。根据用户指定的数据源和需求，使用 WebSearch 和 WebFetch 工具搜集相关数据，或使用 Read/Glob 工具读取本地文件。将收集到的原始数据整理成 JSON 或 CSV 格式，使用 writeFile 保存为 collected-data.json。输出应包含数据来源、采集时间、数据条数概要。', model: 'sonnet' } },
      { id: 'n3', label: '数据清洗', skillNames: ["CSV处理","数据分析"], type: 'agent', position: { x: 250, y: 300 }, config: { systemPrompt: '你是一个数据清洗专家。读取上游收集的原始数据，执行以下操作：1) 填充或删除缺失值，标注处理方式；2) 检测并处理异常值（使用统计方法如 Z-score）；3) 统一数据格式（日期、数值、编码）；4) 去除重复记录。使用 writeFile 保存清洗后的数据为 cleaned-data.json，附带清洗日志。', model: 'haiku' } },
      { id: 'n4', label: '数据分析', skillNames: ["数据分析"], type: 'agent', position: { x: 440, y: 200 }, config: { systemPrompt: '你是一个数据分析专家。读取清洗后的数据，执行以下分析：1) 计算关键统计指标（均值、中位数、分布）；2) 识别趋势和模式；3) 发现显著关联或异常；4) 提取核心洞察。使用 writeFile 保存分析结果为 analysis-report.md，包含数据概览、关键指标、趋势描述和结论。', model: 'opus' } },
      { id: 'n5', label: '生成报告', skillNames: ["Markdown处理","数据分析"], type: 'agent', position: { x: 630, y: 200 }, config: { systemPrompt: '你是一个报告撰写专家。基于上游的分析结果，生成一份完整的数据分析报告。报告应包含：1) 执行摘要（关键发现）；2) 数据来源和方法说明；3) 分析结果详情（含数据表格）；4) 结论和建议。使用 Markdown 格式，结构清晰，用 writeFile 保存为 data-analysis-report.md。', model: 'sonnet' } },
      { id: 'n6', label: '结束', type: 'end', position: { x: 820, y: 200 } }
    ],
    edges: [
      { id: 'e1', source: 'n1', target: 'n2' },
      { id: 'e2', source: 'n1', target: 'n3' },
      { id: 'e3', source: 'n2', target: 'n4' },
      { id: 'e4', source: 'n3', target: 'n4' },
      { id: 'e5', source: 'n4', target: 'n5' },
      { id: 'e6', source: 'n5', target: 'n6' }
    ],
    isBuiltin: true
  },
  {
    id: 'tpl-research',
    name: '研究调研流水线',
    category: '研究',
    description: '文献搜集、整理、分析、综述生成',
    nodes: [
      { id: 'n1', label: '开始', type: 'start', position: { x: 60, y: 200 } },
      { id: 'n2', label: '文献搜集', skillNames: ["网络搜索"], type: 'agent', position: { x: 250, y: 200 }, config: { systemPrompt: '你是一个文献检索专家。根据用户提供的研究主题，使用 WebSearch 和 WebFetch 工具搜索学术论文、技术报告、权威资料。重点关注：1) 近3年的最新研究；2) 高引用率的核心论文；3) 不同观点的代表性文献。将搜集结果整理为文献清单（包含标题、作者、年份、来源、摘要），使用 writeFile 保存为 literature-list.json。', model: 'sonnet' } },
      { id: 'n3', label: '文献整理', type: 'agent', position: { x: 440, y: 200 }, config: { systemPrompt: '你是一个文献分析专家。读取上游搜集的文献清单，逐篇提取关键信息：1) 研究方法和实验设计；2) 核心结论和数据支撑；3) 与其他文献的关联和对比；4) 局限性和争议点。按主题分类整理，标注引用关系。使用 writeFile 保存为 literature-analysis.md，包含分类摘要和引用矩阵。', model: 'sonnet' } },
      { id: 'n4', label: '生成综述', skillNames: ["Markdown处理"], type: 'agent', position: { x: 630, y: 200 }, config: { systemPrompt: '你是一个学术写作专家。基于上游的文献分析结果，撰写一份完整的研究综述报告。结构要求：1) 引言（研究背景和意义）；2) 研究现状（按主题分类梳理）；3) 主要发现和争议；4) 研究空白和未来方向；5) 参考文献。语言学术规范，逻辑连贯，使用 writeFile 保存为 research-review.md。', model: 'opus' } },
      { id: 'n5', label: '结束', type: 'end', position: { x: 820, y: 200 } }
    ],
    edges: [
      { id: 'e1', source: 'n1', target: 'n2' },
      { id: 'e2', source: 'n2', target: 'n3' },
      { id: 'e3', source: 'n3', target: 'n4' },
      { id: 'e4', source: 'n4', target: 'n5' }
    ],
    isBuiltin: true
  },
  {
    id: 'tpl-learning',
    name: '学习笔记流水线',
    category: '学习',
    description: '阅读材料、整理笔记、生成复习卡片',
    nodes: [
      { id: 'n1', label: '开始', type: 'start', position: { x: 60, y: 200 } },
      { id: 'n2', label: '阅读材料', type: 'agent', position: { x: 250, y: 200 }, config: { systemPrompt: '你是一个学习分析专家。使用 Read 工具阅读用户提供的学习材料，逐章节提取：1) 核心概念和定义；2) 关键公式和推导；3) 重要案例和例题；4) 易错点和注意事项。按逻辑顺序整理，标注概念层级关系。使用 writeFile 保存为 key-points.md。', model: 'sonnet' } },
      { id: 'n3', label: '整理笔记', skillNames: ["Markdown处理"], type: 'agent', position: { x: 440, y: 200 }, config: { systemPrompt: '你是一个笔记整理专家。读取上游提取的知识点，将其重组为结构化学习笔记：1) 概念解释配通俗类比；2) 知识脉络图（前后概念如何衔接）；3) 对比表格（易混淆概念区分）；4) 每章节总结一句话要点。使用 Markdown 格式，层级清晰，使用 writeFile 保存为 study-notes.md。', model: 'haiku' } },
      { id: 'n4', label: '生成复习卡片', skillNames: ["JSON处理"], type: 'agent', position: { x: 630, y: 200 }, config: { systemPrompt: '你是一个复习设计专家。基于学习笔记，为每个核心概念生成问答复习卡片：1) 正面：简洁问题或关键词提示；2) 背面：完整答案和补充说明；3) 按难度分级（基础/中等/进阶）；4) 包含记忆技巧和常见误答提示。使用 writeFile 保存为 flashcards.json，格式为数组对象 [{question, answer, difficulty, hint}]。', model: 'haiku' } },
      { id: 'n5', label: '结束', type: 'end', position: { x: 820, y: 200 } }
    ],
    edges: [
      { id: 'e1', source: 'n1', target: 'n2' },
      { id: 'e2', source: 'n2', target: 'n3' },
      { id: 'e3', source: 'n3', target: 'n4' },
      { id: 'e4', source: 'n4', target: 'n5' }
    ],
    isBuiltin: true
  },
  {
    id: 'tpl-meeting',
    name: '会议纪要流水线',
    category: '办公',
    description: '会议录音转写、整理纪要、生成待办',
    nodes: [
      { id: 'n1', label: '开始', type: 'start', position: { x: 60, y: 200 } },
      { id: 'n2', label: '转写内容', type: 'agent', position: { x: 250, y: 200 }, config: { systemPrompt: '你是一个内容转写专家。将用户提供的会议录音文字或会议记录整理为结构化内容：1) 按议题分段，标注每个议题的时间跨度；2) 提取各议题下的讨论要点和关键发言；3) 标注发言人与观点对应关系；4) 过滤口语化表达，保留实质内容。使用 writeFile 保存为 meeting-raw.md。', model: 'haiku' } },
      { id: 'n3', label: '生成纪要', skillNames: ["Markdown处理"], type: 'agent', position: { x: 440, y: 200 }, config: { systemPrompt: '你是一个会议纪要撰写专家。基于上游转写的结构化内容，生成正式会议纪要：1) 会议基本信息（时间、参会人、议题）；2) 各议题讨论摘要（核心观点、分歧点）；3) 达成的决议和共识；4) 待讨论事项。语言简练正式，使用 writeFile 保存为 meeting-minutes.md。', model: 'sonnet' } },
      { id: 'n4', label: '提取待办', skillNames: ["JSON处理"], type: 'agent', position: { x: 630, y: 200 }, config: { systemPrompt: '你是一个任务提取专家。从会议纪要中提取所有待办事项：1) 每个待办包含任务描述、负责人、截止时间（如有）；2) 按优先级排序（紧急→一般→待定）；3) 标注待办间的依赖关系；4) 识别未明确负责人的事项并标注。使用 writeFile 保存为 action-items.json，格式为数组对象 [{task, owner, deadline, priority, dependsOn}]。', model: 'haiku' } },
      { id: 'n5', label: '结束', type: 'end', position: { x: 820, y: 200 } }
    ],
    edges: [
      { id: 'e1', source: 'n1', target: 'n2' },
      { id: 'e2', source: 'n2', target: 'n3' },
      { id: 'e3', source: 'n3', target: 'n4' },
      { id: 'e4', source: 'n4', target: 'n5' }
    ],
    isBuiltin: true
  },
  {
    id: 'tpl-translate',
    name: '翻译润色流水线',
    category: '翻译',
    description: '翻译、校对、润色多语言内容',
    nodes: [
      { id: 'n1', label: '开始', type: 'start', position: { x: 60, y: 200 } },
      { id: 'n2', label: '初次翻译', skillNames: ["Markdown处理"], type: 'agent', position: { x: 250, y: 200 }, config: { systemPrompt: '你是一个专业翻译。将用户提供的源文本翻译为目标语言。要求：1) 保持原文语义和语气；2) 专业术语准确翻译，必要时保留原文标注；3) 文化差异处做适当本地化适配；4) 长句适当拆分以符合目标语言习惯。使用 writeFile 保存为 draft-translation.md。', model: 'sonnet' } },
      { id: 'n3', label: '校对修正', skillNames: ["代码审查"], type: 'agent', position: { x: 440, y: 200 }, config: { systemPrompt: '你是一个翻译校对专家。对比源文本和初译文本，逐段检查：1) 语义偏差或遗漏；2) 专业术语翻译错误；3) 语法和拼写错误；4) 文化适配不当处。列出所有问题及修正建议，然后将修正后的全文整合。使用 writeFile 保存为 corrected-translation.md。', model: 'sonnet' } },
      { id: 'n4', label: '润色优化', skillNames: ["Markdown处理"], type: 'agent', position: { x: 630, y: 200 }, config: { systemPrompt: '你是一个语言润色专家。对校对后的译文进行最终润色：1) 优化句式使其更自然流畅；2) 统一全文风格和用词；3) 消除翻译腔（生硬表达、冗余用词）；4) 确保术语前后一致。最终译文应读起来像目标语言的原创文本。使用 writeFile 保存为 final-translation.md。', model: 'opus' } },
      { id: 'n5', label: '结束', type: 'end', position: { x: 820, y: 200 } }
    ],
    edges: [
      { id: 'e1', source: 'n1', target: 'n2' },
      { id: 'e2', source: 'n2', target: 'n3' },
      { id: 'e3', source: 'n3', target: 'n4' },
      { id: 'e4', source: 'n4', target: 'n5' }
    ],
    isBuiltin: true
  },
  {
    id: 'tpl-api-design',
    name: 'API 设计流水线',
    category: '开发',
    description: '需求分析、API 设计、文档生成、Mock 服务',
    nodes: [
      { id: 'n1', label: '开始', type: 'start', position: { x: 60, y: 200 } },
      { id: 'n2', label: '需求分析', skillNames: ["代码审查","测试生成"], type: 'agent', position: { x: 250, y: 100 }, config: { systemPrompt: '你是一个需求分析专家。根据用户描述的 API 需求，分析并定义：1) 目标用户和使用场景；2) 核心功能列表和优先级；3) 数据模型和实体关系；4) 非功能需求（性能、安全、兼容性）。输出结构化的需求文档，使用 writeFile 保存为 api-requirements.md。', model: 'sonnet' } },
      { id: 'n3', label: 'API 设计', skillNames: ["API开发"], type: 'agent', position: { x: 440, y: 100 }, config: { systemPrompt: '你是一个 API 设计专家。基于需求文档，设计 RESTful API：1) 定义所有接口路径和方法（GET/POST/PUT/DELETE）；2) 每个接口的请求参数和响应格式（含示例 JSON）；3) 认证方式和错误码体系；4) 版本管理策略。使用 writeFile 保存为 api-design.md，包含完整的接口清单。', model: 'opus' } },
      { id: 'n4', label: '生成文档', type: 'agent', position: { x: 630, y: 100 }, config: { systemPrompt: '你是一个文档撰写专家。基于 API 设计，生成完整的 API 文档：1) 接口概述和认证说明；2) 每个接口的详细描述（路径、方法、参数、响应、示例）；3) 错误处理和状态码说明；4) 快速入门指南。使用 Markdown 格式，结构清晰，使用 writeFile 保存为 api-documentation.md。', model: 'sonnet' } },
      { id: 'n5', label: '生成 Mock', skillNames: ["代码生成"], type: 'agent', position: { x: 630, y: 300 }, config: { systemPrompt: '你是一个 Mock 服务开发专家。基于 API 设计，生成 Mock 服务代码：1) 使用 Express.js 实现所有接口的模拟响应；2) 每个接口返回合理的示例数据；3) 支持基本参数校验；4) 包含启动脚本和说明。使用 writeFile 保存为 mock-server.js。', model: 'sonnet' } },
      { id: 'n6', label: '结束', type: 'end', position: { x: 820, y: 200 } }
    ],
    edges: [
      { id: 'e1', source: 'n1', target: 'n2' },
      { id: 'e2', source: 'n2', target: 'n3' },
      { id: 'e3', source: 'n3', target: 'n4' },
      { id: 'e4', source: 'n3', target: 'n5' },
      { id: 'e5', source: 'n4', target: 'n6' },
      { id: 'e6', source: 'n5', target: 'n6' }
    ],
    isBuiltin: true
  },
  {
    id: 'tpl-content-marketing',
    name: '内容营销流水线',
    category: '营销',
    description: '市场调研、内容策划、创作、多平台发布',
    nodes: [
      { id: 'n1', label: '开始', type: 'start', position: { x: 60, y: 200 } },
      { id: 'n2', label: '市场调研', skillNames: ["网络搜索"], type: 'agent', position: { x: 250, y: 200 }, config: { systemPrompt: '你是一个市场调研专家。使用 WebSearch 和 WebFetch 工具调研目标市场：1) 目标受众画像（人口统计、兴趣偏好）；2) 主要竞品分析和差异化机会；3) 市场趋势和增长数据；4) 用户痛点和未被满足的需求。将调研结果整理为结构化报告，使用 writeFile 保存为 market-research.md。', model: 'sonnet' } },
      { id: 'n3', label: '内容策划', type: 'agent', position: { x: 440, y: 200 }, config: { systemPrompt: '你是一个内容策划专家。基于市场调研结果，制定内容策略：1) 内容主题矩阵（3-5个核心主题，每个2-3个子话题）；2) 内容形式规划（文章/视频/图文等）；3) 发布节奏和时间线；4) SEO关键词和标题建议。使用 writeFile 保存为 content-plan.md，包含主题清单和发布排期。', model: 'opus' } },
      { id: 'n4', label: '内容创作', type: 'agent', position: { x: 630, y: 200 }, config: { systemPrompt: '你是一个内容创作专家。根据内容策划方案，创作具体的营销内容：1) 撰写吸引人的标题和开头；2) 正文内容结构化、有干货支撑；3) 嵌入调研数据和案例增强说服力；4) 结尾包含行动号召（CTA）。使用 writeFile 保存为 marketing-content.md。', model: 'sonnet' } },
      { id: 'n5', label: '结束', type: 'end', position: { x: 820, y: 200 } }
    ],
    edges: [
      { id: 'e1', source: 'n1', target: 'n2' },
      { id: 'e2', source: 'n2', target: 'n3' },
      { id: 'e3', source: 'n3', target: 'n4' },
      { id: 'e4', source: 'n4', target: 'n5' }
    ],
    isBuiltin: true
  },
  {
    id: 'tpl-multi-agent-dev',
    name: '多Agent协作开发',
    category: '开发',
    description: '需求分析 → 前后端并行开发 → 合并测试 → 部署',
    nodes: [
      { id: 'n1', label: '开始', type: 'start', position: { x: 60, y: 200 } },
      { id: 'n2', label: '需求分析与分工', skillNames: ["代码审查"], type: 'agent', position: { x: 250, y: 200 }, config: { systemPrompt: '你是一个技术负责人。分析用户需求并拆分为前后端任务：1) 前端任务清单（UI组件、页面交互、状态管理）；2) 后端任务清单（API设计、数据处理、数据库）；3) 接口约定（数据格式、API路径、认证方式）；4) 开发优先级和依赖关系。使用 writeFile 保存为 task-breakdown.md。', model: 'opus' } },
      { id: 'n3', label: '并行处理', type: 'parallel', position: { x: 440, y: 200 } },
      { id: 'n4', label: '前端开发', skillNames: ["Frontend Design","网页设计规范"], type: 'agent', position: { x: 630, y: 100 }, config: { systemPrompt: '你是一个前端开发专家。根据需求分析和接口约定：1) 实现所有页面组件和交互逻辑；2) 对接后端API接口（使用约定格式）；3) 处理加载、错误、空数据等状态；4) 遵循项目现有代码风格。使用 writeFile 将所有代码保存为对应的源文件。', model: 'sonnet' } },
      { id: 'n5', label: '后端开发', skillNames: ["API开发","SQL操作"], type: 'agent', position: { x: 630, y: 300 }, config: { systemPrompt: '你是一个后端开发专家。根据需求分析和接口约定：1) 实现所有API接口和业务逻辑；2) 设计数据模型和数据库操作；3) 添加参数校验和错误处理；4) 遵循项目现有代码风格。使用 writeFile 将所有代码保存为对应的源文件。', model: 'sonnet' } },
      { id: 'n6', label: '合并测试', skillNames: ["测试生成"], type: 'agent', position: { x: 820, y: 200 }, config: { systemPrompt: '你是一个测试专家。读取前后端代码，验证功能完整性：1) 检查API接口是否与前端对接一致；2) 检查数据流是否正确；3) 评估边界情况和错误处理；4) 输出测试报告（通过项和问题项）。如果发现问题，提供修复建议。使用 writeFile 保存为 integration-test-report.md。', model: 'haiku' } },
      { id: 'n7', label: '结束', type: 'end', position: { x: 1010, y: 200 } }
    ],
    edges: [
      { id: 'e1', source: 'n1', target: 'n2' },
      { id: 'e2', source: 'n2', target: 'n3' },
      { id: 'e3', source: 'n3', target: 'n4' },
      { id: 'e4', source: 'n3', target: 'n5' },
      { id: 'e5', source: 'n4', target: 'n6' },
      { id: 'e6', source: 'n5', target: 'n6' },
      { id: 'e7', source: 'n6', target: 'n7' }
    ],
    isBuiltin: true
  },
  {
    id: 'tpl-security-audit',
    name: '安全审计流水线',
    category: '安全',
    description: '代码扫描 → 漏洞分析 → 风险评估 → 审核 → 修复建议',
    nodes: [
      { id: 'n1', label: '开始', type: 'start', position: { x: 60, y: 200 } },
      { id: 'n2', label: '代码安全扫描', skillNames: ["安全审查"], type: 'agent', position: { x: 250, y: 200 }, config: { systemPrompt: '你是一个代码安全扫描专家。逐文件审查项目代码，识别安全问题：1) SQL注入、XSS、CSRF等常见漏洞；2) 不安全的加密实现、硬编码密钥；3) 路径遍历和文件包含风险；4) 不安全的第三方依赖。对每个问题标注严重级别（严重/高/中/低）。使用 writeFile 保存为 security-scan-results.json。', model: 'sonnet' } },
      { id: 'n3', label: '漏洞深度分析', skillNames: ["安全审查","调试诊断"], type: 'agent', position: { x: 440, y: 200 }, config: { systemPrompt: '你是一个安全分析专家。对扫描发现的问题进行深度分析：1) 确认漏洞可利用性（exploitability）；2) 评估影响范围（数据泄露、系统控制权等）；3) 分析根因（是设计缺陷还是编码失误）；4) 根据CVSS标准评分。使用 writeFile 保存为 vulnerability-analysis.md。', model: 'opus' } },
      { id: 'n4', label: '风险评估', skillNames: ["安全审查"], type: 'agent', position: { x: 630, y: 200 }, config: { systemPrompt: '你是一个风险评估专家。综合分析结果，生成风险报告：1) 风险矩阵（可能性×影响程度）；2) 修复优先级排序；3) 业务影响量化评估；4) 合规性检查（OWASP Top 10、GDPR等）。使用 writeFile 保存为 risk-assessment-report.md。', model: 'sonnet' } },
      { id: 'n5', label: '安全审核', type: 'approval', position: { x: 820, y: 200 }, config: { approvalTitle: '安全审核确认', approvalDescription: '请审核安全审计结果，确认是否接受风险等级评估', timeout: 7200 } },
      { id: 'n6', label: '生成修复方案', skillNames: ["代码生成"], type: 'agent', position: { x: 1010, y: 200 }, config: { systemPrompt: '你是一个安全修复专家。根据审核通过的安全报告，制定修复方案：1) 每个漏洞的具体修复代码；2) 预防同类问题的编码规范；3) 安全加固建议（WAF、日志监控等）；4) 修复验证方法。使用 writeFile 保存为 security-fix-plan.md。', model: 'sonnet' } },
      { id: 'n7', label: '结束', type: 'end', position: { x: 1200, y: 200 } }
    ],
    edges: [
      { id: 'e1', source: 'n1', target: 'n2' },
      { id: 'e2', source: 'n2', target: 'n3' },
      { id: 'e3', source: 'n3', target: 'n4' },
      { id: 'e4', source: 'n4', target: 'n5' },
      { id: 'e5', source: 'n5', target: 'n6', label: 'true' },
      { id: 'e6', source: 'n6', target: 'n7' }
    ],
    isBuiltin: true
  },
  {
    id: 'tpl-cicd-pipeline',
    name: 'CI/CD 流水线',
    category: '开发',
    description: '代码构建、测试、发布、通知全流程',
    nodes: [
      { id: 'n1', label: '开始', type: 'start', position: { x: 60, y: 200 } },
      { id: 'n2', label: '构建编译', skillNames: ["自动部署"], type: 'agent', position: { x: 250, y: 200 }, config: { systemPrompt: '你是一个构建工程师。执行项目构建流程：1) 检查依赖是否完整安装；2) 执行编译/构建命令；3) 检查构建产物完整性；4) 记录构建日志和性能指标（耗时、产物大小）。使用 writeFile 保存为 build-log.json。', model: 'haiku' } },
      { id: 'n3', label: '单元测试', skillNames: ["测试生成"], type: 'agent', position: { x: 440, y: 100 }, config: { systemPrompt: '你是一个测试工程师（单元测试）。运行项目的单元测试：1) 执行所有单元测试用例；2) 统计通过率和覆盖率；3) 分析失败用例的原因；4) 标注可能被忽略的关键逻辑。使用 writeFile 保存为 unit-test-results.md。', model: 'haiku' } },
      { id: 'n4', label: '集成测试', skillNames: ["测试生成"], type: 'agent', position: { x: 440, y: 300 }, config: { systemPrompt: '你是一个测试工程师（集成测试）。运行项目的集成测试：1) 执行所有集成测试用例；2) 验证各模块间API交互正确；3) 检查数据一致性；4) 评估端到端流程完整性。使用 writeFile 保存为 integration-test-results.md。', model: 'haiku' } },
      { id: 'n5', label: '质量判断', type: 'condition', position: { x: 630, y: 200 }, config: { expression: '$unitTest.output.includes("100%") && $integrationTest.output.includes("通过")' } },
      { id: 'n6', label: '部署发布', skillNames: ["自动部署"], type: 'agent', position: { x: 820, y: 100 }, config: { systemPrompt: '你是一个部署工程师。执行部署发布：1) 准备发布包（版本号、变更日志）；2) 执行部署脚本；3) 验证服务健康状态；4) 记录部署日志。使用 writeFile 保存为 deploy-log.md。', model: 'sonnet' } },
      { id: 'n7', label: '回滚通知', skillNames: ["日志分析"], type: 'agent', position: { x: 820, y: 300 }, config: { systemPrompt: '你是一个运维工程师。测试未通过，需要准备回滚方案：1) 列出失败的测试项及原因；2) 列出可能影响的功能模块；3) 建议修复后的重试步骤；4) 通知相关开发人员。使用 writeFile 保存为 rollback-notice.md。', model: 'haiku' } },
      { id: 'n8', label: '结束', type: 'end', position: { x: 1010, y: 200 } }
    ],
    edges: [
      { id: 'e1', source: 'n1', target: 'n2' },
      { id: 'e2', source: 'n2', target: 'n3' },
      { id: 'e3', source: 'n2', target: 'n4' },
      { id: 'e4', source: 'n3', target: 'n5' },
      { id: 'e5', source: 'n4', target: 'n5' },
      { id: 'e6', source: 'n5', target: 'n6', label: 'true' },
      { id: 'e7', source: 'n5', target: 'n7', label: 'false' },
      { id: 'e8', source: 'n6', target: 'n8' },
      { id: 'e9', source: 'n7', target: 'n8' }
    ],
    isBuiltin: true
  },
  {
    id: 'tpl-customer-support',
    name: '客服工单处理',
    category: '运营',
    description: '工单分类、问题分析、解决方案、客户回复',
    nodes: [
      { id: 'n1', label: '开始', type: 'start', position: { x: 60, y: 200 } },
      { id: 'n2', label: '工单分类', type: 'agent', position: { x: 250, y: 200 }, config: { systemPrompt: '你是一个客服工单分类专家。分析用户提交的工单内容：1) 识别问题类型（技术故障/功能咨询/投诉建议/账户问题）；2) 判断紧急程度（紧急/普通/低优先）；3) 提取关键信息（产品模块、错误信息、用户环境）；4) 历史相似工单关联。使用 writeFile 保存为 ticket-classification.json。', model: 'haiku' } },
      { id: 'n3', label: '问题分析', skillNames: ["调试诊断"], type: 'agent', position: { x: 440, y: 200 }, config: { systemPrompt: '你是一个技术支持专家。深入分析工单问题：1) 根因分析（是用户操作问题还是系统bug）；2) 搜索知识库中相关解决方案；3) 评估解决难度和时间预估；4) 如需开发介入，标记转交开发团队。使用 writeFile 保存为 problem-analysis.md。', model: 'sonnet' } },
      { id: 'n4', label: '编写回复', skillNames: ["Markdown处理"], type: 'agent', position: { x: 630, y: 200 }, config: { systemPrompt: '你是一个客服沟通专家。为客户撰写回复内容：1) 礼貌问候并确认问题；2) 提供清晰的分步解决方案；3) 附上相关文档或截图说明；4) 提供后续跟进方式。语气专业友好，避免技术术语（除非客户是技术人员）。使用 writeFile 保存为 customer-reply.md。', model: 'haiku' } },
      { id: 'n5', label: '结束', type: 'end', position: { x: 820, y: 200 } }
    ],
    edges: [
      { id: 'e1', source: 'n1', target: 'n2' },
      { id: 'e2', source: 'n2', target: 'n3' },
      { id: 'e3', source: 'n3', target: 'n4' },
      { id: 'e4', source: 'n4', target: 'n5' }
    ],
    isBuiltin: true
  },
  {
    id: 'tpl-database-migration',
    name: '数据库迁移流水线',
    category: '数据',
    description: '迁移分析、脚本生成、测试验证、备份回滚',
    nodes: [
      { id: 'n1', label: '开始', type: 'start', position: { x: 60, y: 200 } },
      { id: 'n2', label: '迁移分析', skillNames: ["数据分析"], type: 'agent', position: { x: 250, y: 200 }, config: { systemPrompt: '你是一个数据库分析专家。分析数据库迁移需求：1) 对比源和目标数据库结构（表、字段、索引）；2) 识别数据类型映射和兼容性问题；3) 分析数据量和迁移时间预估；4) 标注潜在风险点（外键约束、触发器等）。使用 writeFile 保存为 migration-analysis.md。', model: 'sonnet' } },
      { id: 'n3', label: '生成迁移脚本', skillNames: ["SQL操作","数据迁移"], type: 'agent', position: { x: 440, y: 200 }, config: { systemPrompt: '你是一个数据库开发专家。根据迁移分析生成迁移脚本：1) DDL脚本（建表、索引、约束）；2) DML脚本（数据迁移、转换、清洗）；3) 回滚脚本（失败恢复）；4) 验证脚本（数据完整性检查）。每个脚本独立文件，使用 writeFile 保存。', model: 'opus' } },
      { id: 'n4', label: '脚本审核', skillNames: ["代码审查"], type: 'agent', position: { x: 630, y: 200 }, config: { systemPrompt: '你是一个数据库审核专家。审核迁移脚本：1) 检查语法正确性和最佳实践；2) 评估性能影响（大表操作、锁表风险）；3) 验证数据转换逻辑正确性；4) 确认回滚脚本覆盖所有变更。使用 writeFile 保存为 script-review-report.md。', model: 'sonnet' } },
      { id: 'n5', label: '备份确认', type: 'timer', position: { x: 820, y: 200 }, config: { duration: 30 } },
      { id: 'n6', label: '执行总结', skillNames: ["Markdown处理"], type: 'agent', position: { x: 1010, y: 200 }, config: { systemPrompt: '你是一个项目协调专家。生成迁移执行总结：1) 迁移步骤检查清单；2) 预估执行时间线；3) 风险应对措施；4) 验证步骤和验收标准。使用 writeFile 保存为 migration-execution-plan.md。', model: 'haiku' } },
      { id: 'n7', label: '结束', type: 'end', position: { x: 1200, y: 200 } }
    ],
    edges: [
      { id: 'e1', source: 'n1', target: 'n2' },
      { id: 'e2', source: 'n2', target: 'n3' },
      { id: 'e3', source: 'n3', target: 'n4' },
      { id: 'e4', source: 'n4', target: 'n5' },
      { id: 'e5', source: 'n5', target: 'n6' },
      { id: 'e6', source: 'n6', target: 'n7' }
    ],
    isBuiltin: true
  },
  {
    id: 'tpl-code-generation',
    name: '代码生成流水线',
    category: '开发',
    description: '需求输入 → 架构设计 → 代码生成 → 代码审查',
    nodes: [
      { id: 'n1', label: '开始', type: 'start', position: { x: 60, y: 200 } },
      { id: 'n2', label: '架构设计', skillNames: ["代码审查","代码生成"], type: 'agent', position: { x: 250, y: 200 }, config: { systemPrompt: '你是一个架构设计专家。根据用户需求设计代码架构：1) 模块划分和职责定义；2) 类/组件结构设计；3) 数据流和控制流设计；4) 接口和抽象定义。输出架构设计文档，使用 writeFile 保存为 architecture-design.md。', model: 'opus' } },
      { id: 'n3', label: '代码生成', skillNames: ["代码生成"], type: 'agent', position: { x: 440, y: 200 }, config: { systemPrompt: '你是一个代码生成专家。根据架构设计生成完整代码：1) 每个模块生成完整实现代码；2) 包含必要的注释和类型定义；3) 确保代码符合设计规范和最佳实践；4) 生成对应的配置文件和依赖声明。使用 writeFile 保存所有源文件。', model: 'sonnet' } },
      { id: 'n4', label: '代码审查', skillNames: ["代码审查"], type: 'agent', position: { x: 630, y: 200 }, config: { systemPrompt: '你是一个代码审查专家。审查生成的代码：1) 代码质量检查（可读性、复杂度、重复代码）；2) 安全检查（OWASP Top 10）；3) 性能评估（算法复杂度、资源使用）；4) 提供改进建议（分级：必须修复/建议优化/可选）。使用 writeFile 保存为 code-review.md。', model: 'sonnet' } },
      { id: 'n5', label: '优化迭代', type: 'loop', position: { x: 820, y: 200 }, config: { maxIterations: 3, loopBody: '根据审查结果修复最高优先级的代码问题', loopCondition: '有需要修复的问题且迭代次数<3' } },
      { id: 'n6', label: '结束', type: 'end', position: { x: 1010, y: 200 } }
    ],
    edges: [
      { id: 'e1', source: 'n1', target: 'n2' },
      { id: 'e2', source: 'n2', target: 'n3' },
      { id: 'e3', source: 'n3', target: 'n4' },
      { id: 'e4', source: 'n4', target: 'n5' },
      { id: 'e5', source: 'n5', target: 'n6' }
    ],
    isBuiltin: true
  },
  {
    id: 'tpl-weekly-report',
    name: '周报生成流水线',
    category: '办公',
    description: '收集工作日志 → 数据汇总 → 生成周报',
    nodes: [
      { id: 'n1', label: '开始', type: 'start', position: { x: 60, y: 200 } },
      { id: 'n2', label: '收集工作日志', skillNames: ["Git操作"], type: 'agent', position: { x: 250, y: 200 }, config: { systemPrompt: '你是一个信息收集专家。收集本周工作信息：1) 读取项目目录的git提交记录（使用 execute_command: git log --since="7 days ago" --oneline）；2) 读取工作区本周修改的文件清单；3) 整理任务管理系统中本周完成的任务；4) 汇总本周遇到的问题和解决方案。使用 writeFile 保存为 weekly-data.json。', model: 'haiku' } },
      { id: 'n3', label: '数据汇总分析', skillNames: ["数据分析"], type: 'agent', position: { x: 440, y: 200 }, config: { systemPrompt: '你是一个数据分析专家。分析本周工作数据：1) 分类统计（功能开发、bug修复、文档更新等）；2) 工作量和效率分析（提交频率、代码行数）；3) 识别本周关键成果和里程碑；4) 整理下周期待和改进建议。使用 writeFile 保存为 weekly-analysis.md。', model: 'sonnet' } },
      { id: 'n4', label: '生成周报', skillNames: ["Markdown处理"], type: 'agent', position: { x: 630, y: 200 }, config: { systemPrompt: '你是一个报告撰写专家。基于数据分析生成专业周报：1) 本周概览（一句话总结）；2) 关键成果（3-5条，有数据支撑）；3) 工作详情（按项目/任务分组）；4) 问题和风险；5) 下周计划。Markdown格式，语言简洁专业。使用 writeFile 保存为 weekly-report.md。', model: 'sonnet' } },
      { id: 'n5', label: '结束', type: 'end', position: { x: 820, y: 200 } }
    ],
    edges: [
      { id: 'e1', source: 'n1', target: 'n2' },
      { id: 'e2', source: 'n2', target: 'n3' },
      { id: 'e3', source: 'n3', target: 'n4' },
      { id: 'e4', source: 'n4', target: 'n5' }
    ],
    isBuiltin: true
  }
];

class WorkflowTemplateService {
  /** @type {Map<string, Object>} Custom templates */
  static customTemplates = new Map();

  /**
   * Get all templates, optionally filtered by category
   * @param {string} [category] - Optional category filter
   * @returns {Array} List of workflow templates
   */
  static getAll(category) {
    let templates = [...BUILTIN_WORKFLOW_TEMPLATES, ...WorkflowTemplateService.customTemplates.values()];
    if (category) {
      templates = templates.filter(t => t.category === category);
    }
    return templates;
  }

  /**
   * Get a single template by ID
   * @param {string} id - Template ID
   * @returns {Object|null} Template object or null
   */
  static getById(id) {
    const builtin = BUILTIN_WORKFLOW_TEMPLATES.find(t => t.id === id);
    if (builtin) return builtin;
    return WorkflowTemplateService.customTemplates.get(id) || null;
  }

  /**
   * Clone a template to create a new workflow
   * @param {string} templateId - Template ID to clone
   * @returns {Object} The newly created workflow
   */
  static clone(templateId) {
    const template = WorkflowTemplateService.getById(templateId);
    if (!template) {
      const err = new Error(`Workflow template '${templateId}' not found`);
      err.code = 'NOT_FOUND';
      throw err;
    }

    // Deep clone nodes and edges with new IDs for nodes
    const nodeIdMap = new Map();
    const clonedNodes = template.nodes.map(n => {
      const newId = generateId();
      nodeIdMap.set(n.id, newId);
      return {
        ...n,
        id: newId,
        config: n.config ? { ...n.config } : {}
      };
    });

    const clonedEdges = template.edges.map(e => ({
      id: generateId(),
      source: nodeIdMap.get(e.source) || e.source,
      target: nodeIdMap.get(e.target) || e.target,
      label: e.label
    }));

    const workflow = WorkflowModel.create({
      name: `${template.name} (副本)`,
      description: `从模板 "${template.name}" 克隆`,
      nodes: clonedNodes,
      edges: clonedEdges
    });

    return workflow;
  }

  /**
   * Create a custom workflow template
   * @param {Object} data - Template data
   * @returns {Object} Created template
   */
  static create(data) {
    if (!data.name) {
      const err = new Error('name is required');
      err.code = 'VALIDATION_ERROR';
      throw err;
    }

    const template = {
      id: generateId(),
      name: data.name,
      category: data.category || '自定义',
      description: data.description || '',
      nodes: data.nodes || [],
      edges: data.edges || [],
      isBuiltin: false,
      createdAt: new Date().toISOString()
    };
    WorkflowTemplateService.customTemplates.set(template.id, template);
    return template;
  }

  /**
   * Clear custom templates (for testing)
   */
  static clear() {
    WorkflowTemplateService.customTemplates.clear();
  }
}

module.exports = WorkflowTemplateService;
