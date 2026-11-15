"""Validate Codex's semantic plan and enforce source capture policy and budgets."""

from dataclasses import dataclass
from pathlib import PurePosixPath

from common import HandoffError, fields, require_text, safe_path, text_list
from scanner import policy, read_bytes, safe_content, unavailable
from snapshot import path_key

SECTIONS = ("modules", "dependencies", "history", "progress", "validation",
            "questions", "deliverables", "unknowns", "next_actions")
REQUIRED = ("goal", "overview", "files", "prompt", *SECTIONS)
PRIORITY = {"critical": 0, "supporting": 1, "optional": 2}


@dataclass(frozen=True)
class Limits:
    max_zip_bytes: int = 8 * 1024 * 1024
    max_file_bytes: int = 384 * 1024
    max_files: int = 120


def safe_text(text, name):
    reason = safe_content(text.encode("utf-8"))
    if reason:
        raise HandoffError(f"{name} contains {reason}; revise it before export")


def validate_plan(plan):
    fields(plan, REQUIRED, ("scope", "state_review"), name="Handoff Plan")
    for key in ("goal", "overview", "prompt"):
        safe_text(require_text(plan[key], key), key)
    for key in SECTIONS:
        for item in text_list(plan[key], key):
            safe_text(item, key)
    scope = plan.get("scope", [])
    if not isinstance(scope, list) or len(scope) > 100:
        raise HandoffError("scope must be a list of up to 100 relative directories")
    for path in scope:
        safe_path(path)
        if policy(path):
            raise HandoffError(f"Unsafe scope: {path}")
        safe_text(path, "scope path")
    if not isinstance(plan["files"], list) or len(plan["files"]) > 5000:
        raise HandoffError("files must be an array of up to 5000 entries")
    seen = set()
    for entry in plan["files"]:
        fields(entry, ("path", "priority", "reason"), name="selected file")
        path = safe_path(entry["path"])
        if path in seen:
            raise HandoffError(f"Duplicate planned file: {path}")
        seen.add(path)
        if not isinstance(entry["priority"], str) or entry["priority"] not in PRIORITY:
            raise HandoffError(f"Invalid priority for {path}")
        safe_text(require_text(entry["reason"], "selection reason", 2000), "selection reason")
    return plan


def select(root, scan, plan, limits):
    inventory = scan["files"]
    exclusions = scan["exclusions"].copy()
    content, gaps, selected_keys = {}, [], set()
    for path in inventory:
        exclusions[path] = "outside semantic selection"
    remaining = limits.max_zip_bytes
    for entry in sorted(plan["files"], key=lambda row: PRIORITY[row["priority"]]):
        path, priority = entry["path"], entry["priority"]
        reason = policy(path)
        if not reason and safe_content(path.encode()):
            reason = "sensitive path content"
        if not reason and path not in inventory:
            reason = exclusions.get(path) or "not in project inventory (missing or ignored)"
        if not reason and path_key(path) in selected_keys:
            reason = "case-folded or Unicode path collision"
        if not reason and len(content) >= limits.max_files:
            reason = "file-count budget exceeded"
        if not reason:
            try:
                data = read_bytes(root, path, limits.max_file_bytes)
            except (OSError, HandoffError) as error:
                reason = unavailable(error)
                if reason != "single-file size budget exceeded":
                    raise HandoffError(f"Working tree changed or became unreadable at {path}; re-run discovery") from error
            else:
                reason = safe_content(data)
                if not reason and len(data) > remaining:
                    reason = "total source byte budget exceeded"
        if reason:
            exclusions[path] = reason
            if priority != "optional":
                gaps.append({"path": path, "priority": priority, "reason": reason})
            continue
        content[path] = data
        selected_keys.add(path_key(path))
        remaining -= len(data)
        exclusions.pop(path, None)
    return content, exclusions, gaps


def display_path(path):
    try:
        safe_path(path)
    except HandoffError:
        return None
    if policy(path) or safe_content(path.encode()):
        return None
    return path


def scope_label(path, scope):
    parts = PurePosixPath(path).parts
    if scope and not any(path == prefix or path.startswith(prefix + "/") for prefix in scope):
        return parts[0] if len(parts) > 1 else "(root)"
    if len(parts) >= 3 and parts[0] in ("packages", "apps", "services"):
        return "/".join(parts[:2])
    return parts[0] if len(parts) > 1 else "(root)"
