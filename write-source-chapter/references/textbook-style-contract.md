# Source-grounded textbook writing contract

Use this contract to produce a traceable, teaching-oriented explanation of the target codebase. It defines an editorial method, not a template tied to any specific repository, language, framework, or architecture.

The workflow contract identifier is `source-chapter/v1`.

## The stable pattern

A strong source-grounded chapter works at four levels:

1. **Chapter shell** — preview, ordered topics, conclusions, and questions.
2. **Topic packet** — relevant sources, scope, mental model, mechanics, and engineering interpretation.
3. **Evidence unit** — claim or definition, supporting material, exact source, then interpretation.
4. **Teaching loop** — tell the reader what exists, show how it works, explain why it matters, and test transfer of understanding.

The minimum useful knowledge unit is:

```text
What：它是什么，边界是什么
Evidence：源码证据在哪里
How：调用、转换、依赖、编译、数据流、状态或生命周期如何推进
Why：为何形成这种设计；若无直接证据则标记推断
So What：对正确性、性能、可靠性、维护或使用方式意味着什么
```

Not every paragraph needs five labels. The reasoning chain must nevertheless be visible across each substantial topic.

## Complete chapter shell

For a chapter-length deliverable, normally use:

```markdown
## 第 N 章 <标题>

### 内容提要

- <normally 5–8 dense themes, sized to the actual chapter>
- <what the reader will be able to explain or do>

<one or more topic packets>

### 本章小结

- <conclusions, not a list of section titles>

### 第 N 章思考题

1. <question>
   **解：** <reasoned answer>
```

Do not emit the complete shell for a requested subsection, focused revision, outline, or evidence note. Preserve an existing chapter's numbering and local conventions when revising it.

## Plan-backed handoff record

When a chapter is produced from `source-book-plan/v1`, preserve the following fields in document metadata or an adjacent sidecar/handoff artifact so another task can audit the chapter without relying on chat history:

```text
plan_contract: source-book-plan/v1
chapter_contract: source-chapter/v1
plan_ref: <resolvable repo-relative plan path; use a logical ID only when the plan is supplied separately>
chapter_id: <stable ID>
packet_ids: <stable IDs>
evidence_baseline: <commit/tag or named snapshot>
logical_repo_root: .
document_kind: chapter|section
lint_contract: textbook|custom
exercise_mode: answered|questions-only
packet_completion_tests: <tests copied from the plan>
chapter_acceptance_criteria: <criteria copied from the plan>
```

Do not add this block to an ad hoc chapter with no plan. Never store a host checkout root or interpreter path in it. A logical-only `plan_ref` is insufficient by itself: either supply the referenced plan to the next task or preserve all completion tests and acceptance criteria in the handoff.

## Adaptive topic packet

A substantial topic may contain the following, in the order that best teaches the subject:

### 相关源文件

List only files actually used in this topic, preferably grouped by role when the list is long:

```text
- path/to/public-interface
- path/to/implementation
- path/to/behavior-test
- path/to/design-note
```

### 目的与范围

State the topic's role in the larger system, the questions it answers, and any important exclusions. A short transition can serve this purpose; the exact heading is optional.

### 心智模型 / 全局概览

Give the reader the global shape before file-, class-, function-, rule-, or stage-level detail. Choose the form the repository actually needs: components and boundaries, call/dependency graph, transformation stages, state transitions, compilation passes, data lineage, or runtime control/data direction. Use a figure only when it materially improves the mental model.

### Applicable mechanics

Select only what the evidence and topic require:

- 核心概念 / 核心组件
- 核心表示、数据结构、规则、阶段、important fields, ownership, and relationships
- 调用 / 转换 / 依赖 / 数据流 / 生命周期 / 状态机
- API 与实现细节
- 配置、错误处理、并发、性能、可靠性或边界条件

Never create headings with no substantive content. Combine adjacent dimensions when that makes the narrative clearer.

## Evidence and interpretation markers

Use these markers deliberately:

```markdown
**来源：**
`path/to/component:120-168`

**解读：**
<engineering meaning, trade-off, invariant, or consequence>
```

For a figure:

```markdown
*图 N.M：<caption>*

**图片解读：**
<components, arrow semantics, boundaries, and what to notice>

**解读：**
<the broader engineering implication, if one is useful>
```

`图片解读：` decodes what the visual says. `解读：` explains why the fact or visual matters. Do not collapse both into generic praise or repeat the caption.

## Exclude source and conversion artifacts

Normalize incidental source-document or conversion noise rather than imitating it:

- duplicate `内容提要` headings;
- page anchors and page-number fragments;
- interleaved two-column sentences;
- broken paths, symbols, and image captions caused by line wrapping;
- invalid pseudo-ranges such as `$10^9$`, truncated ranges, or missing separators;
- empty code blocks and duplicated caption text.

The target is the editorial method, not the incidental formatting of a converted PDF.

## Closing sections

`本章小结` should state the conclusions a reader should retain: codebase role, decisive mechanisms, invariants, trade-offs, and practical consequences. Do not merely repeat subsection names.

Complete chapters should normally end with thought questions and answers. Apply the detailed rules in [visuals-and-questions.md](visuals-and-questions.md).
