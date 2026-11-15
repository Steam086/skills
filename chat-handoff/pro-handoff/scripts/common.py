"""Shared serialization, validation and durable file writes."""

import hashlib
import json
import os
from datetime import datetime, timezone
from pathlib import Path
import re
import stat
import tempfile
from uuid import uuid4

PROTOCOL = "pro-handoff/1.0"
SKILL = Path(__file__).resolve().parents[1]
ID = re.compile(r"[0-9a-f]{32}")
HASH = re.compile(r"[0-9a-f]{64}")
LABEL = re.compile(r"[A-Za-z0-9][A-Za-z0-9_-]{0,79}")
RESERVED = re.compile(r"(?i)(CON|PRN|AUX|NUL|COM[1-9¹²³]|LPT[1-9¹²³])(?:\..*)?")


class HandoffError(Exception):
    pass


def now():
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def new_id():
    return uuid4().hex


def digest(data):
    return hashlib.sha256(data).hexdigest()


def canonical(value):
    return json.dumps(value, sort_keys=True, separators=(",", ":"), allow_nan=False).encode()


def json_bytes(value):
    return (json.dumps(value, indent=2, sort_keys=True, allow_nan=False) + "\n").encode()


def parse_json(data):
    def unique(pairs):
        result = {}
        for key, value in pairs:
            if key in result:
                raise HandoffError(f"Duplicate JSON key {key!r}")
            result[key] = value
        return result

    def invalid_number(value):
        raise HandoffError(f"Invalid JSON number {value}")

    try:
        return json.loads(data.decode("utf-8"), object_pairs_hook=unique, parse_constant=invalid_number)
    except (ValueError, RecursionError) as error:
        raise HandoffError(f"Invalid UTF-8 JSON: {error}") from error


def load(path):
    return parse_json(path.read_bytes())


def local_link(info):
    return stat.S_ISLNK(info.st_mode) or bool(getattr(info, "st_file_attributes", 0) & 0x400)


def sync_dir(path):
    if os.name == "posix":
        fd = os.open(path, os.O_RDONLY | os.O_DIRECTORY)
        try:
            os.fsync(fd)
        finally:
            os.close(fd)


def private_dir(path):
    try:
        path.mkdir(mode=0o700)
        sync_dir(path.parent)
    except FileExistsError:
        pass
    info = path.lstat()
    if local_link(info) or not stat.S_ISDIR(info.st_mode):
        raise HandoffError(f"Expected a real directory: {path}")


def atomic_write(path, data):
    fd, temp = tempfile.mkstemp(prefix=".pending-", dir=path.parent)
    try:
        with os.fdopen(fd, "wb") as stream:
            stream.write(data)
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(temp, path)
        sync_dir(path.parent)
    finally:
        Path(temp).unlink(missing_ok=True)


def safe_path(value):
    if not isinstance(value, str) or not value or len(value) > 1024:
        raise HandoffError(f"Invalid relative path {value!r}")
    for part in value.split("/"):
        if (
            not part or part in (".", "..") or part.endswith((" ", "."))
            or any(ord(char) < 32 or 127 <= ord(char) <= 159 or 0xD800 <= ord(char) <= 0xDFFF
                   or char in '\\:*?"<>|' for char in part)
            or RESERVED.fullmatch(part)
        ):
            raise HandoffError(f"Unsafe relative path {value!r}")
    return value


def require_text(value, name, limit=12000):
    if (
        not isinstance(value, str) or not value.strip() or len(value) > limit
        or any((ord(c) < 32 and c not in "\n\t\r") or 127 <= ord(c) <= 159
               or 0xD800 <= ord(c) <= 0xDFFF for c in value)
    ):
        raise HandoffError(f"Invalid text in {name}")
    return value


def text_list(value, name, limit=100):
    if not isinstance(value, list) or len(value) > limit:
        raise HandoffError(f"{name} must be an array of up to {limit} items")
    return [require_text(item, name) for item in value]


def fields(value, required, optional=(), name="object"):
    if not isinstance(value, dict) or not set(required) <= value.keys() or value.keys() - set(required) - set(optional):
        raise HandoffError(f"Invalid fields in {name}. Required: {', '.join(required)}")


def terminal_text(text):
    return "".join(
        c if c in "\n\t" or (32 <= ord(c) < 127 or 160 <= ord(c) and c.isprintable()) else repr(c)[1:-1]
        for c in text
    )
