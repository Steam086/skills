# Human / LLM Review Checklist

> Entry point: [SKILL.md](../SKILL.md). Read this file at workflow step 4 (after SVG / PNG export).
> These checks can't be fully automated — they need human or LLM review before and after export.

---

## 1. Semantics & structure

- Containers express ONLY "who contains whom" — behavior is expressed by arrows.
- Architecture figures are not merely layered stacks; use arrows, grouping, and placement to show the relationships the reader needs.
- Module text contains only noun phrases, abbreviations, numbering, and necessary numerics — no explanatory sentences.
- A label containing verbs like "decides / executes / manages / when... / used for / via" should usually be shortened.
- Parameters, formulas, long interface names, and implementation details belong in prose or tables — not in the figure.

---

## 2. Readability & layout

- Semantics MUST stay distinguishable in grayscale / B&W rendering via line style, texture, and position — color cannot be the sole encoding.
- Font-family visual consistency: every label MUST render in an approved font family. The default body labels use serif families — `SimSun` / `Source Han Serif SC` for CJK or mixed CJK-English cells, `Times New Roman` for pure-Latin / digit / math labels, and `CMU Serif` for dedicated formula callouts. An optional in-figure title may use `SimHei` as the sole heading face. If any body label looks flat-ended (Helvetica / Arial / Noto Sans), the `fontFamily=` attribute is missing or not whitelisted by the active default or temporary spec — re-run the lint and fix before submission.
- Emphasize important modules via line weight, size, or position — avoid full-figure uniform grid.
- Multi-layer architecture figures use left-side layer labels; general system figures use a legend.
- Legend decodes only arrows, containers, or icons the reader needs to decode — do NOT repeat main labels.

---

## 3. Figure-decomposition priority

When a figure exceeds density limits, follow this order:

1. Overview keeps only main modules, main flow, and key feedback paths.
2. Secondary modules move into a local detail figure.
3. Parameters, formulas, long interface names, and implementation details move into prose or tables.
4. Repeated modules become an ellipsis array, aggregation marker, or color-card array.
