"""Per-project lock, checksummed commit records and recoverable projections."""

from contextlib import contextmanager
import os
from pathlib import Path
import stat

from common import (HandoffError, ID, LABEL, PROTOCOL, atomic_write, canonical, digest,
                    json_bytes, load, local_link, new_id, now, private_dir)
from scanner import git

ARTIFACTS = ("snapshots", "prompts", "responses", "exports", "plans", "reviews")
CATEGORIES = {
    "verified_facts": "Verified Facts",
    "accepted_decisions": "Accepted Decisions",
    "pending_proposals": "Pending Proposals",
    "superseded_decisions": "Superseded Decisions",
    "implementation_status": "Implementation Status",
    "open_questions": "Open Questions",
    "next_actions": "Next Actions",
    "pro_findings": "Pro Findings for Local Verification",
}


def read_record(path):
    info = path.lstat()
    if local_link(info) or not stat.S_ISREG(info.st_mode):
        raise HandoffError(f"Unsafe session record: {path}")
    record = load(path)
    if not isinstance(record, dict) or set(record) != {"payload", "sha256"}:
        raise HandoffError(f"Damaged session record: {path}")
    payload = record["payload"]
    if not isinstance(payload, dict) or record["sha256"] != digest(canonical(payload)):
        raise HandoffError(f"Checksum mismatch in {path}. Restore a known-good copy.")
    if payload.get("protocol_version") != PROTOCOL:
        raise HandoffError(f"Unsupported session format in {path}")
    return payload


def write_record(path, payload):
    atomic_write(path, json_bytes({"payload": payload, "sha256": digest(canonical(payload))}))


@contextmanager
def lock(path):
    flags = os.O_CREAT | os.O_RDWR | getattr(os, "O_NOFOLLOW", 0) | getattr(os, "O_BINARY", 0)
    if os.path.lexists(path) and local_link(path.lstat()):
        raise HandoffError(f"Unsafe lock file: {path}")
    fd = os.open(path, flags, 0o600)
    try:
        if not stat.S_ISREG(os.fstat(fd).st_mode):
            raise HandoffError(f"Unsafe lock file: {path}")
        if os.name == "nt":
            import msvcrt
            msvcrt.locking(fd, msvcrt.LK_LOCK, 1)
        else:
            import fcntl
            fcntl.flock(fd, fcntl.LOCK_EX)
        yield
    finally:
        os.close(fd)


def git_exclude(root):
    ignored = git(root, "check-ignore", "--quiet", "--", ".pro-handoff/index.json")
    if ignored and ignored.returncode == 0:
        return None
    # A local ignore file also works when Codex mounts .git read-only.
    local_ignore = root / ".pro-handoff" / ".gitignore"
    if not os.path.lexists(local_ignore):
        try:
            atomic_write(local_ignore, b"*\n")
        except OSError:
            pass
        ignored = git(root, "check-ignore", "--quiet", "--", ".pro-handoff/index.json")
        if ignored and ignored.returncode == 0:
            return None
    result = git(root, "rev-parse", "--path-format=absolute", "--git-path", "info/exclude")
    if not result or result.returncode != 0:
        return "Add /.pro-handoff/ to your local Git exclude rules."
    exclude = Path(os.fsdecode(result.stdout.rstrip(b"\n")))
    try:
        if local_link(exclude.parent.lstat()):
            raise OSError("symbolic link")
        with lock(exclude.with_name("pro-handoff-exclude.lock")):
            if os.path.lexists(exclude):
                info = exclude.lstat()
                if local_link(info) or not stat.S_ISREG(info.st_mode):
                    raise OSError("unsafe exclude file")
                before = exclude.read_bytes()
            else:
                before = b""
            if b"/.pro-handoff/" not in before.splitlines():
                separator = b"\n" if before and not before.endswith(b"\n") else b""
                atomic_write(exclude, before + separator + b"/.pro-handoff/\n")
    except (OSError, HandoffError):
        return "Git local excludes are read-only. Keep .pro-handoff/ out of commits."
    ignored = git(root, "check-ignore", "--quiet", "--", ".pro-handoff/index.json")
    if not ignored or ignored.returncode != 0:
        return "Git still reports .pro-handoff/ as visible. Check tracked files and ignore overrides."
    return None


class Store:
    def __init__(self, root, is_git):
        self.root = root
        self.is_git = is_git
        self.directory = root / ".pro-handoff"
        self.index_file = self.directory / "index.json"
        self.warning = None

    @contextmanager
    def locked(self, create=False):
        if not create and not os.path.lexists(self.directory):
            yield {"protocol_version": PROTOCOL, "active": None, "sessions": {}}
            return
        private_dir(self.directory)
        with lock(self.directory / "store.lock"):
            if os.path.lexists(self.index_file):
                index = read_record(self.index_file)
                if not isinstance(index.get("sessions"), dict) or index.get("active") not in (
                    None, *index["sessions"]
                ):
                    raise HandoffError("Invalid session index")
            else:
                index = {"protocol_version": PROTOCOL, "active": None, "sessions": {}}
            if create and self.is_git:
                self.warning = git_exclude(self.root)
            yield index

    def directory_for(self, session_id):
        if not isinstance(session_id, str) or not ID.fullmatch(session_id):
            raise HandoffError("Invalid session ID")
        return self.directory / "sessions" / session_id

    def select(self, index, selector=None, *, create=False, goal=None):
        session_id = index["active"] if selector is None else (
            selector if selector in index["sessions"] else next(
                (key for key, name in index["sessions"].items() if name == selector), None
            )
        )
        if session_id:
            folder = self.directory_for(session_id)
            for directory in (folder.parent, folder, *(folder / name for name in ARTIFACTS)):
                if not directory.is_dir() or local_link(directory.lstat()):
                    raise HandoffError(f"Session directory missing or unsafe: {directory}")
            state = read_record(folder / "session.json")
            if state.get("session_id") != session_id or state.get("session_name") != index["sessions"][session_id]:
                raise HandoffError("Session identity mismatch")
            self.project_views(folder, state)
            return folder, state
        if not create:
            raise HandoffError(f"Unknown session {selector!r}" if selector else "No active session")
        name = selector or "default"
        if not LABEL.fullmatch(name) or ID.fullmatch(name):
            raise HandoffError("Use a session name of up to 80 letters, digits, underscores or hyphens")
        session_id = new_id()
        folder = self.directory_for(session_id)
        for directory in (folder.parent, folder, *(folder / name for name in ARTIFACTS)):
            private_dir(directory)
        created = now()
        state = {
            "protocol_version": PROTOCOL, "session_id": session_id, "session_name": name,
            "created_at": created, "updated_at": created, "status": "active", "goal": goal,
            "git_head": None, "snapshot_id": None, "state_revision": 0, "latest_export_id": None,
            "confirmed_base_export_id": None, "latest_import_id": None, "exports": {}, "imports": {},
            "reviews": {}, "knowledge": {key: [] for key in CATEGORIES}, "events": [],
        }
        self.commit(folder, state, "init", {"name": name})
        index["sessions"][session_id] = name
        self.activate(index, session_id)
        return folder, state

    def activate(self, index, session_id):
        if index["active"] != session_id:
            index["active"] = session_id
            write_record(self.index_file, index)

    def commit(self, folder, state, operation, details):
        state["state_revision"] += 1
        state["updated_at"] = now()
        state["events"].append({
            "revision": state["state_revision"], "at": state["updated_at"],
            "operation": operation, **details,
        })
        write_record(folder / "session.json", state)
        self.project_views(folder, state)

    @staticmethod
    def project_views(folder, state):
        state_file = folder / "STATE.md"
        rendered = render_state(state).encode()
        if not state_file.exists() or state_file.is_symlink() or state_file.read_bytes() != rendered:
            atomic_write(state_file, rendered)
        journal = folder / "events.jsonl"
        expected = b"".join(canonical(event) + b"\n" for event in state["events"])
        if not journal.exists() or journal.is_symlink():
            atomic_write(journal, expected)
            return
        existing = journal.read_bytes()
        if expected == existing:
            return
        if not expected.startswith(existing) or not existing.endswith(b"\n"):
            atomic_write(journal, expected)
            return
        with journal.open("ab") as stream:
            stream.write(expected[len(existing):])
            stream.flush()
            os.fsync(stream.fileno())


def render_item(item):
    if isinstance(item, str):
        return item.replace("\n", "\n  ")
    line = f"[`{item['id']}`] {item['text']}" if "id" in item else item["text"]
    if item.get("reason"):
        line += f" — {item['reason']}"
    if item.get("source"):
        line += f" (source `{item['source']}`)"
    if item.get("stale"):
        line += " **Evidence requires revalidation.**"
    for evidence in item.get("evidence", []):
        line += f"\n  - `{evidence['path']}` SHA-256 `{evidence['sha256']}`"
        if evidence.get("detail"):
            line += f" — {evidence['detail']}"
    return line


def render_state(state, keys=None):
    title = f"# Session {state['session_name']}\n\n"
    title += f"Goal: {state.get('goal') or 'Unset'}\n\n"
    title += f"State revision {state['state_revision']}.\n"
    for key in keys or CATEGORIES:
        title += f"\n## {CATEGORIES[key]}\n\n"
        items = state["knowledge"][key]
        title += "\n".join(f"- {render_item(item)}" for item in items) if items else "None recorded."
        title += "\n"
    return title


def confirm_base(state, export_id, method):
    record = state["exports"][export_id]
    base = record["base_export_id"]
    if base and not state["exports"][base]["delivery"]:
        raise HandoffError(f"Confirm delta base {base} before confirming {export_id}")
    if method not in record["delivery"]:
        record["delivery"][method] = now()
    confirmed = state["confirmed_base_export_id"]
    if not confirmed or record["revision"] > state["exports"][confirmed]["revision"]:
        state["confirmed_base_export_id"] = export_id
