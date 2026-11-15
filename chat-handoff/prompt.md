# 任务：设计并实现 Pro Handoff Skill V1

你是一名资深 AI Agent 工程师、Python 工程师和软件架构师。

请为 Codex 设计并实际实现一个名为 `pro-handoff` 的全局 Skill，用于在**本地 Codex 与 ChatGPT Pro 之间进行长期、双向、版本化的项目上下文交接**。

这是一个实际开发任务，不是单纯的架构讨论。

请完成设计、编码、测试、安装与验证，最终交付可实际使用的 Codex Skill。

---

# 一、项目背景与核心目标

我经常使用本地 Codex 开发软件项目，在遇到复杂的架构设计、Bug 分析、技术决策或需要深度思考的问题时，会切换到 ChatGPT Pro。

目前存在以下问题：

1. 本地项目包含大量文件，手动上传给 Pro 非常麻烦。
2. Pro 不知道 Codex 当前的任务、项目背景、设计决策及已经尝试过的方案。
3. 单纯上传代码不能完整传递 Codex 已经建立的项目理解。
4. 与 Pro 通常会进行多轮对话，而不是一次性问答。
5. Pro 的分析结论需要返回 Codex，形成后续开发任务。
6. Codex 修改代码后，还需要将最新进展同步给原来的 Pro 对话。
7. Pro 对话过长或新开对话时，需要恢复此前形成的有效知识。

因此，我需要的是：

**一个以项目为基础、以 Session 为协作状态、以 ZIP 和 Prompt 为传输载体的双向上下文同步 Skill。**

它应该使 Codex 和 Pro 能够围绕同一个项目进行长期协作，而不要求双方直接连接。

# 二、核心设计原则

实现时严格遵循以下原则。

## 2.1 语义理解与文件操作分离

采用以下架构：

- **Codex Skill**：负责理解项目、分析当前任务、提取关键上下文、选择重要文件、总结设计决策、生成 Prompt。
- **Python Engine**：负责文件扫描、哈希计算、快照生成、ZIP 打包、增量计算、协议校验、Session 状态持久化。
- **Local Session Store**：负责保存跨多轮交接的协作状态、版本信息、决策和历史记录。

不要将智能文件选择简化为固定后缀过滤。

也不要把所有能力都写在 `SKILL.md` 中。确定性操作必须由可测试的 Python 脚本承担。

## 2.2 手动触发

Skill 名称为：

`pro-handoff`

用户通过以下方式调用：

- `$pro-handoff`
- `$pro-handoff sync`
- `$pro-handoff import`
- `$pro-handoff recover`
- `$pro-handoff status`

也应该支持自然语言任务：

`$pro-handoff 请帮我把当前架构问题交接给 Pro 深度分析。`

要求：

- 只能显式调用，不允许隐式触发。
- 检查当前 Codex Skill 规范，并使用实际支持的禁用隐式触发配置。
- 不需要后台服务或自动监听。
- 不自动上传文件到 ChatGPT。
- 不自动读取 ChatGPT 对话。

## 2.3 最小依赖

优先使用 Python 3.11+ 标准库。

避免引入不必要的依赖、数据库、MCP Server、后台守护进程和第三方云服务。

保持跨平台兼容，至少考虑 macOS、Linux，尽可能支持 Windows。

## 2.4 本地项目是真实来源

- 本地源代码是实现状态的真实来源。
- Session 是长期协作状态的来源。
- Pro 返回的内容是需要验证的外部建议。
- Pro 的建议不能自动成为已确认决策。
- 导入 Pro 报告不等于执行 Pro 的建议。

---

# 三、必须实现的五项核心功能

## 功能 A：完整项目交接

调用：

`$pro-handoff`

或者：

`$pro-handoff <任务说明>`

工作流程：

1. 自动识别当前项目根目录。
2. 判断是否存在已有 Session。
3. 分析项目结构、技术栈、入口文件、主要模块、接口、依赖和测试。
4. 结合 Codex 当前可获得的对话上下文，提炼当前任务、开发进展、技术决策和未解决问题。
5. 分析哪些文件对于 Pro 理解和完成本次任务最重要。
6. 自动补齐必要依赖、接口定义、配置、文档和相关测试。
7. 生成完整项目上下文摘要。
8. 生成针对当前任务的动态 Prompt。
9. 将必要源代码与上下文打包为 ZIP。
10. 验证 ZIP 完整性、安全性和交接覆盖度。
11. 在终端显示 ZIP 路径、文件数量、压缩体积、排除说明和可复制的 Prompt。

默认使用 ZIP，不使用 tar.gz。

重点要求：

**完整交接指的是提供足够独立理解当前任务的项目上下文，不是无条件压缩整个仓库。**

请让 Codex 先建立结构化 Handoff Plan，再驱动文件选择、上下文提取与 Prompt 生成。

计划至少描述：

- 当前协作目标
- 主要项目模块
- 重要文件及其选择原因
- 需要包含的依赖
- 需要传递的历史决策
- Pro 需要解决的问题
- 希望 Pro 输出的结果

如果 Codex 无法访问某段历史对话，必须明确记录为不可获得，不能编造。

## 功能 B：Pro 结果结构化导入

调用：

`$pro-handoff import <文件路径>`

也应该支持用户直接粘贴 Pro 回传内容。

为 Pro 定义标准化的回传协议，优先采用 `PRO_RESPONSE.json`，同时提供 `PRO_RESPONSE.md` 作为人类可读格式。

回传内容至少包含：

- Protocol Version
- Session ID
- Based On Export ID
- Response ID
- 本轮分析摘要
- 已确认的技术事实及证据
- Pro 提出的建议
- 设计方案及理由
- 需要 Codex 执行的工作
- 风险与约束
- 未解决的问题
- 建议下一次向 Pro 同步的信息

导入时必须：

1. 校验数据结构和协议版本。
2. 确认 Session ID 和基线版本。
3. 检查引用文件是否仍然存在、内容是否发生变化。
4. 识别 Pro 建议与现有决策之间的冲突。
5. 将新发现、待确认建议与已确认决策分开管理。
6. 防止重复导入同一份响应。
7. 保存原始回传以供追溯。
8. 更新 Session 的有效知识与待办状态。

**禁止在 import 操作中直接执行 Pro 返回的代码、Shell 命令或项目修改指令。**

如果用户随后明确要求 Codex 实施建议，再按照正常开发流程执行。

## 功能 C：持续保存 Session 状态

每个项目允许存在多个独立 Session。

例如：

- architecture-review
- performance-analysis
- database-refactor

默认使用当前活动 Session，也支持明确指定 Session。

建议在项目下建立：

`.pro-handoff/`

其中保存：

- `index.json`：Session 索引
- `session.json`：当前会话状态
- `STATE.md`：当前有效上下文
- `events.jsonl`：追加式操作历史
- `snapshots/`：快照清单
- `prompts/`：生成的 Prompt
- `responses/`：Pro 回传
- `exports/`：ZIP 文件

默认避免将该目录提交到 Git。

请实现稳定的状态管理，至少记录：

- Session ID
- Session Name
- Protocol Version
- 当前任务目标
- Git HEAD
- 最新项目 Snapshot ID
- State Revision
- Latest Export ID
- 已确认远端基线
- Latest Import ID
- 创建和更新时间
- Session 状态

`STATE.md` 必须区分：

1. Verified Facts：有证据支持的事实
2. Accepted Decisions：已确认决策
3. Pending Proposals：待确认建议
4. Superseded Decisions：已被取代的决策
5. Implementation Status：实际实施状态
6. Open Questions：未解决问题
7. Next Actions：下一步任务

不要把每轮对话简单追加到 STATE.md。

应该维护一份简洁、准确的当前状态，同时保留原始证据和历史记录。

状态文件写入需要考虑原子性、中断恢复和损坏检测。

## 功能 D：基于文件版本的增量同步

调用：

`$pro-handoff sync`

目标是向已经打开的 Pro 对话发送新的项目状态，不必每次重新上传完整项目。

要求：

1. 使用已确认发送的 Snapshot 作为比较基线。
2. 基于实际文件内容 SHA-256 计算变化。
3. 正确识别新增、修改、删除和重命名。
4. 支持尚未提交的 Git 修改。
5. 支持与任务相关的 Git 未跟踪文件。
6. 不仅同步变化文件，也要同步必要的新发现、决策和任务进展。
7. 生成新的增量 ZIP 和动态更新 Prompt。
8. 记录本次增量包依赖的 Base Export ID。

必须明确区分：

- 本地已经生成的 ZIP
- 用户已经发送给 Pro 的 ZIP
- Pro 回传中实际引用的 ZIP

不能假设生成 ZIP 就代表 Pro 已经收到。

因此需要提供标记发送的操作，例如：

`$pro-handoff sent`

如果不存在可靠的基线，应当退回完整交接或明确提示，而不是生成存在错误依赖关系的增量包。

如果文件仍在项目中，但由于交接范围变化而被省略，不要将其记录为源代码删除。

增量包应该包含：

- 基线标识
- 文件操作清单
- 新增和变更文件
- 相关上下文变化
- 已完成的工作
- 新发现的问题
- 新的 Pro Prompt

对于删除文件，应记录删除事实，不需要把历史文件内容重新作为当前文件发送。

## 功能 E：长对话与新对话的上下文恢复

调用：

`$pro-handoff recover`

用于以下场景：

- Pro 对话太长
- 新开 Pro 对话
- Codex 上下文已经压缩
- Codex 重新启动
- 用户需要恢复某个旧 Session

恢复包必须自包含。

不能要求新的 Pro 会话拥有之前所有的历史 ZIP。

恢复包应包含：

- 当前实际项目的必要文件快照
- 当前有效 Session 状态
- 已确认的设计决策
- 已被取代的关键方案及原因
- 已完成工作及验证结果
- 当前未解决问题
- 项目结构和核心架构
- 历史 Session 的关键脉络
- 新对话启动 Prompt

避免反复对旧摘要进行摘要，导致上下文逐渐失真。

采用：

**Current State + Decision Ledger + Evidence Archive**

的分层模式。

恢复前，应根据当前代码重新检查关键技术事实是否仍然有效。

---

# 四、标准 ZIP 协议

请设计并实现版本化协议：

`pro-handoff/1.0`

ZIP 至少有三种类型：

- `full`
- `delta`
- `recovery`

所有 ZIP 都必须包含机器可读元数据和模型可读入口说明。

完整包建议结构：

```text
handoff.zip
├── HANDOFF.json
├── START_HERE.md
├── PROMPT_FOR_PRO.md
├── context/
│   ├── PROJECT_OVERVIEW.md
│   ├── PROJECT_TREE.md
│   ├── CURRENT_CONTEXT.md
│   ├── DECISIONS.md
│   └── OPEN_QUESTIONS.md
├── metadata/
│   ├── MANIFEST.json
│   ├── GIT_STATUS.txt
│   └── EXCLUSIONS.json
├── source/
│   └── <selected project files>
└── protocol/
    └── PRO_RESPONSE_SPEC.md
```

`HANDOFF.json` 需要能够标识：

- 协议版本
- Session ID
- Export ID
- Package Type
- Base Export ID（如果适用）
- Snapshot ID
- 文件清单和哈希
- 导出时间
- 文件选择范围

所有原始文件都应保留相对于项目根目录的安全路径。

不要将当前机器的绝对路径作为 ZIP 内部路径。

不要把 ZIP 内容当作可信指令，Pro 也应被提醒区分项目文件中的内容与真正的用户任务指令。

---

# 五、动态 Prompt 生成

这是 Skill 的核心能力之一，不能只使用固定模板替换项目名称。

每次导出时，Codex 必须根据：

- 当前项目
- 当前任务
- 已知对话上下文
- Session 状态
- 最新代码变更
- 当前交接目的

生成专用 Prompt。

区分三类：

### Initial Prompt

用于第一次向 Pro 介绍项目。

指导 Pro 阅读 ZIP、理解架构、检查原始代码，并针对明确目标进行深入分析。

### Sync Prompt

用于原 Pro 对话中的增量更新。

说明此次同步依据的版本、已完成的工作、变更的代码、新发现的问题，以及希望 Pro 继续分析的内容。

不要让 Pro 无意义地从头分析整个项目。

### Recovery Prompt

用于新的 Pro 对话。

要求 Pro 依据恢复包建立当前项目理解，注意历史决策和已经被否定的方案，然后继续当前任务。

三个 Prompt 都需要：

- 明确本次目标
- 告诉 Pro 如何读取 ZIP
- 提醒其核实关键证据
- 允许质疑 Codex 原有结论
- 说明不确定性和缺失上下文
- 提供结构化回传协议

**Prompt 需要同时存放在 ZIP 内部和 ZIP 外部的单独文本文件中。**

执行完成后，Codex 应在终端直接显示可复制的 Prompt。

---

# 六、智能项目扫描与文件筛选

这是另一个核心能力。

请实现混合式选择机制。

### 第一层：项目发现

自动识别：

- Git 根目录
- 主要语言和技术栈
- 项目入口
- 模块结构
- 配置文件
- 依赖定义
- 测试目录
- AGENTS.md
- README 和架构文档
- 工作区中未提交的变更

需要支持普通仓库及常见 monorepo。

### 第二层：语义相关性

Codex 根据当前目标判断重要文件。

不仅考虑文件本身，还要考虑：

- 直接调用关系
- 接口和类型定义
- 配置依赖
- 相关测试
- 关键数据结构
- 修改历史
- 错误日志及测试输出（如果可安全获得）
- 项目级设计说明

关键设计目标：

**避免文件选得太少导致 Pro 失去必要上下文，也避免文件选得太多产生噪声。**

### 第三层：体积预算与覆盖度

支持可配置的最大 ZIP 体积、单文件限制和文件总数。

优先保留关键文件及完整上下文关系。

如果因为预算无法包含关键内容，应明确报告。

### 第四层：安全过滤

默认排除：

- `.git/`
- `.pro-handoff/`
- 依赖缓存
- 虚拟环境
- 构建产物
- 临时文件
- 明显的凭据和密钥文件
- 其他不适合交接的敏感数据

此外需要考虑：

- Git 未跟踪文件中的敏感信息
- 文件内部嵌入的密钥
- 符号链接
- 项目目录之外的路径
- 二进制文件
- 巨型文件
- ZIP 路径穿越
- 导入时的恶意或不可信内容

不允许在未获用户明确授权的情况下，将高风险敏感文件加入交接包。

扫描结果应包含被排除文件的原因。

对于涉及私有代码的项目，在首次导出时应有简洁的预览与人工确认机制，并提供明确的非交互执行选项，但不能绕过安全策略。

---

# 七、Skill 安装结构

默认目标目录：

`~/.agents/skills/pro-handoff/`

建议包含：

```text
pro-handoff/
├── SKILL.md
├── agents/
│   └── openai.yaml
├── scripts/
│   ├── cli.py
│   ├── scanner.py
│   ├── selector.py
│   ├── snapshot.py
│   ├── exporter.py
│   ├── importer.py
│   ├── session_store.py
│   └── validator.py
├── references/
│   ├── protocol.md
│   ├── selection-policy.md
│   └── security-policy.md
├── templates/
│   ├── initial_prompt.md
│   ├── sync_prompt.md
│   ├── recovery_prompt.md
│   └── pro_response_spec.md
└── tests/
```

这只是建议结构。可以根据实际工程需要调整，但应保持职责清晰。

请检查当前 Codex 的官方 Skill 规范，并确保安装、元数据和调用方式正确。

全局安装目录已有同名 Skill 时，不要直接覆盖，先检查并安全处理。

# 八、Python CLI 接口

请为 Skill 提供稳定的 Python CLI。

建议支持：

```bash
python cli.py init
python cli.py export --type full
python cli.py export --type delta
python cli.py import-response <path>
python cli.py recover
python cli.py status
python cli.py mark-sent <export-id>
```

CLI 应支持明确指定项目目录和 Session。

请合理设计参数、退出码、错误信息和输出格式。

Skill 可以调用这些命令，但普通用户不应该需要理解所有 CLI 细节。

Python 层必须可以脱离 Codex 独立进行测试。

# 九、测试与可靠性要求

请编写自动化测试，不要只验证正常情况。

至少覆盖：

1. 在普通 Git 项目中创建 Session。
2. 在非 Git 目录中运行时的行为。
3. 多 Session 隔离。
4. 正确生成完整 ZIP。
5. ZIP 内部路径正确。
6. 文件 SHA-256 正确。
7. 识别新增、修改、删除。
8. 识别未提交和相关未跟踪文件。
9. 不可靠增量基线的回退。
10. 重复导入 Pro 报告。
11. 错误 Session ID。
12. 过期 Snapshot ID。
13. 旧版 Pro 建议与当前代码冲突。
14. Session 重启后恢复。
15. 新会话恢复包独立可用。
16. 敏感文件默认排除。
17. 符号链接和路径穿越防护。
18. 文件读取或打包过程中发生变化。
19. Session 状态写入失败或中断。
20. 导入内容含有恶意指令时不会被执行。

另外设计一个真实的端到端测试场景：

```text
创建测试项目
    ↓
初次导出完整 ZIP
    ↓
模拟 Pro 结构化回复
    ↓
导入回复
    ↓
更新项目代码
    ↓
生成增量 ZIP
    ↓
验证增量正确性
    ↓
生成恢复 ZIP
    ↓
模拟新 Session 读取恢复数据
```

同时检查 Skill 的显式触发是否正常，以及未显式触发时是否不会被调用。

# 十、实施方式

请按照下面的工程顺序实施：

**阶段一：环境与规范检查**

检查当前 Codex Skill 规范、Python 环境、当前目录及安装权限。

如果发现与本设计冲突的现有机制，应优先采用当前受支持的实现，并说明差异。

**阶段二：协议设计**

先确定数据结构、状态流转、快照和增量关系。

编写 `protocol.md` 和对应 Schema。

**阶段三：Python Engine**

实现文件扫描、哈希、打包、版本比较、Session 持久化、导入与校验。

**阶段四：Codex Skill**

实现 SKILL.md、手动触发、语义分析流程、Handoff Plan、动态 Prompt 生成和脚本调用。

**阶段五：集成与测试**

执行单元测试、集成测试及真实 Skill 调用验证。

**阶段六：安装与交付**

将 Skill 安装到用户级目录，验证可发现性，并提供使用说明。

实施过程中可以自行进行合理的低风险工程决策，不必对每个细节请求确认。

但不要未经授权删除现有数据、覆盖其他 Skill、上传私人文件或实施高风险系统修改。

# 十一、交付要求

最终必须交付：

1. 完整可用的 `pro-handoff` Skill。
2. Python Engine 实现。
3. 版本化交接协议与 Schema。
4. 完整、增量和恢复 ZIP 的实现。
5. Pro 回传解析与导入机制。
6. 多 Session 持久化机制。
7. 动态 Prompt 生成机制。
8. 安全过滤与文件完整性校验。
9. 自动化测试。
10. 用户使用说明。

实现完成后请实际运行测试，而不是仅声明代码已完成。

最终报告必须说明：

- 安装位置
- 已实现的功能
- 所有可用调用命令
- 核心目录结构
- 测试执行结果
- 尚未解决的问题
- 与最初设计的差异及理由
- 如何完成第一次 Codex → Pro → Codex 往返

请明确区分“已经测试通过”“仅完成实现”和“尚未验证”的功能。

# 十二、验收目标

这个 Skill 的成功标准不是生成一个 ZIP 文件。

而是：

**在一个完全新的 ChatGPT Pro 会话中，Pro 仅凭 Skill 生成的 ZIP 与 Prompt，就能正确理解当前项目的目标、核心架构、实际开发状态、关键决策和正在解决的问题。**

当 Pro 给出分析结果后，Codex 能够安全地导入并继续工作。

当 Codex 修改项目后，能够生成准确的增量交接包。

当 Pro 会话太长或需要新开对话时，能够重新建立可信的有效上下文。

以上过程不需要用户手动挑选数十个文件，也不需要手动反复解释整个项目。

---

# 十三、开始执行

现在请直接开始实际开发。

首先检查当前环境以及 Codex Skill 规范，然后确定最终的文件结构和协议，接着实施代码、完成测试并安装 Skill。

不要停留在讨论层面，也不要只给我一份规划文档。

在保证安全、可靠和可维护性的前提下，优先交付可运行的 V1，而不是过度设计。

如果某项能力受到当前环境限制，应该实现能够独立工作的部分，并明确报告限制，不要假装已经完成。

**最终目标：让我可以在任意本地 Codex 项目中执行 `$pro-handoff`，直接得到可上传给 ChatGPT Pro 的高质量上下文 ZIP 和专用 Prompt，并能够进行长期双向交接。**
