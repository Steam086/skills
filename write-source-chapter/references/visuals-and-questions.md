# Visuals and thought questions

Use visuals and questions as teaching instruments. They must encode verified relationships, not decorate the page.

## When a visual is warranted

Prefer a diagram when prose alone makes one of these relationships hard to hold in working memory:

- architecture with several components and boundaries;
- control or data flow across three or more stages;
- lifecycle or state machine with branches;
- ownership and nesting relationships;
- a call chain with synchronous/asynchronous handoffs;
- a deployment topology or multi-layer API mapping.

Use a table for repeated-field comparisons, configuration precedence, API mappings, or alternative capabilities. Skip a visual for a single fact, a two-step path, or material already clear in a short paragraph.

## Select the smallest truthful form

- **Layered architecture:** components, boundaries, dependency direction.
- **Flow:** ordered operations, data versus control arrows, completion/failure route.
- **State machine:** states, transition triggers, terminal states, retry/rollback.
- **Sequence:** actor order and sync/async boundaries.
- **Ownership tree:** who creates, holds, transfers, and destroys an object.
- **Transformation/data-lineage graph:** how representations, records, or artifacts change across stages.
- **Dependency/build graph:** prerequisite direction, invalidation, and produced artifacts.
- **Comparison table:** same dimensions across alternatives.

Use Mermaid, PlantUML, Graphviz/DOT, D2, an existing repository-native diagram format, or a referenced image as appropriate. Follow the output document's established conventions. Do not invent an edge to make a picture look complete.

## Figure contract

Every figure needs a caption and an immediately adjacent explanation:

```markdown
*图 N.M：<specific caption>*

**图片解读：**
<identify components, explain arrow/state semantics, boundaries, and the reading order>

**来源：**
- `path/to/implementation:30-72`
- `path/to/interface:14-48`
```

`图片解读：` answers “how to read this picture?” It should state:

- what the major nodes or regions represent;
- what each arrow type means;
- where control/data enters and leaves;
- which boundaries or transitions deserve attention;
- whether exceptional paths are shown or intentionally omitted.

Add a separate `解读：` only for broader engineering consequences such as decoupling, failure isolation, latency, or maintainability. Do not repeat the caption.

For a diagram synthesized from several files, cite the files that establish its nodes and edges. Label a partially inferred relationship in the prose and, where practical, in the figure.

## Thought-question contract

For a complete chapter, normally provide about five questions, adjusted to actual scope. Include reasoned answers unless the user requests an exercise-only edition.

Cover several levels rather than recall alone:

1. architecture and responsibility boundaries;
2. an end-to-end call, transformation, dependency, data, or lifecycle path;
3. implementation rationale or an invariant;
4. a failure, concurrency, or edge case;
5. a trade-off, alternative, or scenario-based diagnosis.

Good questions require the reader to connect at least two ideas. For example:

```markdown
1. 一个输入经过核心机制后为何得到该结果？请沿适用的调用、转换、依赖或状态路径说明关键中间步骤与边界条件。

   **解：** <connect the relevant mechanisms and explain their consequences>
```

Avoid:

- asking only for a list already printed in the text;
- trivia about filenames or line numbers;
- claims in an answer that the chapter did not establish;
- universal performance conclusions from one benchmark;
- questions whose answer is merely “yes/no”.

Answers should explain reasoning, mention relevant symbols or flows, and respect the same fact/inference boundary as the chapter. They do not need to repeat all citations when the answer only recombines already cited chapter material.
