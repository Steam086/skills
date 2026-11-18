# Pro Handoff

在 Codex 中用 `$pro-handoff` 生成面向当前任务的上下文 ZIP 和可复制 Prompt。ZIP 由用户上传给 ChatGPT Pro，Pro 的回传由用户保存或粘贴给 Codex。Python 引擎本地运行，要求 Python 3.11+，只用标准库。

## 第一次往返

1. 在目标项目启动 Codex，输入 `$pro-handoff 请让 Pro 分析为什么任务重试会重复执行`。Codex 会检查架构、调用关系和测试，生成计划与文件预览。确认范围后获得 ZIP 和独立 Prompt。已明确同意非交互执行时，可在调用里加入 `--yes`。
2. 在 ChatGPT Pro 中使用支持文件上传和数据分析的对话，将 ZIP 作为附件上传，再粘贴独立 Prompt。请 Pro 按包内协议返回 `PRO_RESPONSE.json`。也可以保存带 JSON 代码块的 `PRO_RESPONSE.md`。
3. 在项目中运行 `$pro-handoff import /path/to/PRO_RESPONSE.json`，或在调用后粘贴回传。Codex 会报告证据变化和潜在冲突。建议进入待审查状态。要实施某项建议，请另发开发指令。
4. 修改代码后，在原 Pro 对话继续时运行 `$pro-handoff sync`，上传增量 ZIP 并粘贴新 Prompt。每次上传后可执行 `$pro-handoff sent <export-id>`；导入引用该导出的 Pro 回传也会确认送达。
5. 换新 Pro 对话时运行 `$pro-handoff recover`，只需上传本次恢复 ZIP 和 Prompt。若原对话缺少增量基线，也可用恢复包。

如果 ZIP 上传后 Pro 仍无法打开，先检查当前对话的模型和数据分析工具。请它从 `source/` 引用一个关键函数，并在回传中附上清单里的 SHA-256，以确认它实际读到了包内证据。有关 ZIP 的支持条件见 [OpenAI 文件上传说明](https://help.openai.com/en/articles/8555545-uploading-files-and-audio-to-chatgpt)。

## 调用

| 调用 | 用途 |
| --- | --- |
| `$pro-handoff [任务]` | 完整交接 |
| `$pro-handoff sync` | 从已确认送达的版本生成增量；没有基线时生成完整包 |
| `$pro-handoff recover` | 生成可独立使用的恢复包 |
| `$pro-handoff import [路径]` | 导入文件或本轮粘贴的回传 |
| `$pro-handoff sent [导出 ID]` | 记录送达；省略 ID 时使用最新导出 |
| `$pro-handoff status` | 查看会话、版本和交接状态 |
| `$pro-handoff init <名称>` | 创建或激活会话 |
| `$pro-handoff use <名称或 ID>` | 切换会话 |
| `$pro-handoff review …` | 维护已核实事实、已接受决策和待审条目 |

操作可加 `--session <名称或 ID>` 或 `--project <目录>`。Git 项目自动定位到仓库根目录；非 Git 项目使用所指定目录或当前目录。会话首次导出、新增源文件路径或附带原始 skill 参考时需要确认；`--yes` 不会跳过安全过滤和预算检查。默认目标快照与参考附件合计最多 120 个文件，单文件 384 KiB，压缩 ZIP（含元数据）8 MiB。可通过 `--max-files`、`--max-file-bytes` 和 `--max-zip-bytes` 调整。预览显示实际压缩大小；范围外未选路径不会从扫描结果或 Git 状态自动进入 ZIP，只保留排除计数。

必要信息缺失时，交接不会以残缺 ZIP 结束。计划必须用 `required_context` 声明“问题 → 必要文件 → 原因”；引擎会同时检查 critical 文件和当前事实、已接受决策引用的证据文件。预览中的 `publishable: false` 与 `blocking_gaps` 表示发布被阻断，`--yes` 和预览确认都不能绕过。Agent 会先尝试安全补齐本地选择；仍无法解决时应暂停，说明缺失内容、分析影响和需要用户提供的最小证据或范围决定，不得降低优先级、删除引用或伪造文件来过关。非必要遗漏可以保留为警告。完整包和恢复包必须实际携带必要文件，增量包可复用准确的已确认基线。旧计划缺少此声明时须重新规划；声明和哈希校验不能替代对调用链及语义依赖的检查。

由 Codex 或 Pi 在本地筛选 skills，把影响本轮判断的规则和检查直接写进 `plan.prompt`，随独立 Prompt 和包内 Prompt 一并交接。默认不附原始 skill，也不让 Pro 重新选 skill。只有审查原文、脚本或样例时才附入 ZIP 的 `skills/`；必需附件缺失会阻断发布，可选遗漏会在 Prompt 提示。每次 `sync` 或 `recover` 重新评估并写出本轮适用的指引。

## 安装与工程入口

Codex 的 `~/.agents/skills/pro-handoff` 和 Pi 的 `~/.pi/agent/skills/pro-handoff` 都可软链接到源码目录。修改源码后，两处会读到同一份文件。Codex 使用 `$pro-handoff`，Pi 使用 `/skill:pro-handoff`，两边的子命令和参数相同。修改后可在 Pi 执行 `/reload`，或启动新的 Codex 会话。

在仓库根目录执行以下命令可创建链接。已有同名文件或链接时会保留原路径。

```bash
skill_dir="$(cd pro-handoff && pwd -P)"
mkdir -p "$HOME/.agents/skills" "$HOME/.pi/agent/skills"
for skill_link in "$HOME/.agents/skills/pro-handoff" "$HOME/.pi/agent/skills/pro-handoff"; do
  if [ ! -e "$skill_link" ] && [ ! -L "$skill_link" ]; then
    ln -s "$skill_dir" "$skill_link"
  fi
done
```

`SKILL.md` 路由操作，`agents/openai.yaml` 配置显式调用，`scripts/` 提供引擎，`references/` 保存协议、Schema 和工作流，`templates/` 保存回传说明，`tests/` 覆盖 Python 端到端流程。命令详情可通过 `python3 pro-handoff/scripts/cli.py --help` 查看。测试命令为 `python3 -B -m unittest discover -s pro-handoff/tests -v`。

项目下的 `.pro-handoff/` 保存会话索引和独立会话目录。每个会话有 `session.json`、`STATE.md`、`events.jsonl`、快照、计划、审查记录、Prompt、回传和 ZIP。Git 项目默认用状态目录自己的 `.gitignore` 忽略这些文件，在 `.git` 只读时也有效。新增和修改基于实际工作区内容。重命名按唯一同内容匹配识别，编辑后移动或相同内容有多个匹配时会记录为删除和新增。

协议详见 [pro-handoff/1.0](pro-handoff/references/protocol.md)。全局目录与显式调用配置见 [OpenAI 官方技能文档](https://learn.chatgpt.com/docs/build-skills)。

## V1 验收

使用合成项目完成了 Codex → ChatGPT 网页（xhigh）→ Codex 往返。网页端从 ZIP 源码读出了 Prompt 未提供的返回值。引擎导入回传原文并核对 9 处引用，以该导出作为增量基线。补充回归测试后，增量包仅包含修改过的测试文件。独立恢复包在空目录中通过验证。

Linux 用户级安装版的 V1 验收通过当时的 12 项自动化测试。真实 Codex 会话验证了显式触发、相似请求的隐式触发对照，以及 `import`、`sync`、`recover` 入口。本次网页测试使用 xhigh。其他 ChatGPT 推理模式及 macOS、Windows 未实测。
