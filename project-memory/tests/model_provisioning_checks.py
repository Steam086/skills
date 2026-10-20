import contextlib
import errno
import hashlib
import importlib.util
import io
import json
import os
from pathlib import Path
import subprocess
import tempfile
import unittest
from unittest.mock import patch

PACKAGE = Path(__file__).resolve().parent.parent
spec = importlib.util.spec_from_file_location('models', PACKAGE / 'scripts/memory-models.py')
models = importlib.util.module_from_spec(spec)
spec.loader.exec_module(models)
DATA = b'GGUFtest fixture, not a real model'
MODEL = {'file': 'embed.gguf', 'cacheName': 'alias.gguf', 'sha256': hashlib.sha256(DATA).hexdigest(),
         'repo': 'fixture/model', 'revision': 'pinned'}


class Provisioning(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.base = Path(self.tmp.name)
        self.project = self.base / 'project'
        self.cache = self.base / 'cache'
        self.cache.mkdir()
        self.source = self.cache / MODEL['file']
        self.source.write_bytes(DATA)

    def run_models(self, **kwargs):
        with contextlib.redirect_stdout(io.StringIO()):
            models.provision({'embed': MODEL}, self.project, self.cache, **kwargs)

    def test_offline_hardlink_and_repeat(self):
        with patch.object(models.subprocess, 'run', side_effect=AssertionError('Network forbidden')):
            self.run_models(offline=True)
            self.run_models(offline=True)
        self.assertTrue(os.path.samefile(self.source, self.project / 'alias.gguf'))
        self.assertFalse((self.cache / '.models.lock').exists())

    def test_missing_offline_never_downloads(self):
        self.source.unlink()
        with patch.object(models.subprocess, 'run', side_effect=AssertionError('Network forbidden')):
            with self.assertRaisesRegex(ValueError, 'Offline'):
                self.run_models(offline=True)
        self.assertFalse((self.project / 'embed.gguf').exists())

    def test_conflict_and_symlink_do_not_overwrite(self):
        self.project.mkdir()
        alias = self.project / 'alias.gguf'
        alias.write_bytes(b'bad')
        with self.assertRaises(ValueError):
            self.run_models(offline=True)
        self.assertEqual(alias.read_bytes(), b'bad')
        self.assertFalse((self.project / 'embed.gguf').exists())
        alias.unlink()
        alias.symlink_to(self.source)
        with self.assertRaisesRegex(ValueError, 'Symlink'):
            self.run_models(offline=True)

    def test_pinned_download_atomic_publish_and_rejection(self):
        self.source.unlink()
        def download(argv, **kwargs):
            self.assertEqual(argv[:5], ['hf', 'download', 'fixture/model', 'embed.gguf', '--revision'])
            self.assertEqual(argv[5], 'pinned')
            self.assertFalse(self.source.exists())
            (Path(argv[-1]) / 'embed.gguf').write_bytes(DATA)
        with patch.object(models.subprocess, 'run', side_effect=download):
            self.run_models()
        self.assertEqual(self.source.read_bytes(), DATA)
        self.assertFalse(list(self.cache.glob('.download-*')))
        # A failed download cannot publish either a shared or project weight.
        other = self.base / 'other'
        def bad(argv, **kwargs):
            (Path(argv[-1]) / 'embed.gguf').write_bytes(b'GGUFwrong')
        with patch.object(models.subprocess, 'run', side_effect=bad):
            with self.assertRaisesRegex(ValueError, 'SHA256'):
                models.provision({'embed': MODEL}, other, self.base / 'fresh')
        self.assertFalse((other / 'embed.gguf').exists())
        self.assertFalse((self.base / 'fresh/embed.gguf').exists())

    def test_all_models_preflight_before_publication(self):
        second = {**MODEL, 'file': 'second.gguf', 'cacheName': 'second-alias.gguf'}
        (self.cache / 'second.gguf').write_bytes(b'GGUFcorrupt')
        with self.assertRaisesRegex(ValueError, 'SHA256'):
            models.provision({'embed': MODEL, 'rerank': second}, self.project, self.cache,
                             selection='all', offline=True)
        self.assertFalse((self.project / 'embed.gguf').exists())
        with self.assertRaisesRegex(ValueError, 'basename'):
            models.provision({'embed': {**MODEL, 'file': '../escape'}}, self.project, self.cache)

    def test_cross_device_requires_explicit_copy(self):
        self.project.mkdir()
        real_link = os.link
        def cross_device(src, dst):
            if Path(src) == self.source:
                raise OSError(errno.EXDEV, 'cross device')
            return real_link(src, dst)
        with patch.object(models.os, 'link', side_effect=cross_device):
            with self.assertRaisesRegex(ValueError, '--copy'):
                self.run_models(offline=True)
            self.run_models(offline=True, allow_copy=True)
        target = self.project / 'embed.gguf'
        self.assertEqual(target.read_bytes(), DATA)
        self.assertFalse(os.path.samefile(target, self.source))
        self.assertTrue(os.path.samefile(target, self.project / 'alias.gguf'))
        self.assertFalse(list(self.project.glob('.model-copy-*')))

    def test_cache_environment_resolved_before_project_redirect(self):
        # Real shell wrapper and manifest; offline failure prints selected directories.
        env = {**os.environ, 'PI_MEMORY_PROJECT_ROOT': str(self.base),
               'XDG_CACHE_HOME': str(self.base / 'machine-cache')}
        env.pop('PI_MEMORY_MODEL_DIR', None)
        command = [str(PACKAGE / 'scripts/memory-models'), '--offline']
        result = subprocess.run(command, env=env, capture_output=True, text=True)
        self.assertNotEqual(result.returncode, 0)
        self.assertIn(str(self.base / 'machine-cache/project-memory/models'), result.stderr)
        env['PI_MEMORY_MODEL_DIR'] = str(self.base / 'override')
        result = subprocess.run(command, env=env, capture_output=True, text=True)
        self.assertIn(str(self.base / 'override'), result.stderr)
        result = subprocess.run(command + ['--model-dir', str(self.cache)], env=env, capture_output=True, text=True)
        self.assertIn(str(self.cache), result.stderr)

    def test_parallel_processes_reuse_same_model(self):
        code = '''import importlib.util,json,sys
s=importlib.util.spec_from_file_location('m',sys.argv[1]);m=importlib.util.module_from_spec(s);s.loader.exec_module(m)
m.provision(json.loads(sys.argv[2]),sys.argv[3],sys.argv[4])
'''
        args = ['python3', '-c', code, str(PACKAGE / 'scripts/memory-models.py'),
                json.dumps({'embed': MODEL}), str(self.project), str(self.cache)]
        children = [subprocess.Popen(args, stdout=subprocess.PIPE, stderr=subprocess.PIPE) for _ in range(3)]
        for child in children:
            out, err = child.communicate(timeout=20)
            self.assertEqual(child.returncode, 0, err)
        self.assertTrue(os.path.samefile(self.source, self.project / 'alias.gguf'))


if __name__ == '__main__':
    unittest.main()
