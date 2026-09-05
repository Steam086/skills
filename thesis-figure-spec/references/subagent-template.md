# Subagent Dispatch Template — Thesis Figures

> Entry point: [SKILL.md](../SKILL.md).
> Purpose: when dispatching a draw.io drawing task to a subagent, paste this template directly into the prompt. Do NOT just say "follow the style guide" — subagents do NOT inherit the parent's loaded skills or local memory.
> You MUST paste the full hard rules from [drawing-rules.md](drawing-rules.md) verbatim into the marked placeholder in the template below — it is the authoring source for humans and agents. This template deliberately does NOT restate those rules inline, so there is nothing to keep in sync when drawing-rules.md changes.

---

## Prompt template

```text
Task: produce one thesis draw.io figure. Unless the dispatcher explicitly asks for a draft only, output an editable .drawio source file, a final PNG, and a SELF-CHECK REPORT at the end.

You MUST comply with ALL hard rules in the drawing-rules.md spec — pasted in full below (palette, canvas + font size, containers/shapes, arrows, fonts, icons, geometry) — and submit the SELF-CHECK REPORT before delivery. drawing-rules.md is the authoring source for humans and agents; this template does not restate its rules. Do NOT read lint scripts, lint tests, or spec.toml to discover drawing rules; run validators as black-box commands and fix their output. If the task provides an explicit font or palette policy, copy spec.toml to a temporary path, edit only those explicit overrides, and pass that temporary file to the linter with `--spec`.

=== BEGIN drawing-rules.md hard rules (authoring source) ===
<<< DISPATCHER: paste the COMPLETE contents of references/drawing-rules.md here, verbatim. >>>
=== END drawing-rules.md hard rules ===

These hard rules WIN over the `drawio` / `drawio-skill` skill on every conflict — never take anything stylistic from it. Specifically: do NOT run its Step 0 preset resolution, do NOT read drawio-skill's local style preset directory, do NOT apply any built-in preset (`default` / `corporate` / `handdrawn`), do NOT use its palette (`#dae8fc`, `#d5e8d4`, etc.), and do NOT copy its `rounded=1` edge defaults. You MAY consult `drawio` / `drawio-skill` only for low-level mechanics this spec doesn't restate: file skeleton, edge `<mxGeometry>` expanded form, entry/exit table, and headless-Linux CLI tips. For draft review, use this skill's draft acceptance checks. For final review, use this skill's lint and review checklist.

PYTHON RUNNER: use `python` for this skill's Python scripts. Do NOT require `uv`, and do NOT hard-code machine-specific absolute interpreter paths. If the execution environment mandates a specific Python executable, substitute it only when running locally.

WORKFLOW: use the brief/logic/draft/final workflow from SKILL.md. If `<name>.brief.md` or `mermaid/<name>.mmd` exists, read all existing companion files before drawing. If the task is a non-trivial schematic and either companion file is missing, create or update them before drawing. Keep basenames aligned: `<name>.brief.md`, `mermaid/<name>.mmd`, `<name>.drawio`. Draft export may use `drawio -x -f png -s 2 -o <name>.draft.png <name>.drawio` and does not need PNG repair. Final export must happen only after hard lint errors are fixed against the active default or temporary spec and companion files match the final logical structure.

OUTPUT FORMAT: PNG primary for final delivery. Export with `drawio -x -f png -e -s 3 -o <name>.drawio.png <name>.drawio`, then run `python .claude/skills/thesis-figure-spec/scripts/repair_png.py <name>.drawio.png` to fix malformed embedded-PNG chunks. SVG only on request, for vector embedding, or when the target document reliably preserves SVG text and strokes.

LANGUAGE: choose Chinese, English, or bilingual labels according to the thesis prose, source/reference material, official terminology, and target audience. Keep language use internally consistent within each figure.

SELF-CHECK REPORT:
- draft_acceptance: passed / draft-only / not applicable; if failed, keep restructuring
- brief_path: <path or none for trivial local detail>; basename matches drawio: yes / no
- mermaid_path: <path or none for trivial local detail>; logic matches final drawio: yes / no
- total_edges: <count>
- edges_with_exit_entry: <count of edges with explicit exit/entry>
- routing_risk_endpoints_checked: <whether all degree >= 4 endpoints and same-side multi-connection endpoints were checked one-by-one>
- waypoint_edges: <count of edges with waypoints; if 0, state why none needed>
- edge_shape_overlap: none / fixed / unresolved
- stacked_edges: none / fixed / unresolved
- text_overflow: none / fixed / unresolved
- final_segment_lt_20px: none / fixed / unresolved
- routing_corridor_lt_60px: none / fixed / unresolved
- page_width_px: <value>
- page_height_px: <value; MUST be within global cap>
- aspect_ratio: <page_width_px / page_height_px; MUST be within allowed range>
- visible_text_count: <count units; warn/error thresholds from drawing-rules.md §2.3>
- core_module_count: <count; warn/error thresholds from drawing-rules.md §2.3>
- connected_edge_count: <count; warn/error thresholds from drawing-rules.md §2.3>
- visible_text_below_font_floor: none / list violators
- core_modules_over_two_lines: none / list violators
- core_module_labels_over_unit_limit: none / list violators
- module_language_mismatch: none / list labels whose language conflicts with the figure context or source material
- text_cells_total: <count of mxCell with non-empty value>
- text_cells_missing_fontsize: <count; MUST be 0 before delivery>
- text_cells_missing_fontfamily: <count; MUST be 0 before delivery>
- non_whitelisted_or_banned_fontfamily_used: none / list violators
- cjk_content_using_latin_font: none / list violators
- pure_latin_content_using_cjk_font: none / list violators

If any SELF-CHECK item is unresolved, keep fixing — do NOT deliver.
```

---

## Quick commands

Prefer running the repo's geometry lint:

```bash
python .claude/skills/thesis-figure-spec/scripts/lint_drawio_geometry.py file.drawio
```

The greps below are tripwires only — they cannot replace an XML-parsing lint, because attributes may wrap or reorder:

```bash
grep -c 'edge="1"' file.drawio
grep -c 'edge="1".*exitX' file.drawio
grep -c '<Array as="points">' file.drawio
```

Final source of truth: drawing-rules.md + lint output + human review.
