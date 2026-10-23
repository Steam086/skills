# Coding-memory comparison

Scope: project-local source-code understanding, not personal assistant memory. This is an architectural comparison, **not a head-to-head benchmark**. External descriptions below are based on primary-source documentation retrieved on 2026-10-22; main-branch implementations and product availability can change. Actual local evaluation evidence is in [evaluation.md](evaluation.md).

## Before and after this change

| Concern | Previous project-memory adapter | Revised adapter |
| --- | --- | --- |
| Read trigger | Explicit stored recall or necessary missing prior-session context; ordinary code work generally excluded | Relevant nontrivial source investigation can recall earlier analysis even without historical keywords; sufficient current context still skips recall |
| Write trigger | Explicit persistence request only | Manual remains default; operator-enabled code-research permits verified, anchored, reusable findings at analysis milestones; task-local no-save still takes precedence |
| Runtime control | Appended model policy; upstream snapshot/compaction hooks still active | Independent runtime read/write gates, session mode commands, pending-search cancellation; upstream lifecycle hooks not registered |
| Storage unit | One long-term file, date logs, checklist | Stable-ID topic Markdown with revision guards, source hashes, scoped duplicate no-op and recovery; legacy preserved |
| Ambient context | Up to 12,000 body characters across long-term/checklist/two days, plus wrappers/policy (16,000 overall builder cap) | Metadata index capped at 1,800 characters by default, plus stable routing policy; no topic/log bodies |
| Detail retrieval | Full legacy file reads; small snippets but no topic identity API | Summary-first search, selected topic/section, bounded character pagination, source-anchor preview and paginated provenance |
| Write response | Up to 4,000 characters of old-file preview | Compact mutation receipt |
| Compaction | Copied open TODOs/recent log lines back into log | No automatic log copying or conversation summarizer; host compaction remains separate |
| Optional indexed search | Native writable QMD open could perform maintenance | Keyword opens actual read-only SQLite; outdated index rejected, no implicit repair. Vector/deep require an existing service; deep unavailable when write permission is off because its inference cache writes |
| Diagnostics | Limited runtime/service diagnostics | Per-project metadata-only events, request/backend distinctions, selected-read linkage, actual/unknown usage provenance, labeled recall, bounded rotation and explicit reporting |

Character limits are not tokenizer counts. Comparing saturated old-body capacity with a new index cap describes a design bound, not a measured percentage reduction in total tokens. The old baseline could also have an empty memory store. Cache-stable text still occupies context and may incur cached-input charges.

## External designs

| Design | Read/write behavior established by sources | What this project adopts or differs on |
| --- | --- | --- |
| **Claude Code auto memory** | Automatic useful-note selection; concise `MEMORY.md` index loaded at startup (first 200 lines or 25KB); topic files read on demand | Same index/detail separation. This project defaults to explicit writes until research mode is enabled, uses runtime output caps, and stores source hashes/revisions. The cited docs do not establish equivalent hash-based invalidation; that is not proof it is absent from every release |
| **Native Codex memories** | Available where supported through Personalization controls. Source templates distinguish prompt-loaded `memory_summary.md`, searchable `MEMORY.md`, and detailed rollout/skill references | Similar progressive retrieval. This package is strictly one local consumer project per process and does not extract raw rollouts. Exact current native token budgets, background extraction costs and cross-version behavior were not established here |
| **Codex `AGENTS.md`** | Hierarchical persistent instructions read before work; not the same as learned native memory | Keep project policy in policy files; do not automatically duplicate it into topic memory. Static instructions are not a fair baseline for retrieval quality |
| **ifBars/codex-memory** (third party) | Recall for most repository/preference-sensitive tasks; candidate suggestion then user-confirmed save | This project uses task-relevance gating rather than a universal recall ritual, and allows standing project authorization for vetted source knowledge instead of asking for every useful finding |
| **claude-mem** (third party) | Session-start index, search → timeline → selected observations; hooks capture prompts/tool observations and asynchronously summarize | Adopts progressive disclosure, not broad activity capture or background LLM compression. Its documented search-result token estimates and savings claims are not total-cost measurements for this project |

Native Codex memories, Codex static instructions, and third-party Codex memory skills are deliberately listed separately. Do not describe Codex as having only `AGENTS.md`, or assume a native feature is available in all clients/accounts/versions.

## Token and recall evidence

This project's fixed model-visible overhead includes tool schemas, skill metadata, routing policy and the bounded index. Loading the skill, searching, selected reads, source verification and saving add task-dependent costs. Local QMD compute is not a cloud model token bill, but still uses CPU/GPU, memory and latency. Deep search can be substantially more expensive locally than keyword search.

The bounded live smoke observed eight completed routing passes; one case was incomplete and one not attempted after the cumulative token guard. It recorded 122,990 observed tokens including 85,504 cache-read tokens. Those are whole-session host-reported counters, not memory-attributable usage or savings. Recall still read all three tiny source files; this experiment **does not demonstrate avoided exploration or cheaper answers**.

The separate synthetic lexical retrieval set produced Recall@3 and MRR@3 of 0.75 on four complete positive labels; the Chinese conceptual query missed. This is not semantic/cross-language QMD evaluation and not a large-repository benchmark. No comparison model runs were conducted against native Claude Code, native Codex, or claude-mem.

For a defensible future cost comparison, keep repository revision, task set, answer-quality rubric, model/provider, thinking, cache state and repetition count constant. Report cold/warm runs separately, include extraction/write/verification costs, label relevant memory IDs independently, and compare memory-disabled against enabled as well as against external products. Reduced memory-tool usage alone is not savings; avoided repeated source exploration is the intended benefit.

## Sources

- Claude Code: https://code.claude.com/docs/en/memory
- Native Codex controls: https://developers.openai.com/codex/app/settings
- Codex memory controls corroboration: https://help.openai.com/en/articles/20001601-composer-predictions-in-codex
- Native Codex consolidation: https://github.com/openai/codex/blob/main/codex-rs/memories/write/templates/memories/consolidation.md
- Native Codex retrieval: https://github.com/openai/codex/blob/main/codex-rs/ext/memories/templates/memories/read_path.md
- Native Codex memory overview: https://github.com/openai/codex/blob/main/codex-rs/memories/README.md
- Codex static guidance: https://developers.openai.com/codex/guides/agents-md
- Third-party Codex skill: https://github.com/ifBars/codex-memory/blob/main/skills/memory-system/SKILL.md
- Claude-mem context: https://docs.claude-mem.ai/progressive-disclosure
- Claude-mem retrieval: https://docs.claude-mem.ai/usage/search-tools
- Claude-mem hooks: https://docs.claude-mem.ai/architecture/hooks
