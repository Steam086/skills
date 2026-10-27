# Installation workflow and authorization boundaries

## 1. Scope and preflight

The commands below are Bash templates, not an unconditional installer. `PACKAGE`, `TARGET`, and `MODEL_SOURCE` must be reviewed, explicit paths; always quote them. Check each exit status and stop subsequent steps on failure.

- Record the logical target path and `realpath`. For Git projects, check the root with `git -C "$TARGET" rev-parse --show-toplevel`; for non-Git directories, require an explicit target.
- Check whether `PI_MEMORY_PROJECT_ROOT` points to another project. Set it to the target real path only in the installation subshell, without affecting other sessions.
- Inspect target `.pi/settings.json`, `.pi/extensions`, `.pi/skills`, `.agents/skills`, `.qmd/index.yml` / `index.yaml`, and applicable global resource declarations. Identify duplicate runtimes, legacy `repo-memory`, `.repo-memory`, and custom bootstraps. Never print global auth files or credentials. Stop on active conflicts and request manual migration, except for the specific duplicate-skill normalization in section 4.
- Verify that the package manifest declares both `SKILL.md` and `extensions/project-memory.ts`, and that required scripts, lockfile, and `model-sources.json` exist. Read the package README completely. Stop on incompatible versions instead of applying outdated commands.
- Check Node.js >=22.19, npm, Bash, flock, and Pi availability. Model provisioning requires Python 3.8+; only online downloads require hf. GPU validation requires compatible NVIDIA/CUDA.
- Never share project state through symlinks. Package setup also performs safety checks. Do not copy another project's `.pi`, QMD trust records, or service metadata.

## 2. Package source and updates

Resolve in order: an explicit user-specified package path, the sibling `../project-memory` of this skill's real directory, then ask for a source.

The collection repository is `https://github.com/Steam086/skills.git`; its root is not a Pi package. Initial acquisition requires network and destination approval, for example:

```bash
git clone https://github.com/Steam086/skills.git "$CHECKOUT"
# If a version was requested, select the reviewed commit/tag in the checkout.
PACKAGE="$CHECKOUT/project-memory"
```

Do not use `pi install git:github.com/Steam086/skills` as though it selected a subdirectory. Never automatically run `git pull`, change an existing checkout's version, or run update scripts during initialization. Shared code and dependency changes affect all consumer projects; updates require separate authorization and diff inspection. Do not install, remove, or replace legacy global entry points during initialization.

## 3. Authorization checklist

| Operation | Requirement |
| --- | --- |
| Read-only preflight | Within the current installation request |
| Create project state and register the local package, including section 4 normalization | Explicit installation request; explain affected paths first |
| Install missing dependencies | Explain network access and shared node_modules changes; obtain approval |
| `pi install --local --approve` | Explain and obtain approval for this command only; no permanent trust |
| QMD trust | Review generated configuration and obtain explicit trust approval |
| Reuse models from a specified directory | Explicit reuse request; verify before publishing; never overwrite |
| Cross-filesystem copies or online model downloads | Explain disk/network costs and obtain approval |
| Indexing and GPU warmup | Explicit validation approval; explain GPU memory use and the default 30-minute idle shutdown |
| Update shared package or global settings | Outside default installation scope; separate authorization |
| Permanent Pi trust | User confirmation in Pi's interactive interface |

Approval can be grouped: “Install into TARGET; allow one-command Pi installation approval, trust the generated QMD configuration, reuse embedding from MODEL_SOURCE, and validate GPU; no downloads or shared-package updates.” Unmentioned permissions remain ungranted.

## 4. Dependencies, initialization, and registration

Check `npm ls --omit=peer` in the package directory and verify the lockfile. Skip reinstalling satisfied dependencies. For missing or mismatched dependencies, obtain approval before running:

```bash
"$PACKAGE/scripts/memory-install"
```

The installer uses the lockfile, skips lifecycle scripts and automatic peer installation, and configures the package-local CUDA loader. It does not install CUDA/drivers or change the global loader. If dependencies are already satisfied but existing CUDA needs configuration, explain before running `node "$PACKAGE/scripts/memory-cuda.mjs"`; use `--lib-dir` for a custom path.

Run subsequent commands in a subshell rooted at the target:

```bash
cd "$TARGET"
export PI_MEMORY_PROJECT_ROOT="$(pwd -P)"
node "$PACKAGE/scripts/memory-setup.mjs"
pi install --local "$PACKAGE"
```

If registration is rejected because the project is untrusted, stop and review its resources. Retry with `pi install --local --approve "$PACKAGE"` only after explicit approval; never add approve automatically. Skip registration when already registered, but still perform the skill-source check below. Preserve existing settings.

Setup creates `.pi/memory/`, `.pi/cache/qmd/models/`, `.pi/qmd-state/`, `.qmd/index.yml`, and local ignore files. It does not edit the root `.gitignore`, AGENTS.md, or Pi settings, grant trust, or start services.

### Select exactly one skill source

Perform this check after registration and on repeated installations, even when the package is already registered. A plain package string loads its declared skill as well as its extension; an automatically discovered project skill with the same name causes a collision.

1. Inspect `.agents/skills/project-memory/SKILL.md` and `.pi/skills/project-memory/SKILL.md`, as well as any other discovered or explicitly configured skills named `project-memory`. A valid project-local skill must have valid frontmatter, `name: project-memory`, a nonempty description, and instructions reviewed for compatibility with the selected runtime. Do not infer validity from file existence alone.
2. If exactly one valid project-local skill is available, retain it and disable only the package's skill resources. In the target `.pi/settings.json`, convert the matching package string to an object with the same `source` and `"skills": []`. For an existing object, change only its `skills` field; preserve the source, extension filters, and all other properties. Match local package identity by resolved path, not just the source's spelling. Relative sources resolve from the containing settings directory.
3. If no project-local skill exists, keep the package skill enabled. For a fresh installation, leave the package string or omit the object's `skills` field. If an existing filter disables the package skill and no alternative exists, explain the missing-skill state and obtain approval before changing an intentional filter. Do not blindly add `"skills": []` to every installation.
4. Malformed or incompatible local skills, multiple local/global skill sources, duplicate runtimes, and ambiguous registrations require clarification. Do not delete, rename, overwrite, or migrate skills to silence warnings. This exception permits only normalization of the known package-skill/project-skill collision, not arbitrary conflict repair.

Example when a valid project-local skill exists (retain the actual existing source rather than copying this placeholder):

```json
{
  "packages": [
    {
      "source": "/absolute/path/to/project-memory",
      "skills": []
    }
  ]
}
```

Merge this change into existing settings; never replace unrelated package entries or configuration. Do not remove the runtime package, add `"extensions": []`, or modify the shared package's `pi.skills` manifest. Disabling package skills must not disable memory tools. If existing extension filters already exclude the runtime, report it instead of claiming successful installation.

Validate JSON, package identity, runtime-extension selection, and exactly one selected skill source. After `/reload` or restarting Pi, check that `project-memory` has no collision diagnostic and that the expected memory tools remain available. If interactive loading was not checked, report only static validation, not confirmed session activation.

## 5. Reuse local models

Select `embed` from `model-sources.json` by default; select `rerank` and `generate` only when Deep is requested. Check the target cache first, then explicitly supplied source directories. Never scan the whole filesystem, the user's home, or other projects. `/data/models/qmd` is only an example user-selected directory, not a prerequisite.

Use the package provisioner rather than writing ad hoc copying logic. Python 3.8+ is required; hf is needed only for online downloads:

```bash
# --from implies offline: no source modification or download.
# MODEL_SOURCE must be an explicitly confirmed real path.
"$PACKAGE/scripts/memory-models" embed --from "$MODEL_SOURCE" --offline
# Add --copy only for an approved cross-filesystem copy.
# "$PACKAGE/scripts/memory-models" embed --from "$MODEL_SOURCE" --offline --copy
# Without a source, check only project and default/configured shared caches, offline.
"$PACKAGE/scripts/memory-models" embed --offline
```

Online shared-directory precedence is `--model-dir` > `PI_MEMORY_MODEL_DIR` > `${XDG_CACHE_HOME:-$HOME/.cache}/project-memory/models`. The script resolves defaults before changing the project environment. If the parent shell already sets XDG_CACHE_HOME to the project cache, explicitly supply the confirmed shared directory to avoid inheriting that default. `--from` and `--model-dir` are mutually exclusive: the former is read-only offline import; the latter permits explicitly authorized downloads to the shared cache. Never silently fall back to network access. For Deep, replace `embed` with `all`.

The provisioner enforces these rules. On failure, report the cause instead of bypassing checks with temporary scripts:

1. Read `file`, `cacheName`, and `sha256` from the reviewed manifest. Accept ordinary basenames only; reject separators, absolute paths, `.`, and `..`.
2. Candidates use `file` or `cacheName` in the target/source directory. Require regular files without following project-state symlinks, check the first four bytes for `GGUF`, and stream the full SHA256 calculation against the manifest.
3. Verify all existing selected candidates and targets before publishing weights. Stop on mismatched content, aliases, or symlinks; preserve evidence without deleting files. After explicit download approval, verify each newly downloaded model before publishing it.
4. Reuse valid targets and aliases. Publish missing targets through exclusive hard-link creation, never overwrite. On EXDEV, stop, obtain copy approval, then exclusively create and reverify a copy. Do not silently fall back to copying on other errors. New aliases are hard links to target weights, so the two names do not duplicate storage.
5. Do not chmod or rewrite hard-linked models: they share an inode with their source, so in-place changes affect other consumers. Choose copying for independently mutable files. Record source, target, verification result, and reuse method.

Do not automatically replace mismatched source files through network downloads. Only after explicit download approval run:

```bash
"$PACKAGE/scripts/memory-models" embed
# Full Deep models, only when explicitly requested:
# "$PACKAGE/scripts/memory-models" all
```

The download script uses hf and Python 3, pins revisions, and verifies SHA256. Never request access tokens in chat; direct users to hf's normal authentication workflow when needed.

## 6. Trust and validation

Summarize `.qmd/index.yml`: only project `.pi/memory/**/*.md` is indexed, recovery is excluded, and embed/generate/rerank model identifiers are expected. Check for unexpected hooks, external paths, or custom models. After explicit authorization:

```bash
"$PACKAGE/scripts/qmd-memory" trust
node "$PACKAGE/check-memory-config.mjs" --require-trust --models=embed
```

Only with runtime-validation approval:

```bash
"$PACKAGE/scripts/memory-index"
"$PACKAGE/scripts/qmd-memory" service start --warm
"$PACKAGE/scripts/qmd-memory" service status
```

GPU success requires both `device.gpu == "cuda"` and `gpuLayers.embed > 0`. A running service or CPU fallback does not establish GPU success. Do not load extra Deep models, create fake memories, or modify source code for validation. A fresh empty memory store normally indexes zero documents and may have no vector index; this does not establish successful retrieval over documents.

On CUDA failure, inspect this project's `.pi/qmd-state/service.log` and report only necessary error summaries, never service tokens. Restarting a project service after modifying an existing CUDA loader can affect active sessions; explain before doing so. Without GPU or models, report “registered; semantic/GPU behavior unverified.” Do not bypass trust or pretend success. Keyword retrieval needs no model weights.

Finally inspect consumer-project `git status --short`, `git check-ignore`, and tracked files: ignore rules do not protect already tracked sensitive files. Never read/print bearer metadata. Never commit memory, models, service tokens, logs, or trust records, and do not automatically commit consumer configuration. Report package path, target real path, registration and selected skill source, model source/cache paths, QMD trust, GPU validation, and remaining steps. Ask the user to start Pi from the target root and personally confirm project trust; one process uses one project. If not checked in interactive Pi, do not claim resources are active in the user's session.
