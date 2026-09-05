# Drawing Hard Rules

> Entry point: [SKILL.md](../SKILL.md). This file is the authoring source for humans and agents: it restates lint-enforced checks in readable form and also includes manual hard rules the lint cannot fully judge. `scripts/spec.toml` is the default machine source for linter constants such as palette, font whitelist, visibility floors, and density caps. Explicitly provided project, prompt, or template rules may be mirrored in a temporary spec and passed to the linter with `--spec`.
> Subagent dispatch prompts paste this file verbatim.
> Normal drawing agents read this file, not `scripts/*.py`, `scripts/test_*.py`, or `scripts/spec.toml`. Run validators as black-box commands and fix their output; read implementation files only when explicitly maintaining the validator.

---

## 0. Lint-enforced surface

Use this summary to design without opening the lint source:

- **Canvas:** default `1200×675`; max `1600×900`; aspect ratio `1.25–2.40`.
- **Density:** total visible text, colored core modules, connected edges, core-module line count, and core-module label units.
- **Edges:** required square-corner orthogonal base style; expanded `<mxGeometry relative="1" as="geometry">`; explicit `exitX/exitY/entryX/entryY/exitDx/exitDy/entryDx/entryDy` on routing-risk endpoints; no edge routes through a non-endpoint filled box (hard error when the route is pinned/determined, warning when unpinned); a both-pinned, straight-reachable connector bent into a dogleg is a warning.
- **Text boxes:** possible overflow is estimated from visible lines, `fontSize`, and box dimensions; warnings still require manual review.
- **Fonts:** explicit `fontSize`, explicit whitelisted `fontFamily`, banned-font rejection, CJK/Latin mismatch warnings, and Latin words inside CJK-font cells.
- **Colors:** all hex style colors must stay in the approved palette; `fillColor`, `strokeColor`, and visible `fontColor` have separate allowlists.
- **Math:** `math="1"` and LaTeX markers that will not render in headless export are rejected; use HTML `<sub>` / `<sup>` and Unicode.

If lint output seems surprising, first resolve it from the sections below. Do not read the validator code unless the task is to change or debug the validator itself.

---

## 1. Palette & colors

Only colors from the table below may appear in a figure. Black, white, and transparent are allowed for text / canvas / white-backed callouts, but they do NOT count toward the "primary color" budget.

| # | Suggested role | Fill | Stroke | Good for |
| --: | --- | --- | --- | --- |
| 1 | High-frequency main-flow module | `#D8ECFF` | `#2F78C4` | Main process, transfer, coordination |
| 2 | Compute-core module | `#FFE9A8` | `#C28A00` | Compute, computation stages |
| 3 | Aggregate / combine module | `#DDF4C8` | `#4F9A2F` | Combine, reduce, output |
| 4 | Control / routing module | `#E3F6D8` | `#5C9B45` | Decision, routing, control logic |
| 5 | Buffer / storage / async module | `#D9F2F8` | `#3A8DA8` | Buffer, storage, asynchronous state |
| 6 | Auxiliary / annotation module | `#F0F0F0` | `#707070` | Annotations, helper frames, background blocks |
| 7 | Emphasis / bottleneck / wait | `#FFDAD4` | `#C8584B` | Delay, wait, conflict, critical path |
| 8 | Secondary stage / spare category | `#E9DFFF` | `#7962B8` | Stage, batch, extra category |
| 9 | Physical device / hardware | `#DDE3EA` | `#566D80` | Device, accelerator, physical node |

The validator uses the same hex lists internally. Normal drawing agents should use this table and should not open the TOML; editing this table as a spec change also requires updating the validator constants.

Hard rules:

- A single figure uses at most 7 palette roles (excluding black / white, and excluding the auxiliary gray role when it is used only for annotations / background blocks).
- Modules, containers, backgrounds MUST use flat solid fill — no gradients, shadows, 3D effects, watermarks, canvas borders, or grid lines.
- `fillColor` MUST use one of the table's fill colors, `#FFFFFF`, or transparent / `none`.
- `strokeColor` MUST use one of the table's stroke colors, `#000000`, or `#FFFFFF`.
- `fontColor` on any visible text MUST be either `#000000` (default) or `#707070` (the auxiliary gray, used for arrow labels and annotations). No other palette fill or stroke color may appear as `fontColor`.
- Arrow labels and annotations MUST use `#707070`, regardless of the arrow or container color.
- L1 module titles MUST all be black within one figure.

Quick check:

```bash
grep -oE '(fillColor|strokeColor|fontColor)=#[0-9A-Fa-f]+' *.drawio | sort -u
```

---

## 2. Canvas, font size, information density

Use one output-neutral canvas model. Do NOT draw oversized figures and shrink them later; that hides overcrowding and makes text unreadable. Canvas, visibility, and density caps below are enforced by the lint.

### 2.1 Canvas

Default canvas:

- If `mxGraphModel` omits `pageWidth` or `pageHeight`, lint treats the figure as `1200 × 675` (`16:9`).
- `pageWidth` MUST be ≤ `1600`.
- `pageHeight` MUST be ≤ `900`.
- Aspect ratio (`pageWidth / pageHeight`) MUST stay in `1.25–2.40`.

Choose the aspect ratio from the figure shape, not from an output application:

| Figure shape | Recommended W:H | Example canvas |
| --- | --- | --- |
| Horizontal pipeline / data-flow / architecture overview | `2:1–2.4:1` | `1200×600`, `1440×640` |
| System framework / logic diagram / flowchart | `16:9–3:2` | `1200×675`, `1200×760` |
| Local detail / comparison / matrix-like figure | `4:3–3:2` | `1200×900`, `1200×800` |

When the shape is unclear, use `1200×675`. Avoid portrait and ultra-wide canvases; they usually force either long labels or tiny labels.

### 2.2 Visibility and font-size floors

Hard rules:

- Every visible text cell MUST set `fontSize=` explicitly.
- Ordinary visible text MUST use `fontSize ≥ 14`.
- Auxiliary text (`fontColor=#707070` or auxiliary gray fill `#F0F0F0`) MUST use `fontSize ≥ 12`.
- Core module text MUST use `fontSize ≥ 16`.
- Final placement scale MUST remain ≥ 85% (`0.85`) of the design size. If the figure must be reduced more than that, simplify the content, split the figure, or increase the target space.
- Never lower `fontSize` to fix overflow. Widen the box, shorten the label, or split the figure.

Recommended ranges:

| Text role | Recommended draw.io `fontSize` |
| --- | --- |
| Core module main title | `16–20` |
| Module subtitle / secondary label | `14–16` |
| Ordinary formula / number / unit label | `14–16` |
| Arrow label / annotation | `12–14` |
| Optional in-figure title | `18–22` |

### 2.3 Information density

Warnings identify figures that should be simplified; hard errors block figures that are too crowded to read.

| Metric | Warning | Hard error |
| --- | ---: | ---: |
| Total visible text | `> 320` count units | `> 420` count units |
| Core modules | `> 24` | `> 30` |
| Connected edges (`source` and `target` both set) | `> 32` | `> 40` |

Local density rules:

- A colored core module box holds ≤ 2 visible lines: main name on line 1 and optional subtitle on line 2. Choose Chinese, English, or bilingual wording according to the thesis prose, source/reference material, official terminology, and target audience.
- A single core module label holds ≤ 16 count units.
- Move details, formulas, and parameters to prose, tables, or a detail figure.

Lint text-count units are deterministic: strip HTML; count each CJK character as 1; count each contiguous Latin / digit / Greek / math-symbol token as 1; ignore punctuation used only as separators. Count title text, lane labels, legend entries, module labels, and arrow labels. Exclude only captions or labels that live outside the `.drawio` figure.

### 2.4 Lint terminology

- **Core module** — a visible text-bearing vertex whose `fillColor` is one of the colored palette fills in §1 except the auxiliary gray `#F0F0F0`. White boxes, transparent group frames, gray annotation blocks, image shapes, and icon shapes are NOT core modules.
- **Connected edge** — an edge with both `source` and `target` set. Free-floating legend lines / decorative arrows without endpoints do not count toward the cap.

---

## 3. Containers & shapes

| Type | Geometry | Stroke | Fill |
| --- | --- | --- | --- |
| Core module | Rounded rectangle, R=4–8 px | 1.5 pt solid | Light flat fill |
| Module group | Rounded rectangle, R=4–8 px | 1.5 pt dashed | Very light or transparent |
| Data / vector | Rectangle array | 0.5 pt gray stroke | Discrete colored cell array |
| Neural network layer | Right-angle rectangle | 1 pt solid | Flat fill |
| Input / output | Large rounded rectangle, R=10–15 px | 1 pt solid | White or light gray |
| Database / storage | Cylinder icon | 1 pt solid | Light blue |

Hard rules:

- System modules, schedulers, and executors default to rounded rectangles.
- Complex system figures prefer a "group frame + sub-module" two-layer structure.

---

## 4. Arrows & connectors

| Semantics | Style | Color | Width |
| --- | --- | --- | --- |
| Main data flow | Solid + filled triangle | `#2F78C4` | 1.5 pt |
| Key control flow | Bold solid + filled triangle | `#5C9B45` | 1.5 pt |
| Secondary / internal | Thin solid + thin triangle | `#707070` | 0.75 pt |
| Feedback / status flow | Dashed + filled triangle | `#4F9A2F` | 1–1.5 pt |
| Exception / alert | Dashed + filled triangle | `#C8584B` | 1–1.5 pt |
| Async message | Dashed + thin-line arrow | `#3A8DA8` | 0.75 pt |
| Sync interaction | Bidirectional bold arrow | `#2F78C4` | 1.5 pt |

Hard rules:

- Solid lines = actual data flow, control flow, or module boundary.
- Dashed lines = logical grouping, trust domain, feedback path, async relation, or conditional path.
- Figures with ≥ 2 arrow semantics MUST include a legend (top-right or bottom).
- Connectors use square-corner orthogonal polylines — rounded connector bends, curves, and Bézier lines are banned.
- Arrows MUST land on a box edge — never floating.
- Same-semantic arrows keep consistent direction; prefer left-to-right or top-to-bottom.

---

## 5. Fonts & text

**Text-level glossary (L1 / L2 / L3):**

- **L1** = a core module's primary name — the line-1 title inside a colored module box. One per module. **Regular weight — not bold** (only an optional in-figure title may use a heading face; see the rules below).
- **L2** = a sub-module name, small in-figure label, or English subtitle stacked under L1 (e.g. "Worker Process", "Storage Node"). Used inside L1 modules or for secondary boxes; ≤ line-2 of the module box.
- **L3** = an annotation or callout — never inside a colored core module. Includes arrow labels, axis ticks, and explanatory text in a white-backed callout.

Default font policy:

| Text type | Font | draw.io `fontSize` | Color |
| --- | --- | --- | --- |
| Optional in-figure title (the only heading-face text) | SimHei, a true heading-weight CJK face; no `fontStyle=1` | 18–22 | `#000000` |
| L1 module title with CJK or mixed CJK-English content | SimSun / Source Han Serif SC, regular weight | 16–20 | `#000000` |
| Module English subtitle | Times New Roman | 14–16 | `#000000` |
| L2 sub-module name / small label | SimSun Regular | 14–16 | `#000000` |
| L3 internal detail / annotation | SimSun Regular | 12–14 | `#707070` |
| Numbers, English abbreviations, units | Times New Roman | 14–16 | `#000000` |
| Math variable / symbol (plain text + `<sub>`/`<sup>`, NOT LaTeX) | Times New Roman italic / CMU Serif | 14–16 | `#000000` |
| Arrow label | SimSun + Times New Roman | 12–14 | `#707070` |

Allowed `fontFamily` values accepted by the lint:

- CJK/body fonts: `Source Han Serif SC`, `思源宋体`, `SimSun`, `宋体`, `STSong`, `华文宋体`, `SimHei`, `黑体`.
- Latin/math fonts: `Times New Roman`, `CMU Serif`, `Computer Modern`, `LM Math`, `Latin Modern Math`.

For normal authoring, prefer `SimSun` or `Source Han Serif SC` for CJK body text, `SimHei` only for an optional in-figure title, `Times New Roman` for Latin/digit labels, and `CMU Serif` only for dedicated formula callouts. The other accepted names are compatibility aliases, not new style choices.

### 5.1 Hard font rules

These rules apply to both draft and final figures unless explicitly marked as final polish:

- **Explicit font instructions override this default spec.** If a prompt, brief, school / department template, or other source mandates a font family, use it and mirror that change in a temporary spec passed to the validator with `--spec`. Update the default whitelist and validator constants only when changing the default policy.
- **Every visible text cell MUST set `fontFamily` explicitly.** Omitting `fontFamily` is a hard error because draw.io silently falls back to Helvetica / system sans-serif.
- **Every visible text cell MUST set `fontSize` explicitly and satisfy the §2.2 floor.**
- **Every `fontFamily` value MUST be one of the allowed values listed above.** Any unlisted family is a hard error, even if it is visually similar.
- **Banned fonts MUST NOT appear:** `Helvetica`, `Arial`, `Calibri`, `Verdana`, `Tahoma`, `Microsoft YaHei`, `微软雅黑`, `sans-serif`, `Noto Sans CJK SC`, `Noto Sans`, and any default theme font unless the school template explicitly requires it.
- **Visible font color MUST be either `#000000` or `#707070`.** Use black for core module text and gray for arrow labels, anchors, and annotations.
- **Do not use synthetic bold.** `fontStyle=1` must not appear on any cell. SimSun / Source Han Serif SC faux-bold renders muddy at `-s 3`; use size, position, stroke weight, or fill color for emphasis.
- **In-figure titles are optional.** If a composite figure needs an in-figure title, use `fontFamily=SimHei` and still do not set `fontStyle=1`.
- Core modules have no fixed language-order requirement. Choose Chinese, English, or bilingual labels according to the thesis prose, source/reference material, official terminology, and target audience. Keep language use consistent within a figure unless a cited/source label or official name requires a different language.
- Mixed Chinese-English module labels MAY stay in one cell with a CJK `fontFamily` (`SimSun` / `Source Han Serif SC` / `SimHei`), **but Latin words inside that cell MUST be wrapped in an inline Latin face** — `&lt;font face=&quot;Times New Roman&quot;&gt;…&lt;/font&gt;` (or split into a separate Times New Roman cell). A CJK font's embedded Latin glyphs are NOT Times New Roman: leaving a Latin word in a SimSun/SimHei cell renders it in the wrong narrow CJK-serif face. Inline `<font>` tags render correctly under the headless `drawio -x` export and are stripped by the lint's text-count, but they can slightly change text metrics, so recheck box width after wrapping. **This is a hard error for Latin words** — the lint flags any Latin word (≥ 2 ASCII letters) sitting in a CJK-font cell outside a Latin-face `<font>` span. Digits, single-letter variables, and compact math symbols should use Times New Roman when they are prominent or pure-Latin/math labels, but they are not a hard error inside otherwise-CJK labels.
- Pure-Latin / digit / math-symbol labels SHOULD use `fontFamily=Times New Roman`; the lint reports a warning if pure-Latin content uses a CJK font.
- **Subscripts / superscripts use HTML `<sub>` / `<sup>`, NOT LaTeX.** draw.io renders a label as HTML (every cell already sets `html=1`); it does NOT typeset LaTeX unless `mxGraphModel` has `math="1"`. Write `T<sub>total</sub>`, `α<sub>c,τ</sub>`, `x<sup>2</sup>` — escaped in the XML as `&lt;sub&gt;…&lt;/sub&gt;`. Use Unicode directly for whole glyphs and operators (`α β Σ √ ≈ ≤ → ₁ ₂ ³`). A single math variable may be italicised with `<i>G</i>`.
- **Never use LaTeX delimiters (`$…$`, `\(…\)`) or set `math="1"` for thesis/proposal figures.** Even with `math="1"`, the mandated headless `drawio -x` export bakes the raw `$\alpha$` source into the PNG — MathJax does not run during CLI export, so the formula only renders inside the interactive app while the embedded image stays broken. The lint treats `math="1"`, `_{…}`, `^{…}`, `$…$`, `\(`, `\[`, and `\command` as hard errors.
- Long formulas go in a white-backed, borderless callout — not inside a colored module (still authored with `<sub>` / `<sup>` + Unicode, never LaTeX).

### 5.2 Final polish font rules

Run final typography cleanup only after the draft structure is accepted:

- Resolve all missing, banned, or unlisted `fontFamily` hard errors.
- Resolve or explicitly accept lint warnings about CJK content in Latin-only fonts and pure-Latin content in CJK fonts.
- Split an English subtitle into a separate Times New Roman text cell only for high-polish final figures or figures where the subtitle is visually prominent. Both cells still count toward density.
- Use `fontFamily=CMU Serif` only for dedicated formula callouts. This is a font choice, not LaTeX rendering.
- Confirm the actual export machine has the requested fonts installed at least once per environment:
  ```bash
  fc-match SimSun
  fc-match "Source Han Serif SC"
  fc-match SimHei
  fc-match "Times New Roman"
  fc-match "CMU Serif"
  ```

Quick check:

```bash
# Cells that have a non-empty value but no fontFamily (hard errors)
python -c "import re,sys; xml=open(sys.argv[1]).read(); print('\n'.join(m.group(0)[:120] for m in re.finditer(r'<mxCell[^>]*value=\"[^\"]+\"[^>]*>', xml) if 'fontFamily=' not in m.group(0)))" file.drawio

# Any banned font present?
grep -oE 'fontFamily=[^;"]+' file.drawio | sort -u
```

---

## 6. Icons & logos

Hard rules:

- System modules, schedulers, and decision blocks use NO decorative icons — prefer rounded rectangle + text.
- The physical resource layer uses abstract geometry with text labels (`Device 0`, `Node 1`) — no real device photos. Physical-device / accelerator boxes use palette role 9 (`#DDE3EA` / `#566D80`), keeping hardware visually distinct from the logical software modules.
- Icons MUST be linear and single-color — no 3D, skeuomorphic, gradient, or color-stereoscopic icons.
- Avoid emoji.
- Third-party logos appear ONLY in the infrastructure layer; max 2–3 per figure.

---

## 7. Geometry & routing

Geometry layout is a hard-error class — NOT an "aesthetic suggestion". Correct colors and font sizes don't matter if edges cut through boxes, arrows stack, or text overflows.

Edge & routing hard rules:

- Every edge MUST use the square-corner orthogonal-routing base style: `edgeStyle=orthogonalEdgeStyle;rounded=0;orthogonalLoop=1;jettySize=auto`.
- Edge styles MUST NOT include `rounded=1` or `curved=1`. `rounded=1` turns right-angle bends into visibly curved arcs in exported draw.io images; `curved=1` creates true curved connectors. Both are hard errors.
- This edge rule does NOT ban rounded rectangles for vertices. Module boxes may use `rounded=1`; connector edges must use `rounded=0`.
- Every edge MUST have an expanded-form `<mxGeometry relative="1" as="geometry">` child element — no self-closing edge cells.
- Explicit connection points are mandatory only for routing-risk endpoints: any endpoint with degree ≥ 4, or any endpoint with ≥ 2 connections inferred on the same side. Simple pass-through nodes with exactly two opposite-side connections do not require manual pins.
- When pins are mandatory for either endpoint of an edge, that edge MUST set explicit `exitX/exitY/entryX/entryY` with `exitDx=0;exitDy=0;entryDx=0;entryDy=0`.
- N connections on the same side distribute connection points evenly. E.g., 3 edges on the bottom: `exitX=0.25, 0.5, 0.75; exitY=1`.
- **Prefer a straight segment; align the pin instead of jogging.** An orthogonal edge renders as a single straight line only when its exit and entry land on the same coordinate of the travel axis (same x for a vertical edge, same y for a horizontal one). When an exit faces a target that is collinear with it, pin it to the matching fraction so the segment is straight, and offset only the *other* same-side edges. Pinning a straight-reachable connector to a mismatched fraction makes a needless dogleg — **the lint warns** when a both-pinned, waypoint-free connector whose boxes overlap on an axis is bent rather than straight (fix: align the two pins to a shared coordinate, or drop the pins if the endpoint is not routing-risk and let auto-routing straighten it).
- When an edge path crosses an unrelated shape, either move the node or add `<Array as="points">` waypoints to route around it. **The lint enforces this:** an authored route (pinned anchors + waypoints) whose straight segment passes through a non-endpoint filled box is a **hard error**; an unpinned edge whose centre-line crosses a box is a **warning** (draw.io may auto-route around it). Transparent group frames (`fillColor=none`), text labels, and line samples are not obstacles. Never satisfy the "pins must exist" rule with values that aim an exit *into* an adjacent box — choose the exit side that faces the target and route waypoints around any blocker (e.g., a child that sits behind another node must leave from a different side than the child directly in line).
- The final straight segment into the target box MUST be ≥ 20 px — prevents the arrowhead from sticking to a bend.
- Row / column routing corridors: ≥ 60 px hard floor, 80 px recommended. Don't place shapes in gaps that edges need to traverse.
- Hub nodes — vertices with **degree ≥ 4** (counting both `source=` and `target=` edges) — go in the center of their row / column so edges radiate outward. Never force edges from a hub to cross the whole figure.
- Long edges spanning multiple rows / columns route along the outer corridor, never through the middle.

Text-box hard rules:

- Box width MUST cover label width + padding. Estimate CJK chars at `1.0 × fontSize`, English / digit / symbol at `0.6 × fontSize`. Combined horizontal padding ≥ 16 px.
- Box height MUST satisfy `height ≥ lines × fontSize × 1.35 + 12 px`.
- When labels overflow: widen the box, shorten the label, or split the figure. NEVER lower font size to bypass the §2 floor.
- Fixed-form module arrays MUST share uniform width / height so identical nodes don't jitter due to label length.
