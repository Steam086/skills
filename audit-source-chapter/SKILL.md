---
name: audit-source-chapter
description: Audit source-grounded technical chapters for codebases in any language or domain against repository evidence and a textbook-style chapter contract. Use for reviewing, linting, or validating a draft; do not use to draft a chapter from scratch.
---

# Audit Source Chapter

Audit independently: treat the chapter as a claim set to verify, not as an explanation to endorse.

## Default behavior

- Report findings; do not edit the chapter unless the user explicitly asks for fixes.
- Keep mechanical findings separate from semantic findings.
- Never infer that a citation supports a claim merely because its file and line range exist.
- Do not invent corrected citations. If the intended location is uncertain, say what could not be verified.
- Ground the audit in the requested repository revision. If none is named, report the revision actually inspected when discoverable.
- Apply repository-native terminology and tooling. Do not assume a particular language, framework, version-control system, build system, or exemplar codebase.

## Workflow

1. Read [references/audit-rubric.md](references/audit-rubric.md).
2. Establish the chapter path, repository root, and revision. Make sure the root is materialized at the same revision or snapshot claimed by the draft. Preserve the draft unchanged during a report-only audit. If a book plan or chapter handoff record is provided, also record the `source-book-plan/v1` and `source-chapter/v1` contract IDs, chapter/packet IDs, document kind, lint contract, exercise mode, and acceptance criteria.
3. Resolve the bundled tools relative to this skill directory, not the target repository or the current working directory. Run `scripts/chapter_lint.py <draft> --document-kind <chapter-or-section> --contract <textbook-or-custom>` and `scripts/verify_source_refs.py <draft> --root <repo-root>` either as executables or with the active environment's Python 3.8+ command. Use `textbook` for the default Chinese textbook shell and `custom` when the user explicitly supplied a different structure. Add `--exercise-mode questions-only` for an exercise-only edition; otherwise answers are required. Never embed a host-specific interpreter or skill-installation path in the draft or report. Use `--json` when structured results help. These scripts are mechanical checks, not proof of factual correctness or revision identity.
4. Inspect each material claim against the cited source and surrounding implementation. Follow relevant definitions and calls when the cited excerpt is insufficient.
5. Check the mental model, diagrams, flows or transformations, lifecycle/state descriptions, configuration, error behavior, performance claims, and design interpretations that are relevant to this codebase against source evidence. If a plan is supplied, compare the draft with the planned evidence and packet completion tests; treat justified deviations as changes to record, not automatic defects.
6. Produce a concise report ordered by severity. For each finding, identify the chapter location, cited or relevant source, why it matters, and a concrete correction direction.

## Report contract

Use these sections:

1. `审校结论`: pass, pass with minor issues, or needs revision.
2. `机械检查`: script results and citation integrity problems.
3. `语义审查`: unsupported, contradicted, incomplete, or mislabeled claims.
4. `问题清单`: findings grouped as blocker, major, then minor.
5. `覆盖盲点`: important claims or source areas not verifiable from the draft.

Also record the lint contract and exercise mode used. When a book plan or a resolvable handoff/plan reference was supplied, reuse the writer's conformance columns as `Packet ID | completion test | status | verified evidence | deviation/gap`, then append `audit result`; do not hide justified deviations among unrelated findings.

State explicitly when no findings exist. A clean mechanical result does not imply semantic approval.
