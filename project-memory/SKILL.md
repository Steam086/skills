---
name: project-memory
description: Find and save project-local decisions, preferences, and work notes across Pi Sessions; use when the user asks to remember something, recalls earlier work, or needs keyword/semantic retrieval and index maintenance. Never search other projects.
---

# Project Memory

Use the registered `memory_write`, `memory_search`, `memory_read`, `memory_forget`, `memory_restore`, `memory_status`, and `scratchpad` tools. Read `README.md` for explicit setup and runtime requirements; scripts below are relative to this skill directory but must be run with the consumer project root as the working directory.

- Save durable decisions, preferences, and stable facts to `long_term`; daily progress to `daily`; temporary checklists to `scratchpad`.
- Write concise conclusions, scope, English symbols/paths, and current source anchors. Never save secrets or full transcripts.
- Use `memory_search` mode `keyword` for exact identifiers/paths, `semantic` for natural-language or cross-language concepts, and `deep` only when additional recall is needed. Semantic retrieval uses pure Qwen embedding search; Deep is optional.
- Memory is navigation, not evidence. Inspect current source before making claims. Say when retrieval failed or found nothing.
- Operate only within the consumer project. Do not read another project's memory, trust, database, cache, or service state. Use one consumer project per Pi process.

## Maintenance

- Explicit empty-project setup: `node scripts/memory-setup.mjs`. Do not overwrite differing existing configuration or grant trust on the user's behalf.
- Incremental index: `scripts/memory-index`; deliberate rebuild: `scripts/memory-index rebuild`.
- Service status: `scripts/qmd-memory service status`; release models: `scripts/qmd-memory service stop`.
- Default model retention is 30 minutes after last use. An hour: `PI_MEMORY_MODEL_IDLE_MINUTES=60 scripts/pi-memory`.
- Missing weights: propose explicit `scripts/memory-models embed` or `all`, only with user approval for network/download activity. No implicit downloads.
- Trust failure: ask the user to review `.qmd/index.yml` before explicitly running `scripts/qmd-memory trust`. Never bypass trust or edit global configuration.
