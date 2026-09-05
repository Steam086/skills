---
name: paper-to-report
description: 从论文 PDF 制作组会汇报大纲、逐页讲稿和论文证据映射；用户要求成品时继续调用 Paper Report，生成可编辑 PPTX 和 PDF。适用于论文汇报、paper presentation、论文转 PPT；不用于仅翻译或摘要论文。
---

# 论文 PDF 到汇报

这是日常入口。负责论文理解与可讲述内容；`artifact-template-paper-report` 负责排版与成品。用户要求完整汇报时连续完成两个阶段；只要求大纲时停在可交接内容包。无需第三个总控 skill。

## 开始

1. 读取用户 PDF、用途、时长、语言、听众及相关研究材料。已有上下文优先。未指定时，采用约 30 分钟、英文页面、中文讲稿、面向非本细分方向的研究生听众，并说明假设；不沿用任何参考模板的页数、作者、机构、论文结果或个人研究。
2. 若同级安装了 `../artifact-template-paper-report/`，读取其 `references/outline-contract.md` 并按协议输出。渲染 skill 缺失时仍可读论文和写大纲，明确交接协议/渲染依赖缺失，不声称完成 PPT。
3. 在用户指定位置建立独立目录。未指定位置时，在当前可写工作区创建 `<paper-slug>-report/`。原始 PDF、审校、素材、生成源码、成品分开，不覆盖原始论文和旧报告。

## 论文到内容包

读取 [论文阅读与审校](references/reading-workflow.md)，按论文实际结构安排工作。

- PDF 先记录版本、文件 SHA-256、总页数，区分从 1 开始的 PDF 页码与印刷页码。调用 `scripts/paper_pdf.py inspect` 提取逐页文本。查看准备使用的图、表、公式所在完整页面，再裁图；图注和抽取文本不能代替看图。
- 复合图先区分父图、子图组和 PDF 对象，登记必要元素与共享条件；并排或拆页由讲述任务和最终可读性决定。已有页数不自动成为硬约束。遇到此类图时按阅读规范中的图组说明处理，并在同级渲染 skill 可用时读取其 `references/figures.md`。
- 按“问题与代价 → 方法成立的机会 → 机制与不变量 → 实验设置和结果 → 边界与讨论”组织因果链。概念在首次需要前解释；按听众决定集中前置还是就地定义。页数服从用户、内容密度和时长，每页只回答一个主要问题。
- 每条关键结论记录来源及 PDF 页/section/figure/table；实验保留硬件、模型、workload、baseline、指标、单位和比较点。正文、图注与算术冲突分别记录，不挑最好的倍数或悄悄改原图。
- 页面英文正文与中文讲稿分别撰写。讲稿包括图怎么读、概念定义、证据限定和转场，不是逐字翻译 bullet。影响结论的限制也写到可见页面；备注不能补救夸大的页面。
- 只有用户要求或上下文明确需要时加入本人研究联系。重新读取研究和代码，区分论文贡献、已有实现、个人假设与计划实验；缺材料就记缺失，不移植参考报告中的研究主题、结论或结尾。

输出 `deck.json`（唯一可编辑内容源）、`content/outline.md`、`content/manuscript.md`、`review.md` 和素材。两个 Markdown 内容视图由渲染 skill 的 `report.py outline` 从 JSON 生成。`review.md` 单独保存来源冲突、概念首次出现和短版依赖检查。仅涉及研究延伸时增加 `research-map.md`。

用渲染 skill 的 `report.py validate` 检查交接包，再自行完成事实审校。脚本检查结构、来源定位和哈希，不能判断论文理解是否正确。用户请求端到端时，读取并执行 `../artifact-template-paper-report/SKILL.md`，继续渲染、逐页视觉检查和修正，交付 PPTX 与 PDF。用户明确要求先审大纲时才等待反馈。

## PDF 工具

先用 `load_workspace_dependencies` 找 Python 与 Poppler。逐项确认本次返回或 bundled 依赖目录中的 `pdfinfo`、`pdftotext`、`pdftoppm`，再把绝对路径作为参数传入；不要假设某个用户名、家目录或系统 `PATH`。所需工具缺失时停止对应步骤。基础文本提取和像素坐标裁图只使用 Python 标准库；对象清单与自适应分辨率需要 pypdf，归一化区域裁图还需要 Pillow。裁图不重绘论文证据。

```bash
"$RUNTIME_PYTHON" "$PAPER_SKILL/scripts/paper_pdf.py" inspect \
  --pdf paper.pdf --out evidence --pdfinfo "$PDFINFO" --pdftotext "$PDFTOTEXT"
"$RUNTIME_PYTHON" "$PAPER_SKILL/scripts/paper_pdf.py" page \
  --pdf paper.pdf --page 5 --out evidence/page-05.png --pdftoppm "$PDFTOPPM"
"$RUNTIME_PYTHON" "$PAPER_SKILL/scripts/paper_pdf.py" crop \
  --pdf paper.pdf --page 5 --xywh 100 300 900 600 --scale 2200 \
  --sha256 VERIFIED_PDF_SHA256 --out assets/fig-04.png --pdftoppm "$PDFTOPPM"
```

坐标相对于 `page` 命令相同 `--scale` 的栅格图，默认最长边 2200px。裁图生成同名 `.source.json`，把来源和实际图片哈希写入内容包。换 PDF 或裁图后重新审阅，不沿用旧页码和坐标。

复合图或需要改变成品分辨率时可使用：

```bash
"$RUNTIME_PYTHON" "$PAPER_SKILL/scripts/paper_pdf.py" objects \
  --pdf paper.pdf --page 2 --out evidence/page-02-objects.json
"$RUNTIME_PYTHON" "$PAPER_SKILL/scripts/paper_pdf.py" crop \
  --pdf paper.pdf --page 2 --region 0.1 0.2 0.7 0.3 \
  --width-in 6 --ppi 200 --sha256 VERIFIED_PDF_SHA256 \
  --out assets/panel.png --pdftoppm "$PDFTOPPM"
```

示例数值仅说明参数格式，区域、显示宽度和 PPI 应按当前材料确定。`--region` 是显示后的完整 MediaBox 页面左上原点归一化坐标，包含页面旋转，不使用 PDF 左下原点或对象局部坐标；不得与 `--xywh` 混用。自适应模式使用 `--region`、`--width-in`、`--ppi`，不同时指定 `--scale`；仅需固定栅格尺寸时用 `--region` 加 `--scale`。从实际裁图 sidecar 读取最终整数 xywh/scale 写入内容包。

`objects` 只输出资源线索，不能证明对象就是完整子图，也不直接导出矢量裁片。保留原 PDF，当前 PPT 生成器使用 PNG；支持矢量的其他导出链路需单独验证。无可提取对象时继续对照完整页面定位。裁出后检查必需元素，再将 sidecar 的 `visually_reviewed` 设为 true；不得由像素检测自动标记已审阅。
