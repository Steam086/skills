"""Discover projects and safely capture selected working-tree files."""

from contextlib import ExitStack, contextmanager
import os
from pathlib import Path
import re
import stat
import subprocess

from common import HandoffError, digest, local_link, safe_path

SKIP_DIRS = {
    ".git", ".hg", ".svn", ".pro-handoff", ".agents", ".codex", ".aws", ".ssh", ".gnupg",
    ".idea", ".vscode", ".terraform", ".venv", "venv", "node_modules", "vendor", "__pycache__",
    ".cache", ".pytest_cache", ".mypy_cache", ".ruff_cache", "dist", "build", "target",
    "coverage", ".next", ".nuxt", ".turbo", ".tox", ".nox", ".gradle", ".dart_tool",
    ".npm", ".yarn", ".kube", ".docker", ".secrets", "secrets", ".credentials", ".direnv",
    ".svelte-kit", ".parcel-cache", ".output", ".angular", ".pnpm-store", ".eggs",
}
SENSITIVE_NAME = re.compile(
    r"(?i)^(?:\.env(?:\..*)?|.*\.env|\.envrc|\.netrc|\.npmrc|\.pypirc|\.git-credentials|\.gitconfig|"
    r"\.htpasswd|\.pgpass|\.my\.cnf|id_(?:rsa|dsa|ecdsa|ed25519)(?:\..*)?|"
    r"(?:credentials?|secrets?|tokens?|service[-_]?account|kubeconfig)(?:[._-].*)?|"
    r".*\.(?:pem|key|pfx|p12|jks|keystore|kdbx|tfstate)(?:\..*)?)$"
)
TEMP_NAME = re.compile(r"(?i)(?:^\.DS_Store$|\.(?:tmp|swp|swo|bak|pyc|pyo)$|~$)")
SECRET = re.compile(
    r"""(?ix)
    -----BEGIN\s+(?:[A-Z0-9]+\s+)*PRIVATE\s+KEY-----
    |\b(?:AKIA|ASIA)[A-Z0-9]{16}\b
    |\b(?:gh[pousr]_[a-z0-9]{20,}|github_pat_[a-z0-9_]{20,}|sk-(?:proj-|live_|test_)?[a-z0-9_-]{16,}
        |xox[baprs]-[a-z0-9-]{12,}|AIza[a-z0-9_-]{35})\b
    |\b(?:postgres(?:ql)?|mysql|mongodb(?:\+srv)?|redis|amqp|https?)://[^\s:/@]+:[^\s/@]+@
    |\b(?:api[_-]?key|private[_-]?key|access[_-]?key|secret[_-]?key|client[_-]?secret|
        password|passwd|pwd|(?:auth|access|refresh|bearer|api)[_-]?token|authorization|secret|token)
        ["']?\s*[:=]\s*["'](?:bearer\s+)?[^\s"'\[\]{}<>]{4,}["']
    |(?m:^[ \t]*(?:[A-Z0-9]+_)*(?:PASSWORD|TOKEN|SECRET|API_KEY)[ \t]*=[ \t]*
        (?![a-z_]\w*(?:\.[a-z_]\w*)*\([ \t]*\r?$)  # multiline code call, not a literal assignment
        [^\s"'$\[\]{}<>]{4,}[ \t]*\r?$)
    """
)
LANGUAGES = {
    ".py": "Python", ".rs": "Rust", ".go": "Go", ".js": "JavaScript", ".ts": "TypeScript",
    ".tsx": "TypeScript", ".jsx": "JavaScript", ".rb": "Ruby", ".php": "PHP", ".java": "Java",
    ".kt": "Kotlin", ".swift": "Swift", ".c": "C", ".h": "C/C++", ".cpp": "C++", ".cs": "C#",
    ".lua": "Lua", ".zig": "Zig", ".ex": "Elixir", ".sh": "Shell", ".vue": "Vue",
}
DESCRIPTORS = {
    "pyproject.toml", "setup.cfg", "setup.py", "package.json", "tsconfig.json",
    "pnpm-workspace.yaml", "turbo.json", "nx.json", "lerna.json", "go.mod", "go.work", "cargo.toml",
    "gemfile", "composer.json", "pom.xml", "build.gradle", "build.gradle.kts", "makefile", "justfile",
    "dockerfile", "compose.yaml", "docker-compose.yml", "cmakelists.txt", "tox.ini", "pytest.ini",
    "config.toml", "settings.py", "vite.config.ts", "next.config.js",
}
ENTRY_NAMES = {
    "main.py", "__main__.py", "app.py", "manage.py", "asgi.py", "wsgi.py", "main.go",
    "main.rs", "lib.rs", "index.js", "index.ts", "main.ts", "main.tsx", "app.ts", "main.c", "program.cs",
}


def git(path, *args):
    env = {**os.environ, "GIT_OPTIONAL_LOCKS": "0"}
    for key in ("GIT_DIR", "GIT_WORK_TREE", "GIT_INDEX_FILE", "GIT_COMMON_DIR"):
        env.pop(key, None)
    try:
        return subprocess.run(
            ["git", "-c", "core.fsmonitor=false", "-C", str(path), *args],
            stdout=subprocess.PIPE, stderr=subprocess.DEVNULL,
            env=env, check=False, timeout=30,
        )
    except FileNotFoundError:
        return None
    except subprocess.TimeoutExpired as error:
        raise HandoffError("Git discovery timed out") from error


def project(path):
    root = path.expanduser().resolve(strict=True)
    if not root.is_dir():
        raise HandoffError(f"Project directory is not a directory: {root}")
    result = git(root, "rev-parse", "--show-toplevel")
    if result and result.returncode == 0:
        return Path(os.fsdecode(result.stdout.rstrip(b"\n"))).resolve(strict=True), True
    return root, False


def policy(path):
    try:
        safe_path(path)
    except HandoffError:
        return "unsafe or non-portable path"
    parts = path.lower().split("/")
    if any(part in SKIP_DIRS for part in parts):
        return "metadata, cache, dependency, build or local state"
    if any(SENSITIVE_NAME.fullmatch(part) for part in parts):
        return "sensitive path"
    if TEMP_NAME.search(parts[-1]):
        return "temporary file"
    return None


def walk(root, exclusions):
    def walk_error(error):
        relative = Path(error.filename).relative_to(root).as_posix()
        exclusions[relative] = "directory unreadable"

    for base, dirs, files in os.walk(root, followlinks=False, onerror=walk_error):
        for name in list(dirs):
            child = Path(base, name)
            rel = child.relative_to(root).as_posix()
            reason = policy(rel)
            try:
                if local_link(child.lstat()):
                    reason = "symbolic link or reparse point"
            except OSError:
                reason = "directory unreadable"
            if reason:
                exclusions[rel] = reason
                dirs.remove(name)
        for name in files:
            yield Path(base, name).relative_to(root).as_posix()


def status_lines(root):
    result = git(root, "status", "--porcelain=v1", "-z", "--untracked-files=all", "--ignore-submodules=all")
    if not result or result.returncode:
        raise HandoffError("Git working-tree status is unavailable")
    records = iter(os.fsdecode(result.stdout).split("\0"))
    rows = []
    for row in records:
        if not row:
            continue
        state, path = row[:2], row[3:]
        old = next(records, "") if any(char in state for char in "RC") else ""
        rows.append((state, path, old))
    return rows


def is_handoff_state(path):
    return path == ".pro-handoff" or path.startswith(".pro-handoff/")


def discover(root, is_git):
    exclusions = {}
    head, status = None, []
    if is_git:
        result = git(root, "ls-files", "-z", "--cached", "--others", "--exclude-standard")
        if not result or result.returncode:
            raise HandoffError("Git project inventory is unavailable")
        paths = os.fsdecode(result.stdout).split("\0")
        ignored = git(root, "ls-files", "-z", "--others", "--ignored", "--exclude-standard", "--directory")
        if ignored and ignored.returncode == 0:
            for path in os.fsdecode(ignored.stdout).split("\0"):
                path = path.rstrip("/")
                if path:
                    exclusions[path] = policy(path) or "Git ignore rules"
        result = git(root, "rev-parse", "--verify", "HEAD")
        if result and result.returncode == 0:
            head = result.stdout.decode("ascii").strip()
        status = status_lines(root)
    else:
        paths = list(walk(root, exclusions))
    status = [row for row in status if not any(is_handoff_state(path) for path in row[1:])]
    exclusions = {path: reason for path, reason in exclusions.items() if not is_handoff_state(path)}
    changed = {path for _, path, _ in status}
    candidates = {}
    for path in sorted(set(paths) - {""}):
        if is_handoff_state(path):
            continue
        reason = policy(path)
        if reason:
            exclusions[path] = reason
            continue
        try:
            with file_descriptor(root, path, read=False) as (_, info):
                candidates[path] = {"size": info.st_size, "changed": path in changed}
        except (OSError, HandoffError) as error:
            exclusions[path] = unavailable(error)
    return {"git_head": head, "status": status, "files": candidates, "exclusions": exclusions,
            "discovery": describe(candidates)}


def describe(candidates):
    result = {key: [] for key in ("entry_points", "descriptors", "docs", "tests", "modules")}
    languages, modules = {}, set()
    for path in candidates:
        p = Path(path)
        name = p.name.lower()
        language = LANGUAGES.get(p.suffix.lower())
        if language:
            languages[language] = languages.get(language, 0) + 1
        if name in DESCRIPTORS or name.startswith(("requirements", "dockerfile", "settings.gradle")):
            result["descriptors"].append(path)
        if name in ENTRY_NAMES or name.startswith(("cli.", "server.")):
            result["entry_points"].append(path)
        if name.startswith(("agents.", "readme", "architecture", "design")) or any(
            part.lower() in {"doc", "docs", "adr"} for part in p.parts[:-1]
        ):
            result["docs"].append(path)
        if name.startswith("test_") or re.search(r"(?i)(?:_test\.|\.test\.|\.spec\.)", name) or any(
            part.lower() in {"tests", "test", "spec", "__tests__"} for part in p.parts[:-1]
        ):
            result["tests"].append(path)
        if len(p.parts) > 1:
            modules.add("/".join(p.parts[:2]) if len(p.parts) > 2 and p.parts[0] in {"apps", "packages", "services"}
                        else p.parts[0])
    result["languages"] = languages
    result["modules"] = sorted(modules)
    return result


def unavailable(error):
    if isinstance(error, FileNotFoundError):
        return "missing from working tree"
    if isinstance(error, HandoffError):
        return str(error)
    return "unreadable file or unsafe path components"


def regular(info):
    if local_link(info):
        raise HandoffError("symbolic link or reparse point")
    if not stat.S_ISREG(info.st_mode):
        raise HandoffError("not a regular file")


def identity(info):
    return info.st_dev, info.st_ino, info.st_size, info.st_mtime_ns, info.st_ctime_ns


@contextmanager
def file_descriptor(root, path, *, read):
    """Use anchored opens on POSIX and path/identity checks elsewhere."""
    parts = safe_path(path).split("/")
    flags = os.O_RDONLY | getattr(os, "O_BINARY", 0) | getattr(os, "O_NONBLOCK", 0)
    with ExitStack() as stack:
        if os.open in os.supports_dir_fd and hasattr(os, "O_NOFOLLOW"):
            folder = os.open(root, flags | os.O_DIRECTORY | os.O_NOFOLLOW)
            stack.callback(os.close, folder)
            for part in parts[:-1]:
                folder = os.open(part, flags | os.O_DIRECTORY | os.O_NOFOLLOW, dir_fd=folder)
                stack.callback(os.close, folder)

            def lookup():
                return os.stat(parts[-1], dir_fd=folder, follow_symlinks=False)

            def open_file():
                return os.open(parts[-1], flags | os.O_NOFOLLOW, dir_fd=folder)
        else:
            location = root.joinpath(*parts)

            def lookup():
                for parent in reversed(location.parents):
                    if local_link(parent.lstat()):
                        raise HandoffError("symbolic link or reparse point")
                return location.lstat()

            def open_file():
                return os.open(location, flags)
        info = lookup()
        regular(info)
        fd = None
        if read:
            fd = open_file()
            stack.callback(os.close, fd)
            if identity(info) != identity(os.fstat(fd)) or identity(info) != identity(lookup()):
                raise HandoffError("file changed during capture; retry the export")
        yield fd, info
        if read and (
            identity(info) != identity(os.fstat(fd))
            or identity(info) != identity(lookup())
            or identity(info) != identity(root.joinpath(*parts).lstat())
        ):
            raise HandoffError("file changed during capture; retry the export")


def read_bytes(root, path, limit):
    with file_descriptor(root, path, read=True) as (fd, info):
        if info.st_size > limit:
            raise HandoffError("single-file size budget exceeded")
        with os.fdopen(fd, "rb", closefd=False) as stream:
            data = stream.read(limit + 1)
        if len(data) != info.st_size:
            raise HandoffError("file changed during capture; retry the export")
        return data


def safe_content(data):
    try:
        text = data.decode("utf-8-sig")
    except UnicodeError:
        return "binary or non-UTF-8"
    if any(ord(char) < 32 and char not in "\t\n\r\f" for char in text):
        return "binary or control characters"
    if SECRET.search(text):
        return "potential embedded credential"
    return None


def current_hash(root, path, limit):
    reason = policy(path)
    if reason:
        return None, reason
    try:
        data = read_bytes(root, path, limit)
        reason = safe_content(data)
        return (None, reason) if reason else (digest(data), None)
    except (OSError, HandoffError) as error:
        return None, unavailable(error)


def presence(root, path):
    """Only a missing path proven without following links is a deletion."""
    location = root
    try:
        for part in safe_path(path).split("/"):
            location /= part
            if local_link(location.lstat()):
                return "unavailable"
    except (FileNotFoundError, NotADirectoryError):
        return "missing"
    except (OSError, HandoffError):
        return "unavailable"
    return "present"
