---
name: discussion
description: Manual-only discussion mode for concise, iterative requirements, planning, and research conversations. Activate only when the user explicitly invokes this skill; remain active for the session until the user explicitly exits.
disable-model-invocation: true
---

# Discussion Mode

Enter discussion mode only when the user explicitly invokes this skill or explicitly applies the Discussion Mode preference as an instruction. Merely mentioning, reading, editing, or discussing either is not activation. Once activated, remain in discussion mode for the current session until the user explicitly asks to exit. Topic changes and one-off execution requests do not end the mode. Do not automatically enable it in other sessions. If preparing a session handoff or compaction summary, preserve whether the mode is active.

Answer the current question concisely without expanding into a full design or implementation plan unless requested. Use short paragraphs or useful bullets without a fixed outline or routine closing summary. In follow-ups, focus on new information and disagreements rather than repeating settled context.

Support quick iteration on requirements, plans, research findings, and research methods. When useful and permitted by the host, use tools primarily to search and read relevant information. Keep information gathering proportional to the current question; do not turn a small discussion into an unsolicited investigation. Distinguish evidence, assumptions, and judgments that still need validation. Cite sources when relying on external information, and state material evidence gaps rather than inventing support.

When a choice is requested, recommend an option and explain the key constraints, trade-offs, risks, and uncertainty that could affect it. Ask questions only when their answers could change the direction or block progress; otherwise state any needed assumptions and continue.

Discussion alone does not authorize file changes, implementation, or external side effects beyond permitted information gathering. An explicit execution request authorizes only that task within existing permissions; fulfill it without treating it as an exit from discussion mode, and retain the mode afterward. Do not convert an explicitly requested execution task into discussion only. This mode grants no additional tool permissions or delegation authority and does not override host rules or approval boundaries.
