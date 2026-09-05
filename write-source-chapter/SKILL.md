---
name: write-source-chapter
description: Write or revise Chinese source-code-grounded textbook chapters and architecture deep dives for codebases in any language or domain, with verified repository evidence, engineering interpretation, diagrams, summaries, and thought questions. Use for substantial teaching-oriented repository documentation; do not use for ordinary bug fixes, code reviews, or short technical answers.
---

# Write Source Chapter

Write a technical chapter that teaches how the repository works. The governing chain is:

`What → Evidence → How → Why → So What`

Do not stop at paraphrasing code. Establish the right whole-mechanism mental model before local implementation detail, distinguish observed facts from interpretation, and make important claims traceable to verified `path:line-line` locations. Depending on the repository, that model may be a component architecture, call graph, transformation pipeline, state model, dependency graph, compilation flow, data lineage, or runtime topology.

## Load the relevant guidance

- Always read [references/textbook-style-contract.md](references/textbook-style-contract.md) for the chapter and topic-packet contract.
- Always read [references/evidence-contract.md](references/evidence-contract.md) before citing or interpreting source material.
- Read [references/chapter-types.md](references/chapter-types.md) when selecting or adapting a chapter shape, or when a draft mixes multiple chapter purposes.
- Read [references/visuals-and-questions.md](references/visuals-and-questions.md) for a complete chapter, or whenever diagrams or thought questions are requested.

Apply the contracts to the target repository's actual domain. Names and examples in the references illustrate an editorial method; they do not imply a particular programming language, runtime, architecture, build system, or exemplar codebase.

## Workflow

1. Confirm the requested deliverable, reader level, repository scope, output location, and evidence baseline. Use the current worktree unless the user names a revision; do not silently substitute a different revision. Discover the repository's own toolchain and terminology rather than assuming either. If a book plan is provided, preserve its plan/chapter contract versions, chapter/packet IDs, baseline, document kind, lint contract, exercise mode, boundaries, and acceptance criteria in document metadata or an adjacent handoff record.
2. Inspect the smallest sufficient evidence set. Follow public entry points into declarations, implementations, tests, configuration, design documents, and benchmarks as relevant.
3. Build a mental-model-first outline. Choose the explanatory spine that matches the codebase, then establish its boundaries, responsibilities or stages, invariants, and main path before describing individual functions or files.
4. Draft adaptive topic packets. Include only applicable dimensions; never emit empty sections merely to satisfy a template.
5. Pair important facts with precise evidence, then explain how they compose and what they mean. Mark unsupported-but-reasonable conclusions explicitly as `推断：`.
6. For a complete chapter, add high-information conclusions and reasoned thought questions. For a targeted section or revision, preserve the requested scope instead of forcing the full chapter shell.
7. Recheck citations against the evidence baseline and perform the quality checks below. When working from a plan, return a packet conformance table with `Packet ID | completion test | status | verified evidence | deviation/gap`; keep workflow metadata out of reader-facing prose unless the user requests it there.

## Non-negotiable constraints

- Use Chinese explanatory prose; retain an important English term in parentheses at first use when that improves precision.
- List only source files actually used, using repository-relative paths.
- Keep the chapter portable: do not embed host-specific repository roots, home directories, virtual-environment paths, interpreter paths, or temporary locations. Use logical placeholders only when an environment-specific value must be discussed.
- Never invent a file, symbol, call edge, configuration default, benchmark condition, or source location.
- Do not present inferred design intent as an author-stated fact.
- Prefer concrete symbols, states, fields, and flows over generic summaries.
- Keep code excerpts short and explanatory; do not reproduce large source files.
- Follow the user's requested format when it conflicts with the default chapter shell.

## Completion check

Before delivery, verify that:

- the reader gets a whole-mechanism mental model appropriate to the codebase before low-level mechanics;
- important claims have valid, minimal `path:line-line` evidence;
- `来源：`, `解读：`, and, where a figure exists, `图片解读：` have distinct jobs;
- normal flow, important exceptional flow, ownership, and lifecycle are explained where relevant;
- optional dimensions are omitted when unsupported rather than filled with boilerplate;
- every inference is visibly marked and bounded;
- a plan-backed chapter has a portable `source-chapter/v1` handoff record and packet conformance table;
- a complete chapter has `内容提要`, `本章小结`, and thought questions with reasoned answers unless the user asks otherwise.
