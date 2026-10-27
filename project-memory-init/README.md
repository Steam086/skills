# Project Memory Init

A globally available, explicit-only Pi installation entry point. It registers the sibling `project-memory` skill and runtime for one selected project. This package contains no runtime extension and does not automatically enable memory in other projects.

## Install the entry point

Review the code, then install this subdirectory from the collection repository:

```bash
# Initial acquisition only; do not clone again or automatically update an existing checkout.
git clone https://github.com/Steam086/skills.git "$HOME/skills"
pi install "$HOME/skills/project-memory-init"
```

This intentionally installs the entry point globally, unlike the runtime, which must use `--local`. It does not install runtime dependencies, download models, grant trust, or start services. After starting Pi or running `/reload`, invoke:

```text
/skill:project-memory-init Install into ~/Sources/MyProject; first report preflight results and required approvals.
```

Example grouped authorization:

```text
/skill:project-memory-init Install into ~/Sources/MyProject; allow one-command Pi installation approval, trust the generated QMD configuration, reuse embedding from /data/models/qmd, and validate GPU. Do not download models or update the shared package.
```

Replace the example model directory with your own. By default, the package is resolved as the sibling `project-memory` of this skill's real directory; you can also specify a package path explicitly. Projects that do not need memory do not load the runtime.

## Capabilities and boundaries

- Prepare embedding only by default; Deep models are opt-in.
- Verify local GGUF files and manifest SHA256; prefer hard links and require approval for cross-filesystem copies.
- Stop on conflicts without overwriting, automatic legacy migration, or shared-package updates.
- Prevent the known duplicate-skill collision during registration and repeated installation: when exactly one valid project-local `project-memory` skill exists, set `"skills": []` on the runtime package entry, preserving its extension and other settings. Without a local skill, keep the package skill enabled. Ambiguous or incompatible skill sources require clarification.
- Keep QMD trust separate from Pi project trust; permanent Pi trust requires interactive user confirmation.
- This is an instruction-based skill, not an unattended installer or security sandbox. Correct execution depends on the agent; host controls remain responsible for important permissions.
- Requires Linux/Unix, Node.js >=22.19, npm, Bash, flock, and compatible Pi. GPU validation requires NVIDIA/CUDA. See the runtime [README](../project-memory/README.md).

This version does not automatically migrate, upgrade, or uninstall the runtime or install drivers. Keeping an old `repo-memory-init` entry point does not migrate projects; do not layer active legacy implementations into the same project. Removing a legacy global entry point requires separate source verification and authorization.

Remove this entry point with `pi remove "$HOME/skills/project-memory-init"`. This does not delete project memories or unregister project runtimes.

## Validation

```bash
npm test --prefix "$HOME/skills/project-memory-init"
# If Pi is not in the global npm directory, specify its host SDK explicitly:
PI_MEMORY_TEST_HOST=/absolute/path/to/pi-coding-agent/dist/index.js \
  npm test --prefix "$HOME/skills/project-memory-init"
```

Tests check real Pi skill discovery, explicit-only metadata, exclusion from automatic skill prompts, resource declarations, documentation references, and documented registration safeguards. They use temporary directories without installing global resources, granting trust, accessing the network, or starting GPU services. Documentation assertions do not prove that an LLM follows the workflow or that consumer settings have been rewritten correctly; runtime safety is covered separately by `project-memory` tests. This adapter does not yet declare a license.
