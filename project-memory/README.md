# Project Memory

A standalone Pi package and skill for project-local Markdown memory and QMD retrieval. Runtime pins: pi-memory **0.4.2**, QMD **2.8.3**, node-llama-cpp **3.20.0**. The package declares Pi host peers; it does not bundle host classes. No license is declared for this adapter.

## Requirements

Linux/Unix with Node.js >=22.19, npm, Bash, `flock`, and an installed Pi host compatible with pi-memory (>=0.81.1). GPU retrieval uses CUDA; provide your own compatible driver/libraries through standard system discovery or your launch environment. This package does not install CUDA or change driver/global settings. GPU/platform compatibility has not been verified for this package.

## Install and initialize

Review the package first. Set `PACKAGE` to its absolute directory and run:

```bash
"$PACKAGE/scripts/memory-install"
cd /path/to/your/project
node "$PACKAGE/scripts/memory-setup.mjs"
pi -e "$PACKAGE"
```

The explicit setup creates empty project directories, `.qmd/index.yml`, and local `.pi/.gitignore` / `.qmd/.gitignore` protections. It preflights config and ignore-file safety before changes, preserves existing ignore rules and appends private-runtime rules last (idempotently). It refuses differing existing config and symlinked state, leaves existing memory unchanged, and does not grant trust, start services, edit the repository root `.gitignore`, or edit Pi settings. Run from the project root, not from the shared package or a subdirectory. `PI_MEMORY_PROJECT_ROOT` can explicitly select an absolute consumer root for scripts; the Pi session's `cwd` must match it.

For a persistent project installation, after review use Pi's documented local package mechanism: `pi install --local "$PACKAGE"`. Pi may ask for project trust separately. Do not directly autoload the upstream pi-memory dependency. For controlled local dependency installation use the bundled installer, which skips lifecycle scripts and automatic peer installation. Pi-managed git/npm installs use Pi's normal dependency installation behavior instead.

## Models and trust

No retrieval path automatically provisions missing models. Review `.qmd/index.yml` and explicitly approve QMD trust before GPU retrieval:

```bash
"$PACKAGE/scripts/qmd-memory" trust
"$PACKAGE/scripts/memory-models" embed  # explicit online download; requires hf and Python 3
"$PACKAGE/scripts/memory-index"        # update + incremental embedding
```

`memory-models all` explicitly downloads the additional Deep models. Public model revisions and SHA256 digests are pinned in `model-sources.json`; provisioning checks GGUF magic and SHA256. Weights and aliases stay in the consumer's `.pi/cache/qmd/models`. Runtime checks reject missing/non-GGUF weights. There is no trust bypass. Keyword search needs no weights; semantic uses only Qwen embeddings through the SDK's `searchVector()`. Deep loads expansion and reranking models only when requested.

## Operation

Use Pi's `memory_write`, `memory_read`, `memory_search`, `memory_forget`, `memory_restore`, `memory_status`, and `scratchpad` tools. The skill describes when to use each. Session startup attempts embedding warmup only after trust and cached-weight checks; without them it reports a warning and Markdown tools remain usable.

```bash
"$PACKAGE/scripts/qmd-memory" service status
"$PACKAGE/scripts/qmd-memory" service stop
PI_MEMORY_MODEL_IDLE_MINUTES=60 "$PACKAGE/scripts/pi-memory"
"$PACKAGE/scripts/memory-index" rebuild
```

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

Tests own and remove temporary projects, explicitly load the package using the actual Pi SDK, register the real upstream tools, execute `memory_write`, and check A/B separation and safe startup failure. They also cover failing shell environment validation with a no-network `hf` stub, ordinary Git staging protection, and missing-embedding diagnostics through a fake Unix socket and the real client. They do not grant trust, download models, or start GPU services. GPU search, live socket authorization, and full idle-expiry behavior require a separate approved hardware test; source-project results are not package validation.
