# Paper Report 交接协议 v1

`deck.json` 是唯一可编辑内容源，记录页面写什么、用哪张图、怎么讲，不要求论文阅读阶段指定 x/y。`report.py outline` 生成可读大纲与讲稿；生成器从同一 JSON 读取正文与备注。

## 顶层

- `schema`: 固定 `paper-report-v1`。
- `meta`: `title`, `audience`, `slide_language`, `notes_language`, `target_minutes`；可选 `presenter`, `font_face`（默认 Arial）。未知姓名省略。
  可选 `figure_quality`：`min_effective_ppi` 和/或 `min_label_height_pt`，均为正数，按本报告显示用途选择。低于阈值产生逐图诊断，不代表图已裁全；缺少标签测量也会注明待检。
- `sources`: 每项 `id`, `title`, `type`, `version`, `collected`, `scope`；至少有 `file` 或 `url`。本地 `file` 使用相对 `deck.json` 的路径，必须存在并给 `sha256`；PDF 记录 `pages`。未知版本写“未知”。URL 由 agent 核验，脚本不联网。
- `assets`: 每项 `id`, `file`, `sha256`, `source`（source ID）, `locator`（PDF 页/figure/区域）；可选 `crop` 对象。路径相对 JSON 目录，不能用旧图填新论文。
  `crop` 为整数 `{page,x,y,width,height,scale}`，坐标基于指定 scale 的完整栅格页面。声明 crop 时需本地 PDF 来源和同名 `.source.json`；其来源、图片哈希、页码、坐标、尺寸及人工视觉审阅状态必须匹配。历史裁图先补齐真实溯源并审阅，不伪造记录。
  可选 `figure` 记录语义结构：必填 `parent`（父图定位）、`required_elements`（非空字符串数组）；可选 `panel`（原子图标识）、`shared_context`（共享条件/图注，自动追加到使用页备注）、`label_height_px`（当前 PNG 中最小必要标签的实测字形高度）。单图可省略该对象；图组通过相同 source 和 parent 关联，不要求父图本身也是 PNG 素材。影响结论的共享限定仍须写入可见内容。
- `slides`: 有序数组。

## 每页公共字段

- `id`：稳定唯一短 ID；增删页面不改其他 ID。
- `layout`：`cover | section | bullets | comparison | figure | two-figures | figure-grid | table | flow`。
- `title`, `section`, `purpose`（唯一问题/结论）。
- `seconds`：正数时间预算；`optional`：可选页，不自动隐藏。短版显式导出对应页集合，再查概念依赖。
- `takeaway`：可见结论条，封面/章节可为空字符串。
- `footer`：可见精简来源；`notes`：完整中文讲述，包括读图、定义、解释、限制和转场。
- `evidence`：非空数组，每项 `source`, `locator`, `kind`, `claim`, `limits`。kind 是 `paper | teaching | inference | research | proposal`，无额外限制时 limits 可为空。来源自动追加至 PPTX 备注，重大限定也须可见。

## 版式专属字段

| layout | 字段 |
|---|---|
| cover | `subtitle`, `authors`；可选 `items`（1–3 个机制概览步骤） |
| section | `subtitle` |
| bullets | `items`：1–6 个 `{heading,text}` |
| comparison | `items`：2–3 个 `{heading,text}` |
| flow | `items`：2–5 个 `{heading,text}` |
| figure | `figures`：1 个 asset ID；`caption`；可选 `items`：1–3 个 `{heading,text}`；可选 `figure_options`，见下文 |
| two-figures | `figures`：2 个 asset ID；`items`：2 个 `{heading,text}`；可选 `caption` |
| figure-grid | `figures`：2–4 个 asset ID；可选 `items`，数量和顺序与图对应；可选 `caption`、`columns`（整数 2 或 3，不超过图数）。默认 2 图两列、3 图三列、4 图两列 |
| table | `columns`：2–5 个字符串；`rows`：1–6 行字符串数组；可选 `caption` |

v1 拒绝未知字段，避免内容被静默丢弃。复杂图表在报告自己的协议/生成器副本扩展并验证，协议不限制论文机制。完整可运行样例见 `example-deck.json`；其中所有文字、数字与图片均为合成教学内容。

`figure_options` 支持 `placement: side | wide`、`align: top | center`、`height`（图片区域高度，英寸）。显式指定选项时默认 top，图注距实际图底边 0.12 英寸；wide 把说明移到下方。区域高度默认/上限为 4.7 英寸，wide 且有说明时为 3.1 英寸。省略整个对象时保留基础模板原有布局。所有模式使用等比例 contain；区域宽高不是强制拉伸后的图片尺寸。

`figure-grid` 每组说明为简短 heading/text，不承担完整讲稿。容量不代表推荐密度；具体是否并排、拆页或使用自定义版式，按 [配图处理](figures.md) 检查。新增字段是兼容旧无扩展内容包的 v1 扩展；旧 crop 元数据现在会核对 sidecar，不能依赖过去的宽松校验。

## 产物目录与修改

独立报告目录下保存原始 `paper.pdf`（或来源路径）、`deck.json`、`review.md`、`assets/`；研究联系需要时另存 `research-map.md`。`content/outline.md` 和 `content/manuscript.md` 是自动生成视图，`_build/v1/` 放候选/检查/预览，`output/v1/` 放已检查的 PPTX/PDF。

outline 给出页号、稳定 ID、标题、问题、布局、时间、全部可见字段、配图和来源；manuscript 使用 `### 第 N 页：标题`，包含完整备注。Markdown 改动先合回 JSON，再生成视图。结构通过不代表事实已审。
