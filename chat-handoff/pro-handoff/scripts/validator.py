"""Verify the handoff archive and its snapshot, including delta replay."""

import stat
from zipfile import BadZipFile, ZipFile

from common import ID, LABEL, PROTOCOL, HandoffError, fields, digest, parse_json, safe_path
from importer import matches
from scanner import policy, safe_content
from snapshot import path_key, payload_paths, replay, snapshot_id, validate_manifest

ENTRIES = {
    "HANDOFF.json", "START_HERE.md", "PROMPT_FOR_PRO.md",
    "context/PROJECT_OVERVIEW.md", "context/PROJECT_TREE.md", "context/CURRENT_CONTEXT.md",
    "context/DECISIONS.md", "context/OPEN_QUESTIONS.md", "context/HANDOFF_PLAN.json",
    "metadata/MANIFEST.json", "metadata/GIT_STATUS.txt", "metadata/EXCLUSIONS.json",
    "protocol/PRO_RESPONSE_SPEC.md", "protocol/pro-response.schema.json", "protocol/handoff.schema.json",
}
RECOVERY_ENTRIES = {"context/STATE.md", "context/EVIDENCE_ARCHIVE.json"}


def verify(zip_path, *, base=None, base_export_id=None, max_bytes=128 * 1024 * 1024):
    try:
        with ZipFile(zip_path) as archive:
            entries = archive.infolist()
            names = set()
            total = 0
            for info in entries:
                name = safe_path(info.orig_filename)
                folded = path_key(name)
                if folded in names or stat.S_ISLNK(info.external_attr >> 16) or info.flag_bits & 1:
                    raise HandoffError(f"Unsafe, duplicate or encrypted ZIP entry: {name}")
                names.add(folded)
                total += info.file_size
                if total > max_bytes:
                    raise HandoffError("Uncompressed ZIP size exceeds validation budget")
            meta = parse_json(archive.read("HANDOFF.json"))
            fields(meta, ("protocol_version", "session_id", "session_name", "export_id",
                          "package_type", "base_export_id", "base_snapshot_id", "snapshot_id",
                          "state_revision", "exported_at", "scope", "files"), ("skills",), name="HANDOFF")
            if meta["protocol_version"] != PROTOCOL:
                raise HandoffError("Unsupported ZIP protocol")
            for key in ("session_id", "export_id"):
                matches(meta[key], ID, key)
            for key in ("session_name", "exported_at"):
                if not isinstance(meta[key], str) or not meta[key].strip():
                    raise HandoffError(f"Invalid {key}")
            if type(meta["state_revision"]) is not int or meta["state_revision"] < 1:
                raise HandoffError("Invalid state revision")
            if not isinstance(meta["scope"], list):
                raise HandoffError("Invalid scope")
            for prefix in meta["scope"]:
                safe_path(prefix)
            files = meta["files"]
            validate_manifest(files)
            if snapshot_id(files) != meta["snapshot_id"] or parse_json(archive.read("metadata/MANIFEST.json")) != files:
                raise HandoffError("Target manifest or snapshot ID mismatch")
            skills = meta.get("skills", {})
            validate_manifest(skills)
            for path in skills:
                name, slash, _ = path.partition("/")
                if not slash or not LABEL.fullmatch(name) or f"{name}/SKILL.md" not in skills:
                    raise HandoffError(f"Invalid skill attachment path: {path}")

            required = ENTRIES.copy()
            kind = meta["package_type"]
            if kind not in ("delta", "full", "recovery"):
                raise HandoffError("Invalid package type")
            if kind == "delta":
                required.add("metadata/OPERATIONS.json")
                matches(meta["base_export_id"], ID, "base export ID")
                if base is None or base_export_id != meta["base_export_id"]:
                    raise HandoffError(f"Supply confirmed base export {meta['base_export_id']} to verify this delta")
                validate_manifest(base)
                if snapshot_id(base) != meta["base_snapshot_id"]:
                    raise HandoffError("Base manifest does not match the delta")
                operations = parse_json(archive.read("metadata/OPERATIONS.json"))
                replay(base, files, operations)
                paths = payload_paths(operations)
            else:
                if meta["base_export_id"] is not None or meta["base_snapshot_id"] is not None:
                    raise HandoffError("A standalone export must have no base")
                if kind == "recovery":
                    required.update(RECOVERY_ENTRIES)
                paths = set(files)
            expected = required | {"source/" + path for path in paths} | {"skills/" + path for path in skills}
            if set(archive.namelist()) != expected:
                raise HandoffError("ZIP entries do not match the protocol and manifests")
            if archive.testzip() is not None:
                raise HandoffError("ZIP CRC check failed")
            for prefix, entry_manifest, payload in (("source", files, paths), ("skills", skills, skills)):
                for path in entry_manifest:
                    if policy(path) or safe_content(path.encode()):
                        raise HandoffError(f"Restricted {prefix} path {path}")
                for path in payload:
                    data = archive.read(f"{prefix}/{path}")
                    entry = entry_manifest[path]
                    if len(data) != entry["size"] or digest(data) != entry["sha256"]:
                        raise HandoffError(f"Incorrect {prefix} hash or size for {path}")
                    if safe_content(data):
                        raise HandoffError(f"Restricted {prefix} content at {path}")
            return meta
    except (BadZipFile, KeyError, UnicodeError, RuntimeError) as error:
        raise HandoffError(f"Invalid handoff ZIP: {error}") from error
