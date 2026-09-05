import tempfile
import textwrap
import unittest
from pathlib import Path

from lint_drawio_geometry import lint_file


def write_temp_drawio(body: str, model_attrs: str = "") -> Path:
    model_attr_text = f" {model_attrs}" if model_attrs else ""
    content = f"""<mxfile>
  <diagram name="Page-1">
    <mxGraphModel{model_attr_text}>
      <root>
        <mxCell id="0" />
        <mxCell id="1" parent="0" />
        {body}
      </root>
    </mxGraphModel>
  </diagram>
</mxfile>
"""
    tmp = tempfile.NamedTemporaryFile("w", suffix=".drawio", delete=False, encoding="utf-8")
    tmp.write(content)
    tmp.close()
    return Path(tmp.name)


def write_temp_spec(extra: str = "") -> Path:
    content = f"""# Test spec derived from scripts/spec.toml shape.

[palette]
fills = ["#D8ECFF", "#F0F0F0"]
strokes = ["#2F78C4", "#707070"]
auxiliary_fill = "#F0F0F0"
auxiliary_text_gray = "#707070"

[palette.font_colors]
visible_text = ["#000000", "#707070"]

[palette.neutrals]
allowed = ["#000000", "#FFFFFF"]
fill_allowed = ["#FFFFFF"]

[fonts]
cjk = ["Source Han Serif SC"]
latin = ["Times New Roman", "Georgia"]
banned = ["Helvetica", "Arial", "sans-serif"]

[canvas]
default_width  = 1200
default_height = 675
max_width      = 1600
max_height     = 900
min_aspect     = 1.25
max_aspect     = 2.40

[visibility]
min_font_size      = 14
min_aux_font_size  = 12
min_core_font_size = 16
min_scale          = 0.85

[density]
text_warn       = 320
text_error      = 420
module_warn     = 24
module_error    = 30
edge_warn       = 32
edge_error      = 40
core_label_units = 16
max_core_label_lines = 2
{extra}
"""
    tmp = tempfile.NamedTemporaryFile("w", suffix=".toml", delete=False, encoding="utf-8")
    tmp.write(content)
    tmp.close()
    return Path(tmp.name)


def valid_edge(edge_id: str, source: str, target: str) -> str:
    return f"""<mxCell id="{edge_id}" value="" style="edgeStyle=orthogonalEdgeStyle;rounded=0;orthogonalLoop=1;jettySize=auto;html=1;exitX=1;exitY=0.5;exitDx=0;exitDy=0;entryX=0;entryY=0.5;entryDx=0;entryDy=0;" edge="1" parent="1" source="{source}" target="{target}">
      <mxGeometry relative="1" as="geometry" />
    </mxCell>"""


class DrawioGeometryLintTest(unittest.TestCase):
    def test_valid_geometry_passes(self) -> None:
        path = write_temp_drawio(
            textwrap.dedent(
                """
                <mxCell id="a" value="模块甲" style="rounded=1;fontSize=14;fontFamily=Source Han Serif SC;" vertex="1" parent="1">
                  <mxGeometry x="0" y="0" width="90" height="42" as="geometry" />
                </mxCell>
                <mxCell id="b" value="模块乙" style="rounded=1;fontSize=14;fontFamily=Source Han Serif SC;" vertex="1" parent="1">
                  <mxGeometry x="160" y="0" width="90" height="42" as="geometry" />
                </mxCell>
                <mxCell id="e1" value="" style="edgeStyle=orthogonalEdgeStyle;rounded=0;orthogonalLoop=1;jettySize=auto;html=1;exitX=1;exitY=0.5;exitDx=0;exitDy=0;entryX=0;entryY=0.5;entryDx=0;entryDy=0;" edge="1" parent="1" source="a" target="b">
                  <mxGeometry relative="1" as="geometry" />
                </mxCell>
                """
            )
        )

        result = lint_file(path)

        self.assertEqual(result.errors, [])
        self.assertEqual(result.warnings, [])

    def test_edge_missing_style_and_geometry_is_error(self) -> None:
        path = write_temp_drawio(
            textwrap.dedent(
                """
                <mxCell id="a" value="A" style="rounded=1;fontSize=14;fontFamily=Times New Roman;" vertex="1" parent="1">
                  <mxGeometry x="0" y="0" width="60" height="40" as="geometry" />
                </mxCell>
                <mxCell id="b" value="B" style="rounded=1;fontSize=14;fontFamily=Times New Roman;" vertex="1" parent="1">
                  <mxGeometry x="160" y="0" width="60" height="40" as="geometry" />
                </mxCell>
                <mxCell id="e1" value="" style="html=1;" edge="1" parent="1" source="a" target="b" />
                """
            )
        )

        result = lint_file(path)

        joined = "\n".join(result.errors)
        self.assertIn("missing edgeStyle=orthogonalEdgeStyle", joined)
        self.assertIn("missing expanded mxGeometry", joined)

    def test_edge_rounded_bends_are_hard_error(self) -> None:
        path = write_temp_drawio(
            textwrap.dedent(
                """
                <mxCell id="a" value="A" style="rounded=1;fontSize=14;fontFamily=Times New Roman;" vertex="1" parent="1">
                  <mxGeometry x="0" y="0" width="60" height="40" as="geometry" />
                </mxCell>
                <mxCell id="b" value="B" style="rounded=1;fontSize=14;fontFamily=Times New Roman;" vertex="1" parent="1">
                  <mxGeometry x="160" y="0" width="60" height="40" as="geometry" />
                </mxCell>
                <mxCell id="e1" value="" style="edgeStyle=orthogonalEdgeStyle;rounded=1;orthogonalLoop=1;jettySize=auto;html=1;exitX=1;exitY=0.5;exitDx=0;exitDy=0;entryX=0;entryY=0.5;entryDx=0;entryDy=0;" edge="1" parent="1" source="a" target="b">
                  <mxGeometry relative="1" as="geometry" />
                </mxCell>
                """
            )
        )

        result = lint_file(path)

        joined = "\n".join(result.errors)
        self.assertIn("banned rounded=1", joined)
        self.assertIn("missing rounded=0", joined)

    def test_edge_curves_are_hard_error(self) -> None:
        path = write_temp_drawio(
            textwrap.dedent(
                """
                <mxCell id="a" value="A" style="rounded=1;fontSize=14;fontFamily=Times New Roman;" vertex="1" parent="1">
                  <mxGeometry x="0" y="0" width="60" height="40" as="geometry" />
                </mxCell>
                <mxCell id="b" value="B" style="rounded=1;fontSize=14;fontFamily=Times New Roman;" vertex="1" parent="1">
                  <mxGeometry x="160" y="0" width="60" height="40" as="geometry" />
                </mxCell>
                <mxCell id="e1" value="" style="edgeStyle=orthogonalEdgeStyle;rounded=0;curved=1;orthogonalLoop=1;jettySize=auto;html=1;exitX=1;exitY=0.5;exitDx=0;exitDy=0;entryX=0;entryY=0.5;entryDx=0;entryDy=0;" edge="1" parent="1" source="a" target="b">
                  <mxGeometry relative="1" as="geometry" />
                </mxCell>
                """
            )
        )

        result = lint_file(path)

        self.assertTrue(
            any("banned curved=1" in error for error in result.errors),
            result.errors,
        )

    def test_two_connection_pass_through_node_does_not_require_entry_exit(self) -> None:
        path = write_temp_drawio(
            textwrap.dedent(
                """
                <mxCell id="source" value="源" style="rounded=1;fontSize=14;fontFamily=Source Han Serif SC;" vertex="1" parent="1">
                  <mxGeometry x="0" y="0" width="60" height="40" as="geometry" />
                </mxCell>
                <mxCell id="middle" value="中继" style="rounded=1;fontSize=14;fontFamily=Source Han Serif SC;" vertex="1" parent="1">
                  <mxGeometry x="120" y="0" width="70" height="40" as="geometry" />
                </mxCell>
                <mxCell id="target" value="目标" style="rounded=1;fontSize=14;fontFamily=Source Han Serif SC;" vertex="1" parent="1">
                  <mxGeometry x="250" y="0" width="60" height="40" as="geometry" />
                </mxCell>
                <mxCell id="e1" value="" style="edgeStyle=orthogonalEdgeStyle;rounded=0;orthogonalLoop=1;jettySize=auto;html=1;" edge="1" parent="1" source="source" target="middle">
                  <mxGeometry relative="1" as="geometry" />
                </mxCell>
                <mxCell id="e2" value="" style="edgeStyle=orthogonalEdgeStyle;rounded=0;orthogonalLoop=1;jettySize=auto;html=1;" edge="1" parent="1" source="middle" target="target">
                  <mxGeometry relative="1" as="geometry" />
                </mxCell>
                """
            )
        )

        result = lint_file(path)

        self.assertEqual(result.errors, [])

    def test_two_connections_on_same_side_must_pin_entry_exit(self) -> None:
        path = write_temp_drawio(
            textwrap.dedent(
                """
                <mxCell id="hub" value="中心节点" style="rounded=1;fontSize=14;fontFamily=Source Han Serif SC;" vertex="1" parent="1">
                  <mxGeometry x="0" y="0" width="80" height="42" as="geometry" />
                </mxCell>
                <mxCell id="a" value="A" style="rounded=1;fontSize=14;fontFamily=Times New Roman;" vertex="1" parent="1">
                  <mxGeometry x="160" y="-60" width="60" height="40" as="geometry" />
                </mxCell>
                <mxCell id="b" value="B" style="rounded=1;fontSize=14;fontFamily=Times New Roman;" vertex="1" parent="1">
                  <mxGeometry x="160" y="60" width="60" height="40" as="geometry" />
                </mxCell>
                <mxCell id="e1" value="" style="edgeStyle=orthogonalEdgeStyle;rounded=0;orthogonalLoop=1;jettySize=auto;html=1;" edge="1" parent="1" source="hub" target="a">
                  <mxGeometry relative="1" as="geometry" />
                </mxCell>
                <mxCell id="e2" value="" style="edgeStyle=orthogonalEdgeStyle;rounded=0;orthogonalLoop=1;jettySize=auto;html=1;" edge="1" parent="1" source="hub" target="b">
                  <mxGeometry relative="1" as="geometry" />
                </mxCell>
                """
            )
        )

        result = lint_file(path)

        self.assertTrue(
            any("node hub has 2 connections on its right side" in error for error in result.errors),
            result.errors,
        )

    def test_pinned_edge_routing_through_node_is_hard_error(self) -> None:
        # root sits directly above shared; reqC is to the lower-right. Dropping the
        # root->reqC edge straight down (waypoint at x=248) cuts through shared.
        path = write_temp_drawio(
            textwrap.dedent(
                """
                <mxCell id="root" value="根" style="rounded=1;whiteSpace=wrap;html=1;fillColor=#D8ECFF;strokeColor=#2F78C4;fontSize=16;fontFamily=SimSun;fontColor=#000000;" vertex="1" parent="1">
                  <mxGeometry x="180" y="118" width="80" height="38" as="geometry" />
                </mxCell>
                <mxCell id="shared" value="共享" style="rounded=1;whiteSpace=wrap;html=1;fillColor=#D8ECFF;strokeColor=#2F78C4;fontSize=16;fontFamily=SimSun;fontColor=#000000;" vertex="1" parent="1">
                  <mxGeometry x="104" y="190" width="232" height="58" as="geometry" />
                </mxCell>
                <mxCell id="reqC" value="丙" style="rounded=1;whiteSpace=wrap;html=1;fillColor=#D8ECFF;strokeColor=#2F78C4;fontSize=16;fontFamily=SimSun;fontColor=#000000;" vertex="1" parent="1">
                  <mxGeometry x="322" y="300" width="98" height="56" as="geometry" />
                </mxCell>
                <mxCell id="e_rc" value="" style="edgeStyle=orthogonalEdgeStyle;rounded=0;orthogonalLoop=1;jettySize=auto;html=1;exitX=0.85;exitY=1;exitDx=0;exitDy=0;entryX=0.5;entryY=0;entryDx=0;entryDy=0;" edge="1" parent="1" source="root" target="reqC">
                  <mxGeometry relative="1" as="geometry">
                    <Array as="points">
                      <mxPoint x="248" y="280" />
                      <mxPoint x="371" y="280" />
                    </Array>
                  </mxGeometry>
                </mxCell>
                """
            )
        )

        result = lint_file(path)

        self.assertTrue(
            any("routes through" in e and "shared" in e for e in result.errors),
            result.errors,
        )

    def test_pinned_edge_routed_around_node_passes(self) -> None:
        # Same boxes, but root->reqC exits root's right side and routes around shared.
        path = write_temp_drawio(
            textwrap.dedent(
                """
                <mxCell id="root" value="根" style="rounded=1;whiteSpace=wrap;html=1;fillColor=#D8ECFF;strokeColor=#2F78C4;fontSize=16;fontFamily=SimSun;fontColor=#000000;" vertex="1" parent="1">
                  <mxGeometry x="180" y="118" width="80" height="38" as="geometry" />
                </mxCell>
                <mxCell id="shared" value="共享" style="rounded=1;whiteSpace=wrap;html=1;fillColor=#D8ECFF;strokeColor=#2F78C4;fontSize=16;fontFamily=SimSun;fontColor=#000000;" vertex="1" parent="1">
                  <mxGeometry x="104" y="190" width="232" height="58" as="geometry" />
                </mxCell>
                <mxCell id="reqC" value="丙" style="rounded=1;whiteSpace=wrap;html=1;fillColor=#D8ECFF;strokeColor=#2F78C4;fontSize=16;fontFamily=SimSun;fontColor=#000000;" vertex="1" parent="1">
                  <mxGeometry x="322" y="300" width="98" height="56" as="geometry" />
                </mxCell>
                <mxCell id="e_rc" value="" style="edgeStyle=orthogonalEdgeStyle;rounded=0;orthogonalLoop=1;jettySize=auto;html=1;exitX=1;exitY=0.5;exitDx=0;exitDy=0;entryX=0;entryY=0.5;entryDx=0;entryDy=0;" edge="1" parent="1" source="root" target="reqC">
                  <mxGeometry relative="1" as="geometry">
                    <Array as="points">
                      <mxPoint x="390" y="137" />
                      <mxPoint x="390" y="328" />
                    </Array>
                  </mxGeometry>
                </mxCell>
                """
            )
        )

        result = lint_file(path)

        self.assertFalse(any("routes through" in e for e in result.errors), result.errors)
        self.assertFalse(any("route through" in w for w in result.warnings), result.warnings)

    def test_unpinned_edge_crossing_node_is_warning_not_error(self) -> None:
        # No exit/entry pins: the centre-to-centre line crosses mid, but draw.io's
        # auto-router may avoid it, so the crossing is uncertain -> warning, not error.
        path = write_temp_drawio(
            textwrap.dedent(
                """
                <mxCell id="left" value="甲" style="rounded=1;whiteSpace=wrap;html=1;fillColor=#D8ECFF;strokeColor=#2F78C4;fontSize=16;fontFamily=SimSun;fontColor=#000000;" vertex="1" parent="1">
                  <mxGeometry x="0" y="0" width="60" height="40" as="geometry" />
                </mxCell>
                <mxCell id="mid" value="乙" style="rounded=1;whiteSpace=wrap;html=1;fillColor=#D8ECFF;strokeColor=#2F78C4;fontSize=16;fontFamily=SimSun;fontColor=#000000;" vertex="1" parent="1">
                  <mxGeometry x="120" y="0" width="80" height="40" as="geometry" />
                </mxCell>
                <mxCell id="right" value="丙" style="rounded=1;whiteSpace=wrap;html=1;fillColor=#D8ECFF;strokeColor=#2F78C4;fontSize=16;fontFamily=SimSun;fontColor=#000000;" vertex="1" parent="1">
                  <mxGeometry x="260" y="0" width="60" height="40" as="geometry" />
                </mxCell>
                <mxCell id="e1" value="" style="edgeStyle=orthogonalEdgeStyle;rounded=0;orthogonalLoop=1;jettySize=auto;html=1;" edge="1" parent="1" source="left" target="right">
                  <mxGeometry relative="1" as="geometry" />
                </mxCell>
                """
            )
        )

        result = lint_file(path)

        self.assertTrue(
            any("may route through" in w and "mid" in w for w in result.warnings),
            result.warnings,
        )
        self.assertFalse(any("routes through" in e for e in result.errors), result.errors)

    def test_collinear_boxes_with_jogged_pins_is_warning(self) -> None:
        # top and bottom share centre x=220 (vertical straight reachable), but the
        # exit pin at 0.45 offsets the exit to x=216 -> needless dogleg.
        path = write_temp_drawio(
            textwrap.dedent(
                """
                <mxCell id="top" value="甲" style="rounded=1;whiteSpace=wrap;html=1;fillColor=#D8ECFF;strokeColor=#2F78C4;fontSize=16;fontFamily=SimSun;fontColor=#000000;" vertex="1" parent="1">
                  <mxGeometry x="180" y="118" width="80" height="38" as="geometry" />
                </mxCell>
                <mxCell id="bottom" value="乙" style="rounded=1;whiteSpace=wrap;html=1;fillColor=#D8ECFF;strokeColor=#2F78C4;fontSize=16;fontFamily=SimSun;fontColor=#000000;" vertex="1" parent="1">
                  <mxGeometry x="104" y="190" width="232" height="58" as="geometry" />
                </mxCell>
                <mxCell id="e1" value="" style="edgeStyle=orthogonalEdgeStyle;rounded=0;orthogonalLoop=1;jettySize=auto;html=1;exitX=0.45;exitY=1;exitDx=0;exitDy=0;entryX=0.5;entryY=0;entryDx=0;entryDy=0;" edge="1" parent="1" source="top" target="bottom">
                  <mxGeometry relative="1" as="geometry" />
                </mxCell>
                """
            )
        )

        result = lint_file(path)

        self.assertEqual(result.errors, [])
        self.assertTrue(
            any("straight" in w and "e1" in w for w in result.warnings),
            result.warnings,
        )

    def test_collinear_boxes_with_aligned_pins_has_no_dogleg_warning(self) -> None:
        path = write_temp_drawio(
            textwrap.dedent(
                """
                <mxCell id="top" value="甲" style="rounded=1;whiteSpace=wrap;html=1;fillColor=#D8ECFF;strokeColor=#2F78C4;fontSize=16;fontFamily=SimSun;fontColor=#000000;" vertex="1" parent="1">
                  <mxGeometry x="180" y="118" width="80" height="38" as="geometry" />
                </mxCell>
                <mxCell id="bottom" value="乙" style="rounded=1;whiteSpace=wrap;html=1;fillColor=#D8ECFF;strokeColor=#2F78C4;fontSize=16;fontFamily=SimSun;fontColor=#000000;" vertex="1" parent="1">
                  <mxGeometry x="104" y="190" width="232" height="58" as="geometry" />
                </mxCell>
                <mxCell id="e1" value="" style="edgeStyle=orthogonalEdgeStyle;rounded=0;orthogonalLoop=1;jettySize=auto;html=1;exitX=0.5;exitY=1;exitDx=0;exitDy=0;entryX=0.5;entryY=0;entryDx=0;entryDy=0;" edge="1" parent="1" source="top" target="bottom">
                  <mxGeometry relative="1" as="geometry" />
                </mxCell>
                """
            )
        )

        result = lint_file(path)

        self.assertFalse(any("straight" in w for w in result.warnings), result.warnings)

    def test_collinear_dogleg_check_skips_edges_with_waypoints(self) -> None:
        path = write_temp_drawio(
            textwrap.dedent(
                """
                <mxCell id="top" value="甲" style="rounded=1;whiteSpace=wrap;html=1;fillColor=#D8ECFF;strokeColor=#2F78C4;fontSize=16;fontFamily=SimSun;fontColor=#000000;" vertex="1" parent="1">
                  <mxGeometry x="180" y="118" width="80" height="38" as="geometry" />
                </mxCell>
                <mxCell id="bottom" value="乙" style="rounded=1;whiteSpace=wrap;html=1;fillColor=#D8ECFF;strokeColor=#2F78C4;fontSize=16;fontFamily=SimSun;fontColor=#000000;" vertex="1" parent="1">
                  <mxGeometry x="104" y="190" width="232" height="58" as="geometry" />
                </mxCell>
                <mxCell id="e1" value="" style="edgeStyle=orthogonalEdgeStyle;rounded=0;orthogonalLoop=1;jettySize=auto;html=1;exitX=0.45;exitY=1;exitDx=0;exitDy=0;entryX=0.5;entryY=0;entryDx=0;entryDy=0;" edge="1" parent="1" source="top" target="bottom">
                  <mxGeometry relative="1" as="geometry">
                    <Array as="points">
                      <mxPoint x="216" y="172" />
                    </Array>
                  </mxGeometry>
                </mxCell>
                """
            )
        )

        result = lint_file(path)

        self.assertFalse(any("straight" in w for w in result.warnings), result.warnings)

    def test_edge_through_transparent_frame_is_not_flagged(self) -> None:
        # A fillColor=none group frame is a container, not an obstacle: edges traverse it.
        path = write_temp_drawio(
            textwrap.dedent(
                """
                <mxCell id="frame" value="" style="rounded=1;whiteSpace=wrap;html=1;fillColor=none;strokeColor=#707070;dashed=1;" vertex="1" parent="1">
                  <mxGeometry x="0" y="0" width="400" height="200" as="geometry" />
                </mxCell>
                <mxCell id="a" value="甲" style="rounded=1;whiteSpace=wrap;html=1;fillColor=#D8ECFF;strokeColor=#2F78C4;fontSize=16;fontFamily=SimSun;fontColor=#000000;" vertex="1" parent="1">
                  <mxGeometry x="20" y="80" width="60" height="40" as="geometry" />
                </mxCell>
                <mxCell id="b" value="乙" style="rounded=1;whiteSpace=wrap;html=1;fillColor=#D8ECFF;strokeColor=#2F78C4;fontSize=16;fontFamily=SimSun;fontColor=#000000;" vertex="1" parent="1">
                  <mxGeometry x="300" y="80" width="60" height="40" as="geometry" />
                </mxCell>
                <mxCell id="e1" value="" style="edgeStyle=orthogonalEdgeStyle;rounded=0;orthogonalLoop=1;jettySize=auto;html=1;exitX=1;exitY=0.5;exitDx=0;exitDy=0;entryX=0;entryY=0.5;entryDx=0;entryDy=0;" edge="1" parent="1" source="a" target="b">
                  <mxGeometry relative="1" as="geometry" />
                </mxCell>
                """
            )
        )

        result = lint_file(path)

        self.assertEqual(result.errors, [])
        self.assertFalse(any("through" in w for w in result.warnings), result.warnings)

    def test_text_overflow_is_warning(self) -> None:
        path = write_temp_drawio(
            textwrap.dedent(
                """
                <mxCell id="tiny" value="较长的模块名称示例" style="rounded=1;fontSize=14;fontFamily=Source Han Serif SC;" vertex="1" parent="1">
                  <mxGeometry x="0" y="0" width="80" height="24" as="geometry" />
                </mxCell>
                """
            )
        )

        result = lint_file(path)

        joined = "\n".join(result.warnings)
        self.assertIn("possible text overflow", joined)

    def test_missing_fontfamily_is_hard_error(self) -> None:
        path = write_temp_drawio(
            textwrap.dedent(
                """
                <mxCell id="bad" value="模块甲" style="rounded=1;fontSize=14;" vertex="1" parent="1">
                  <mxGeometry x="0" y="0" width="200" height="60" as="geometry" />
                </mxCell>
                """
            )
        )

        result = lint_file(path)

        self.assertTrue(
            any("missing fontFamily" in error for error in result.errors),
            result.errors,
        )

    def test_missing_fontsize_is_hard_error(self) -> None:
        path = write_temp_drawio(
            textwrap.dedent(
                """
                <mxCell id="bad" value="模块甲" style="rounded=1;fontFamily=Source Han Serif SC;" vertex="1" parent="1">
                  <mxGeometry x="0" y="0" width="200" height="60" as="geometry" />
                </mxCell>
                """
            )
        )

        result = lint_file(path)

        self.assertTrue(
            any("missing fontSize" in error for error in result.errors),
            result.errors,
        )

    def test_visible_text_below_font_floor_is_hard_error(self) -> None:
        path = write_temp_drawio(
            textwrap.dedent(
                """
                <mxCell id="small" value="模块甲" style="rounded=1;fontSize=13;fontFamily=Source Han Serif SC;" vertex="1" parent="1">
                  <mxGeometry x="0" y="0" width="200" height="60" as="geometry" />
                </mxCell>
                """
            )
        )

        result = lint_file(path)

        self.assertTrue(
            any("fontSize 13 is below visible text floor 14" in error for error in result.errors),
            result.errors,
        )

    def test_auxiliary_text_uses_lower_font_floor(self) -> None:
        path = write_temp_drawio(
            textwrap.dedent(
                """
                <mxCell id="aux" value="注释" style="rounded=1;fontSize=12;fontFamily=Source Han Serif SC;fontColor=#707070;" vertex="1" parent="1">
                  <mxGeometry x="0" y="0" width="200" height="60" as="geometry" />
                </mxCell>
                """
            )
        )

        result = lint_file(path)

        self.assertEqual(result.errors, [])

    def test_auxiliary_text_below_auxiliary_floor_is_hard_error(self) -> None:
        path = write_temp_drawio(
            textwrap.dedent(
                """
                <mxCell id="aux" value="注释" style="rounded=1;fontSize=11;fontFamily=Source Han Serif SC;fontColor=#707070;" vertex="1" parent="1">
                  <mxGeometry x="0" y="0" width="200" height="60" as="geometry" />
                </mxCell>
                """
            )
        )

        result = lint_file(path)

        self.assertTrue(
            any("fontSize 11 is below auxiliary text floor 12" in error for error in result.errors),
            result.errors,
        )

    def test_core_module_below_core_font_floor_is_hard_error(self) -> None:
        path = write_temp_drawio(
            textwrap.dedent(
                """
                <mxCell id="module" value="模块甲" style="rounded=1;fontSize=15;fontFamily=Source Han Serif SC;fillColor=#D8ECFF;strokeColor=#2F78C4;fontColor=#000000;" vertex="1" parent="1">
                  <mxGeometry x="0" y="0" width="200" height="60" as="geometry" />
                </mxCell>
                """
            )
        )

        result = lint_file(path)

        self.assertTrue(
            any("fontSize 15 is below core module floor 16" in error for error in result.errors),
            result.errors,
        )

    def test_banned_fontfamily_is_hard_error(self) -> None:
        path = write_temp_drawio(
            textwrap.dedent(
                """
                <mxCell id="bad" value="模块甲" style="rounded=1;fontSize=14;fontFamily=Helvetica;" vertex="1" parent="1">
                  <mxGeometry x="0" y="0" width="200" height="60" as="geometry" />
                </mxCell>
                """
            )
        )

        result = lint_file(path)

        self.assertTrue(
            any("banned fontFamily 'Helvetica'" in error for error in result.errors),
            result.errors,
        )

    def test_unlisted_fontfamily_is_hard_error(self) -> None:
        path = write_temp_drawio(
            textwrap.dedent(
                """
                <mxCell id="bad" value="模块甲" style="rounded=1;fontSize=14;fontFamily=Georgia;" vertex="1" parent="1">
                  <mxGeometry x="0" y="0" width="200" height="60" as="geometry" />
                </mxCell>
                """
            )
        )

        result = lint_file(path)

        self.assertTrue(
            any("fontFamily 'Georgia' is not on §5 whitelist" in error for error in result.errors),
            result.errors,
        )

    def test_lint_file_accepts_custom_spec_path_for_font_whitelist(self) -> None:
        path = write_temp_drawio(
            textwrap.dedent(
                """
                <mxCell id="custom-font" value="Custom Font" style="rounded=1;fontSize=14;fontFamily=Georgia;" vertex="1" parent="1">
                  <mxGeometry x="0" y="0" width="200" height="60" as="geometry" />
                </mxCell>
                """
            )
        )
        spec_path = write_temp_spec()

        result = lint_file(path, spec_path=spec_path)

        self.assertEqual(result.errors, [])

    def test_cjk_content_with_latin_font_is_warning(self) -> None:
        path = write_temp_drawio(
            textwrap.dedent(
                """
                <mxCell id="mix" value="模块甲 Module" style="rounded=1;fontSize=14;fontFamily=Times New Roman;" vertex="1" parent="1">
                  <mxGeometry x="0" y="0" width="200" height="60" as="geometry" />
                </mxCell>
                """
            )
        )

        result = lint_file(path)

        self.assertEqual(result.errors, [])
        self.assertTrue(
            any("CJK content uses Latin-only font" in warning for warning in result.warnings),
            result.warnings,
        )

    def test_pure_latin_content_with_cjk_font_is_warning(self) -> None:
        path = write_temp_drawio(
            textwrap.dedent(
                """
                <mxCell id="latin" value="Node Label 0" style="rounded=1;fontSize=14;fontFamily=Source Han Serif SC;" vertex="1" parent="1">
                  <mxGeometry x="0" y="0" width="200" height="60" as="geometry" />
                </mxCell>
                """
            )
        )

        result = lint_file(path)

        self.assertEqual(result.errors, [])
        self.assertTrue(
            any("pure-Latin content uses CJK font" in warning for warning in result.warnings),
            result.warnings,
        )

    def test_empty_value_cells_skip_font_check(self) -> None:
        path = write_temp_drawio(
            textwrap.dedent(
                """
                <mxCell id="bg" value="" style="rounded=1;fillColor=#FFFFFF;" vertex="1" parent="1">
                  <mxGeometry x="0" y="0" width="200" height="60" as="geometry" />
                </mxCell>
                """
            )
        )

        result = lint_file(path)

        self.assertFalse(
            any("missing fontFamily" in error for error in result.errors),
            result.errors,
        )

    def test_new_palette_fill_stroke_and_font_colors_pass(self) -> None:
        path = write_temp_drawio(
            textwrap.dedent(
                """
                <mxCell id="module" value="模块甲" style="rounded=1;fontSize=16;fontFamily=Source Han Serif SC;fillColor=#D8ECFF;strokeColor=#2F78C4;fontColor=#000000;" vertex="1" parent="1">
                  <mxGeometry x="0" y="0" width="200" height="60" as="geometry" />
                </mxCell>
                <mxCell id="note" value="注释" style="rounded=1;fontSize=12;fontFamily=Source Han Serif SC;fillColor=#F0F0F0;strokeColor=#707070;fontColor=#707070;" vertex="1" parent="1">
                  <mxGeometry x="0" y="80" width="200" height="60" as="geometry" />
                </mxCell>
                <mxCell id="device" value="设备节点" style="rounded=1;fontSize=16;fontFamily=Source Han Serif SC;fillColor=#DDE3EA;strokeColor=#566D80;fontColor=#000000;" vertex="1" parent="1">
                  <mxGeometry x="0" y="160" width="200" height="60" as="geometry" />
                </mxCell>
                """
            )
        )

        result = lint_file(path)

        self.assertEqual(result.errors, [])

    def test_main_flow_blue_is_no_longer_allowed_as_font_color(self) -> None:
        path = write_temp_drawio(
            textwrap.dedent(
                """
                <mxCell id="title" value="模块甲" style="rounded=1;fontSize=16;fontFamily=Source Han Serif SC;fillColor=#D8ECFF;strokeColor=#2F78C4;fontColor=#2F78C4;" vertex="1" parent="1">
                  <mxGeometry x="0" y="0" width="200" height="60" as="geometry" />
                </mxCell>
                """
            )
        )

        result = lint_file(path)

        self.assertTrue(
            any("fontColor #2F78C4 is not allowed for visible text" in error for error in result.errors),
            result.errors,
        )

    def test_legacy_palette_colors_are_hard_errors(self) -> None:
        path = write_temp_drawio(
            textwrap.dedent(
                """
                <mxCell id="legacy" value="旧配色" style="rounded=1;fontSize=14;fontFamily=Source Han Serif SC;fillColor=#BDD7EE;strokeColor=#2E75B6;fontColor=#2E75B6;" vertex="1" parent="1">
                  <mxGeometry x="0" y="0" width="200" height="60" as="geometry" />
                </mxCell>
                """
            )
        )

        result = lint_file(path)

        joined = "\n".join(result.errors)
        self.assertIn("fillColor #BDD7EE is not in §1 fill palette", joined)
        self.assertIn("strokeColor #2E75B6 is not in §1 stroke palette", joined)
        self.assertIn("fontColor #2E75B6 is not allowed for visible text", joined)

    def test_fill_and_stroke_colors_must_use_their_palette_roles(self) -> None:
        path = write_temp_drawio(
            textwrap.dedent(
                """
                <mxCell id="swapped" value="计算" style="rounded=1;fontSize=14;fontFamily=Source Han Serif SC;fillColor=#C28A00;strokeColor=#FFE9A8;fontColor=#000000;" vertex="1" parent="1">
                  <mxGeometry x="0" y="0" width="200" height="60" as="geometry" />
                </mxCell>
                """
            )
        )

        result = lint_file(path)

        joined = "\n".join(result.errors)
        self.assertIn("fillColor #C28A00 is not in §1 fill palette", joined)
        self.assertIn("strokeColor #FFE9A8 is not in §1 stroke palette", joined)

    def test_visible_font_color_is_limited_to_text_palette(self) -> None:
        path = write_temp_drawio(
            textwrap.dedent(
                """
                <mxCell id="bad-font-color" value="计算" style="rounded=1;fontSize=16;fontFamily=Source Han Serif SC;fillColor=#FFE9A8;strokeColor=#C28A00;fontColor=#C28A00;" vertex="1" parent="1">
                  <mxGeometry x="0" y="0" width="200" height="60" as="geometry" />
                </mxCell>
                """
            )
        )

        result = lint_file(path)

        self.assertTrue(
            any("fontColor #C28A00 is not allowed for visible text" in error for error in result.errors),
            result.errors,
        )

    def test_default_canvas_allows_relaxed_visible_text_count(self) -> None:
        long_text = "测" * 300
        path = write_temp_drawio(
            textwrap.dedent(
                f"""
                <mxCell id="dense" value="{long_text}" style="rounded=1;fontSize=14;fontFamily=Source Han Serif SC;" vertex="1" parent="1">
                  <mxGeometry x="0" y="0" width="4300" height="60" as="geometry" />
                </mxCell>
                """
            )
        )

        result = lint_file(path)

        self.assertEqual(result.errors, [])
        self.assertEqual(result.warnings, [])

    def test_visible_text_count_above_warning_limit_is_warning(self) -> None:
        long_text = "测" * 321
        path = write_temp_drawio(
            textwrap.dedent(
                f"""
                <mxCell id="dense" value="{long_text}" style="rounded=1;fontSize=14;fontFamily=Source Han Serif SC;" vertex="1" parent="1">
                  <mxGeometry x="0" y="0" width="4200" height="60" as="geometry" />
                </mxCell>
                """
            )
        )

        result = lint_file(path)

        self.assertEqual(result.errors, [])
        self.assertTrue(
            any("visible text count 321 exceeds global warning limit 320" in warning for warning in result.warnings),
            result.warnings,
        )

    def test_visible_text_count_above_error_limit_is_hard_error(self) -> None:
        long_text = "测" * 421
        path = write_temp_drawio(
            textwrap.dedent(
                f"""
                <mxCell id="dense" value="{long_text}" style="rounded=1;fontSize=14;fontFamily=Source Han Serif SC;" vertex="1" parent="1">
                  <mxGeometry x="0" y="0" width="5200" height="60" as="geometry" />
                </mxCell>
                """
            )
        )

        result = lint_file(path)

        self.assertTrue(
            any("visible text count 421 exceeds global error limit 420" in error for error in result.errors),
            result.errors,
        )

    def test_core_module_boxes_allow_at_most_two_visible_lines(self) -> None:
        path = write_temp_drawio(
            textwrap.dedent(
                """
                <mxCell id="module" value="模块甲&lt;br/&gt;Module&lt;br/&gt;状态" style="rounded=1;fontSize=16;fontFamily=Source Han Serif SC;fillColor=#D8ECFF;strokeColor=#2F78C4;fontColor=#000000;" vertex="1" parent="1">
                  <mxGeometry x="0" y="0" width="180" height="80" as="geometry" />
                </mxCell>
                """
            )
        )

        result = lint_file(path)

        self.assertTrue(
            any("core module has 3 visible lines; maximum is 2" in error for error in result.errors),
            result.errors,
        )

    def test_core_module_first_line_may_follow_reference_language(self) -> None:
        path = write_temp_drawio(
            textwrap.dedent(
                """
                <mxCell id="module" value="Input Stream&lt;br/&gt;Output Stage" style="rounded=1;fontSize=16;fontFamily=Times New Roman;fillColor=#FFE9A8;strokeColor=#C28A00;fontColor=#000000;" vertex="1" parent="1">
                  <mxGeometry x="0" y="0" width="180" height="60" as="geometry" />
                </mxCell>
                """
            )
        )

        result = lint_file(path)

        self.assertEqual(result.errors, [])

    def test_core_module_label_count_above_limit_is_hard_error(self) -> None:
        path = write_temp_drawio(
            textwrap.dedent(
                """
                <mxCell id="module" value="这是一个明显过长的通用模块名称示例" style="rounded=1;fontSize=16;fontFamily=Source Han Serif SC;fillColor=#D8ECFF;strokeColor=#2F78C4;fontColor=#000000;" vertex="1" parent="1">
                  <mxGeometry x="0" y="0" width="500" height="60" as="geometry" />
                </mxCell>
                """
            )
        )

        result = lint_file(path)

        self.assertTrue(
            any("core module label count" in error for error in result.errors),
            result.errors,
        )

    def test_canvas_height_above_global_cap_is_hard_error(self) -> None:
        path = write_temp_drawio("", model_attrs='pageWidth="1200" pageHeight="920"')

        result = lint_file(path)

        self.assertTrue(
            any("pageHeight 920 exceeds canvas max height 900" in error for error in result.errors),
            result.errors,
        )

    def test_module_and_arrow_counts_above_limit_are_hard_errors(self) -> None:
        modules = []
        for index in range(31):
            x = (index % 8) * 140
            y = (index // 8) * 80
            modules.append(
                f'<mxCell id="m{index}" value="模块{index}" style="rounded=1;fontSize=16;fontFamily=Source Han Serif SC;fillColor=#D8ECFF;strokeColor=#2F78C4;fontColor=#000000;" vertex="1" parent="1"><mxGeometry x="{x}" y="{y}" width="100" height="50" as="geometry" /></mxCell>'
            )
        edge_nodes = []
        edges = []
        for index in range(41):
            y = 360 + index * 6
            edge_nodes.append(
                f'<mxCell id="s{index}" value="" style="rounded=1;" vertex="1" parent="1"><mxGeometry x="0" y="{y}" width="20" height="20" as="geometry" /></mxCell>'
            )
            edge_nodes.append(
                f'<mxCell id="t{index}" value="" style="rounded=1;" vertex="1" parent="1"><mxGeometry x="80" y="{y}" width="20" height="20" as="geometry" /></mxCell>'
            )
            edges.append(valid_edge(f"e{index}", f"s{index}", f"t{index}"))
        path = write_temp_drawio(
            "\n".join(modules + edge_nodes + edges),
            model_attrs='pageWidth="1200" pageHeight="675"',
        )

        result = lint_file(path)

        joined = "\n".join(result.errors)
        self.assertIn("core module count 31 exceeds global error limit 30", joined)
        self.assertIn("connected edge count 41 exceeds global error limit 40", joined)

    def test_default_canvas_is_neutral_16_9(self) -> None:
        path = write_temp_drawio(
            textwrap.dedent(
                """
                <mxCell id="a" value="模块甲" style="rounded=1;fontSize=16;fontFamily=Source Han Serif SC;fillColor=#D8ECFF;strokeColor=#2F78C4;fontColor=#000000;" vertex="1" parent="1">
                  <mxGeometry x="20" y="20" width="120" height="50" as="geometry" />
                </mxCell>
                """
            ),
        )

        result = lint_file(path)

        self.assertEqual(result.errors, [])

    def test_global_density_budget_allows_moderately_complex_figures(self) -> None:
        modules = []
        for index in range(24):
            x = (index % 6) * 160 + 20
            y = (index // 6) * 100 + 20
            modules.append(
                f'<mxCell id="m{index}" value="模块{index}" style="rounded=1;fontSize=18;fontFamily=Source Han Serif SC;fillColor=#D8ECFF;strokeColor=#2F78C4;fontColor=#000000;" vertex="1" parent="1"><mxGeometry x="{x}" y="{y}" width="100" height="50" as="geometry" /></mxCell>'
            )
        path = write_temp_drawio(
            "\n".join(modules),
            model_attrs='pageWidth="1200" pageHeight="675"',
        )

        result = lint_file(path)

        joined = "\n".join(result.errors)
        self.assertNotIn("core module count", joined)
        self.assertNotIn("canvas category", joined)

    def test_pagewidth_above_canvas_max_is_hard_error(self) -> None:
        path = write_temp_drawio("", model_attrs='pageWidth="1700" pageHeight="900"')

        result = lint_file(path)

        self.assertTrue(
            any("pageWidth 1700 exceeds canvas max width 1600" in error for error in result.errors),
            result.errors,
        )

    def test_canvas_aspect_ratio_outside_range_is_hard_error(self) -> None:
        path = write_temp_drawio("", model_attrs='pageWidth="900" pageHeight="900"')

        result = lint_file(path)

        self.assertTrue(
            any("canvas aspect ratio 1 is outside allowed range 1.25-2.4" in error for error in result.errors),
            result.errors,
        )

    def test_latex_brace_subscript_is_hard_error(self) -> None:
        path = write_temp_drawio(
            textwrap.dedent(
                """
                <mxCell id="m" value="α_{c,τ} → 1" style="text;html=1;fontSize=14;fontFamily=Times New Roman;" vertex="1" parent="1">
                  <mxGeometry x="0" y="0" width="120" height="30" as="geometry" />
                </mxCell>
                """
            )
        )

        result = lint_file(path)

        self.assertTrue(
            any("un-rendered math '_{'" in error for error in result.errors),
            result.errors,
        )

    def test_latex_dollar_delimiters_is_hard_error(self) -> None:
        path = write_temp_drawio(
            textwrap.dedent(
                r"""
                <mxCell id="m" value="$\alpha$" style="text;html=1;fontSize=14;fontFamily=Times New Roman;" vertex="1" parent="1">
                  <mxGeometry x="0" y="0" width="120" height="30" as="geometry" />
                </mxCell>
                """
            )
        )

        result = lint_file(path)

        self.assertTrue(
            any("un-rendered math" in error for error in result.errors),
            result.errors,
        )

    def test_latex_command_is_hard_error(self) -> None:
        path = write_temp_drawio(
            textwrap.dedent(
                r"""
                <mxCell id="m" value="T = \sum T_i" style="text;html=1;fontSize=14;fontFamily=Times New Roman;" vertex="1" parent="1">
                  <mxGeometry x="0" y="0" width="120" height="30" as="geometry" />
                </mxCell>
                """
            )
        )

        result = lint_file(path)

        self.assertTrue(
            any(r"\sum" in error for error in result.errors),
            result.errors,
        )

    def test_html_subscript_passes_math_check(self) -> None:
        path = write_temp_drawio(
            textwrap.dedent(
                """
                <mxCell id="m" value="α&lt;sub&gt;c,τ&lt;/sub&gt; → 1   T&lt;sub&gt;total&lt;/sub&gt;" style="text;html=1;fontSize=14;fontFamily=Times New Roman;" vertex="1" parent="1">
                  <mxGeometry x="0" y="0" width="180" height="30" as="geometry" />
                </mxCell>
                """
            )
        )

        result = lint_file(path)

        self.assertFalse(
            any("un-rendered math" in error for error in result.errors),
            result.errors,
        )

    def test_math_mode_on_is_hard_error_and_does_not_suppress_latex_check(self) -> None:
        path = write_temp_drawio(
            textwrap.dedent(
                """
                <mxCell id="m" value="α_{c,τ}" style="text;html=1;fontSize=14;fontFamily=Times New Roman;" vertex="1" parent="1">
                  <mxGeometry x="0" y="0" width="120" height="30" as="geometry" />
                </mxCell>
                """
            ),
            model_attrs='math="1"',
        )

        result = lint_file(path)

        joined = "\n".join(result.errors)
        self.assertIn("mxGraphModel math=\"1\" is banned", joined)
        self.assertIn("un-rendered math '_{'", joined)

    def test_math_mode_on_without_latex_is_hard_error(self) -> None:
        path = write_temp_drawio(
            textwrap.dedent(
                """
                <mxCell id="m" value="α&lt;sub&gt;c,τ&lt;/sub&gt;" style="text;html=1;fontSize=14;fontFamily=Times New Roman;" vertex="1" parent="1">
                  <mxGeometry x="0" y="0" width="120" height="30" as="geometry" />
                </mxCell>
                """
            ),
            model_attrs='math="1"',
        )

        result = lint_file(path)

        self.assertTrue(
            any('mxGraphModel math="1" is banned' in error for error in result.errors),
            result.errors,
        )

    def test_plain_underscore_identifier_not_flagged_as_math(self) -> None:
        path = write_temp_drawio(
            textwrap.dedent(
                """
                <mxCell id="m" value="format_item(x, y)" style="text;html=1;fontSize=14;fontFamily=Times New Roman;" vertex="1" parent="1">
                  <mxGeometry x="0" y="0" width="160" height="30" as="geometry" />
                </mxCell>
                """
            )
        )

        result = lint_file(path)

        self.assertFalse(
            any("un-rendered math" in error for error in result.errors),
            result.errors,
        )


if __name__ == "__main__":
    unittest.main()
