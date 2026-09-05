---
name: plan-source-book
description: Plan source-grounded, multi-chapter technical books or codebase guides, including audience and scope, revision baseline, chapter dependencies, topic/source coverage, and acceptance gates. Use for whole-book or substantial multi-chapter planning; do not use to draft a single chapter or ordinary repository documentation.
---

# Plan Source Book

Create an actionable book plan whose structure follows reader questions and whose technical coverage can be traced to the repository.

## Boundaries

- Plan the book; do not write chapter prose, fabricate quotations, or perform a chapter-level deep dive.
- Treat the user's requested audience, scope, deliverable format, and source revision as authoritative.
- Remain codebase-neutral. Infer the relevant architecture vocabulary, evidence types, languages, build system, and operational concerns from the target repository instead of importing assumptions from an example project.
- Do not mirror the repository tree as a table of contents. Group implementation details into concepts, workflows, and architectural boundaries that readers need to understand.
- Do not force every chapter or Topic Packet to contain identical subsections. Include APIs, configuration, failure handling, performance, deployment, or tests only when relevant and supportable.
- Mark unverified source candidates and inferred design intent as such. Never invent file paths, line ranges, benchmarks, or ownership relationships.
- Keep durable deliverables portable: cite repository files relative to the repository root, describe that root as `.` or a logical placeholder, and do not persist host-specific absolute paths, virtual-environment locations, or interpreter paths unless the user explicitly requests an environment-specific runbook.

## Workflow

1. Establish the planning baseline: target readers, learning outcome, prerequisites, included and excluded scope, logical repository root, revision or snapshot, and output constraints. Detect the repository's own languages and toolchain instead of assuming them. If the worktree is dirty, record that fact rather than silently treating it as a clean revision.
2. Inventory the evidence surfaces needed for planning: architecture and design documents, public APIs, core implementations, types, configuration, tests, examples, benchmarks, build/deployment files, and operational material. Sample enough code to understand boundaries; exhaustive line-by-line reading belongs to chapter production.
3. Identify the explanatory spine and reader journey. Choose the form that matches the codebase—such as component architecture, call graph, transformation pipeline, state model, dependency graph, compilation flow, data lineage, or runtime topology—and sequence chapters by conceptual dependency and practical learning progression, not directory order.
4. Divide each chapter into coherent Topic Packets. Give every chapter and packet a stable ID, and give each packet a purpose, reader questions, planned evidence, likely explanatory form, and completion test.
5. Build chapter dependency, source coverage, diagram/table, and terminology/duplication plans. Assign each shared concept one canonical teaching location and distinguish later recap from repetition.
6. Apply acceptance gates. Surface evidence gaps, version-sensitive areas, and unresolved choices instead of hiding them in the outline.

Before producing a concrete plan, read [references/book-plan-schema.md](references/book-plan-schema.md) and use the portions relevant to the requested deliverable. If the user provides an existing schema, preserve it while ensuring the same planning invariants are represented.

## Quality bar

A plan is ready for chapter writing only when another author can determine what each chapter teaches, why it appears at that point, which repository evidence must be inspected, which visuals are worth producing, how overlap is controlled, and what must be true before the chapter is accepted.
