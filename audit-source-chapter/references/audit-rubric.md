# Source-grounded chapter audit rubric

Use this rubric for a full audit. Scripts cover only the mechanical portion; semantic approval requires reading the cited source and enough surrounding code to establish behavior.

## Severity

- **Blocker**: fabricated or wrong evidence, a central architectural claim contradicted by source, an unusable citation scheme, or a draft whose source/revision cannot be identified well enough to audit.
- **Major**: a material unsupported claim, incorrect flow or lifecycle, misleading diagram, omitted failure path that changes the reader's model, or interpretation presented as established source fact.
- **Minor**: localized imprecision, weak traceability for a non-central claim, small contract deviation, terminology drift, or a useful but nonessential clarification.

Do not grade wording preferences as correctness findings.

## Mechanical checks

Run both bundled scripts before semantic review. Resolve them relative to the installed skill directory and use the active environment's Python 3 command or platform-appropriate executable invocation; do not record that host path in the report.

### Document contract

For a complete chapter, check for:

- a chapter title and `内容提要`;
- one or more `相关源文件` sections;
- distinct `来源：` and `解读：` markers;
- `图片解读：` after each Markdown image, HTML image, or supported fenced diagram;
- `本章小结`;
- a `思考题` section with numbered questions and answers;
- repeated headings and empty structural sections that may be conversion or generation artifacts.

For a focused section, do not require the complete chapter shell (`内容提要`, `本章小结`, or `思考题`). Still require a substantive heading, `相关源文件`, distinct `来源：` and `解读：` markers, and `图片解读：` for every visual. If a focused section includes thought questions, validate their answers normally.

Absence of an optional topic dimension such as configuration or performance is not a finding when the source does not support it.

The default lint contract is `textbook`. Select `custom` when the user explicitly requested a different shell; it keeps universal Markdown structure checks but deliberately does not enforce the default Chinese heading and marker names. Citation blocks should still use `来源：`, `Source:`, or `Evidence:` so repository references remain mechanically identifiable. Select `questions-only` exercise mode when the requested edition intentionally omits answers. Record both choices in the audit.

### Citation integrity

Check that every `path:line[-line]` citation:

- parses without PDF/OCR artifacts;
- is repository-relative rather than tied to a host-specific checkout path;
- resolves under the selected repository root;
- names a regular file;
- uses positive, ordered, in-range line numbers;
- points to the revision being audited.

Treat forms such as `$10^9$`, whitespace inserted into line numbers, a colon separated from its line number by a line break, or other unparseable source blocks as broken evidence. Do not silently normalize them when the intended range is ambiguous.

## Semantic checks

For every central claim, ask:

1. Does the cited excerpt directly support it?
2. Does surrounding code, configuration, documentation, or a relevant test qualify or contradict it?
3. Is the statement a source fact, a defensible inference, or speculation?
4. If it describes an ordered mechanism, are the applicable ordering, mutation/ownership, consistency/concurrency, error, and completion semantics correct?

### Mental model and boundaries

- The chosen explanatory spine—components, calls, transformations, state, dependencies, compilation, data lineage, or runtime topology—matches the implementation.
- Control, data, dependency, event, and transformation arrows have the correct direction and meaning.
- Relevant process, thread, module, UI, schema, storage, build, and network boundaries are not conflated.
- Important dependencies and alternate implementations or strategies are neither invented nor hidden.

### Representations, ownership, and lifecycle

- Important fields, rules, schemas, representations, invariants, states, and transitions are correct.
- Creation, ownership or scope, mutation/transformation, persistence, completion, and destruction are distinguished where applicable.
- Normal and important exceptional paths are both represented.
- Asynchronous behavior and synchronization are not rewritten as synchronous behavior.

### APIs and implementation

- Signatures, inputs, outputs, side effects, and important calls match source.
- Public contract and current implementation detail are labeled appropriately.
- Tests are not treated as the only implementation evidence unless the claim is specifically about expected behavior.

### Reliability, configuration, and performance

- Defaults, units, precedence, fallback, retry, timeout, and failure semantics are verified.
- Performance numbers name their source and relevant environment; complexity or optimization claims follow from evidence.
- A comment expressing intent is not treated as proof that the implementation achieves it.

### Interpretation and pedagogy

- `解读：` explains engineering meaning rather than repeating code.
- Design intent is labeled as inference unless documented or unambiguously enforced by structure.
- Diagrams have an accurate `图片解读：` and do not carry unsupported details.
- The summary states conclusions, and thought questions test architecture, rationale, flow, edge cases, or trade-offs rather than recall alone.

## Finding format

Use one entry per distinct problem:

```text
[major] M03 — A transformation is incorrectly described as in-place
章节：docs/chapter.md:182
证据：path/to/implementation:210-248; path/to/test:71-86
问题：apply_rule() constructs and returns a new state; it does not mutate the input.
影响：Readers may infer the wrong state and caching semantics.
建议：Separate input from output state and trace the value through the next stage.
```

Keep evidence needed to understand the finding close to that finding. If a claim cannot be verified, describe the attempted evidence path rather than asserting it is false.
