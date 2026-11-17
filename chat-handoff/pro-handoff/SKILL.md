---
name: pro-handoff
description: Explicit workflow for packaging task-specific local project context for ChatGPT Pro, importing its structured analysis, sending deltas, and recovering long-running sessions.
disable-model-invocation: true
---

# Pro Handoff

Use this workflow when the user explicitly invokes `$pro-handoff` in Codex or `/skill:pro-handoff` in Pi. Pi expands the command and appends its arguments to these instructions. Resolve `scripts/cli.py` relative to this skill directory and run it with the project's instructed Python 3.11+ interpreter. The engine runs offline. The user moves the ZIP, Prompt and response between their local agent and ChatGPT Pro.

## Choose the operation

- Bare invocation or a task description → `export --type full`. Use the user's task, the active conversation, and the selected session's current objective. If none supplies a task, provide an architecture orientation with specific open questions grounded in the project.
- `sync` → `export --type delta`. Start with the confirmed base plan and manifest from `status`. Retain still-relevant baseline files while adding new work and evidence. The engine falls back to a standalone full export when no base is confirmed. Tell the user which type was produced.
- `recover` → `recover`. Reinspect code and tests underlying the accepted decisions and verified facts, including any stale evidence flagged by `status`. Reconstruct the current architecture and implementation directly from evidence. Include prior approaches, supersession reasons, and validation results so a fresh Pro conversation can continue independently.
- `status` → `status`. Show the active session, objective, current state, generated export, confirmed delivery, and last import. Summarize only shareable excerpts from any imported advisory text.
- `sent [EXPORT_ID]` → `mark-sent EXPORT_ID`. With no ID use the selected session's latest generated export and report which one was recorded. The invocation means the user has delivered that ZIP.
- `import <path>` or `import` with pasted content → `import-response <path>` or `import-response -`. Use the actual JSON or Markdown with a fenced JSON block. Copy pasted content verbatim into stdin or a private temporary file. If neither was supplied, request it. See [Import and local review](references/workflow.md#import-and-local-review).
- `init <name>` → `init --session <name>`. `use <name-or-id>` → `use <name-or-id>`. `review` records locally reviewed state using the workflow reference.

Pass `--project` for a user-specified directory and `--session` for a user-selected session. Omit `--session` to use the active session. In a non-Git project, use the intended project directory as the root. A named export can create a new session.

## Plan and publish

1. Read [Planning and selection](references/workflow.md#planning-and-selection). Run `scan --json` and `status --json` first. For large inventories, save the scan privately and inspect the discovery fields and paths relevant to the task. Read task-relevant files and use scoped searches to trace dependencies. Use actual worktree contents, Git status, relevant prior decisions, and the conversation you can access.
2. Write a structured Handoff Plan JSON in a private temporary location. Include the evidence-backed project overview, file reasons, current progress and verification, questions, and desired Pro output. While planning, consider available local skills and include only [skill material that materially affects Pro's task](references/workflow.md#optional-skill-attachments). Use the plan's optional `state_review` for locally verified facts and decisions already accepted by the user. Write the dedicated task brief in the user's language for this run. Identify missing history or evidence explicitly. The engine takes this plan as an input.
3. Run `preview --type <full|delta|recovery> --plan <path>`. Read the selected paths, skills, exclusions and coverage gaps. Revise the plan or adjust budgets if a necessary dependency is missing. When `preview_required` is true, show the task, scope, representative source paths, counts, exclusions, and every selected skill path with its selection reason. Obtain the user's confirmation and use `--approve <preview_token>`. Keep the same plan, session, and budget. An explicit `--yes` in the user's request authorizes noninteractive export. Continue previewing for coverage, and pass `--yes` only when the user supplies it. If a preview is stale, rerun it and present the change.
4. Run the chosen publish command with the same plan and options. For sync, state the exact base and work completed since it. Report the ZIP and external Prompt paths, export ID, file counts, compressed bytes, coverage gaps and exclusion reasons. Include the generated Prompt verbatim in a copyable Markdown block using a fence longer than any backtick run in the Prompt. Link the two files, then tell the user to upload the ZIP and paste the Prompt. A generated export remains unconfirmed until `sent` or a matching Pro reply.
