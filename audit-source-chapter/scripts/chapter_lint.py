#!/usr/bin/env python3
"""Lint a Markdown source-grounded textbook chapter (Python 3.8+, stdlib only).

This checks structural conventions only. It cannot establish whether prose or
citations are semantically correct.
"""

from __future__ import annotations

import argparse
import json
import re
import sys
from dataclasses import asdict, dataclass
from pathlib import Path


@dataclass(frozen=True)
class Finding:
    severity: str
    code: str
    line: int | None
    message: str


HEADING_RE = re.compile(r"^\s{0,3}#{1,6}\s+(.+?)\s*#*\s*$")
QUESTION_RE = re.compile(r"^(?P<indent>\s*)(?P<number>\d+)[.、]\s+\S")
ANSWER_RE = re.compile(r"^\s*(?:[-*+]\s*)?(?:\*\*)?解(?:答)?\s*[：:](?:\*\*)?\s*(?P<tail>.*)$")
IMAGE_RE = re.compile(r"!\[[^]]*\](?:\([^)]+\)|\[[^]]*\])|<img\b", re.IGNORECASE)
FENCE_RE = re.compile(r"^\s{0,3}(?P<fence>`{3,}|~{3,})(?P<info>.*)$")
MARKER_RE = re.compile(
    r"^\s*(?:[-*+]\s*)?(?:\*\*)?(?P<name>图片解读|来源|解读)\s*[：:](?:\*\*)?\s*(?P<tail>.*)$"
)
INLINE_CODE_RE = re.compile(r"`[^`\r\n]*`")
DIAGRAM_LANGUAGE_RE = re.compile(r"(?:^|[\s.{])(?:mermaid|plantuml|puml|dot|graphviz|d2)(?:[\s}]|$)", re.I)
CAPTION_RE = re.compile(r"^\s*(?:[*_]\s*)?(?:图\s*\S+|figure\b)|^\s*<figcaption\b", re.I)


def _heading_line(lines: list[str], phrase: str) -> int | None:
    for number, line in enumerate(lines, 1):
        match = HEADING_RE.match(line)
        if match and phrase in match.group(1):
            return number
    return None


def _has_marker(lines: list[str], marker: str) -> bool:
    return any((match := MARKER_RE.match(line)) and match.group("name") == marker for line in lines)


def _mask_fenced_code(lines: list[str]) -> list[str]:
    """Blank fenced blocks while preserving line numbers."""
    masked = list(lines)
    fence_char: str | None = None
    fence_width = 0
    for index, line in enumerate(lines):
        if fence_char is None:
            match = FENCE_RE.match(line)
            if not match:
                continue
            fence = match.group("fence")
            fence_char = fence[0]
            fence_width = len(fence)
            masked[index] = ""
            continue

        masked[index] = ""
        close_re = rf"^\s{{0,3}}{re.escape(fence_char)}{{{fence_width},}}\s*$"
        if re.match(close_re, line):
            fence_char = None
            fence_width = 0
    return masked


def _unclosed_fence_line(lines: list[str]) -> int | None:
    opened_at: int | None = None
    fence_char: str | None = None
    fence_width = 0
    for index, line in enumerate(lines, 1):
        if fence_char is None:
            match = FENCE_RE.match(line)
            if match:
                fence = match.group("fence")
                fence_char = fence[0]
                fence_width = len(fence)
                opened_at = index
            continue
        close_re = rf"^\s{{0,3}}{re.escape(fence_char)}{{{fence_width},}}\s*$"
        if re.match(close_re, line):
            opened_at = None
            fence_char = None
            fence_width = 0
    return opened_at


def _diagram_ends(lines: list[str]) -> list[int]:
    ends: list[int] = []
    fence_char: str | None = None
    fence_width = 0
    in_diagram = False
    for index, line in enumerate(lines):
        if fence_char is None:
            match = FENCE_RE.match(line)
            if match:
                fence = match.group("fence")
                fence_char = fence[0]
                fence_width = len(fence)
                in_diagram = bool(DIAGRAM_LANGUAGE_RE.search(match.group("info")))
                continue
            if IMAGE_RE.search(INLINE_CODE_RE.sub("", line)):
                ends.append(index)
            continue

        close_re = rf"^\s{{0,3}}{re.escape(fence_char)}{{{fence_width},}}\s*$"
        if re.match(close_re, line):
            if in_diagram:
                ends.append(index)
            fence_char = None
            fence_width = 0
            in_diagram = False
    return ends


def _has_following_interpretation(lines: list[str], end_index: int, visual_ends: set[int]) -> bool:
    caption_seen = False
    for index, line in enumerate(lines[end_index + 1 :], end_index + 1):
        if index in visual_ends:
            return False
        if not line.strip():
            continue
        match = MARKER_RE.match(line)
        if match:
            return match.group("name") == "图片解读"
        if not caption_seen and CAPTION_RE.match(line):
            caption_seen = True
            continue
        return False
    return False


def _marker_has_content(lines: list[str], index: int, match: re.Match[str]) -> bool:
    if match.group("tail").strip():
        return True
    for line in lines[index + 1 :]:
        if HEADING_RE.match(line) or MARKER_RE.match(line):
            return False
        if line.strip():
            return True
    return False


def lint(text: str, document_kind: str = "chapter", contract: str = "textbook", exercise_mode: str = "answered") -> list[Finding]:
    if text.startswith("\ufeff"):
        text = text[1:]
    lines = text.splitlines()
    visible_lines = _mask_fenced_code(lines)
    findings: list[Finding] = []

    unclosed_fence = _unclosed_fence_line(lines)
    if unclosed_fence is not None:
        findings.append(Finding("error", "UNCLOSED_FENCE", unclosed_fence, "Fenced code or diagram block is not closed."))

    headings: list[tuple[int, int, str]] = []
    for number, line in enumerate(visible_lines, 1):
        match = HEADING_RE.match(line)
        if match:
            level = len(line.lstrip()) - len(line.lstrip().lstrip("#"))
            headings.append((number, level, re.sub(r"\s+", " ", match.group(1).strip())))

    if not headings:
        findings.append(Finding("error", "NO_HEADINGS", None, "No Markdown chapter heading found."))
    elif contract == "textbook" and document_kind == "chapter" and not any(re.search(r"第\s*\S+\s*章|chapter\b", title, re.I) for _, _, title in headings):
        findings.append(Finding("warning", "NO_CHAPTER_TITLE", headings[0][0], "No heading looks like a chapter title."))

    if contract == "textbook":
        required_headings = [("相关源文件", "MISSING_RELEVANT_FILES", "Missing 相关源文件 heading.")]
        if document_kind == "chapter":
            required_headings.extend(
                (
                    ("内容提要", "MISSING_OVERVIEW", "Missing 内容提要 heading."),
                    ("本章小结", "MISSING_SUMMARY", "Missing 本章小结 heading."),
                    ("思考题", "MISSING_QUESTIONS", "Missing 思考题 heading."),
                )
            )
        for phrase, code, message in required_headings:
            if _heading_line(visible_lines, phrase) is None:
                findings.append(Finding("error", code, None, message))

        for marker, code in (("来源", "MISSING_SOURCE_MARKER"), ("解读", "MISSING_INTERPRETATION")):
            if not _has_marker(visible_lines, marker):
                findings.append(Finding("error", code, None, f"Missing {marker}： marker."))

    seen: dict[tuple[int | None, int, str], int] = {}
    parents: list[tuple[int, int]] = []
    for number, level, title in headings:
        while parents and parents[-1][0] >= level:
            parents.pop()
        parent_line = parents[-1][1] if parents else None
        key = (parent_line, level, title.casefold())
        if key in seen:
            findings.append(Finding("warning", "DUPLICATE_HEADING", number, f"Heading duplicates line {seen[key]}: {title}"))
        else:
            seen[key] = number
        parents.append((level, number))

    for position, (number, level, title) in enumerate(headings):
        next_heading = headings[position + 1] if position + 1 < len(headings) else None
        if next_heading and next_heading[1] > level:
            continue
        end_index = (next_heading[0] - 1) if next_heading else len(visible_lines)
        if not any(line.strip() for line in visible_lines[number:end_index]):
            findings.append(Finding("warning", "EMPTY_SECTION", number, f"Heading has no substantive content: {title}"))

    for index, line in enumerate(visible_lines):
        match = MARKER_RE.match(line)
        if match and not _marker_has_content(visible_lines, index, match):
            code = {
                "来源": "EMPTY_SOURCE_MARKER",
                "解读": "EMPTY_INTERPRETATION_MARKER",
                "图片解读": "EMPTY_IMAGE_INTERPRETATION_MARKER",
            }[match.group("name")]
            findings.append(Finding("error", code, index + 1, f"{match.group('name')}： marker has no content."))

    if contract == "textbook":
        visual_ends = set(_diagram_ends(lines))
        for end_index in sorted(visual_ends):
            if not _has_following_interpretation(visible_lines, end_index, visual_ends):
                findings.append(Finding("error", "MISSING_IMAGE_INTERPRETATION", end_index + 1, "Diagram or image is not followed by 图片解读： before the next heading or visual."))

    question_heading = _heading_line(visible_lines, "思考题") if contract == "textbook" else None
    if question_heading is not None:
        question_level = next(level for number, level, _ in headings if number == question_heading)
        question_end = next((number - 1 for number, level, _ in headings if number > question_heading and level <= question_level), len(visible_lines))
        question_lines = visible_lines[question_heading:question_end]
        candidates = [(index, match) for index, line in enumerate(question_lines) if (match := QUESTION_RE.match(line))]
        minimum_indent = min((len(match.group("indent").expandtabs(4)) for _, match in candidates), default=0)
        starts = [index for index, match in candidates if len(match.group("indent").expandtabs(4)) == minimum_indent]
        if not starts:
            findings.append(Finding("error", "NO_NUMBERED_QUESTIONS", question_heading, "思考题 has no numbered questions."))
        else:
            if exercise_mode == "answered":
                for position, start in enumerate(starts):
                    stop = starts[position + 1] if position + 1 < len(starts) else len(question_lines)
                    answer = next(((offset, ANSWER_RE.match(line)) for offset, line in enumerate(question_lines[start + 1 : stop], start + 1) if ANSWER_RE.match(line)), None)
                    if answer is None:
                        findings.append(Finding("error", "QUESTION_WITHOUT_ANSWER", question_heading + start + 1, "Numbered thought question has no 解： answer."))
                        continue
                    answer_offset, answer_match = answer
                    assert answer_match is not None
                    if not answer_match.group("tail").strip() and not any(line.strip() for line in question_lines[answer_offset + 1 : stop]):
                        findings.append(Finding("error", "EMPTY_ANSWER", question_heading + answer_offset + 1, "Thought-question answer has no substantive content."))
            if len(starts) < 3:
                findings.append(Finding("warning", "FEW_QUESTIONS", question_heading, f"Only {len(starts)} thought question(s); approximately five are normally expected."))

    return findings


def _parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="Lint the mechanical Markdown contract of a source-grounded technical chapter.",
        epilog="Exit codes: 0 = pass, 1 = findings at the selected threshold, 2 = usage or input error.",
    )
    parser.add_argument("chapter", type=Path, help="Markdown chapter or focused section to inspect")
    parser.add_argument("--document-kind", choices=("chapter", "section"), default="chapter", help="Validate a complete chapter or a focused section (default: chapter)")
    parser.add_argument("--contract", choices=("textbook", "custom"), default="textbook", help="Enforce the default Chinese textbook shell or only universal structure checks (default: textbook)")
    parser.add_argument("--exercise-mode", choices=("answered", "questions-only"), default="answered", help="Require reasoned answers or allow an exercise-only edition (default: answered)")
    parser.add_argument("--json", action="store_true", help="Emit a JSON result instead of text")
    parser.add_argument("--fail-on", choices=("error", "warning", "never"), default="error", help="Exit nonzero for this severity or higher (default: error)")
    return parser


def _display_path(path: Path) -> str:
    if path.is_absolute() or ".." in path.parts:
        return path.name or "<draft>"
    return path.as_posix() or "<draft>"


def _safe_error_detail(exc: OSError | UnicodeError) -> str:
    return getattr(exc, "strerror", None) or type(exc).__name__


def main(argv: list[str] | None = None) -> int:
    args = _parser().parse_args(argv)
    display_chapter = _display_path(args.chapter)
    try:
        text = args.chapter.read_text(encoding="utf-8-sig")
    except (OSError, UnicodeError) as exc:
        print(f"chapter_lint: cannot read {display_chapter}: {_safe_error_detail(exc)}", file=sys.stderr)
        return 2

    findings = lint(text, args.document_kind, args.contract, args.exercise_mode)
    if args.json:
        print(json.dumps({"chapter": display_chapter, "document_kind": args.document_kind, "contract": args.contract, "exercise_mode": args.exercise_mode, "findings": [asdict(item) for item in findings]}, ensure_ascii=False, indent=2))
    elif findings:
        for item in findings:
            location = f"{display_chapter}:{item.line}" if item.line else display_chapter
            print(f"{location}: {item.severity}: {item.code}: {item.message}")
    else:
        print(f"{display_chapter}: OK (mechanical {args.contract} {args.document_kind} contract)")

    if args.fail_on == "never":
        return 0
    levels = {"warning": 1, "error": 2}
    threshold = levels[args.fail_on]
    return 1 if any(levels[item.severity] >= threshold for item in findings) else 0


if __name__ == "__main__":
    raise SystemExit(main())
