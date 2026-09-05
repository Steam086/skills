# Lint Script Design & Extension Guide

> Entry point: [SKILL.md](../SKILL.md). Read this file ONLY when extending or debugging `lint_drawio_geometry.py`.
> Normal drawing and review workflows do NOT need it.
> Do NOT use this file or `scripts/*.py` to pre-read validator behavior before drawing; `drawing-rules.md` is the condensed authoring mirror of the lint.

---

## Layout

```
.claude/skills/thesis-figure-spec/
  SKILL.md                       # Always-loaded workflow + disclosure table
  references/                    # On-demand rule docs (this file lives here)
  scripts/
    spec.toml                    # Default machine source: palette, fonts, visibility, density caps
    lint_drawio_geometry.py      # Loads spec.toml from beside it; parses .drawio XML
    test_lint_drawio_geometry.py # unittest suite
```

To change default allowed colors / fonts / visibility floors / density caps, edit `spec.toml` — the lint reads from it unless `--spec <path>` is provided. For task-specific overrides, create a temporary copy of `spec.toml`, change only the explicit override constants, and pass that path to the linter with `--spec`; do not edit the default spec for one figure. Python changes are only needed for new rule types. Any new or changed lint rule MUST be reflected in `references/drawing-rules.md` in author-facing language in the same change.

## Available command

Run from the project root. Use `python` directly; do not require `uv` or hard-code an absolute interpreter path in this skill. If the current workspace mandates a specific Python executable, substitute it only when executing locally.

```bash
python .claude/skills/thesis-figure-spec/scripts/lint_drawio_geometry.py path/to/file.drawio
```

Run with an explicit temporary spec:

```bash
python .claude/skills/thesis-figure-spec/scripts/lint_drawio_geometry.py --spec /tmp/thesis-figure-spec.toml path/to/file.drawio
```

Run the test suite:

```bash
python -m unittest discover -s .claude/skills/thesis-figure-spec/scripts -p 'test_*.py' -v
```

---

## Checks and severity

| Check | Severity | Automation feasibility |
| --- | --- | --- |
| `fontColor` whitelist | hard error | high |
| `fontFamily` declared on every text-bearing cell | hard error | high |
| `fontFamily` whitelist (§5) / banned-font list | hard error | high |
| Content / font consistency (CJK vs. Latin font) | warning | high |
| Latin word in a CJK-font cell not wrapped in an inline Latin `<font face>` span | hard error | high |
| `fillColor` / `strokeColor` palette whitelist | hard error | high |
| Ban gradients, shadows, rounded connector bends, curves, grids, watermarks | hard error | high |
| Canvas dimensions, aspect ratio, and global caps | hard error | high |
| Explicit `fontSize` and visible-size floors | hard error | high |
| Text total, core module count, connected edge count | warning / hard error | medium |
| Colored core module line count | hard error | high |
| Per-core-module label count | hard error | high |
| Edge base style and expanded `<mxGeometry>` form | hard error | high |
| Routing-risk endpoints (degree ≥ 4, or ≥ 2 connections on the same side) have explicit `exitX/entryX` | hard error | medium |
| Stacked edges from repeated connection points | warning / error | medium |
| Text overflow on box width / height | warning / error | medium |
| Edge routes through non-endpoint filled box (`_check_edge_routing`, R2) | error (pinned/determined route) / warning (unpinned, uncertain) | medium |
| Collinear-reachable connector bent into a dogleg by pins (`_check_edge_routing`, R1) | warning | medium |
| Final arrow segment < 20 px | warning / error | medium |
| Row / column routing corridor < 60 px | warning | medium |
| Legend present | warning / error | medium |
| Noun-phrase labels, in-figure naming / color consistency | warning | low — needs human / LLM |
| Grayscale / B&W readability, overall composition | manual | low — needs human |

---

## Severity conventions

- `hard error` — MUST be fixed before export or commit.
- `warning` — export allowed, but human confirmation required.
- `manual` — script only lists the check; human / LLM judges.

---

## Implementation guidance

The lint script already covers deterministic checks for square-corner orthogonal edge style, `mxGeometry`, routing-risk endpoint entry / exit, edge-routing crossing and collinear-dogleg detection, palette colors, strict font-family whitelist rules, explicit font-size floors, text-box dimension estimation, canvas caps, aspect ratio, visible text totals, core module counts, connected edge counts, two-line core module labels, and per-core-module label counts.

Edge-routing geometry lives in `_check_edge_routing` (with helpers `_edge_waypoints`, `_edge_anchor`, `_is_obstacle_vertex`, `_segment_hits_rect_interior`, `_rect_of`). It builds the polyline `[exit anchor, *waypoints, entry anchor]`, where an anchor is "authored" when explicit `exitX/exitY` (or `entryX/entryY`) pins fix it and a cell-centre fallback otherwise.

- **R2 (crossing):** for each polyline segment, intersect it (Liang–Barsky, `_segment_hits_rect_interior`) against every obstacle rectangle — obstacles are vertices whose `fillColor` is a hex value (palette fill or `#FFFFFF`); transparent frames (`fillColor=none`), text cells, and `shape=line` samples are excluded, as are the edge's own source / target. A hit on a **determined** segment (both endpoints authored *and* axis-aligned within `_AXIS_EPS`) is a hard error; any other hit is a warning ("uncertain — draw.io may auto-route"). This is the realisation of the former "phase 2" plan.
- **R1 (collinear dogleg):** for a both-pinned, waypoint-free connector, if the two boxes overlap on an axis (a straight orthogonal segment is geometrically reachable) yet the pinned anchors are offset on both axes (beyond `_AXIS_EPS`), emit a warning to align the pins.

Both constants `_AXIS_EPS` (axis-aligned / "already straight" tolerance) and `_RECT_INSET` (boundary-touch inset) are module-level near the function. Extending toward the `< 20 px` final-segment check would reuse the same polyline reconstruction.
