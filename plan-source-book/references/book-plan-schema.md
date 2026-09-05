# Source-Book Planning Schema

Use this schema for a concrete multi-chapter plan. Adapt labels and detail to the requested language and format; preserve the planning information rather than mechanically emitting every heading. Fields marked **required** must be present or explicitly unresolved. Optional dimensions should be omitted when irrelevant, not left as empty template sections.

Use `source-book-plan/v1` as the plan handoff contract and `source-chapter/v1` as the downstream chapter contract. These are Markdown workflow contracts, not machine-validation schemas. Stable IDs let writing and audit tasks refer to the same scope even when display titles change.

## 1. Book charter

Record the contract under which later chapters will be written:

| Field | Requirement |
|---|---|
| Plan contract | **Required.** `source-book-plan/v1`. |
| Working title | **Required.** Name the system and the book's teaching angle. |
| Target readers | **Required.** State their role and expected technical level. |
| Reader outcome | **Required.** Describe what readers should be able to explain, operate, debug, extend, or evaluate after finishing. |
| Prerequisites | Languages, runtime concepts, domain knowledge, and environment assumptions. |
| Included scope | **Required.** Components, workflows, APIs, and operational concerns the book covers. |
| Excluded scope | **Required.** Adjacent systems or detail intentionally deferred. |
| Evidence baseline | **Required.** Logical repository root (`.` or a stable repository identifier) and exact commit/tag/release when available. Record dirty-worktree or non-Git snapshot status; omit host-specific checkout paths. |
| Version policy | Explain whether generated files, vendored code, deprecated APIs, experimental modules, or multiple release lines count as evidence. |
| Output constraints | Language, approximate depth, format, diagram syntax, and any requested chapter count. |

Do not infer a clean or stable version from the current checkout. If no immutable revision is available, state the snapshot date and the risk that references may drift.

Plans must remain portable across machines. Use repository-relative source paths and project-declared commands or neutral placeholders; do not copy local home directories, checkout roots, virtual-environment locations, or interpreter paths into the deliverable.

## 2. Evidence inventory and explanatory spine

Summarize the evidence surfaces that determine the book structure. This is a planning inventory, not a dump of every repository file.

Cover, when present:

- architecture/design documentation and ADRs;
- public entry points and language bindings;
- core interfaces, types, and implementations;
- configuration, feature flags, build files, and generated interfaces;
- tests that reveal invariants, failures, and intended usage;
- examples and quick starts that define the user journey;
- benchmarks and performance methodology;
- deployment, observability, migration, and troubleshooting material.

Then state the **explanatory spine** in the form natural to the target codebase. Examples include:

- runtime system: `caller → public API → coordination/state → backend → completion/observability`;
- compiler or transformer: `input → parse → intermediate representation → passes/rules → output`;
- stateful application: `event → validation → state transition → effects/persistence → presentation`;
- data or build repository: `sources → dependency graph → transformations → artifacts → verification`.

Choose only the applicable form and use real boundaries; the notation is illustrative. Identify the concepts that must be introduced once before later chapters can depend on them.

## 3. Reader journey and chapter dependency map

Explain the progression in one short paragraph, then provide a dependency table:

| Chapter | Reader question answered | Requires | Enables |
|---|---|---|---|
| N. Title | The concrete question readers can answer | Earlier chapters or concepts | Later work made understandable |

Useful progression patterns include orientation → first success → public surface → architecture → internal workflows → reliability/performance → deployment/integration → reference. Choose the sequence that fits the repository; it is not a mandatory table of contents.

Flag dependencies that are:

- **hard** — the later chapter would be unintelligible without the earlier concept;
- **soft** — the earlier material merely improves context;
- **external** — depends on knowledge outside the planned book.

Check that no chapter depends on a concept taught only later.

## 4. Chapter cards

Create one card per chapter. Each card should be detailed enough to hand off to a chapter writer.

### Chapter N — `<title>`

- **Chapter ID:** a stable, repository-neutral slug such as `ch-core-flow`; do not derive workflow identity solely from mutable display numbering.
- **Role in the book:** why this chapter exists at this position.
- **Reader outcome:** observable understanding or ability gained.
- **Prerequisites:** earlier chapters and external knowledge.
- **Core questions:** normally a small set of high-value questions, not a list of headings.
- **Topic Packets:** use the packet schema below.
- **Evidence set:** primary files or directories known to support the chapter; distinguish verified files from search candidates.
- **Planned visuals/tables:** IDs from the visual plan, if any.
- **Out of scope / handoffs:** material owned by another chapter.
- **Version risks and open questions:** unstable code, missing tests/docs, conflicting behavior, or decisions that require later investigation.
- **Acceptance criteria:** chapter-specific proof that the planned coverage is complete.

Do not assign exact `path:line-line` references before they have been verified against the chosen revision. During planning, file and symbol granularity is usually sufficient; reserve line-level evidence for chapter production unless the user explicitly requests a citation map.

## 5. Topic Packet schema

A Topic Packet is the planning unit beneath a chapter. It represents one coherent question or mechanism, not a fixed bundle of generic headings.

For each packet record:

| Field | Requirement |
|---|---|
| Packet ID | **Required.** Stable within the plan, such as `ch-core-flow/main-path`; preserve it through writing and audit. |
| Packet title | **Required.** A concept, workflow, lifecycle, API surface, or operational concern. |
| Purpose and boundary | **Required.** What it explains and what it deliberately leaves elsewhere. |
| Reader questions | **Required.** The questions the finished packet must answer. |
| Planned evidence | **Required.** Relevant design docs, interfaces, implementations, tests, examples, configuration, or benchmarks. Mark `verified` versus `candidate`. |
| Explanation path | Choose what fits: components, call/dependency graph, transformation/compilation stages, data lineage, state/lifecycle, API behavior, failure path, configuration, performance, or trade-offs. |
| Visual/table need | Create one only if relationships, sequence, state, or comparison would be materially clearer. |
| Engineering interpretation | Design intent, invariants, trade-offs, or operational meaning that should be investigated; label hypotheses as inference. |
| Completion test | Evidence-based condition that shows the packet is ready, such as a traced normal and failure path or a reconciled API/implementation contract. |

Packets intended for source-grounded chapter writing should ultimately support this reasoning chain:

`What → Evidence → How → Why → So what`

The plan identifies the needed evidence and analysis; it does not pre-write the resulting prose.

## 6. Source coverage matrix

Map important source areas to their pedagogical owner:

| Source area / symbol | Evidence role | Canonical chapter + packet | Secondary use | Status / gap |
|---|---|---|---|---|
| `path/or/module` | API, implementation, test, config, benchmark, etc. | Where it is first taught | Later recap/reference only | verified, candidate, missing, version-sensitive |

The matrix must make these failures visible:

- critical subsystems with no chapter owner;
- chapters supported only by overview documentation and no implementation/test evidence;
- high-value tests, examples, or failure paths that are never used;
- one source area redundantly explained in several chapters;
- performance claims lacking reproducible methodology or environmental context.

Coverage is semantic, not numerical. A large file list is not evidence that the important behavior is covered.

## 7. Diagram and table plan

Plan visuals only where they improve the reader's mental model.

| ID | Chapter / packet | Form | Question answered | Nodes/data needed | Source basis | Required interpretation |
|---|---|---|---|---|---|---|
| V-N | Location | architecture, sequence, transformation, dependency, state, ownership, data-lineage, comparison table | What the reader learns | Major entities, stages, edges, or states | Files/symbols that substantiate it | What the prose after the visual must explain |

For every planned visual, require the eventual chapter to explain components or states, flow direction, boundaries, and the main engineering implication. Avoid decorative diagrams and multiple visuals that answer the same question.

## 8. Terminology and deduplication plan

Assign shared concepts a canonical home:

| Term / concept | Canonical definition | First deep treatment | Allowed later use | Conflicts or aliases |
|---|---|---|---|---|

Use these rules:

- Define a term before using it as a dependency.
- Teach a mechanism deeply once. Later chapters may recap briefly and link back.
- Keep overview chapters conceptual; move field-by-field and call-chain detail to the owning internal chapter.
- Separate user-facing workflows from implementation internals unless combining them materially improves comprehension.
- Reconcile aliases and version-specific names rather than silently switching terminology.

## 9. Production order and acceptance gates

Give a recommended writing order, which may differ from publication order. Identify chapters that can proceed in parallel and those blocked by evidence gaps.

Apply the following book-level gates:

### Baseline gate

- Audience, learning outcome, scope, and exclusions are explicit.
- The repository revision or snapshot status is recorded.
- Version-sensitive evidence is identified.
- Source and command references are portable and contain no accidental host-specific paths.

### Structure gate

- Every chapter answers a distinct reader question.
- Chapter dependencies are acyclic and concepts appear before use.
- Every Topic Packet has a boundary, planned evidence, and completion test.

### Evidence gate

- The critical mental model, public workflows, core representations or state, normal paths, and important failure paths have source owners.
- Documentation, implementation, and tests are reconciled where possible.
- Unsupported claims and evidence gaps are listed rather than promoted to facts.

### Visual and duplication gate

- Every planned visual has a teaching purpose and source basis.
- Shared terminology has a canonical definition.
- Repeated material has one canonical teaching location and explicit later handoffs.

### Handoff gate

- Each chapter card is specific enough for an independent writer to begin repository investigation.
- Open questions have an owner or a stated resolution step.
- Acceptance criteria test technical coverage, not merely the presence of headings.

## 10. Cross-stage handoff

End the plan with a compact handoff manifest containing:

- plan contract (`source-book-plan/v1`), logical repository identifier, and evidence revision or snapshot;
- chapter contract (`source-chapter/v1`), chapter ID, packet IDs, a resolvable repository-relative plan reference when available, and a portable output reference for the next writing task; use a logical plan ID only when the plan artifact will be supplied separately;
- expected `document_kind` (`chapter` or `section`), lint contract (`textbook` or `custom`), and exercise mode (`answered` or `questions-only`);
- verified evidence already inspected versus candidates the writer must still verify;
- packet completion tests and chapter acceptance criteria;
- unresolved evidence gaps and any work that must not proceed until the baseline is fixed.

The writer preserves these IDs and reports material deviations. The auditor uses the same baseline and, when the plan is supplied, checks actual coverage against the named packet tests. Ad hoc single-chapter work may proceed without a book plan; do not invent a retrospective plan merely to satisfy this handoff.

Conclude with a compact **risks and unresolved decisions** list. Distinguish blockers from issues that can be resolved during chapter research.
