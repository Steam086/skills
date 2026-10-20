# Project Memory Init

全局可见、仅手动触发的 Pi 安装入口。它为选定项目注册同仓库的 `project-memory` skill + 插件；本包不包含运行时扩展，不自动为所有项目启用记忆。

## 安装入口

先审查代码，再从集合仓库安装这个子目录：

```bash
# 首次获取；已有 checkout 不要重复 clone 或未经审查自动更新
 git clone https://github.com/Steam086/skills.git "$HOME/skills"
 pi install "$HOME/skills/project-memory-init"
```

这是有意的**全局入口安装**，与运行时必须 `--local` 不同。不会安装运行时依赖、下载模型、授予 trust 或启动服务。Pi 启动后或 `/reload` 后可以调用：

```text
/skill:project-memory-init 安装到 ~/Sources/MyProject，先给出预检和授权清单
```

一次明确授权示例：

```text
/skill:project-memory-init 为 ~/Sources/MyProject 安装；允许本次 Pi 安装批准、信任生成的 QMD 配置、从 /data/models/qmd 复用 embedding 并验证 GPU；不下载模型、不更新共享包。
```

`/data/models/qmd` 只是示例，替换成自己的路径。包路径默认从本 skill 的真实目录查找相邻 `project-memory`，也可以在请求中显式指定。不需要 memory 的项目不会加载运行时。

## 能力与边界

- 默认只准备 embedding；Deep 模型按需选择。
- 本地模型校验 GGUF + manifest SHA256，优先硬链接；跨文件系统复制须确认。
- 冲突停止、不覆盖、不自动迁移旧版、不自动更新共享包。
- QMD trust 与 Pi 项目 trust 分开；永久 Pi trust 由用户交互确认。
- 这是指令型 skill，不是无人值守安装器或安全沙箱。操作依赖代理正确执行流程，重要授权仍由宿主管理。
- Linux/Unix、Node.js >=22.19、npm、Bash、flock、兼容 Pi；GPU 需 NVIDIA/CUDA。详见配套包 [README](../project-memory/README.md)。

第一版不提供自动迁移/升级/卸载运行时或驱动安装。保留旧 `repo-memory-init` 不会自动迁移现有项目；不要在同一项目叠加活跃旧实现。若要移除旧全局入口，先确认来源再单独处理。

移除此入口可以运行 `pi remove "$HOME/skills/project-memory-init"`；不会删除任何项目记忆或取消项目运行时注册。

## 验收

```bash
npm test --prefix "$HOME/skills/project-memory-init"
# Pi 不在 npm 全局目录时，显式指定宿主 SDK：
PI_MEMORY_TEST_HOST=/absolute/path/to/pi-coding-agent/dist/index.js \
  npm test --prefix "$HOME/skills/project-memory-init"
```

测试验证真实 Pi skill 发现、手动触发元数据、自动提示排除、资源清单与文档引用。使用临时目录，不安装全局资源、不授 trust、不联网、不启动 GPU。它不证明 LLM 会遵循全部流程；安装运行时的安全性另由 `project-memory` 自身测试覆盖。该适配器尚未声明许可证。
