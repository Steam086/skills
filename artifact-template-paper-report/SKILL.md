---
name: artifact-template-paper-report
description: 将已审校的论文汇报大纲渲染为 Paper Report 风格的可编辑 PPTX、中文讲者备注和 PDF。用户选择 Paper Report 模板、要求同风格组会 PPT 或调用本 skill 时使用；原始论文理解交给 paper-to-report。
---

# Paper Report

负责内容包到成品。读取 `artifact-template.json`，保留 `assets/reference.pptx` 与 `assets/preview.png` 不变。参考文件只含中性教学内容，用作视觉模板，不能把示例文本或数据带入新报告。

## 输入与模板

1. 读取 [大纲协议](references/outline-contract.md) 和 [视觉规范](references/style.md)。`deck.json` 是正文、标题、配图、备注的唯一内容源。只有粗略 Markdown 时先补齐协议字段；只给 PDF 时接续同级 `paper-to-report`。
2. 对照参考 PPTX 检查所用版式。配套脚本使用 PptxGenJS 4.x，保留参考的配色、尺寸和基础布局。正文、表格、机制流程为原生对象，论文截图仍是位图，不把整页截图当作可编辑 PPT。
3. 当前环境提供 `presentations` skill 时，使用其中适用的渲染与视觉验证指导；否则仍可使用本目录的生成与检查脚本。新报告放独立目录，参考文件只读。
4. 遇到复合图、裁剪修复或比例/细节可读性问题时，读取 [配图处理](references/figures.md)。先识别语义图组与共享信息，再选择整体、并排或拆页；不从 PDF 对象数量或已有页数推断固定版式。

## 构建

先调用 `load_workspace_dependencies`，取得 Node、Python、Node modules 以及 bundled 二进制目录。逐项解析并确认 `soffice` 与 `pdftoppm` 的绝对路径；不要把示例变量名当成已经存在的 shell 变量。Python 需 Pillow 和 pypdf，Node 需 PptxGenJS 4.x。不硬编码操作系统或家目录，不自动安装依赖或改全局配置。只使用 bundled LibreOffice，不回退到用户桌面版。

下列变量必须由本次探测结果显式赋值，`RENDER_SKILL` 指当前 skill；所有路径按独立 shell 参数引用。

```bash
"$RUNTIME_PYTHON" "$RENDER_SKILL/scripts/report.py" validate --deck deck.json
"$RUNTIME_PYTHON" "$RENDER_SKILL/scripts/report.py" outline --deck deck.json --out content
"$RUNTIME_PYTHON" "$RENDER_SKILL/scripts/report.py" build --deck deck.json \
  --out _build/v1 --node "$RUNTIME_NODE" --node-modules "$RUNTIME_NODE_MODULES"
"$RUNTIME_PYTHON" "$RENDER_SKILL/scripts/report.py" render --deck deck.json \
  --pptx _build/v1/report.pptx --out _build/v1/render \
  --soffice "$BUNDLED_SOFFICE" --pdftoppm "$PDFTOPPM"
```

`build` 先校验内容与素材，再生成 PPTX，检查实际页数、标题、可见字段、完整备注、素材嵌入和页面边界。`render` 再校验 PPTX，转 PDF/PNG，检查 PDF 页数与逐页文本覆盖，并产生带页码拼图。两个命令要求新的输出目录，避免旧 PDF 冒充当前结果。修改后用 `v2` 等新目录。

## 视觉检查与交付

- 检查全部拼图，再看复杂图表、新增页及疑点页的 1600px 大图。检查截断/重叠、标题单行、密度、坐标轴/图例、来源条、结论条及中文字体。机器校验不检测所有重叠，不能代替看图。
- 默认字号和几何来自参考。先删冗余、拆长句或换版式，不自动缩字塞入。只有用户明确固定页数时才按固定预算重排；没有硬约束时可按可读性拆页并调整时长。JSON 支持基础版式及通用图组网格；复杂机制/公式在该报告的生成器副本中扩展并验证，不强塞固定卡片。
- 分别确认裁剪完整、素材/几何正确和最终可读。检查 `check.json` 中的逐图诊断；比例正确、边距紧凑或结构校验通过不能替代最小标签、细线与比较条件的视觉检查。
- 页面与图中数字以核验内容为准。排版压缩不能改指标、删重要限定或凭空补图。内容修改写回 JSON 再构建。
- 看完本轮图后在 `_build/<version>/visual-review.md` 记录看过的页和剩余问题。结构、PDF 文本与视觉检查都完成，才把同一轮 `report.pptx` 与 `render/report.pdf` 复制到新的 `output/<version>/`；不要再生成一份未看过的正式稿。
- 交付 PPTX 与 PDF。中文完整备注在 PPTX 内，PDF 不含备注，另保留 `manuscript.md`。渲染器缺失或失败时保留内容包/候选 PPTX，明确 PDF 未完成，不冒称全链路通过。

## 修改大纲

Markdown 是 JSON 的可读视图。用户在 Markdown 上改动时先比较并合回 JSON，再生成视图，不直接覆盖人的修改。旧 `### 第 N 页：标题` 格式可逐页迁移，不保留“只同步备注”的行为。
