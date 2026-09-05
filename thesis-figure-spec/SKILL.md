---
name: thesis-figure-spec
description: Authoritative hard-rule spec, geometry lint, review checklist, and subagent dispatch template for thesis and proposal draw.io figures. Use whenever generating, editing, reviewing, or linting ANY .drawio figure for the thesis or proposal — architecture diagrams, decision trees, sequence/timeline diagrams, system overviews — including casual or "make a figure for the proposal", and when extending the lint script. Normal figure work reads references/drawing-rules.md and treats scripts as black-box commands; read lint implementation only when explicitly extending/debugging it. If a drawio/drawio-skill helper is available, consult it only for low-level mechanics this spec does not restate; never use its palette, presets, font defaults, rounded-edge defaults, or vision self-check.
---

# Thesis draw.io Figure Spec

This skill is the workflow entry point for every thesis/proposal `.drawio` figure. If a `drawio` / `drawio-skill` helper is available, use it only for implementation mechanics this spec does not restate, and follow this skill on every conflict. Never apply another skill's palette, font defaults, presets (`default` / `corporate` / `handdrawn`), vision self-check, `rounded=1` edge defaults, or `curved=1` edges.

Two invariants hold across all figures:

- **Style** — cool primary + warm accent; rounded rectangles with flat fill (no shadows / gradients / 3D); solid vs. dashed lines carry distinct, legended semantics.
- **Language** — choose Chinese, English, or bilingual labels according to the thesis prose, source/reference material, official terminology, and target audience. Keep language use internally consistent within each figure.

This file is the always-loaded layer — workflow, self-check, disclosure table. Detailed authoring rules live in the on-demand files below; read them only when the workflow points you there.

**Source layers:** `scripts/spec.toml` is the default machine source for constants that the linter consumes directly (palette, font whitelist, visibility floors, density caps). `references/drawing-rules.md` is the authoring source for humans and agents: it mirrors those defaults in readable language and adds manual rules the machine cannot fully judge.

**Black-box validator rule:** during normal figure authoring, editing, review, or export, do NOT read `scripts/*.py`, `scripts/test_*.py`, or `scripts/spec.toml` to discover rules. Read [`references/drawing-rules.md`](references/drawing-rules.md), execute the validator commands, and fix the reported output. Read lint implementation files only when the user explicitly asks to debug or extend the lint implementation; read `scripts/spec.toml` only when explicitly changing default palette, font, visibility, or density constants.

**Explicit style override rule:** the palette and font table in this skill are defaults. If the prompt, a project brief, a school template, or another explicit source gives a different palette or font policy, that explicit source overrides the defaults. Before linting, copy `scripts/spec.toml` to a temporary file, update only the explicitly overridden constants, and run the validator with `--spec <tmp-spec.toml>`.

---

## Python runner

All Python command examples in this skill use `python` directly. Do not require `uv`, and do not hard-code machine-specific interpreter paths in this skill or in subagent prompts. If the current workspace mandates a specific Python executable, substitute it only when running the command locally.

---

## Mandatory workflow

Use a brief/logic/draft/final workflow. Briefs are for figure metadata and intent, Mermaid files are for logical relationships, drafts are for structure and reading order, and final passes are for strict lint compliance and print/export quality. Do not spend final-polish time on a figure whose structure is still unsettled.

### Stage 0 — Figure brief + logic

If a figure brief or Mermaid logic file already exists, read all existing companion files before drawing. Use them as the editable history for the `.drawio`: the brief records figure metadata and intent, the Mermaid file records module / edge logic, and the `.drawio` remains the final visual source.

Preferred companion-file layout:

```text
<figures-dir>/
  <name>.drawio
  <name>.brief.md
  <name>.drawio.png
  mermaid/
    <name>.mmd
```

Keep the same basename across all companion files. Put `<name>.brief.md` beside the `.drawio` so the drawing contract is visible during edits; put Mermaid in a `mermaid/` subdirectory to keep logical sketches separate from final visual sources. Use per-figure folders only if the project already follows that convention.

For a non-trivial schematic, create or update the brief and Mermaid logic before drawing:

- **Brief (`<name>.brief.md`):** canvas, ratio, figure type, language, target placement scale, reader takeaway, visual semantics / color-role notes, terminology constraints, source authority, exclusions, and open questions.
- **Mermaid (`mermaid/<name>.mmd`):** logical modules, groups, main-flow arrows, control / feedback / exception edges, and legend semantics. Keep it layout-neutral: Mermaid is an adjacency / semantics sketch, not a layout sketch. It may name semantic module / edge categories, but MUST NOT use `classDef`, `style`, theme directives, or hex colors. Put color-role requirements in the brief's visual semantics section. Do not render, import, or visually imitate Mermaid when authoring the final `.drawio`; it does not determine final draw.io geometry, colors, fonts, connector pins, or density compliance.

Before drawing, decide in the brief:

- **Canvas:** default to `1200×675` (`16:9`) unless the figure shape clearly needs another lint-allowed ratio.
- **Figure type:** pipeline, architecture overview, decision tree, timeline, comparison, or local detail figure.
- **Language:** Chinese, English, or bilingual label policy, consistent with the thesis prose and source material.
- **Reader takeaway:** the one sentence the reader should understand within 5 seconds.
- **Visual semantics:** how cool primary, warm accent, gray auxiliary blocks, solid arrows, dashed arrows, and any legend categories map to meaning. This is the only Stage 0 place for color-role requirements; Mermaid records semantic categories only, not concrete colors or styling.
- **Logic source:** the companion Mermaid path, a brief-local node / edge table, or `none` for a trivial local detail figure whose relationships are fully captured in the brief.

### Stage 1 — Draft pass

Author a rough `.drawio` focused on structure:

- Start from the brief metadata and Mermaid or node / edge logic; update them first if the intended module / edge relationships have changed. Use that logic only to confirm what exists and how it relates, then design the `.drawio` layout independently.
- Choose the canvas dimensions and approximate aspect ratio from [`references/drawing-rules.md`](references/drawing-rules.md).
- Place core modules, group frames, and main-flow arrows before tuning connector pins or typography.
- Use the approved palette directionally, but do not fine-tune every connector or subtitle cell yet.
- Keep core module labels short, source-faithful, and within the final density budget.
- Preserve the final visibility floors: visible text `fontSize ≥ 14`, auxiliary text `≥ 12`, and core module text `≥ 16`.
- Do not inspect lint scripts, tests, or `spec.toml` before drawing; `drawing-rules.md` is the condensed authoring source.

Quick-export a draft PNG for visual review. Draft export does not need `-e`, so it does not need PNG repair:

```bash
drawio -x -f png -s 2 -o name.draft.png name.drawio
```

Draft acceptance checks:

- The main flow is readable within 5 seconds.
- The figure is not obviously overcrowded and does not need to be split.
- Modules use noun phrases, abbreviations, numbering, and necessary numerics — not explanatory sentences.
- Arrow crossings, stacked edges, and text overflow are not severe enough to hide the intended structure.

If the draft fails these checks, redesign the structure before doing final lint fixes.

### Stage 2 — Final pass

Only after the draft structure is accepted, run the full final workflow:

1. **Lint** the `.drawio`, and do not final-export while any hard error remains:
   ```bash
   python .claude/skills/thesis-figure-spec/scripts/lint_drawio_geometry.py path/to/file.drawio
   ```
   If explicit font / palette overrides are provided, lint against a temporary spec:
   ```bash
   cp .claude/skills/thesis-figure-spec/scripts/spec.toml /tmp/thesis-figure-spec.toml
   # edit /tmp/thesis-figure-spec.toml to reflect only the explicit overrides
   python .claude/skills/thesis-figure-spec/scripts/lint_drawio_geometry.py --spec /tmp/thesis-figure-spec.toml path/to/file.drawio
   ```
   Treat the lint as a black-box validator. Do not open the lint source to pre-avoid errors; use the error text plus `drawing-rules.md`.
2. **Fix final geometry, typography, and routing:** connection points, waypoints, routing corridors, text-box sizing, font family warnings, and in-figure consistency.
3. **Synchronize companion history:** if the final structure differs from Stage 0, update `<name>.brief.md` and `mermaid/<name>.mmd` before final export.
4. **Export** a document-quality PNG once the lint is clean, then repair it:
   ```bash
   drawio -x -f png -e -s 3 -o name.drawio.png name.drawio
   python .claude/skills/thesis-figure-spec/scripts/repair_png.py name.drawio.png
   ```
   `-e` keeps the PNG editable; `-s 3` is the high-resolution export scale. `repair_png.py` fixes draw.io's malformed `-e` PNG chunks (truncated IEND and raw-deflate `zTXt`) — run it after every `-e` export or strict decoders / vision APIs may reject the file. SVG is supplementary: export on request, for vector embedding, or when the target document reliably preserves SVG text and strokes.
5. **Review** the exported final image against [`references/review-checklist.md`](references/review-checklist.md) — semantics, layout, and in-figure consistency.
6. **Confirm final placement** after export: scale ≥ 85%, visible font size, and caption / surrounding-label alignment.

**Never validate a final figure from the raster alone.** Exported PNG/SVG drops `fontColor`, line style, module/arrow counts, and canvas dimensions — only the `.drawio` + lint can check those. A draft PNG is useful for structure and reading-order review, but it does not replace final source lint.

**Dispatching to a subagent?** Subagents do NOT inherit your loaded skills or memory. Paste the full hard rules from [`references/drawing-rules.md`](references/drawing-rules.md) and the prompt template from [`references/subagent-template.md`](references/subagent-template.md) directly into the subagent's prompt.

---

## On-demand resources (progressive disclosure)

Read each file only when its trigger applies — keep it out of context otherwise.

| File | Read when |
| --- | --- |
| [`references/drawing-rules.md`](references/drawing-rules.md) | Authoring or editing a `.drawio`; also pasted verbatim into subagent prompts |
| [`references/review-checklist.md`](references/review-checklist.md) | Workflow step 5 — human / LLM review of the exported image |
| [`references/subagent-template.md`](references/subagent-template.md) | Dispatching a drawing task to a subagent |
| [`references/lint-implementation.md`](references/lint-implementation.md) | Extending or debugging the lint script |
| [`scripts/spec.toml`](scripts/spec.toml) | Adjusting palette, font, visibility, or density constants; never normal drawing |

**Validators** live in `scripts/`: [`lint_drawio_geometry.py`](scripts/lint_drawio_geometry.py) (loads `spec.toml` from beside it unless `--spec <path>` is provided) and [`repair_png.py`](scripts/repair_png.py), which is vendored so the skill is self-contained. In drawing workflows these files are commands to run, not references to read. For low-level XML / CLI mechanics — file skeleton, edge `<mxGeometry>` expansion, entry/exit coordinate tables, multi-line label `&#xa;` syntax, headless-Linux flags (`xvfb-run -a`, `--no-sandbox`, `HOME=<writable-temp-dir>`) — `drawio-skill`'s references are an optional lookup; the coordinate system is identical. Do not adopt its palette or presets.

---

## Pre-submission self-check

Before submitting each final figure, confirm:

- `.drawio` passes the lint with zero hard errors.
- For non-trivial schematics, `<name>.brief.md` and `mermaid/<name>.mmd` exist, share the `.drawio` basename, and match the final module / edge structure.
- PNG was exported (`-e`) from the validated `.drawio`, then run through `repair_png.py`.
- Every text-bearing cell sets `fontFamily=` explicitly — no Helvetica / sans-serif fallback and no unlisted lookalike fonts. Spot-check: `grep -oE 'fontFamily=[^;"]+' file.drawio | sort -u` returns only §5-whitelist fonts.
- Final placement scale ≥ 85%; visible text follows the §2.2 font-size floors.
- Density caps pass: canvas within global caps, visible text within limit, colored core modules ≤ 2 lines, module count and connected-edge count within limits.
- No explanatory sentences inside the figure; long formulas live in white-backed callouts.
- Formulas use HTML `<sub>` / `<sup>` + Unicode with `math="0"` — never `$…$` or `math="1"` (LaTeX is not rendered by the headless `drawio -x` export, so the raw source ships into the PNG). Lint catches `_{…}` / `^{…}` / `$…$` / `\command`.
- ≥ 2 arrow semantics ⇒ a legend is present, and line style matches semantics.
- Routing-risk endpoints set distributed `exitX/entryX` (degree ≥ 4, or ≥ 2 connections on the same side); edges don't cross unrelated shapes or stack.
- No text overflow — widen the box or shorten the label; never drop below the font floor.
