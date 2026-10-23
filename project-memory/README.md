# Project Memory

A Pi package for project-local **source-code knowledge**, bounded Markdown retrieval, and optional local QMD search. It is intended for reusable analysis of large repositories: call chains, state machines, concurrency, ownership, and implementation constraints, not indiscriminate conversation capture. Runtime pins: pi-memory **0.4.2** (legacy tools), QMD **2.8.3**, node-llama-cpp **3.20.0**. The package declares Pi host peers; it does not bundle host classes. No license is declared for this adapter.

## Requirements

Linux/Unix with Node.js >=22.19, npm, Bash, `flock`, and an installed Pi host compatible with pi-memory (>=0.81.1). GPU retrieval requires a compatible NVIDIA driver and CUDA libraries. The installer detects existing CUDA 12/13 toolkits (`CUDA_HOME`, `CUDA_PATH`, `/usr/local/cuda*`, `/opt/cuda`, `/data/local/cuda*`) and maps their runtime SONAMEs into the Git-ignored package `runtime/cuda/` directory. Plain Pi and CLI children inherit that loader path automatically, without fish/Bash profile edits. This does not install CUDA or change drivers/global loader settings. GPU compatibility still depends on the host and has not been established for every toolkit/platform.

## Install and initialize

For an explicit-only, globally available installation assistant, see the sibling [project-memory-init skill](../project-memory-init/README.md). Install that entry point globally, not this runtime; it guides per-project setup, separate trust approvals, and verified local-model reuse without automatically updating the shared checkout.

Update the shared Git checkout **before** installing into a consumer. On this machine the collection lives at `$HOME/skills`; on another machine clone it first. Review the package and incoming changes before execution:

```bash
# First time only (if the checkout does not exist):
# git clone git@github.com:Steam086/skills.git "$HOME/skills"
git -C "$HOME/skills" pull --ff-only
PACKAGE="$HOME/skills/project-memory"
"$PACKAGE/scripts/memory-install"

# Repeat for each consumer project; never run setup in the shared package.
cd /absolute/path/to/your/project
node "$PACKAGE/scripts/memory-setup.mjs"
pi install --local "$PACKAGE"
pi  # review/approve Pi project trust yourself if prompted
```

This uses Pi's standard **local package** mechanism: the consumer's `.pi/settings.json` points to the shared package, whose manifest loads both `extensions/project-memory.ts` and `SKILL.md`. Do not copy the NCCL `.pi` directory, install only the skill, or enable upstream `pi-memory` directly. Local-path installs reuse this checkout and its dependencies; updates to it affect every consumer on its next Pi launch/reload. They are not pinned per consumer. Review updates and rerun the locked dependency installer after pulling.

The collection is a multi-skill repository, not a root-level Pi package. Do not use `pi install git:github.com/Steam086/skills` as if it selected this subdirectory. Clone/update the collection, then install its `project-memory` directory as above. For a one-off explicit load without persistent settings use `pi -e "$PACKAGE"`.

The explicit setup creates empty project directories, `.qmd/index.yml`, and local `.pi/.gitignore` / `.qmd/.gitignore` protections. It preflights config and ignore-file safety before changes, preserves existing ignore rules and appends private-runtime rules last (idempotently). It refuses differing existing config and symlinked state, leaves existing memory unchanged, and does not grant trust, start services, edit the repository root `.gitignore`, or edit Pi settings. Run from the project root, not from the shared package or a subdirectory. `PI_MEMORY_PROJECT_ROOT` can explicitly select an absolute consumer root for scripts; the Pi session's `cwd` must match it.

Setup and package registration do not grant Pi or QMD trust. `pi install --local` can refuse to modify configuration in an untrusted project. If it does, stop and review the target's configuration and project resources. The user can personally approve the project in Pi or explicitly authorize `pi install --local --approve "$PACKAGE"` for that one command; this flag does not save permanent trust. Do not silently add it to setup. Pi project trust and QMD config trust are separate approvals.

The local package command preserves other Pi settings and does not copy code or install dependencies; the bundled installer installs the lockfile separately, skipping lifecycle scripts and automatic peer installation. No global Pi settings are changed. Avoid installing the package globally: opt each consumer in explicitly. Pi-managed git/npm installs use Pi's normal dependency installation behavior instead.

For existing projects, do not layer this over an active project-local memory bootstrap or legacy `repo-memory` skill. Review and migrate conflicting implementations manually first; the standalone setup only validates its own state/config paths and is not the old NCCL `memory-deploy` migration tool.

## Models and trust

No retrieval path automatically provisions missing models. Review `.qmd/index.yml` and explicitly approve QMD trust before GPU retrieval:

```bash
"$PACKAGE/scripts/qmd-memory" trust
"$PACKAGE/scripts/memory-models" embed  # explicit online download; requires hf and Python 3
"$PACKAGE/scripts/memory-index"        # update + incremental embedding
```

`memory-models all` explicitly provisions the additional Deep models. Public revisions and SHA256 digests are pinned in `model-sources.json`; provisioning checks GGUF magic and SHA256. Runtime weights and aliases remain in the consumer's `.pi/cache/qmd/models`. Runtime checks reject missing/non-GGUF weights. There is no trust bypass. Keyword search needs no weights; semantic uses only Qwen embeddings through the SDK's `searchVector()`. Deep loads expansion and reranking models only when requested.

### Portable shared model cache

The model provisioner requires Python 3.8+; `hf` is only needed when downloading. Shared download/cache directory precedence is `--model-dir` > `PI_MEMORY_MODEL_DIR` > `${XDG_CACHE_HOME:-$HOME/.cache}/project-memory/models`. The wrapper resolves this **before** the runtime redirects XDG_CACHE_HOME into the project. These are machine-local choices, not absolute paths committed to project configuration.

```bash
# Explicit provisioning: reuse project/shared weights; download missing weights
"$PACKAGE/scripts/memory-models" embed
"$PACKAGE/scripts/memory-models" all --model-dir /data/models/qmd

# Never download; --from implies --offline and does not write to the source
"$PACKAGE/scripts/memory-models" embed --from /mnt/models/qmd --offline
# Opt into copying when source and project are on different filesystems
"$PACKAGE/scripts/memory-models" embed --from /mnt/models/qmd --copy
# Offline lookup in the configured/default shared cache
PI_MEMORY_MODEL_DIR=/data/models/qmd "$PACKAGE/scripts/memory-models" embed --offline
```

Candidates are checked in the project first, then the selected source/cache, using manifest filenames and resolver aliases. All existing selected candidates must validate before publication; a corrupt/conflicting candidate fails rather than being overwritten or silently replaced online. Missing online models are downloaded at pinned revisions into a temporary cache directory, verified, then published without overwrite. Locks serialize cooperative online cache writes and project provisioning. Interrupted staging files are never used as valid weights; abrupt termination may leave hidden temporary directories for manual cleanup.

Same-filesystem reuse uses hard links; cross-filesystem reuse fails unless `--copy` is explicitly given, then stages and verifies a copy before publication. Existing valid files are preserved even if independently copied. Never modify shared hard-linked weights in place. Symlinked source/cache/state paths are rejected; use real paths. Offline sources may be read-only and receive no lock files. Locks are advisory, not protection against hostile concurrent filesystem mutation; network filesystems must support flock/hard links or use a local copy.

On another machine, obtain this package, set up the consumer, point `--from` at transferred weights (or explicitly download), and separately approve QMD/Pi trust. Do not transfer service metadata, tokens, trust records, CUDA loader links, or SQLite state as a deployment shortcut. Model provisioning itself never grants trust or starts services. Existing project-only caches continue to work and are not automatically copied back into the shared cache.

## Operation

### Trigger policy

Use `memory_search` at a relevant, nontrivial source investigation boundary when earlier analysis can avoid repeated exploration. The user need not say "recall". Skip simple pasted-code questions, unrelated tasks, and evidence already sufficient in the current conversation. **Source existing in the repository is not a reason to redo expensive source exploration.** Search summaries first, then use `memory_read` for selected topic IDs, sections, or zero-based character ranges (`offset`/`limit`, not line numbers or tokens). Treat stale or unanchored notes as navigation, and verify affected implementation claims against current source.

Persistence has two modes: `manual` (default, explicit user requests only) and explicitly enabled `code-research` (curated source findings at analysis milestones). Research writes require verified, reusable conclusions and repository-relative source anchors. A completed task, a tool result, or skill loading is not by itself a save trigger. Personal facts, raw logs, guesses, and secrets are not research memories.

`memory_upsert` stores a topic by stable ID with optimistic revision checks and source hashes; duplicate/unchanged records do not create a new entry. The compatibility tools `memory_write`, `scratchpad`, `memory_forget`, and `memory_restore` retain legacy operations. Legacy files are preserved, not silently migrated or replaced. Topic corrections should update the existing ID, not append a competing fact.

### Operator controls and configuration

These commands change **only the current session**, never project preferences. Only operator commands can change runtime permission; there is no mode-changing model tool:

```text
/memory-mode manual
/memory-mode code-research
/memory-mode off
/memory-access read off
/memory-access write off
/memory-access read on
/memory-access write on
```

Read and write permissions are independent: disabling reads does not disable explicitly authorized writes, and disabling writes does not block retrieval. Off suppresses both, injection, diagnostics and maintenance. Returning from off restores underlying preferences and session access overrides; it does not silently enable flags previously disabled. `memory_status` reports effective mode/access and diagnostic/maintenance health without starting QMD or reading stored bodies. These controls do not infer permissions from task keywords or negation. Legacy persistence still requires explicit affirmative intent by policy; a tool argument cannot prove that intent or semantic verification of a source claim.

For persistent project opt-in, run **from the consumer root**, explicitly:

```bash
node "$PACKAGE/scripts/memory-config.mjs" --mode code-research
node "$PACKAGE/scripts/memory-config.mjs" --mode manual
node "$PACKAGE/scripts/memory-config.mjs" --read off --write on
node "$PACKAGE/scripts/memory-config.mjs" --diagnostics off --auto-index off --warmup off
node "$PACKAGE/scripts/memory-config.mjs" # show effective preferences
```

Configuration is validated at extension load; reload to adopt CLI edits. Defaults: manual, read/write enabled, diagnostics enabled, after-write auto-index enabled, warmup disabled. The config module's `loadMemoryPreferences(root)` returns validated **ungated** preferences; `loadMemoryConfig(root)` and `resolveMemoryConfig(base, overrides)` return effective off-gated configuration. Session controls resolve against the retained underlying preferences, not a previously gated result. Unknown/invalid configuration fails closed.

### Retrieval and legacy compatibility

The eight tools are `memory_search`, `memory_read`, `memory_upsert`, `memory_write`, `scratchpad`, `memory_forget`, `memory_restore`, and `memory_status`.

- `memory_upsert`: `{id,title,summary,content,reason:"explicit"|"analysis",verified?,anchors?:[{path,symbol?}],tags?,expectedRevision?}`. Analysis requires research mode, `verified:true`, and nonempty anchors. Existing replacements require the current revision; unchanged writes are no-ops. Source hashes are captured by the store, not supplied by the caller.
- `memory_read`: `{id,section?,offset?,limit?,searchId?}`. Offsets/limits are JavaScript UTF-16 **character** counts, including within a selected Markdown section. Responses include revision, freshness, `truncated`, and `nextOffset` when incomplete. Anchored topics include up to two bounded path/symbol `anchors`, `sourceCount`, `anchorsOmitted`, and `sourceView:"sources"`. For complete provenance, call `memory_read` with `{id,view:"sources",offset?,limit?}`: its `content` is a character-paginated JSON array of stored path/symbol/hash records (not source-file bodies). Concatenate content pages before parsing that array; offsets remain character counts, not source indexes. Metadata and preview count toward the same total response budget; small budgets may omit the preview. The source view honors read/off gates. Use `target:"topics"` with optional `cursor`/`limit` for bounded metadata listing.
- Legacy reads accept `target:"long_term"|"scratchpad"|"daily"|"list"`, optional daily `date`, and character ranges; daily listings use entry offsets. `scratchpad action:"list"` is independently read-gated. Legacy files are never auto-migrated. Legacy mutations use a separate fail-closed RMW lock and bounded receipts, without old-content previews. Append and overwrite writes retain upstream-compatible timestamp/session entry markers so forgetting a new entry does not absorb earlier stamped facts or sibling appends. Previously ambiguous unstamped entries are not automatically migrated. Whole-file replacement requires explicit `memory_write mode:"overwrite"` and genuine wholesale-replacement approval. Files over 1 MiB are rejected for explicit operator handling, not loaded unboundedly. Existing legacy recovery UUIDs remain readable; topic recovery uses `id.uuid`.
- `memory_forget` accepts a topic `id` and `expectedRevision`, or legacy `match`/`target`/`date`; `memory_restore` accepts the returned `recoveryId`. These mutations need write permission, not public read permission. Legacy matches can delete multiple blocks; inspect scope first.
- Search accepts `query`, `mode:"keyword"|"semantic"|"deep"`, and `limit`. Keyword uses only an existing trusted local QMD index through a genuine read-only SQLite connection, otherwise lexical **topic** fallback. It never opens the native writable QMD CLI store. The pinned current table/column schema, FTS layout, schema version, triggers and CJK normalization marker must already be present; old or incomplete indexes fail closed without initialization or repair. Fallback responses explicitly report `coverage:"topics-only"` and `legacy.searched:false`, with existing `legacy.availableTargets` and targeted `memory_read` instructions. An empty topic result does not mean legacy memory was searched or is absent. Read a relevant `long_term`/`scratchpad` target directly; for daily logs use `target:"list"`, then select `target:"daily"` and a date. Availability checks do not read legacy bodies or trigger maintenance. A successful empty indexed result is not retried as a fallback. Legacy indexed hits return bounded target/date/path navigation with unverified freshness, not body snippets. Semantic/deep failure is explicitly unavailable, never mislabeled lexical success. Runtime retrieval passes `--existing-service-only`: schema health is checked read-only and a missing/dead resident service is never automatically started. Explicit operator service start/warmup or permitted after-write maintenance may initialize it. Deep retrieval uses upstream expansion/reranking caches, so it reports `deep-cache-requires-write` when writes are disabled; pure vector retrieval on a healthy resident remains available with read permission. There is no read-triggered repair, model download, trust grant or retry loop. Existing pinned adapters enforce already-cached model weights. Model/service state is distinct from saved topic/legacy knowledge: resident vector queries may load cached weights and update service last-use metadata; deep queries may write QMD inference caches only while writes are enabled. Neither permission grants downloads, trust or read-time index migration. Search subprocesses have a 120-second timeout, cancellation and 256-KiB transport cap; compact tool output is separately bounded.

Default budgets: metadata index 1,800 characters plus concise stable routing policy; total search JSON 2,400 characters / 5 results; read JSON 6,000 characters. Metadata and JSON escaping count toward retrieval budgets. Configured maxima are index 12,000, search 24,000, read 30,000 characters and 50 search results. `limit` cannot increase configured search limits. Extremely small budgets can fail explicitly instead of returning a nonadvancing page. Topic content is capped at 24,000 characters. Search IDs support explicit read linkage; pass only the ID of the search whose result you selected.

After successful mutations only, auto-index debounces and serializes QMD update/embed. No startup catch-up or read-time indexing runs. Unchanged writes do not schedule work. Maintenance requires existing local QMD configuration/index and trust; absence is reported as unavailable, not repaired. Off, write-disable and shutdown cancel pending maintenance. Warmup is opt-in and requires trusted cached models. Pending searches have cancellation/generation state separate from maintenance. Read-disable, off and shutdown invalidate pending results and fallback, even if a backend returns late success or an ordinary killed-process error; off then on cannot revive the old call. Cancelling a subprocess stops waiting for it; a request already accepted by the retained QMD daemon can finish server-side. Use explicit service stop for GPU release.

### Content-free diagnostics

```bash
node "$PACKAGE/scripts/memory-report.mjs"
```

Diagnostics are lazy private files in `.pi/memory-state/diagnostics` (default retention three files of 1 MiB each), not a memory source. Off/diagnostics-disabled never call disk-writing hash APIs. Events use project-salted HMAC identifiers and session/plugin/policy versions, never prompts, queries, source paths, bodies, transcripts or raw backend errors. Search telemetry distinguishes persistence `mode`, `requestedMode` (keyword/semantic/deep), and actual `backend`; `retrieval.requestedModes` aggregates requests including failures. Only explicitly supplied, valid `memory_read.searchId` links a selected result to a search; timing is never used to infer relevance. Diagnostic failures are nonfatal and visible via `memory_status`; instance health counters reset when effective configuration changes.

Finalized host `turn_end` assistant usage uses message provider/model/counts/cost, deduplicated by session and message entry ID. Missing counts remain unknown. Error/aborted messages with all-zero counters and no provider response ID are conservatively classified `measurement:"unknown-zero-error"`, with null counters/cost, rather than assumed measured zero. Other supplied usage is `host-reported`; absent usage is `unavailable`. `actualUsage.byMeasurement` distinguishes these from older `unspecified` events, which are not retrospectively rewritten. These are **full session assistant usage totals in retained events**, not causal memory savings. Character/4 estimates are approximate, separate from provider usage and cost. Hit rate/follow-up rate are not recall; recall requires separately labeled relevant IDs. No diagnostic feedback tool or model evaluation is enabled.

### Context and runtime boundaries

The plugin uses a bounded topic index instead of injecting long-term bodies, TODO contents, and today's/yesterday's logs. Detailed topic bodies are loaded on demand. Upstream pi-memory's automatic snapshots, startup catch-up, exit summarization, and log-copying compaction handoffs are not registered. There is no background LLM transcript summarizer. Startup model warmup is off by default; QMD remains an optional on-demand retrieval/indexing backend.

Runtime mode/access controls gate the plugin's tools, injection, and maintenance, including direct SDK execution. They do not sandbox generic file/shell tools or retroactively remove context already seen by the model. Natural-language opt-outs remain instructions to the model, not a claim of perfect automated intent detection. Use runtime controls **before** starting a clean session for strict isolation. Tool calls cannot authorize their own mode change.

Plain `pi` uses the registered package after project trust. `scripts/pi-memory` remains the stricter GPU launcher requiring trusted config and cached embeddings; use plain `pi` for model-free Markdown/lexical operation.

```bash
"$PACKAGE/scripts/qmd-memory" service status
"$PACKAGE/scripts/qmd-memory" service stop
PI_MEMORY_MODEL_IDLE_MINUTES=60 "$PACKAGE/scripts/pi-memory"
"$PACKAGE/scripts/memory-index" rebuild
```

### CUDA startup failures

If a previously started service fell back to CPU, adding libraries to a new shell cannot change that running process. Configure the existing toolkit and restart **that project's** service:

```bash
node "$PACKAGE/scripts/memory-cuda.mjs"
# For an unrecognized installation instead:
# node "$PACKAGE/scripts/memory-cuda.mjs" --lib-dir /absolute/path/to/CUDA/lib
"$PACKAGE/scripts/qmd-memory" service stop
"$PACKAGE/scripts/qmd-memory" service start --warm
```

The helper only creates package-local symlinks to existing public runtime libraries; it never downloads models, grants trust, or overwrites conflicting entries. `PI_MEMORY_CUDA_LIB_DIR` is an alternative to `--lib-dir`. The shim is machine-local: recreate it after moving the package or changing toolkits. A successful GPU warmup requires `device.gpu: "cuda"` and `gpuLayers.embed > 0`; a running CPU service is not reported as GPU success. Server failures are logged in the consumer's `.pi/qmd-state/service.log`, and the client/notification now show the actual error before any stack excerpt.

The default service lifetime is **30 minutes after last use**, configurable to 1–1440 minutes. Status polls do not extend it. Shutdown of a Pi Session does not stop the project service; explicit stop or idle expiry closes the store and releases models. Authenticated Unix-socket requests queue GPU jobs serially. This pinned adapter uses QMD's internal retention field because its public SDK does not expose retention options.

## Scope and security

Code, scripts, and dependencies resolve from the package. Markdown, recovery records, diagnostics/handoffs in `.pi/memory-state`, SQLite, QMD trust records, model cache, locks, socket, service metadata, and logs resolve only from the consumer root. No global Pi settings/auth files are edited. Do not share state directories via symlinks. Service metadata includes a local bearer token: never commit it. Setup's local ignore rules exclude `.pi/memory`, `.pi/memory-state`, `.pi/cache`, `.pi/qmd-state` (including bearer metadata, logs, and sockets), and `.qmd/index.sqlite*` (including WAL/SHM) from ordinary Git staging. The package also ignores these runtime paths locally. Ignore rules do not remove already tracked files or prevent forced staging; review `git ls-files` and staged changes before publishing.

The upstream library has module-global paths; use **one project per Pi process**. SDK callers must set `PI_MEMORY_PROJECT_ROOT` before loading the extension when `cwd` differs from `process.cwd()`. All registered tool/event/command callbacks reject a different session `cwd`; upstream lifecycle callbacks are suppressed rather than overridden. Scope checks reject symlinks but are not a sandbox against concurrent hostile filesystem changes or another process running as the same user. Never store secrets or complete transcripts.

## Validation

```bash
npm test --prefix "$PACKAGE"
# If Pi is not under npm's global root, point to its installed SDK entry:
PI_MEMORY_TEST_HOST=/path/to/pi-coding-agent/dist/index.js npm test --prefix "$PACKAGE"
```

Tests own and remove temporary projects and load the package through the installed Pi `DefaultResourceLoader`. SDK integration covers real registered tools, A/B scope, manual/research authorization, independent opt-outs, off-mode no-effects, stable structured prompt sections, bounded topic/legacy retrieval, revision/recovery/freshness, stubbed optional QMD maintenance/cancellation, and content-free telemetry. A deterministic in-process provider drives an actual host session/`turn_end` to check finalized usage and deduplication; it is not an LLM behavior evaluation. Component tests cover store scale, source/path safety, configuration, diagnostics and concurrency. Existing installer, CUDA, model-cache, service and setup safety tests remain.

No test grants trust, downloads models or starts real GPU/network work. Prompt-contract tests do not establish whether an LLM follows retrieval/persistence policy. Actual model routing, retrieval quality, token/cost savings, GPU search, live socket authorization and full idle expiry need separate approved validation. P2/model evaluation is not part of this functional gate.

## Evaluation

See [docs/evaluation.md](docs/evaluation.md) for the bounded SDK harness, public synthetic cases, rubrics, and annotated live results. This is separate from the functional gate above.

```bash
# No-network labeled retrieval through the actual registered memory search tool
node "$PACKAGE/scripts/memory-eval.mjs" --out /tmp/memory-retrieval.json
# Explicit provider opt-in; two cases, <=8 requests and <=120 seconds per case
node "$PACKAGE/scripts/memory-eval.mjs" --live --provider openai-codex --model gpt-6-astra \
  --cases costly-recall,research-milestone --out /tmp/memory-live.json
```

All state belongs to temporary fixture projects. Live calls are never part of `npm test`; provider failure stops the run without fallback. The authorized smoke observed eight completed routing passes, one token-budget cutoff, and one unattempted case. Labeled lexical recall@3 was 0.75, including a Chinese conceptual miss. These small fixtures do not establish semantic correctness, token savings, or superiority over native Claude Code/Codex memory. See [the source-backed architecture comparison](docs/comparison.md) for native Claude Code/Codex versus third-party memory designs and remaining measurement gaps.
