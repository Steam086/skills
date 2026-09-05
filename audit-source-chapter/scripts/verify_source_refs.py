#!/usr/bin/env python3
"""Verify path:line[-line] citations in a Markdown chapter (Python 3.8+, stdlib only)."""

from __future__ import annotations

import argparse
import json
import re
import sys
from dataclasses import asdict, dataclass
from pathlib import Path, PurePosixPath


SOURCE_MARKER_RE = re.compile(r"^\s*(?:[-*+]\s*)?(?:\*\*)?(?:来源|source|evidence)(?:\*\*)?\s*[：:]", re.I)
OTHER_MARKER_RE = re.compile(r"^\s*(?:[-*+]\s*)?(?:\*\*)?(?:图片解读|解读|推断|interpretation|inference|analysis)(?:\*\*)?\s*[：:]", re.I)
HEADING_RE = re.compile(r"^\s{0,3}#{1,6}\s+")
FENCE_RE = re.compile(r"^\s{0,3}(?P<fence>`{3,}|~{3,})(?P<info>.*)$")
CODE_SPAN_RE = re.compile(r"`(?P<body>[^`\r\n]+)`")
REF_BODY_RE = re.compile(r"^(?P<path>.+):(?P<start>\d+)(?:-(?P<end>\d+))?$")
URI_RE = re.compile(r"^[A-Za-z][A-Za-z0-9+.-]*://")
PDF_REF_RE = re.compile(r"^.+[：:]\s*\$?\d+\s*\^\s*\d+\$?$")
SPACED_REF_RE = re.compile(r"^.+\s+[：:]\s*\d|^.+[：:]\s+\d|^.+[：:]\s*\d+\s+[-–—]\s*\d+\s*$")
NUMBER_ONLY_RE = re.compile(r"^\s*`?\$?\d+(?:\s*[-–—]\s*\d+)?\$?`?\s*$")


@dataclass(frozen=True)
class Finding:
    severity: str
    code: str
    line: int | None
    message: str


@dataclass(frozen=True)
class Citation:
    markdown_line: int
    path: str
    start: int
    end: int


def _safe_error_detail(exc: OSError | UnicodeError) -> str:
    return getattr(exc, "strerror", None) or type(exc).__name__


def _source_context(lines: list[str], index: int) -> bool:
    current = lines[index]
    if HEADING_RE.match(current) or OTHER_MARKER_RE.search(current):
        return False
    if SOURCE_MARKER_RE.search(current):
        return True
    for prior in range(index - 1, -1, -1):
        if HEADING_RE.match(lines[prior]) or OTHER_MARKER_RE.search(lines[prior]):
            return False
        if SOURCE_MARKER_RE.search(lines[prior]):
            return True
    return False


def _mask_fenced_code(lines: list[str]) -> list[str]:
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


def _strip_source_list_prefix(line: str) -> str:
    value = re.sub(r"^\s*[-*+]\s+", "", line).strip()
    return value


def _looks_like_path(path: str, source_context: bool) -> bool:
    if URI_RE.match(path):
        return source_context
    if source_context:
        return bool(path.strip())
    return "/" in path or "\\" in path or path.startswith(".")


def _malformed_reference(body: str, line: int) -> Finding | None:
    if not re.search(r"[：:].*\d", body):
        return None
    if PDF_REF_RE.match(body):
        return Finding("error", "PDF_LINE_NUMBER_ARTIFACT", line, "Citation contains an exponent-style PDF/OCR line-number artifact; the intended range is ambiguous.")
    if "：" in body:
        return Finding("error", "NON_ASCII_SEPARATOR", line, "Citation must use an ASCII colon in path:line[-line].")
    if SPACED_REF_RE.match(body):
        return Finding("error", "SPACED_REFERENCE", line, "Citation contains whitespace around the path/line separator or range.")
    if re.match(r"^.+:\d+(?:-|[^\d-].*)$", body) or re.match(r"^.+:\d+-\d+\S+$", body):
        return Finding("error", "MALFORMED_REFERENCE", line, "Citation has trailing or incomplete characters after its line range.")
    return Finding("error", "UNPARSEABLE_REFERENCE", line, "Source reference is not an exact path:line[-line] token.")


def extract(lines: list[str]) -> tuple[list[Citation], list[Finding]]:
    citations: list[Citation] = []
    findings: list[Finding] = []
    visible_lines = _mask_fenced_code(lines)

    for index, line in enumerate(visible_lines):
        context = _source_context(visible_lines, index)
        occupied: list[tuple[int, int]] = []
        for code_match in CODE_SPAN_RE.finditer(line):
            body = code_match.group("body").strip()
            match = REF_BODY_RE.match(body)
            if match and _looks_like_path(match.group("path"), context):
                if URI_RE.match(match.group("path")) and not context:
                    continue
                citations.append(Citation(index + 1, match.group("path"), int(match.group("start")), int(match.group("end") or match.group("start"))))
                occupied.append(code_match.span())
                continue
            if context:
                malformed = _malformed_reference(body, index + 1)
                if malformed:
                    findings.append(malformed)
                    occupied.append(code_match.span())

        if not context:
            continue

        residual = line
        for start, end in sorted(occupied, reverse=True):
            residual = residual[:start] + residual[end:]
        candidate = _strip_source_list_prefix(residual)
        if not candidate or SOURCE_MARKER_RE.search(candidate):
            continue
        if occupied and not re.search(r"[：:].*\d", candidate):
            continue
        if NUMBER_ONLY_RE.match(candidate):
            continue
        match = REF_BODY_RE.match(candidate)
        if match:
            citations.append(Citation(index + 1, match.group("path"), int(match.group("start")), int(match.group("end") or match.group("start"))))
            continue
        malformed = _malformed_reference(candidate, index + 1)
        if malformed:
            findings.append(malformed)
            continue
        if index + 1 < len(visible_lines) and NUMBER_ONLY_RE.match(visible_lines[index + 1]):
            findings.append(Finding("error", "SPLIT_REFERENCE", index + 1, "Citation path and line range are split across lines; restore one path:line[-line] token."))
        elif re.search(r"[/\\.]", candidate) or re.fullmatch(r"[\w@+-]+", candidate):
            findings.append(Finding("error", "UNPARSEABLE_REFERENCE", index + 1, "Source block contains a path without a parseable path:line[-line] range."))

    return citations, findings


def verify(chapter: Path, root: Path) -> tuple[list[Citation], list[Finding]]:
    try:
        lines = chapter.read_text(encoding="utf-8-sig").splitlines()
    except (OSError, UnicodeError) as exc:
        return [], [Finding("fatal", "CHAPTER_UNREADABLE", None, f"Cannot read chapter: {_safe_error_detail(exc)}")]

    citations, findings = extract(lines)
    if not citations and not findings:
        findings.append(Finding("error", "NO_REFERENCES", None, "No parseable path:line[-line] citations found."))

    resolved_root = root.resolve()
    line_counts: dict[Path, int] = {}
    for citation in citations:
        raw = citation.path
        if URI_RE.match(raw):
            findings.append(Finding("error", "NON_REPOSITORY_REFERENCE", citation.markdown_line, f"Citation is a URL, not a repository-relative path: {raw}"))
            continue
        if raw.startswith("/") or re.match(r"^[A-Za-z]:[\\/]", raw) or raw.startswith("\\\\"):
            findings.append(Finding("error", "ABSOLUTE_REFERENCE", citation.markdown_line, "Citation uses an absolute host path; replace it with a repository-relative path."))
            continue
        if "\\" in raw:
            findings.append(Finding("error", "NON_PORTABLE_SEPARATOR", citation.markdown_line, f"Citation must use '/' as its repository-relative separator: {raw}"))
            continue
        portable_path = PurePosixPath(raw)
        if ".." in portable_path.parts:
            findings.append(Finding("error", "PARENT_REFERENCE", citation.markdown_line, f"Citation must be relative to the repository root without '..': {raw}"))
            continue
        if not raw or ":" in raw or raw.startswith("./") or str(portable_path) != raw:
            findings.append(Finding("error", "NON_NORMALIZED_REFERENCE", citation.markdown_line, f"Citation path is not normalized relative to the repository root: {raw}"))
            continue
        target = resolved_root.joinpath(*portable_path.parts).resolve()
        try:
            target.relative_to(resolved_root)
        except ValueError:
            findings.append(Finding("error", "OUTSIDE_ROOT", citation.markdown_line, f"Citation escapes repository root: {citation.path}"))
            continue
        if not target.exists():
            findings.append(Finding("error", "FILE_NOT_FOUND", citation.markdown_line, f"Cited file does not exist: {citation.path}"))
            continue
        if not target.is_file():
            findings.append(Finding("error", "NOT_A_FILE", citation.markdown_line, f"Citation target is not a regular file: {citation.path}"))
            continue
        if citation.start < 1 or citation.end < citation.start:
            findings.append(Finding("error", "INVALID_RANGE", citation.markdown_line, f"Invalid line range {citation.start}-{citation.end} for {citation.path}"))
            continue
        if target not in line_counts:
            try:
                with target.open("r", encoding="utf-8", errors="replace") as handle:
                    line_counts[target] = sum(1 for _ in handle)
            except OSError as exc:
                findings.append(Finding("error", "SOURCE_UNREADABLE", citation.markdown_line, f"Cannot read {citation.path}: {_safe_error_detail(exc)}"))
                continue
        maximum = line_counts[target]
        if citation.end > maximum:
            findings.append(Finding("error", "RANGE_OUT_OF_BOUNDS", citation.markdown_line, f"Range {citation.start}-{citation.end} exceeds {citation.path} ({maximum} lines)."))

    return citations, findings


def _parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="Check syntax, existence, and line bounds of path:line[-line] citations in Markdown.",
        epilog="Exit codes: 0 = pass, 1 = findings at the selected threshold, 2 = usage or input error.",
    )
    parser.add_argument("chapter", type=Path, help="Markdown chapter containing source citations")
    parser.add_argument("--root", type=Path, required=True, help="Repository root used to resolve relative citation paths (required; never inferred from the current directory)")
    parser.add_argument("--json", action="store_true", help="Emit a JSON result instead of text")
    parser.add_argument("--fail-on", choices=("error", "warning", "never"), default="error", help="Exit nonzero for this severity or higher (default: error)")
    return parser


def _display_chapter(chapter: Path, root: Path) -> str:
    try:
        return chapter.resolve().relative_to(root.resolve()).as_posix()
    except (OSError, ValueError):
        return chapter.name or "<draft>"


def _citation_for_output(citation: Citation) -> dict[str, object]:
    value = asdict(citation)
    raw = citation.path
    if raw.startswith("/") or re.match(r"^[A-Za-z]:[\\/]", raw) or raw.startswith("\\\\"):
        value["path"] = "<absolute-path-redacted>"
    return value


def main(argv: list[str] | None = None) -> int:
    args = _parser().parse_args(argv)
    if not args.root.is_dir():
        if args.json:
            print(json.dumps({"chapter": _display_chapter(args.chapter, args.root), "root": ".", "citations": [], "findings": [{"severity": "fatal", "code": "ROOT_INVALID", "line": None, "message": "Repository root is not a directory."}]}, ensure_ascii=False, indent=2))
        else:
            print("verify_source_refs: repository root is not a directory", file=sys.stderr)
        return 2

    citations, findings = verify(args.chapter, args.root)
    display_chapter = _display_chapter(args.chapter, args.root)
    if args.json:
        print(json.dumps({"chapter": display_chapter, "root": ".", "citations": [_citation_for_output(item) for item in citations], "findings": [asdict(item) for item in findings]}, ensure_ascii=False, indent=2))
    else:
        for item in findings:
            location = f"{display_chapter}:{item.line}" if item.line else display_chapter
            print(f"{location}: {item.severity}: {item.code}: {item.message}")
        if not findings:
            print(f"{display_chapter}: OK ({len(citations)} source citation(s) verified under repository root .)")

    if any(item.severity == "fatal" for item in findings):
        return 2
    if args.fail_on == "never":
        return 0
    levels = {"warning": 1, "error": 2, "fatal": 3}
    threshold = levels[args.fail_on]
    return 1 if any(levels[item.severity] >= threshold for item in findings) else 0


if __name__ == "__main__":
    raise SystemExit(main())
