"""Validate the semantic plan and enforce file capture policy and budgets."""

from dataclasses import dataclass
from pathlib import Path, PurePosixPath

from common import LABEL, MAX_UNCOMPRESSED_BYTES, HandoffError, fields, require_text, safe_path, text_list
from scanner import policy, read_bytes, safe_content, unavailable
from snapshot import path_key

SECTIONS = ("modules", "dependencies", "history", "progress", "validation",
            "questions", "deliverables", "unknowns", "next_actions")
REQUIRED = ("goal", "overview", "files", "required_context", "prompt", *SECTIONS)
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
    fields(plan, REQUIRED, ("scope", "skills", "state_review"), name="Handoff Plan")
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
    validate_required_context(plan["required_context"])
    validate_skill_plan(plan.get("skills", []))
    return plan


def validate_required_context(entries):
    if not isinstance(entries, list) or len(entries) > 100:
        raise HandoffError("required_context must be an array of up to 100 requirements")
    for entry in entries:
        fields(entry, ("question", "required_files", "reason"), name="required context")
        for key in ("question", "reason"):
            safe_text(require_text(entry[key], f"required context {key}"), key)
        paths = text_list(entry["required_files"], "required context files")
        if not paths or len(paths) != len(set(paths)):
            raise HandoffError("Each required context entry needs nonempty, unique required_files")
        for path in paths:
            safe_path(path)


def required_plan_files(plan):
    """Independent requirements cannot be bypassed by lowering a file's priority."""
    paths = {row["path"] for row in plan["files"] if row["priority"] == "critical"}
    for entry in plan["required_context"]:
        paths.update(entry["required_files"])
    return paths


def validate_skill_plan(entries):
    if not isinstance(entries, list):
        raise HandoffError("skills must be an array")
    names = set()
    for entry in entries:
        fields(entry, ("name", "path", "reason"), ("references", "required", "required_references"),
               name="selected skill")
        if type(entry.get("required", False)) is not bool:
            raise HandoffError("Skill required flag must be a boolean")
        name = require_text(entry["name"], "skill name", 80)
        if not LABEL.fullmatch(name) or not display_path(name) or path_key(name) in names:
            raise HandoffError("Skill names must be unique and portable")
        names.add(path_key(name))
        location = Path(require_text(entry["path"], "local skill path", 4096))
        if not location.is_absolute() or location.name != "SKILL.md" or ".." in location.parts:
            raise HandoffError("Skill path must be an absolute path to SKILL.md")
        safe_text(require_text(entry["reason"], "skill selection reason", 2000), "skill selection reason")
        seen = {path_key("SKILL.md")}
        for key in ("required_references", "references"):
            for path in text_list(entry.get(key, []), key):
                safe_path(f"skills/{name}/{path}")
                if path_key(path) in seen:
                    raise HandoffError(f"Duplicate reference for skill {name}")
                seen.add(path_key(path))


class CaptureBudget:
    def __init__(self, limits):
        self.files = limits.max_files
        self.bytes = MAX_UNCOMPRESSED_BYTES
        self.per_file = min(limits.max_file_bytes, MAX_UNCOMPRESSED_BYTES)

    def accept(self, data):
        reason = safe_content(data)
        if reason:
            return reason
        if len(data) > self.bytes:
            return "uncompressed selection byte budget exceeded"
        self.bytes -= len(data)
        self.files -= 1
        return None


def select(root, scan, plan, limits, necessary):
    budget = CaptureBudget(limits)
    inventory = scan["files"]
    exclusions = scan["exclusions"].copy()
    content, gaps, selected_keys = {}, [], set()
    for path in inventory:
        exclusions[path] = "outside semantic selection"

    def capture_source(entry):
        path, priority = entry["path"], entry["priority"]
        reason = policy(path)
        if not reason and safe_content(path.encode()):
            reason = "sensitive path content"
        if not reason and path not in inventory:
            reason = exclusions.get(path) or "not in project inventory (missing or ignored)"
        if not reason and path_key(path) in selected_keys:
            reason = "case-folded or Unicode path collision"
        if not reason and not budget.files:
            reason = "file-count budget exceeded"
        if not reason:
            try:
                data = read_bytes(root, path, budget.per_file)
            except (OSError, HandoffError) as error:
                reason = unavailable(error)
                if reason != "single-file size budget exceeded":
                    raise HandoffError(f"Working tree changed or became unreadable at {path}; re-run discovery") from error
            else:
                reason = budget.accept(data)
        if reason:
            exclusions[path] = reason
            if priority != "optional":
                gaps.append({"path": path, "priority": priority, "reason": reason})
            return
        content[path] = data
        selected_keys.add(path_key(path))
        exclusions.pop(path, None)

    entries = sorted(plan["files"], key=lambda row: PRIORITY[row["priority"]])
    skills = SkillSelection(plan, budget)
    for required in (True, False):
        for entry in entries:
            if (entry["path"] in necessary) == required:
                capture_source(entry)
        skills.capture_phase(required)
    return content, exclusions, gaps, skills.content, skills.selected(), skills.exclusions


class SkillSelection:
    def __init__(self, plan, budget):
        self.content, self.exclusions, self.folders = {}, [], {}
        self.budget = budget
        self.entries = plan.get("skills", [])
        self.groups = {entry["name"]: [] for entry in self.entries}

    def capture(self, entry, path, required):
        name = entry["name"]
        relative = f"{name}/{path}"
        reason = policy(relative)
        if not reason and safe_content(relative.encode()):
            reason = "sensitive path content"
        if not reason and not self.budget.files:
            reason = "file-count budget exceeded"
        if not reason:
            try:
                if path == "SKILL.md":
                    # An installed skill may be a directory link; anchor reads in its resolved root.
                    self.folders[name] = Path(entry["path"]).parent.resolve(strict=True)
                data = read_bytes(self.folders[name], path, self.budget.per_file)
            except (OSError, HandoffError, RuntimeError) as error:
                reason = unavailable(error)
            else:
                reason = self.budget.accept(data)
        if reason:
            self.exclusions.append({"name": name, "path": f"skills/{relative}" if display_path(relative) else
                                    "[restricted path]", "reason": reason, "required": required})
            return False
        self.content[relative] = data
        self.groups[name].append(f"skills/{relative}")
        return True

    def capture_phase(self, required):
        for entry in self.entries:
            references = entry.get("required_references", [])
            required_entry = entry.get("required", False) or bool(references)
            name = entry["name"]
            if required == required_entry and not self.capture(entry, "SKILL.md", required):
                continue
            if not self.groups[name]:
                continue
            for path in references if required else entry.get("references", []):
                self.capture(entry, path, required)

    def selected(self):
        return [{"name": entry["name"], "reason": entry["reason"], "paths": self.groups[entry["name"]]}
                for entry in self.entries if self.groups[entry["name"]]]


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
