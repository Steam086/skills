"""Geometry and style lint checks for draw.io XML files.

Palette, font, visibility, and density caps load from `spec.toml` next to this
script.
"""

from __future__ import annotations

import argparse
import html
import re
import sys
import tomllib
from dataclasses import dataclass, field
from pathlib import Path
from typing import Iterable

from defusedxml import ElementTree as ET


REQUIRED_EDGE_STYLE = (
    ("edgeStyle", "orthogonalEdgeStyle"),
    ("rounded", "0"),
    ("orthogonalLoop", "1"),
    ("jettySize", "auto"),
)
BANNED_EDGE_STYLE = (
    ("rounded", "1", "rounded=1 creates visually curved connector bends; use rounded=0"),
    ("curved", "1", "curved=1 creates Bezier/curved connectors; use orthogonal polylines"),
)
ENTRY_EXIT_KEYS = (
    "exitX",
    "exitY",
    "exitDx",
    "exitDy",
    "entryX",
    "entryY",
    "entryDx",
    "entryDy",
)

# Per drawing-rules.md §5: draw.io renders cell labels as HTML, NOT LaTeX.
# `math="1"` is banned because headless `drawio -x` export can still bake raw
# source into the PNG. The fix is HTML <sub>/<sup> plus Unicode. Plain "X_y"
# underscores are NOT flagged here because they are ambiguous with code identifiers.
UNRENDERED_MATH_PATTERNS = (
    (re.compile(r"[_^]\{"), r"LaTeX brace sub/superscript (e.g. X_{i}); use HTML <sub>/<sup>"),
    (re.compile(r"\$[^$\n]*\$"), r"LaTeX $...$ math delimiters; use HTML <sub>/<sup>"),
    (re.compile(r"\\[()\[\]]"), r"LaTeX \( \) \[ \] math delimiters; use HTML <sub>/<sup>"),
    (re.compile(r"\\[A-Za-z]{2,}"), r"LaTeX command (e.g. \alpha, \sum); use a Unicode glyph or HTML"),
)

SPEC_PATH = Path(__file__).with_name("spec.toml")


def _load_spec(path: Path = SPEC_PATH) -> dict:
    with path.open("rb") as fh:
        return tomllib.load(fh)


_CJK_PATTERN = re.compile(
    r"[㐀-䶿一-鿿豈-﫿぀-ヿ가-힯]"
)
# Pure-Latin: ASCII printable plus a small set of common symbols / sub-/super-script digits used in tech labels
_PURE_LATIN_PATTERN = re.compile(
    r"^[\x20-\x7e\s ‐-―‘-”•…′-‴·×÷"
    r"₀-₉⁰¹²³⁴-⁹"  # subscript/superscript digits
    r"§°±←-⇿∀-⋿Α-ω]+$"
)
_HEX_COLOR_PATTERN = re.compile(r"^#[0-9A-Fa-f]{6}$")
# A Latin "word": >=2 consecutive ASCII letters (catches Telemetry / NCCL / Config;
# ignores single-letter math variables that legitimately sit in their own cells).
_LATIN_WORD_PATTERN = re.compile(r"[A-Za-z]{2,}")
# Inline <font face="...">...</font> span, capturing the face name and inner text.
_FONT_SPAN_PATTERN = re.compile(
    r"<font[^>]*\bface=([\"']?)([^\"'>]+)\1[^>]*>(.*?)</font>",
    re.IGNORECASE | re.DOTALL,
)


@dataclass
class LintResult:
    errors: list[str] = field(default_factory=list)
    warnings: list[str] = field(default_factory=list)

    @property
    def ok(self) -> bool:
        return not self.errors


@dataclass(frozen=True)
class LintSpec:
    palette_fill_colors: set[str]
    palette_stroke_colors: set[str]
    neutral_colors: set[str]
    neutral_fill_colors: set[str]
    visible_text_font_colors: set[str]
    auxiliary_fill: str
    auxiliary_text_gray: str
    core_module_fill_colors: set[str]
    default_page_width: float
    default_page_height: float
    max_page_width: float
    max_page_height: float
    min_aspect: float
    max_aspect: float
    min_font_size: float
    min_aux_font_size: float
    min_core_font_size: float
    text_warn_limit: int
    text_error_limit: int
    module_warn_limit: int
    module_error_limit: int
    edge_warn_limit: int
    edge_error_limit: int
    core_label_units_limit: int
    max_core_label_lines: int
    cjk_fonts_lower: set[str]
    latin_fonts_lower: set[str]
    whitelist_fonts: set[str]
    banned_fonts: set[str]


def _lint_spec_from_dict(spec: dict) -> LintSpec:
    palette_fill_colors = {c.upper() for c in spec["palette"]["fills"]}
    palette_stroke_colors = {c.upper() for c in spec["palette"]["strokes"]}
    auxiliary_fill = spec["palette"]["auxiliary_fill"].upper()
    cjk_fonts_lower = {f.lower() for f in spec["fonts"]["cjk"]}
    latin_fonts_lower = {f.lower() for f in spec["fonts"]["latin"]}
    canvas = spec["canvas"]
    visibility = spec["visibility"]
    density = spec["density"]

    return LintSpec(
        palette_fill_colors=palette_fill_colors,
        palette_stroke_colors=palette_stroke_colors,
        neutral_colors={c.upper() for c in spec["palette"]["neutrals"]["allowed"]},
        neutral_fill_colors={
            c.upper() for c in spec["palette"]["neutrals"].get("fill_allowed", [])
        },
        visible_text_font_colors={
            c.upper() for c in spec["palette"]["font_colors"]["visible_text"]
        },
        auxiliary_fill=auxiliary_fill,
        auxiliary_text_gray=spec["palette"]["auxiliary_text_gray"].upper(),
        core_module_fill_colors=palette_fill_colors - {auxiliary_fill},
        default_page_width=float(canvas["default_width"]),
        default_page_height=float(canvas["default_height"]),
        max_page_width=float(canvas["max_width"]),
        max_page_height=float(canvas["max_height"]),
        min_aspect=float(canvas["min_aspect"]),
        max_aspect=float(canvas["max_aspect"]),
        min_font_size=float(visibility["min_font_size"]),
        min_aux_font_size=float(visibility["min_aux_font_size"]),
        min_core_font_size=float(visibility["min_core_font_size"]),
        text_warn_limit=int(density["text_warn"]),
        text_error_limit=int(density["text_error"]),
        module_warn_limit=int(density["module_warn"]),
        module_error_limit=int(density["module_error"]),
        edge_warn_limit=int(density["edge_warn"]),
        edge_error_limit=int(density["edge_error"]),
        core_label_units_limit=int(density["core_label_units"]),
        max_core_label_lines=int(density["max_core_label_lines"]),
        cjk_fonts_lower=cjk_fonts_lower,
        latin_fonts_lower=latin_fonts_lower,
        whitelist_fonts=cjk_fonts_lower | latin_fonts_lower,
        banned_fonts={f.lower() for f in spec["fonts"]["banned"]},
    )


DEFAULT_LINT_SPEC = _lint_spec_from_dict(_load_spec())


@dataclass
class Cell:
    id: str
    value: str
    style: str
    vertex: bool
    edge: bool
    source: str | None
    target: str | None
    geometry: ET.Element | None
    x: float | None
    y: float | None
    width: float | None
    height: float | None


def lint_file(path: Path, spec_path: Path | None = None) -> LintResult:
    spec = (
        DEFAULT_LINT_SPEC
        if spec_path is None
        else _lint_spec_from_dict(_load_spec(spec_path))
    )
    root = _load_drawio_root(path)
    cells = [_cell_from_element(el) for el in root.iter() if _local_name(el.tag) == "mxCell"]
    vertices = {cell.id: cell for cell in cells if cell.vertex}
    edges = [cell for cell in cells if cell.edge]
    graph_model = _first_graph_model(root)

    result = LintResult()
    _check_canvas_dimensions(graph_model, result, spec)
    _check_density(cells, vertices.values(), edges, result, spec)
    _check_edges(edges, result)
    _check_multi_connection_pins(edges, vertices, result)
    _check_edge_routing(edges, vertices, result)
    _check_text_overflow(vertices.values(), result)
    _check_font_size_floor(cells, result, spec)
    _check_font_family(cells, result, spec)
    _check_colors(cells, result, spec)
    _check_unrendered_math(graph_model, cells, result)
    return result


def _load_drawio_root(path: Path) -> ET.Element:
    root = ET.parse(path).getroot()
    if _local_name(root.tag) == "svg":
        content = root.attrib.get("content")
        if not content:
            raise ValueError(f"{path}: SVG does not contain embedded draw.io content")
        return ET.fromstring(html.unescape(content))
    return root


def _first_graph_model(root: ET.Element) -> ET.Element | None:
    for el in root.iter():
        if _local_name(el.tag) == "mxGraphModel":
            return el
    return None


def _cell_from_element(el: ET.Element) -> Cell:
    geometry = None
    for child in el:
        if _local_name(child.tag) == "mxGeometry":
            geometry = child
            break

    x = _float_attr(geometry, "x")
    y = _float_attr(geometry, "y")
    width = _float_attr(geometry, "width")
    height = _float_attr(geometry, "height")

    return Cell(
        id=el.attrib.get("id", ""),
        value=el.attrib.get("value", ""),
        style=el.attrib.get("style", ""),
        vertex=el.attrib.get("vertex") == "1",
        edge=el.attrib.get("edge") == "1",
        source=el.attrib.get("source"),
        target=el.attrib.get("target"),
        geometry=geometry,
        x=x,
        y=y,
        width=width,
        height=height,
    )


def _check_edges(edges: Iterable[Cell], result: LintResult) -> None:
    for edge in edges:
        style_pairs = set(_style_items(edge.style))
        for key, value in REQUIRED_EDGE_STYLE:
            if (key, value) not in style_pairs:
                result.errors.append(f"edge {edge.id}: missing {key}={value}")

        for key, value, message in BANNED_EDGE_STYLE:
            if (key, value) in style_pairs:
                result.errors.append(f"edge {edge.id}: banned {key}={value}; {message}")

        if edge.geometry is None or edge.geometry.attrib.get("relative") != "1":
            result.errors.append(f"edge {edge.id}: missing expanded mxGeometry relative=1")


def _check_multi_connection_pins(edges: list[Cell], vertices: dict[str, Cell], result: LintResult) -> None:
    endpoint_edges: dict[str, list[tuple[Cell, str | None]]] = {}
    for edge in edges:
        if edge.source:
            endpoint_edges.setdefault(edge.source, []).append((edge, _endpoint_side(edge, edge.source, vertices)))
        if edge.target:
            endpoint_edges.setdefault(edge.target, []).append((edge, _endpoint_side(edge, edge.target, vertices)))

    required_reasons_by_edge: dict[str, list[str]] = {}
    for node_id, touches in endpoint_edges.items():
        reason = _pin_requirement_reason(node_id, touches)
        if reason is None:
            continue
        for edge, _side in touches:
            required_reasons_by_edge.setdefault(edge.id, []).append(reason)

    for edge in edges:
        reasons = required_reasons_by_edge.get(edge.id, [])
        if not reasons:
            continue

        missing = [key for key in ENTRY_EXIT_KEYS if f"{key}=" not in edge.style]
        if missing:
            node_desc = "; ".join(reasons)
            result.errors.append(
                f"edge {edge.id}: {node_desc}; missing explicit entry/exit keys: {', '.join(missing)}"
            )


# Edge-routing geometry (drawing-rules.md §7). _AXIS_EPS: |dx| or |dy| within this
# counts a segment as axis-aligned (and an offset this small as "already straight").
# _RECT_INSET shrinks an obstacle rectangle so an edge merely touching its border or
# anchoring on its edge does not count as passing through it.
_AXIS_EPS = 2.5
_RECT_INSET = 0.5


def _rect_of(cell: Cell) -> tuple[float, float, float, float] | None:
    if cell.x is None or cell.y is None or cell.width is None or cell.height is None:
        return None
    return (cell.x, cell.y, cell.x + cell.width, cell.y + cell.height)


def _is_obstacle_vertex(cell: Cell) -> bool:
    """A filled box (any palette fill or white). Transparent group frames, text
    labels, and line samples carry no hex fillColor and are not obstacles."""
    if not cell.vertex or _rect_of(cell) is None:
        return False
    fill = dict(_style_items(cell.style)).get("fillColor", "")
    return _normalize_hex_color(fill) is not None


def _edge_waypoints(geometry: ET.Element | None) -> list[tuple[float, float]]:
    if geometry is None:
        return []
    points: list[tuple[float, float]] = []
    for child in geometry:
        if _local_name(child.tag) != "Array" or child.attrib.get("as") != "points":
            continue
        for pt in child:
            if _local_name(pt.tag) != "mxPoint":
                continue
            x = _float_value(pt.attrib.get("x"))
            y = _float_value(pt.attrib.get("y"))
            if x is not None and y is not None:
                points.append((x, y))
    return points


def _edge_anchor(
    vertex: Cell, styles: dict[str, str], prefix: str
) -> tuple[tuple[float, float] | None, bool]:
    """Return (anchor_point, authored). Authored is True only when explicit
    {prefix}X/{prefix}Y pins fix the point; otherwise the cell centre is a fallback."""
    fx = _float_value(styles.get(f"{prefix}X"))
    fy = _float_value(styles.get(f"{prefix}Y"))
    rect = _rect_of(vertex)
    if fx is not None and fy is not None and rect is not None:
        return ((rect[0] + fx * (rect[2] - rect[0]), rect[1] + fy * (rect[3] - rect[1])), True)
    return (_cell_center(vertex), False)


def _segment_hits_rect_interior(
    p: tuple[float, float], q: tuple[float, float], rect: tuple[float, float, float, float]
) -> bool:
    """Liang–Barsky clip: True if the open segment p→q enters the rectangle interior."""
    x0, y0 = p
    x1, y1 = q
    rx0, ry0, rx1, ry1 = rect
    rx0 += _RECT_INSET
    ry0 += _RECT_INSET
    rx1 -= _RECT_INSET
    ry1 -= _RECT_INSET
    if rx1 <= rx0 or ry1 <= ry0:
        return False
    dx = x1 - x0
    dy = y1 - y0
    u1, u2 = 0.0, 1.0
    for pk, qk in ((-dx, x0 - rx0), (dx, rx1 - x0), (-dy, y0 - ry0), (dy, ry1 - y0)):
        if abs(pk) < 1e-9:
            if qk < 0:  # parallel to this slab and outside it
                return False
        else:
            r = qk / pk
            if pk < 0:
                if r > u2:
                    return False
                u1 = max(u1, r)
            else:
                if r < u1:
                    return False
                u2 = min(u2, r)
    return u1 < u2 - 1e-9


def _check_edge_routing(edges: list[Cell], vertices: dict[str, Cell], result: LintResult) -> None:
    """R2 — an edge must not pass through a non-endpoint filled box. When the route is
    fully authored (pinned anchors + waypoints) and a straight orthogonal segment cuts a
    box, it is a hard error; when the route is not pinned the crossing is uncertain
    (draw.io may auto-route around it) and is downgraded to a warning.

    R1 — a both-pinned, waypoint-free connector whose boxes overlap on an axis can be a
    straight segment; if the pins still bend it, warn so the author aligns or drops them.
    """
    obstacles = [v for v in vertices.values() if _is_obstacle_vertex(v)]
    for edge in edges:
        source = vertices.get(edge.source or "")
        target = vertices.get(edge.target or "")
        if source is None or target is None:
            continue
        styles = dict(_style_items(edge.style))
        src_anchor, src_pinned = _edge_anchor(source, styles, "exit")
        tgt_anchor, tgt_pinned = _edge_anchor(target, styles, "entry")
        if src_anchor is None or tgt_anchor is None:
            continue

        waypoints = _edge_waypoints(edge.geometry)
        points = [src_anchor, *waypoints, tgt_anchor]
        authored = [src_pinned, *([True] * len(waypoints)), tgt_pinned]
        candidates = [o for o in obstacles if o.id not in (edge.source, edge.target)]

        hard_hits: set[str] = set()
        soft_hits: set[str] = set()
        for i in range(len(points) - 1):
            p, q = points[i], points[i + 1]
            determined = (
                authored[i]
                and authored[i + 1]
                and (abs(q[0] - p[0]) <= _AXIS_EPS or abs(q[1] - p[1]) <= _AXIS_EPS)
            )
            for obstacle in candidates:
                rect = _rect_of(obstacle)
                if rect is not None and _segment_hits_rect_interior(p, q, rect):
                    (hard_hits if determined else soft_hits).add(obstacle.id)

        if hard_hits:
            result.errors.append(
                f"edge {edge.id}: routes through vertex {', '.join(sorted(hard_hits))}; "
                "reroute around it (move the node or add waypoints)"
            )
        soft_only = soft_hits - hard_hits
        if soft_only:
            result.warnings.append(
                f"edge {edge.id}: may route through vertex {', '.join(sorted(soft_only))} "
                "(route not fully pinned; verify or add waypoints/pins)"
            )

        # R1: collinear-but-jogged.
        if src_pinned and tgt_pinned and not waypoints:
            dx = abs(tgt_anchor[0] - src_anchor[0])
            dy = abs(tgt_anchor[1] - src_anchor[1])
            if dx > _AXIS_EPS and dy > _AXIS_EPS:  # not already a straight segment
                s_rect = _rect_of(source)
                t_rect = _rect_of(target)
                if s_rect is not None and t_rect is not None:
                    x_overlap = min(s_rect[2], t_rect[2]) - max(s_rect[0], t_rect[0])
                    y_overlap = min(s_rect[3], t_rect[3]) - max(s_rect[1], t_rect[1])
                    if x_overlap > _AXIS_EPS or y_overlap > _AXIS_EPS:
                        result.warnings.append(
                            f"edge {edge.id}: endpoints could form a straight (collinear) "
                            f"segment but exit/entry pins create a dogleg "
                            f"(Δx={dx:.1f}, Δy={dy:.1f}); align the pins to a shared "
                            "coordinate or drop them if not required"
                        )


def _check_canvas_dimensions(
    graph_model: ET.Element | None,
    result: LintResult,
    spec: LintSpec,
) -> None:
    page_width = _canvas_width(graph_model, spec)
    page_height = _canvas_height(graph_model, spec)

    if page_width > spec.max_page_width:
        result.errors.append(
            f"pageWidth {page_width:g} exceeds canvas max width {spec.max_page_width:g}"
        )

    if page_height > spec.max_page_height:
        result.errors.append(
            f"pageHeight {page_height:g} exceeds canvas max height {spec.max_page_height:g}"
        )

    if page_height > 0:
        aspect = page_width / page_height
        if aspect < spec.min_aspect or aspect > spec.max_aspect:
            result.errors.append(
                f"canvas aspect ratio {aspect:g} is outside allowed range {spec.min_aspect:g}-{spec.max_aspect:g}"
            )


def _check_density(
    cells: Iterable[Cell],
    vertices: Iterable[Cell],
    edges: Iterable[Cell],
    result: LintResult,
    spec: LintSpec,
) -> None:
    vertex_list = list(vertices)

    text_count = sum(_visible_text_count(cell.value) for cell in cells if cell.value)
    if text_count > spec.text_error_limit:
        result.errors.append(
            f"visible text count {text_count} exceeds global error limit {spec.text_error_limit}"
        )
    elif text_count > spec.text_warn_limit:
        result.warnings.append(
            f"visible text count {text_count} exceeds global warning limit {spec.text_warn_limit}"
        )

    core_modules = [vertex for vertex in vertex_list if _is_core_module(vertex, spec)]
    if len(core_modules) > spec.module_error_limit:
        result.errors.append(
            f"core module count {len(core_modules)} exceeds global error limit {spec.module_error_limit}"
        )
    elif len(core_modules) > spec.module_warn_limit:
        result.warnings.append(
            f"core module count {len(core_modules)} exceeds global warning limit {spec.module_warn_limit}"
        )

    arrow_count = sum(1 for edge in edges if edge.source and edge.target)
    if arrow_count > spec.edge_error_limit:
        result.errors.append(
            f"connected edge count {arrow_count} exceeds global error limit {spec.edge_error_limit}"
        )
    elif arrow_count > spec.edge_warn_limit:
        result.warnings.append(
            f"connected edge count {arrow_count} exceeds global warning limit {spec.edge_warn_limit}"
        )

    for module in core_modules:
        lines = _visible_lines(module.value)
        if len(lines) > spec.max_core_label_lines:
            result.errors.append(
                f"cell {module.id}: core module has {len(lines)} visible lines; maximum is {spec.max_core_label_lines}"
            )
        label_count = _visible_text_count(module.value)
        if label_count > spec.core_label_units_limit:
            result.errors.append(
                f"cell {module.id}: core module label count {label_count} exceeds limit {spec.core_label_units_limit}"
            )


def _check_text_overflow(vertices: Iterable[Cell], result: LintResult) -> None:
    for vertex in vertices:
        if not vertex.value or vertex.width is None or vertex.height is None:
            continue

        font_size = _font_size(vertex.style)
        lines = _visible_lines(vertex.value)
        if not lines:
            continue

        estimated_width = max(_estimate_text_width(line, font_size) for line in lines) + 16
        estimated_height = len(lines) * font_size * 1.35 + 12
        if vertex.width < estimated_width or vertex.height < estimated_height:
            result.warnings.append(
                f"vertex {vertex.id}: possible text overflow "
                f"(box={vertex.width:g}x{vertex.height:g}, "
                f"estimated={estimated_width:.1f}x{estimated_height:.1f})"
            )


def _check_font_size_floor(cells: Iterable[Cell], result: LintResult, spec: LintSpec) -> None:
    for cell in cells:
        if not cell.value or not _visible_lines(cell.value):
            continue

        font_size = _explicit_font_size(cell.style)
        if font_size is None:
            result.errors.append(f"cell {cell.id}: missing fontSize on visible text")
            continue

        floor, label = _font_floor_for_cell(cell, spec)
        if font_size < floor:
            result.errors.append(
                f"cell {cell.id}: fontSize {font_size:g} is below {label} floor {floor:g}"
            )


def _pin_requirement_reason(node_id: str, touches: list[tuple[Cell, str | None]]) -> str | None:
    degree = len(touches)
    if degree >= 4:
        return f"node {node_id} has {degree} connections (hub)"

    side_counts: dict[str, int] = {}
    for _edge, side in touches:
        if side is None:
            continue
        side_counts[side] = side_counts.get(side, 0) + 1

    for side in ("left", "right", "top", "bottom"):
        count = side_counts.get(side, 0)
        if count >= 2:
            return f"node {node_id} has {count} connections on its {side} side"

    return None


def _endpoint_side(edge: Cell, endpoint_id: str, vertices: dict[str, Cell]) -> str | None:
    endpoint = vertices.get(endpoint_id)
    other_id = edge.target if endpoint_id == edge.source else edge.source
    other = vertices.get(other_id or "")
    if endpoint is None or other is None:
        return None

    endpoint_center = _cell_center(endpoint)
    other_center = _cell_center(other)
    if endpoint_center is None or other_center is None:
        return None

    dx = other_center[0] - endpoint_center[0]
    dy = other_center[1] - endpoint_center[1]
    if dx == 0 and dy == 0:
        return None
    if abs(dx) >= abs(dy):
        return "right" if dx > 0 else "left"
    return "bottom" if dy > 0 else "top"


def _cell_center(cell: Cell) -> tuple[float, float] | None:
    if cell.x is None or cell.y is None or cell.width is None or cell.height is None:
        return None
    return (cell.x + cell.width / 2, cell.y + cell.height / 2)


def _check_font_family(cells: Iterable[Cell], result: LintResult, spec: LintSpec) -> None:
    """Per drawing-rules.md §5: every text-bearing cell must set fontFamily explicitly."""
    for cell in cells:
        # Skip non-text cells (no visible value)
        lines = _visible_lines(cell.value) if cell.value else []
        if not lines:
            continue

        match = re.search(r"(?:^|;)fontFamily=([^;]+)", cell.style)
        if match is None:
            result.errors.append(
                f"cell {cell.id}: missing fontFamily (falls back to banned Helvetica/sans-serif default)"
            )
            continue

        font = match.group(1).strip()
        font_lower = font.lower()

        if font_lower in spec.banned_fonts:
            result.errors.append(f"cell {cell.id}: banned fontFamily '{font}' (see §5)")
            continue

        if font_lower not in spec.whitelist_fonts:
            result.errors.append(f"cell {cell.id}: fontFamily '{font}' is not on §5 whitelist")
            continue

        text = "\n".join(lines)
        has_cjk = bool(_CJK_PATTERN.search(text))
        is_pure_latin = bool(_PURE_LATIN_PATTERN.match(text))

        if has_cjk and font_lower in spec.latin_fonts_lower:
            result.warnings.append(
                f"cell {cell.id}: CJK content uses Latin-only font '{font}' "
                f"(CJK glyphs will fall back to system font)"
            )
        elif is_pure_latin and font_lower in spec.cjk_fonts_lower:
            result.warnings.append(
                f"cell {cell.id}: pure-Latin content uses CJK font '{font}' "
                f"(use Times New Roman for Latin/digit-only labels)"
            )
        elif (
            has_cjk
            and font_lower in spec.cjk_fonts_lower
            and _latin_word_outside_latin_face(cell.value, spec)
        ):
            # Mixed CJK+Latin cell whose base font is CJK: any Latin word must be
            # wrapped in an inline Latin face, else it renders in the CJK font's
            # narrow embedded Latin glyphs instead of Times New Roman (§5.1).
            result.errors.append(
                f"cell {cell.id}: Latin word in a CJK-font cell is not wrapped in a Latin face "
                f"(wrap each Latin/digit run in <font face=\"Times New Roman\">…</font>, "
                f"or split it into a separate Times New Roman cell — see §5.1)"
            )


def _check_colors(cells: Iterable[Cell], result: LintResult, spec: LintSpec) -> None:
    """Per drawing-rules.md §1: draw.io colors must stay inside the approved palette."""
    all_palette_colors = (
        spec.palette_fill_colors | spec.palette_stroke_colors | spec.neutral_colors
    )
    fill_colors = spec.palette_fill_colors | spec.neutral_fill_colors
    stroke_colors = spec.palette_stroke_colors | spec.neutral_colors

    for cell in cells:
        has_visible_text = bool(_visible_lines(cell.value)) if cell.value else False
        for key, value in _style_items(cell.style):
            color = _normalize_hex_color(value)
            if color is None:
                continue

            if color not in all_palette_colors:
                result.errors.append(f"cell {cell.id}: {key} {color} is not in §1 palette")

            if key == "fillColor" and color not in fill_colors:
                result.errors.append(f"cell {cell.id}: fillColor {color} is not in §1 fill palette")
            elif key == "strokeColor" and color not in stroke_colors:
                result.errors.append(f"cell {cell.id}: strokeColor {color} is not in §1 stroke palette")
            elif key == "fontColor" and has_visible_text and color not in spec.visible_text_font_colors:
                result.errors.append(f"cell {cell.id}: fontColor {color} is not allowed for visible text")


def _check_unrendered_math(
    graph_model: ET.Element | None,
    cells: Iterable[Cell],
    result: LintResult,
) -> None:
    """Per drawing-rules.md §5: reject math mode and LaTeX markers."""
    if graph_model is not None and graph_model.attrib.get("math") == "1":
        result.errors.append(
            'mxGraphModel math="1" is banned; use HTML <sub>/<sup> and Unicode instead'
        )
    for cell in cells:
        if not cell.value:
            continue
        for pattern, message in UNRENDERED_MATH_PATTERNS:
            found = pattern.search(cell.value)
            if found:
                result.errors.append(
                    f"cell {cell.id}: un-rendered math {found.group(0)!r}: {message}"
                )
                break  # one finding per cell is enough


def _style_items(style: str) -> Iterable[tuple[str, str]]:
    for item in style.split(";"):
        if "=" not in item:
            continue
        key, value = item.split("=", 1)
        yield key.strip(), value.strip()


def _normalize_hex_color(value: str) -> str | None:
    if not _HEX_COLOR_PATTERN.match(value):
        return None
    return value.upper()


def _is_core_module(cell: Cell, spec: LintSpec) -> bool:
    if not cell.vertex or not cell.value or not _visible_lines(cell.value):
        return False

    styles = dict(_style_items(cell.style))
    fill_color = _normalize_hex_color(styles.get("fillColor", ""))
    if fill_color not in spec.core_module_fill_colors:
        return False

    shape = styles.get("shape", "")
    if "image" in shape or "icon" in shape:
        return False

    return True


def _latin_word_outside_latin_face(value: str, spec: LintSpec) -> bool:
    """True if a Latin word appears outside any inline Latin-face <font> span.

    Latin runs wrapped in <font face="Times New Roman"> (or any §5 Latin face)
    render correctly; only Latin left in the surrounding CJK font is a problem.
    """
    text = html.unescape(value)

    def _drop_latin_face(match: "re.Match[str]") -> str:
        face = match.group(2).strip().lower()
        # Latin-face spans are fine — remove their content from consideration.
        # Non-Latin-face spans: keep inner text so any Latin inside is still checked.
        return "" if face in spec.latin_fonts_lower else match.group(3)

    prev = None
    while prev != text:  # collapse nested / sequential spans
        prev = text
        text = _FONT_SPAN_PATTERN.sub(_drop_latin_face, text)

    text = re.sub(r"<[^>]+>", " ", text)
    return bool(_LATIN_WORD_PATTERN.search(text))


def _visible_lines(value: str) -> list[str]:
    text = html.unescape(value)
    text = re.sub(r"<br\s*/?>", "\n", text, flags=re.IGNORECASE)
    text = re.sub(r"</?(div|p)[^>]*>", "\n", text, flags=re.IGNORECASE)
    text = re.sub(r"<[^>]+>", "", text)
    return [line.strip() for line in text.splitlines() if line.strip()]


def _visible_text_count(value: str) -> int:
    count = 0
    for line in _visible_lines(value):
        count += len(_CJK_PATTERN.findall(line))
        non_cjk = _CJK_PATTERN.sub(" ", line)
        count += len(
            re.findall(
                r"[A-Za-zΑ-ωℓ][A-Za-z0-9_()′'*.\-\u0300-\u036f]*|\d+(?:\.\d+)?",
                non_cjk,
            )
        )
    return count


def _canvas_width(graph_model: ET.Element | None, spec: LintSpec) -> float:
    if graph_model is None:
        return spec.default_page_width
    return _float_value(graph_model.attrib.get("pageWidth")) or spec.default_page_width


def _canvas_height(graph_model: ET.Element | None, spec: LintSpec) -> float:
    if graph_model is None:
        return spec.default_page_height
    return _float_value(graph_model.attrib.get("pageHeight")) or spec.default_page_height


def _estimate_text_width(text: str, font_size: float) -> float:
    width = 0.0
    for char in text:
        if char.isspace():
            width += 0.3 * font_size
        elif _is_cjk(char):
            width += 1.0 * font_size
        else:
            width += 0.6 * font_size
    return width


def _is_cjk(char: str) -> bool:
    code = ord(char)
    return (
        0x3400 <= code <= 0x4DBF
        or 0x4E00 <= code <= 0x9FFF
        or 0xF900 <= code <= 0xFAFF
        or 0x3040 <= code <= 0x30FF
        or 0xAC00 <= code <= 0xD7AF
    )


def _font_size(style: str) -> float:
    match = re.search(r"(?:^|;)fontSize=([0-9.]+)", style)
    if not match:
        return 12.0
    return float(match.group(1))


def _explicit_font_size(style: str) -> float | None:
    match = re.search(r"(?:^|;)fontSize=([0-9.]+)", style)
    if not match:
        return None
    return float(match.group(1))


def _font_floor_for_cell(cell: Cell, spec: LintSpec) -> tuple[float, str]:
    if _is_core_module(cell, spec):
        return spec.min_core_font_size, "core module"
    if _is_auxiliary_text(cell, spec):
        return spec.min_aux_font_size, "auxiliary text"
    return spec.min_font_size, "visible text"


def _is_auxiliary_text(cell: Cell, spec: LintSpec) -> bool:
    styles = dict(_style_items(cell.style))
    font_color = _normalize_hex_color(styles.get("fontColor", ""))
    fill_color = _normalize_hex_color(styles.get("fillColor", ""))
    return font_color == spec.auxiliary_text_gray or fill_color == spec.auxiliary_fill


def _float_attr(el: ET.Element | None, name: str) -> float | None:
    if el is None or name not in el.attrib:
        return None
    return _float_value(el.attrib[name])


def _float_value(value: str | None) -> float | None:
    if value is None:
        return None
    try:
        return float(value)
    except ValueError:
        return None


def _local_name(tag: str) -> str:
    return tag.rsplit("}", 1)[-1]


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--spec",
        type=Path,
        default=None,
        help="Optional TOML spec override for palette, fonts, canvas, visibility, and density constants.",
    )
    parser.add_argument("paths", nargs="+", type=Path)
    args = parser.parse_args(argv)

    exit_code = 0
    for path in args.paths:
        result = lint_file(path, spec_path=args.spec)
        for warning in result.warnings:
            print(f"{path}: warning: {warning}")
        for error in result.errors:
            print(f"{path}: error: {error}")
        if result.errors:
            exit_code = 1
    return exit_code


if __name__ == "__main__":
    sys.exit(main())
