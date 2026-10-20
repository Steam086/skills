# Project Memory

A standalone Pi package and skill for project-local Markdown memory and QMD retrieval. Runtime pins: pi-memory **0.4.2**, QMD **2.8.3**, node-llama-cpp **3.20.0**. The package declares Pi host peers; it does not bundle host classes. No license is declared for this adapter.

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

Use Pi's `memory_write`, `memory_read`, `memory_search`, `memory_forget`, `memory_restore`, `memory_status`, and `scratchpad` tools. The skill describes when to use each. The skill and the plugin's final prompt policy default to no memory-tool calls when current context/source suffices. Retrieve missing prior-project context or explicitly requested records; persist only with clear user intent. Read and write opt-outs are independent. Loading the skill grants no permission, and ordinary task completion is not an automatic save trigger. This is model routing, not enforcement of plugin lifecycle hooks: snapshots, warmup, and compaction handoffs can still run automatically. A natural-language opt-out does not disable those hooks or remove an injected snapshot.

Session startup attempts embedding warmup only after trust and cached-weight checks; without them it reports a warning and Markdown tools remain usable. Plain `pi` uses the registered package after project trust; `scripts/pi-memory` is the stricter launcher that requires trusted config and cached embeddings.

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

Code, scripts, and dependencies resolve from the package. Markdown, recovery records, SQLite, QMD trust records, model cache, locks, socket, service metadata, and logs resolve only from the consumer root. No global Pi settings/auth files are edited. Do not share state directories via symlinks. Service metadata includes a local bearer token: never commit it. Setup's local ignore rules exclude `.pi/memory`, `.pi/cache`, `.pi/qmd-state` (including bearer metadata, logs, and sockets), and `.qmd/index.sqlite*` (including WAL/SHM) from ordinary Git staging. The package also ignores these runtime paths locally. Ignore rules do not remove already tracked files or prevent forced staging; review `git ls-files` and staged changes before publishing.

The upstream library has module-global paths; use **one project per Pi process**. SDK callers must set `PI_MEMORY_PROJECT_ROOT` before loading the extension when `cwd` differs from `process.cwd()`. All upstream tool/event/command callbacks reject a different session `cwd`. Scope checks reject symlinks but are not a sandbox against concurrent hostile filesystem changes or another process running as the same user. Never store secrets or complete transcripts.

## Validation

```bash
npm test --prefix "$PACKAGE"
# If Pi is not under npm's global root, point to its installed SDK entry:
PI_MEMORY_TEST_HOST=/path/to/pi-coding-agent/dist/index.js npm test --prefix "$PACKAGE"
```

Tests own and remove temporary projects, explicitly load the package using the actual Pi SDK, register the real upstream tools, execute `memory_write`, and check A/B separation and safe startup failure. They also cover package-local CUDA SONAME setup, clean-shell loader propagation without project initialization, CUDA setup conflicts and symlink rejection, concise service-error reporting, the advertised skill metadata and final appended routing policy (including byte-stable delivery across positive, negated, and quoted prompts), failing shell environment validation with a no-network `hf` stub, ordinary Git staging protection, and missing-embedding diagnostics through a fake Unix socket and the real client. Prompt-contract checks validate loading and contents, not whether an LLM follows the policy. They do not grant trust, download models, or start GPU services. GPU search, live socket authorization, and full idle-expiry behavior require a separate approved hardware test; source-project results are not package validation.
