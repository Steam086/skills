"""Hash snapshots and compute or replay their explicit file operations."""

from collections import Counter
from unicodedata import normalize

from common import HASH, HandoffError, canonical, digest, fields, safe_path
from scanner import presence

KINDS = ("added", "modified", "deleted", "renamed", "omitted")


def manifest(content):
    return {path: {"sha256": digest(data), "size": len(data)} for path, data in sorted(content.items())}


def snapshot_id(files):
    return digest(canonical(files))


def path_key(path):
    return normalize("NFC", path).casefold()


def validate_manifest(files):
    if not isinstance(files, dict):
        raise HandoffError("Invalid file manifest")
    seen = set()
    for path, entry in files.items():
        safe_path(path)
        key = path_key(path)
        if key in seen:
            raise HandoffError(f"Non-portable path collision: {path}")
        seen.add(key)
        fields(entry, ("sha256", "size"), name="manifest file")
        sha, size = entry["sha256"], entry["size"]
        if not isinstance(sha, str) or not HASH.fullmatch(sha) or type(size) is not int or size < 0:
            raise HandoffError(f"Invalid hash or size for {path}")
    if any(ancestor in seen for path in seen for ancestor in ancestor_keys(path)):
        raise HandoffError("Manifest contains a file/directory collision")


def ancestor_keys(path):
    parts = path.split("/")
    return ("/".join(parts[:index]) for index in range(1, len(parts)))


def changes(root, previous, current):
    added = sorted(current.keys() - previous.keys())
    removed = sorted(previous.keys() - current.keys())
    deleted = [path for path in removed if presence(root, path) == "missing"]
    omitted = [path for path in removed if path not in deleted]
    modified = sorted(path for path in previous.keys() & current.keys() if previous[path] != current[path])
    before = Counter(previous[path]["sha256"] for path in deleted)
    after = Counter(current[path]["sha256"] for path in added)
    possible = {current[path]["sha256"]: path for path in added if after[current[path]["sha256"]] == 1}
    renamed = [
        {"from": path, "to": possible[previous[path]["sha256"]]}
        for path in deleted if before[previous[path]["sha256"]] == 1 and previous[path]["sha256"] in possible
    ]
    rename_from = {entry["from"] for entry in renamed}
    rename_to = {entry["to"] for entry in renamed}
    return {
        "added": [path for path in added if path not in rename_to],
        "modified": modified,
        "deleted": [path for path in deleted if path not in rename_from],
        "renamed": renamed,
        "omitted": omitted,
    }


def payload_paths(operations):
    return set(operations["added"]) | set(operations["modified"]) | {
        entry["to"] for entry in operations["renamed"]
    }


def replay(previous, current, operations):
    fields(operations, KINDS, name="operations")
    result = previous.copy()
    removed = set()
    destinations = set()

    def remove(path):
        safe_path(path)
        if path in removed or path not in previous or path in current:
            raise HandoffError(f"Invalid removed path {path}")
        removed.add(path)
        del result[path]

    def put(path, modify=False):
        safe_path(path)
        if path in destinations or path not in current or (path in previous) != modify:
            raise HandoffError(f"Invalid destination {path}")
        destinations.add(path)
        result[path] = current[path]

    for key in KINDS:
        if not isinstance(operations[key], list):
            raise HandoffError(f"Invalid operation list {key}")
    for path in operations["deleted"] + operations["omitted"]:
        remove(path)
    for entry in operations["renamed"]:
        fields(entry, ("from", "to"), name="rename")
        remove(entry["from"])
        put(entry["to"])
        if previous[entry["from"]] != current[entry["to"]]:
            raise HandoffError("Rename contents differ")
    for path in operations["added"]:
        put(path)
    for path in operations["modified"]:
        put(path, modify=True)
        if previous[path] == current[path]:
            raise HandoffError(f"Modified file has identical content: {path}")
    if result != current:
        raise HandoffError("Operations do not reconstruct the target snapshot")
