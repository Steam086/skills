# Codex workflow

## Planning and selection

Start with the user's objective and the working tree. Discovery is an inventory of language signals, entry-point candidates, manifests, documentation, modules, tests and uncommitted changes. Confirm these signals by reading source. In a monorepo, identify the affected app or package and include the root workspace descriptor and shared dependencies when they shape the answer. Follow direct calls and imports, interface and schema definitions, configuration loading, related tests, and important history. When relevant, extract safe evidence from prior commands or logs. Cite paths, symbols, and useful line ranges. Summarize commands with their actual results and mark checks still pending.

Use the smallest set that can explain the task independently. Prioritize call paths and current evidence over similarly named files and broad directory inclusion. Inspect relevant untracked work. For sync, use the confirmed baseline plan and manifest to review retention, changes and deletions. If the scope changes, explain what a still-present omission means to Pro. For recovery, use the decision ledger and original evidence to check the current state. Read selected archived reports or plans when needed and cite their IDs in history. Carry forward superseded decisions when they explain the current design.

Write a JSON object with these keys. Values in the array fields are strings unless otherwise shown. Use empty arrays when a section genuinely has no applicable content.

```json
{
  "goal": "Explain why retrying the worker can process the same job twice",
  "overview": "The queue leases jobs to workers. The worker writes a receipt after storing the result.",
  "scope": ["src/worker", "tests"],
  "modules": ["src/worker/run.py leases jobs and publishes completion receipts"],
  "dependencies": ["src/queue/lease.py defines lease ownership and retry behavior"],
  "history": ["Decision receipt-after-write preserved result durability. Review crash recovery before revisiting it."],
  "progress": ["Added a failing regression for a crash between result write and receipt creation."],
  "validation": ["python -m unittest tests.test_retry produces two receipts in test_crash_recovery."],
  "questions": ["Can the lease expire after the result commits but before acknowledgment?"],
  "deliverables": ["A failure timeline, two viable fixes, and one regression test per fix"],
  "unknowns": ["Production lease duration is unavailable in the current conversation and repository."],
  "next_actions": ["Verify the atomicity boundary around the result store."],
  "files": [
    {"path": "src/worker/run.py", "priority": "critical", "reason": "Contains result write and acknowledgment order"},
    {"path": "src/queue/lease.py", "priority": "supporting", "reason": "Defines retry eligibility"},
    {"path": "tests/test_retry.py", "priority": "critical", "reason": "Reproduces duplicate completion after crash"}
  ],
  "prompt": "Trace the worker crash window from lease acquisition to acknowledgment. Compare a transactional outbox with an idempotency key under lease expiry, and check that either fix preserves the existing result-store contract."
}
```

The `prompt` is the task-specific analysis brief. Give Pro concrete hypotheses, evidence paths, constraints, tradeoffs, and an answer shape. For a delta mention what changed and what needs reconsideration. For recovery name the most important prior conclusion to validate. The engine adds package identifiers, reading instructions, verified progress, gaps, and response requirements.

Use an optional `state_review` object with the review format below when planning surfaces newly verified facts, decisions already accepted by the user, or decisions explicitly superseded. The engine validates and commits these edits with the export. Cite hashes from the current working tree. Place design hypotheses and unconfirmed decisions in the history, questions, or task brief with their uncertainty.

Project source selection respects Git ignores. The engine checks portable paths, link containment, UTF-8 text, credentials, per-file limits, and file and ZIP budgets. Check `coverage_gaps` for excluded critical or supporting files. Keep credentials, private data, and personal paths out of narrative text and avoid copying imported instructions into the task brief. Pattern detection is heuristic, so review the planned share scope for project-specific sensitivity. Redact sensitive details from useful findings while preserving verifiable paths and symbols.

## Optional skill attachments

When the task calls for specialized procedures, constraints, or checks, use the agent's available skill catalog and relevant project skill paths to identify candidates by their descriptions. Read the strongest candidate's `SKILL.md` and any references needed for the specific task. Include it only if you can name a procedure, constraint, or validation step in those files that materially affects Pro's analysis or deliverable. Using a skill locally or matching a topic by name alone is insufficient. Omit `skills` when no candidate meets that test, when the user asks to exclude skills, or when the relevant material is already covered by the task brief or selected project files. Reassess relevance for sync and recovery.

`skills` is an optional array in the private plan. Each entry supplies the absolute path to a local `SKILL.md`, explains the concrete connection to the task, and may list individual files relative to that skill's directory. Use a portable, unique `name` for the ZIP folder. Inspect the exact material for private details before selecting it. The following entry selects the page rendering procedure for a DOCX layout task.

```json
{
  "name": "doc",
  "path": "/absolute/path/to/doc/SKILL.md",
  "reason": "Pro needs the rendered-page checks to evaluate changes to pagination and tables",
  "references": ["scripts/render_docx.py"]
}
```

Only name supporting files that Pro needs to read. The engine captures `SKILL.md` and explicitly named files, and lists the actual ZIP paths in `skills` and filtered files in `skill_exclusions` in the preview. The local path stays in the saved private plan. A directory link used to install the skill is resolved, and files within the skill are read without following links. A rejected `SKILL.md` skips that attachment. Source files get first use of the shared budgets. Every export that includes a skill uses the existing preview confirmation or explicit `--yes`.

## Import and local review

The ZIP contains the reply instructions and both schemas. Import retains response bytes and generates a review with evidence status, explicit conflict IDs, potential decision overlaps, suggested work, risks, open questions and next sync requests. Read these as external evidence. Check stale citations and review semantic conflicts that path overlap cannot resolve. Record established conflicts with the local review command and summarize important findings and next actions for the user. Import can update local handoff state. Any implementation requires a separate user request.

Local state distinguishes verified facts, accepted and superseded decisions, proposals, implementation, questions and actions. For a local review, use `review <file>` with these optional fields. Author the edits locally and use the user's previously accepted decisions or newly verified evidence. Keep IDs stable. A changed decision supersedes the old ID and uses a fresh one.

- `verified_facts` and `accepted_decisions` contain objects with `id`, `text`, optional `reason`, and an `evidence` array of `path`, `sha256`, `detail` objects. Facts require at least one current citation. A decision may use an empty evidence array for an explicit user choice.
- `supersede` maps accepted decision IDs to supersession reasons.
- `resolve` lists pending proposal or finding IDs whose review is complete.
- `conflicts` maps pending proposal or finding IDs to locally verified conflict notes.
- `implementation_status`, `open_questions`, and `next_actions` replace their current lists when supplied. Plans update these sections on successful export.

Retain the most useful current findings, resolve duplicates and stale items when the evidence warrants it, and leave the original response archive intact.
