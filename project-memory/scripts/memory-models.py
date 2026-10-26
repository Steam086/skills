#!/usr/bin/env python3
"""Pinned model provisioning. No trust grants, services, or implicit downloads in offline mode."""
import argparse
import contextlib
import errno
import fcntl
import hashlib
import json
import os
from pathlib import Path
import shutil
import stat
import subprocess
import tempfile


def local_path(value):
    path = Path(os.path.abspath(os.path.expanduser(str(value))))
    for part in [*reversed(path.parents), path]:
        if part.is_symlink():
            raise ValueError(f'Symlink is not allowed: {part}')
    return path


def verify(path, digest):
    local_path(path)
    if not path.is_file():
        raise ValueError(f'Missing regular model file: {path}')
    with path.open('rb') as stream:
        if stream.read(4) != b'GGUF':
            raise ValueError(f'Invalid GGUF magic: {path}')
        stream.seek(0)
        digest_state = hashlib.sha256()
        for chunk in iter(lambda: stream.read(8 * 1024 * 1024), b''):
            digest_state.update(chunk)
        actual = digest_state.hexdigest()
    if actual != digest:
        raise ValueError(f'Model SHA256 mismatch; retained for investigation: {path}')


@contextlib.contextmanager
def lock(path):
    local_path(path)
    fd = os.open(path, os.O_CREAT | os.O_RDWR | os.O_NOFOLLOW, 0o600)
    with os.fdopen(fd, 'w') as stream:
        if not stat.S_ISREG(os.fstat(stream.fileno()).st_mode):
            raise ValueError(f'Not a regular lock: {path}')
        fcntl.flock(stream, fcntl.LOCK_EX)
        yield


def publish(source, target, digest, allow_copy=False):
    """Exclusive publication: never replace a conflicting file."""
    local_path(target)
    if target.exists():
        verify(target, digest)
        return 'existing'
    try:
        os.link(source, target)
        return 'hardlink'
    except OSError as exc:
        if exc.errno != errno.EXDEV:
            raise
        if not allow_copy:
            raise ValueError('Cross-filesystem copy requires --copy: ' + str(target)) from exc
    # Stage on destination filesystem; link publishes complete bytes without overwrite.
    fd, name = tempfile.mkstemp(prefix='.model-copy-', dir=target.parent)
    staging = Path(name)
    try:
        with os.fdopen(fd, 'wb') as out, source.open('rb') as inp:
            shutil.copyfileobj(inp, out)
            out.flush()
            os.fsync(out.fileno())
        verify(staging, digest)
        os.link(staging, target)
    finally:
        staging.unlink(missing_ok=True)
    return 'copy'


def provision(manifest, project, cache, selection='embed', offline=False, allow_copy=False):
    project, cache = local_path(project), local_path(cache)
    models = [m for role, m in manifest.items() if selection == 'all' or role == 'embed']
    if not models:
        raise ValueError('No selected models in manifest')
    for model in models:
        for key in ('file', 'cacheName'):
            name = model[key]
            if not name or name in ('.', '..') or '/' in name or '\\' in name:
                raise ValueError(f'Invalid manifest basename: {name}')
        if len(model['sha256']) != 64 or any(c not in '0123456789abcdef' for c in model['sha256']):
            raise ValueError('Invalid SHA256 in manifest')
    project.mkdir(parents=True, exist_ok=True, mode=0o700)
    # Offline source can be read-only: only the project lock is needed there.
    if not offline:
        cache.mkdir(parents=True, exist_ok=True, mode=0o700)
    with contextlib.ExitStack() as stack:
        # Stable lock ordering avoids deadlocks even when directories coincide.
        locks = {project / '.models.lock'}
        if not offline:
            locks.add(cache / '.models.lock')
        for filename in sorted(locks):
            stack.enter_context(lock(filename))
        plan = []
        # Validate ALL existing selected candidates before publishing anything.
        for model in models:
            candidates = []
            for directory in dict.fromkeys([project, cache]):
                for name in dict.fromkeys([model['file'], model['cacheName']]):
                    candidate = local_path(directory / name)
                    if candidate.exists():
                        verify(candidate, model['sha256'])
                        candidates.append(candidate)
            if not candidates and offline:
                raise ValueError(f'Offline: missing verified model {model["file"]} in {project} or {cache}')
            plan.append((model, candidates[0] if candidates else None))
        for model, source in plan:
            if source is None:
                # hf writes only to a temporary directory; failed downloads are never published.
                with tempfile.TemporaryDirectory(prefix='.download-', dir=cache) as tmp:
                    env = dict(os.environ)
                    env.pop('ALL_PROXY', None)
                    env.pop('all_proxy', None)
                    subprocess.run(['hf', 'download', model['repo'], model['file'],
                                    '--revision', model['revision'], '--local-dir', tmp],
                                   env=env, check=True)
                    downloaded = Path(tmp) / model['file']
                    verify(downloaded, model['sha256'])
                    source = cache / model['file']
                    publish(downloaded, source, model['sha256'])
            target = project / model['file']
            method = publish(source, target, model['sha256'], allow_copy)
            alias_method = publish(target, project / model['cacheName'], model['sha256'])
            print(json.dumps({'model': model['file'], 'source': str(source),
                              'target': str(target), 'method': method,
                              'aliasMethod': alias_method, 'sha256': model['sha256']}))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('selection', nargs='?', choices=['embed', 'all'], default='embed')
    parser.add_argument('--default-model-dir', required=True, help=argparse.SUPPRESS)
    sources = parser.add_mutually_exclusive_group()
    sources.add_argument('--model-dir', help='Shared download/cache directory')
    sources.add_argument('--from', dest='source', help='Read-only local source; implies --offline')
    parser.add_argument('--offline', action='store_true', help='Never invoke hf or download')
    parser.add_argument('--copy', action='store_true', help='Allow cross-filesystem copies (never overwrite)')
    args = parser.parse_args()
    root = os.environ.get('PROJECT_MEMORY_PROJECT_ROOT') or os.environ.get('PI_MEMORY_PROJECT_ROOT')
    if not root:
        parser.error('Use scripts/memory-models from a consumer project')
    package = Path(__file__).resolve().parent.parent
    with (package / 'model-sources.json').open() as stream:
        manifest = json.load(stream)
    provision(manifest, Path(root) / '.project-memory/cache/qmd/models',
              args.source or args.model_dir or args.default_model_dir,
              args.selection, args.offline or bool(args.source), args.copy)


if __name__ == '__main__':
    try:
        main()
    except (ValueError, OSError, subprocess.CalledProcessError) as exc:
        raise SystemExit(str(exc)) from exc
