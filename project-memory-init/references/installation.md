# 安装流程与授权边界

## 1. 范围和前置检查

以下命令是 Bash 模板，不是一键无条件执行脚本。`PACKAGE`、`TARGET`、`MODEL_SOURCE` 必须来自已审查且明确的路径，始终引用变量。运行每一步前检查退出码；失败立即停止后续步骤。

- 记录目标逻辑路径与 `realpath`；Git 项目用 `git -C "$TARGET" rev-parse --show-toplevel` 核对根目录，非 Git 目录由用户明确指定。
- 检查 `PI_MEMORY_PROJECT_ROOT` 是否遗留其他目标；仅在本次子 shell 中设成目标真实路径，不能污染其他会话。
- 检查目标 `.pi/settings.json`、`.pi/extensions`、`.pi/skills`、`.agents/skills`、`.qmd/index.yml` / `index.yaml` 及适用的全局资源声明，识别重复 runtime、旧 `repo-memory`、`.repo-memory` 或自定义 bootstrap。不要输出全局 auth 文件或其他凭据。发现活跃冲突停止并请求人工迁移。
- 检查包 manifest 是否同时声明 `SKILL.md` 与 `extensions/project-memory.ts`，以及所需脚本、lockfile 和 `model-sources.json` 是否存在。完整阅读包 README；版本不兼容时停止，不套用旧命令。
- 检查 Node.js >=22.19、npm、Bash、flock 和可用 Pi。只有在线模型下载需要 Python 3、hf；只有 GPU 验证需要兼容驱动/CUDA。
- 现有项目状态不能通过软链接共享；包的 setup 还会执行安全预检。不要复制别的项目 `.pi`、QMD 信任记录或服务元数据。

## 2. 来源与更新

解析顺序：用户明确的包路径 → 本 skill 真实目录同级 `../project-memory` → 询问来源。

本项目的集合仓库为 `https://github.com/Steam086/skills.git`；它不是根级 Pi package。首次获取必须得到联网和目标路径授权，例如：

```bash
git clone https://github.com/Steam086/skills.git "$CHECKOUT"
# 如用户指定版本，在 checkout 中选择已审查的 commit/tag。
PACKAGE="$CHECKOUT/project-memory"
```

不要使用 `pi install git:github.com/Steam086/skills` 假装选择子目录。不要在初始化时自动 `git pull`、切换已有 checkout 的版本或运行更新脚本。共享路径的代码和依赖变化会影响所有消费项目；更新须另行授权并审查差异。也不要在初始化过程中安装、卸载或替换全局旧入口。

## 3. 授权清单

| 操作 | 条件 |
| --- | --- |
| 只读预检 | 当前安装请求范围内 |
| 创建本项目状态、注册本地包 | 明确安装请求；先说明路径 |
| 缺失依赖安装 | 说明网络访问及共享 node_modules 影响；授权后执行 |
| `pi install --local --approve` | 明确说明并获准本次命令批准；不保存永久 trust |
| QMD trust | 审查生成配置并明确获准信任 |
| 从已指定目录复用模型 | 明确复用请求；校验通过；不覆盖 |
| 跨文件系统复制、在线模型下载 | 说明磁盘/网络开销并获准 |
| 索引、GPU 预热 | 明确验收授权；说明服务使用显存，默认空闲 30 分钟退出 |
| 更新共享包、修改全局设置 | 不属于默认安装范围，另行授权 |
| 永久 Pi trust | 用户在 Pi 交互界面自行确认 |

可一次确认：“为 TARGET 安装，允许单次 Pi 安装批准、信任生成的 QMD 配置、复用 MODEL_SOURCE 的 embedding 并验证 GPU；不下载、不更新共享包。” 未包含的权限保持未授权。

## 4. 依赖、初始化与注册

先在包目录检查 `npm ls --omit=peer` 并核对 lockfile；依赖已满足时跳过重装。缺失或不匹配时，获准后执行：

```bash
"$PACKAGE/scripts/memory-install"
```

安装器使用 lockfile，跳过生命周期脚本和自动 peer 安装，并设置包本地 CUDA loader。不安装 CUDA/驱动，不改全局 loader。若依赖已齐全但需要配置已有 CUDA，经说明执行 `node "$PACKAGE/scripts/memory-cuda.mjs"`；自定义路径用其 `--lib-dir` 选项。

在目标根目录的子 shell 中执行后续命令：

```bash
cd "$TARGET"
export PI_MEMORY_PROJECT_ROOT="$(pwd -P)"
node "$PACKAGE/scripts/memory-setup.mjs"
pi install --local "$PACKAGE"
```

若项目不受信任导致注册拒绝，停止审查项目资源；只有明确获准后才用 `pi install --local --approve "$PACKAGE"` 重试。不要自动加 approve。已经正确注册时跳过注册，不覆盖 settings。

setup 创建 `.pi/memory/`、`.pi/cache/qmd/models/`、`.pi/qmd-state/`、`.qmd/index.yml` 及局部 ignore 文件；不编辑根 `.gitignore`、AGENTS.md 或 Pi 设置，不授 trust、不启动服务。

## 5. 本地模型复用

默认选择 `model-sources.json` 的 `embed`；用户要求 Deep 时再选择 `rerank` 和 `generate`。先检查目标缓存，再检查明确给定的源目录，不遍历用户整个 home、其他项目或整块磁盘。`/data/models/qmd` 只是一个可由用户指定的本机示例，不是硬编码前提。

每个模型按以下算法处理（使用本机可用的 Node.js 或 Python 文件 API）：

1. 从已审查 manifest 取 `file`、`cacheName`、`sha256`。只允许普通 basename，拒绝路径分隔符、绝对路径、`.`、`..`。
2. 候选为目标或源目录下的 `file` / `cacheName`。验证是普通文件，不跟随项目状态软链接；检查头四字节为 `GGUF`，流式计算完整 SHA256，必须与 manifest 一致。
3. **先验证所有选中的源文件及已有目标，再创建任何链接。** 已有目标内容不符、别名不符或软链接时停止，保留现场，不删除。
4. 已有目标与 alias 校验正确则复用。缺失目标用独占创建的硬链接，不覆盖；遇到 EXDEV 时停止，取得复制授权后独占复制并重新校验。其他错误不擅自退化为复制。新建 alias 指向目标权重的硬链接，目标两个名字不重复占用存储。
5. 不 chmod、不改写硬链接模型；它们与源共享 inode，任何原地修改会影响其他消费者。需要独立可变文件时选择复制。记录源、目标、校验结果和复用方式。

源文件不匹配时不要自动联网替换。只有明确下载授权后才运行包的：

```bash
"$PACKAGE/scripts/memory-models" embed
# Deep 全量下载（仅明确要求时）：
# "$PACKAGE/scripts/memory-models" all
```

下载脚本依赖 hf 和 Python 3，固定 revision 并校验 SHA256。不要索要访问令牌；需要认证时让用户自行通过 hf 的正常认证流程处理。

## 6. Trust 与验收

展示 `.qmd/index.yml` 配置摘要：只索引项目 `.pi/memory/**/*.md`，排除 recovery，及 embed/generate/rerank 模型标识。确认无意外 hook、项目外路径或自定义模型。明确获准后：

```bash
"$PACKAGE/scripts/qmd-memory" trust
node "$PACKAGE/check-memory-config.mjs" --require-trust --models=embed
```

只有获准进行运行验收时执行：

```bash
"$PACKAGE/scripts/memory-index"
"$PACKAGE/scripts/qmd-memory" service start --warm
"$PACKAGE/scripts/qmd-memory" service status
```

GPU 成功必须同时满足 `device.gpu == "cuda"` 且 `gpuLayers.embed > 0`；服务 running 或 CPU fallback 不算 GPU 成功。不要为了验收加载额外 Deep 模型、创建假记忆或修改源码。全新记忆为空时索引 0 条、无 vector index 是正常状态，不能据此宣称完成了带文档的检索验证。

CUDA 失败时检查本项目 `.pi/qmd-state/service.log`，仅报告必要的错误摘要，不暴露服务令牌。修改已有 CUDA loader 后要重启该项目服务，先说明可能影响当前会话。无 GPU 或缺少模型时如实报告“注册完成、语义/GPU 未验证”；不要绕过 trust 或伪装成功。关键词检索不需要模型权重。

最后检查消费项目 `git status --short`、`git check-ignore` 和已跟踪文件：ignore 不会保护已经跟踪的敏感文件。不要读取/打印 bearer metadata，不自动提交消费项目状态。报告包路径、目标真实路径、配置注册状态、模型原始和缓存位置、QMD trust、GPU 验证、剩余步骤。提示用户从目标根目录启动 `pi` 并亲自确认项目 trust；一进程只用一个项目。未在交互 Pi 中验证时，不声称项目资源已经在用户会话生效。
