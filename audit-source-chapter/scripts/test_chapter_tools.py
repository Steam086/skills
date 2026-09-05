from __future__ import annotations

import importlib.util
import json
import os
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path


SCRIPT_DIR = Path(__file__).resolve().parent


def _load(name: str, filename: str):
    spec = importlib.util.spec_from_file_location(name, SCRIPT_DIR / filename)
    assert spec and spec.loader
    module = importlib.util.module_from_spec(spec)
    sys.modules[name] = module
    spec.loader.exec_module(module)
    return module


chapter_lint = _load("chapter_lint", "chapter_lint.py")
verify_refs = _load("verify_source_refs", "verify_source_refs.py")


VALID_CHAPTER = """## 第 1 章 通用机制

### 内容提要

- 建立整体心智模型。

### 主题 A

#### 相关源文件

- src/core.py

源码展示了一条可验证路径。

**来源：**
`src/core.py:1-2`

**解读：**
该路径连接入口与核心变换。

### 本章小结

- 入口、变换与结果形成闭环。

### 第 1 章思考题

1. 边界在哪里？
   **解：** 边界位于公开入口与内部变换之间。
2. 数据如何推进？
   **解：** 数据依次经过读取与变换。
3. 失败如何观察？
   **解：** 通过返回值与测试断言观察。
"""


class ChapterLintTests(unittest.TestCase):
    def codes(self, text: str, **kwargs) -> set[str]:
        return {item.code for item in chapter_lint.lint(text, **kwargs)}

    def test_valid_chapter_and_bom(self) -> None:
        self.assertEqual(self.codes(VALID_CHAPTER), set())
        self.assertEqual(self.codes("\ufeff" + VALID_CHAPTER), set())

    def test_fenced_contract_does_not_satisfy_document(self) -> None:
        fenced = "```markdown\n" + VALID_CHAPTER + "\n```\n"
        self.assertIn("NO_HEADINGS", self.codes(fenced))

    def test_fenced_and_inline_image_syntax_are_not_visuals(self) -> None:
        text = VALID_CHAPTER.replace(
            "源码展示了一条可验证路径。",
            "源码展示了一条可验证路径。`![not an image](x.png)`\n\n```text\n![also not an image](x.png)\n```",
        )
        self.assertNotIn("MISSING_IMAGE_INTERPRETATION", self.codes(text))

    def test_topic_local_relevant_file_headings_are_not_duplicates(self) -> None:
        second = """
### 主题 B

#### 相关源文件

- tests/core_test.py

该主题验证边界。
"""
        text = VALID_CHAPTER.replace("### 本章小结", second + "\n### 本章小结")
        self.assertNotIn("DUPLICATE_HEADING", self.codes(text))

    def test_empty_sections_markers_and_answers_are_reported(self) -> None:
        self.assertIn("EMPTY_SECTION", self.codes("## 第 1 章 空\n\n### 内容提要\n\n### 下一节\n内容"))
        self.assertIn("EMPTY_SOURCE_MARKER", self.codes(VALID_CHAPTER.replace("`src/core.py:1-2`", "")))
        empty_answers = VALID_CHAPTER.replace("**解：** 边界位于公开入口与内部变换之间。", "**解：**")
        self.assertIn("EMPTY_ANSWER", self.codes(empty_answers))

    def test_custom_contract_and_questions_only_mode(self) -> None:
        self.assertEqual(self.codes("# Custom\n\nSubstantive text.\n", contract="custom"), set())
        questions_only = VALID_CHAPTER.replace("   **解：** 边界位于公开入口与内部变换之间。\n", "").replace(
            "   **解：** 数据依次经过读取与变换。\n", ""
        ).replace("   **解：** 通过返回值与测试断言观察。\n", "")
        self.assertNotIn("QUESTION_WITHOUT_ANSWER", self.codes(questions_only, exercise_mode="questions-only"))

    def test_numbered_steps_inside_an_answer_are_not_questions(self) -> None:
        replacement = """**解：** 依次检查：

      1. 文件存在。
      2. 行号有效。
      3. 语义支持。"""
        text = VALID_CHAPTER.replace("**解：** 边界位于公开入口与内部变换之间。", replacement)
        codes = self.codes(text)
        self.assertNotIn("QUESTION_WITHOUT_ANSWER", codes)
        self.assertNotIn("FEW_QUESTIONS", codes)

    def test_numbered_lists_after_question_section_are_not_questions(self) -> None:
        text = VALID_CHAPTER + "\n### 参考资料\n\n1. 标准文档。\n2. 设计记录。\n"
        self.assertNotIn("QUESTION_WITHOUT_ANSWER", self.codes(text))

    def test_supported_diagram_and_caption_require_immediate_interpretation(self) -> None:
        diagram = """```dot
digraph G { a -> b }
```

*图 1.1：依赖方向*

**图片解读：** 节点表示阶段，箭头表示依赖。
"""
        text = VALID_CHAPTER.replace("源码展示了一条可验证路径。", diagram)
        self.assertNotIn("MISSING_IMAGE_INTERPRETATION", self.codes(text))
        delayed = text.replace("**图片解读：**", "一段无关正文。\n\n**图片解读：**")
        self.assertIn("MISSING_IMAGE_INTERPRETATION", self.codes(delayed))

    def test_unclosed_fence_is_reported(self) -> None:
        self.assertIn("UNCLOSED_FENCE", self.codes(VALID_CHAPTER + "\n```text\nopen"))


class VerifySourceRefsTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temp_dir = tempfile.TemporaryDirectory()
        self.root = Path(self.temp_dir.name)
        files = {
            "Makefile": "one\ntwo\nthree\n",
            ".gitignore": "cache\n",
            "src/core.py": "one\ntwo\nthree\n",
            "vite.config.ts": "one\ntwo\n",
            "docs/design notes.md": "one\ntwo\n",
            "文档/设计.md": "one\ntwo\n",
        }
        for name, content in files.items():
            path = self.root / name
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text(content, encoding="utf-8")

    def tearDown(self) -> None:
        self.temp_dir.cleanup()

    def verify_text(self, text: str):
        draft = self.root / "draft.md"
        draft.write_text(text, encoding="utf-8")
        return verify_refs.verify(draft, self.root)

    def finding_codes(self, text: str) -> set[str]:
        _, findings = self.verify_text(text)
        return {item.code for item in findings}

    def test_extensionless_hidden_space_and_unicode_paths(self) -> None:
        text = """**来源：**
- `Makefile:1-3`
- `.gitignore:1`
- `docs/design notes.md:1-2`
- `文档/设计.md:2`

**解读：** verified
"""
        citations, findings = self.verify_text(text)
        self.assertEqual(len(citations), 4)
        self.assertEqual(findings, [])

    def test_bare_root_file_in_source_block_is_supported(self) -> None:
        citations, findings = self.verify_text("**来源：**\n- Makefile:1\n\n**解读：** ok\n")
        self.assertEqual([item.path for item in citations], ["Makefile"])
        self.assertEqual(findings, [])

    def test_custom_english_evidence_marker_supports_root_file(self) -> None:
        citations, findings = self.verify_text("# Custom\n\nEvidence: `Makefile:1`, `vite.config.ts:1-2`\n\nInterpretation: both citations resolve.\n")
        self.assertEqual([item.path for item in citations], ["Makefile", "vite.config.ts"])
        self.assertEqual(findings, [])

    def test_punctuation_after_inline_citation_is_ignored(self) -> None:
        citations, findings = self.verify_text("**来源：**\n- `Makefile:1`.\n\n**解读：** ok\n")
        self.assertEqual([item.path for item in citations], ["Makefile"])
        self.assertEqual(findings, [])

    def test_absolute_parent_and_backslash_paths_are_rejected(self) -> None:
        absolute = (self.root / "src/core.py").as_posix()
        self.assertIn("ABSOLUTE_REFERENCE", self.finding_codes(f"**来源：**\n`{absolute}:1`\n"))
        self.assertIn("PARENT_REFERENCE", self.finding_codes("**来源：**\n`../src/core.py:1`\n"))
        self.assertIn("NON_PORTABLE_SEPARATOR", self.finding_codes("**来源：**\n`src\\core.py:1`\n"))

    def test_urls_endpoints_and_fenced_traces_are_not_scanned_as_citations(self) -> None:
        lines = """Outside evidence: `127.0.0.1:8000`, `example.com:443`, and `https://example.com/a.py:443`.

```text
path/to/trace.py:12
```
""".splitlines()
        citations, findings = verify_refs.extract(lines)
        self.assertEqual(citations, [])
        self.assertEqual(findings, [])

    def test_malformed_suffix_and_pdf_artifact_are_rejected(self) -> None:
        self.assertIn("MALFORMED_REFERENCE", self.finding_codes("**来源：**\n`src/core.py:1-`\n"))
        self.assertIn("MALFORMED_REFERENCE", self.finding_codes("**来源：**\n`src/core.py:1oops`\n"))
        self.assertIn("PDF_LINE_NUMBER_ARTIFACT", self.finding_codes("**来源：**\n`src/core.py:$1^9$`\n"))

    def test_unrelated_exponent_does_not_poison_valid_reference(self) -> None:
        self.assertNotIn("PDF_LINE_NUMBER_ARTIFACT", self.finding_codes("**来源：**\n`src/core.py:1` and $2^10$\n\n**解读：** ok\n"))

    def test_invalid_ranges_and_bounds_are_reported(self) -> None:
        self.assertIn("INVALID_RANGE", self.finding_codes("**来源：**\n`src/core.py:2-1`\n"))
        self.assertIn("RANGE_OUT_OF_BOUNDS", self.finding_codes("**来源：**\n`src/core.py:99`\n"))

    def test_clis_run_from_an_unrelated_working_directory(self) -> None:
        draft = self.root / "chapter.md"
        draft.write_text(VALID_CHAPTER, encoding="utf-8")
        unrelated_cwd = self.root / "work"
        unrelated_cwd.mkdir()
        environment = dict(os.environ, PYTHONDONTWRITEBYTECODE="1")

        lint_result = subprocess.run(
            [
                sys.executable,
                str(SCRIPT_DIR / "chapter_lint.py"),
                str(draft),
                "--document-kind",
                "chapter",
                "--contract",
                "textbook",
                "--json",
            ],
            cwd=unrelated_cwd,
            env=environment,
            capture_output=True,
            text=True,
            check=False,
        )
        self.assertEqual(lint_result.returncode, 0, lint_result.stderr)
        self.assertEqual(json.loads(lint_result.stdout)["findings"], [])
        self.assertNotIn(str(self.root), lint_result.stdout)

        verify_result = subprocess.run(
            [
                sys.executable,
                str(SCRIPT_DIR / "verify_source_refs.py"),
                str(draft),
                "--root",
                str(self.root),
                "--json",
            ],
            cwd=unrelated_cwd,
            env=environment,
            capture_output=True,
            text=True,
            check=False,
        )
        self.assertEqual(verify_result.returncode, 0, verify_result.stderr)
        self.assertEqual(json.loads(verify_result.stdout)["findings"], [])
        self.assertNotIn(str(self.root), verify_result.stdout)

    def test_verify_cli_requires_explicit_root(self) -> None:
        draft = self.root / "chapter.md"
        draft.write_text("**来源：**\n`src/core.py:1`\n", encoding="utf-8")
        result = subprocess.run(
            [sys.executable, str(SCRIPT_DIR / "verify_source_refs.py"), str(draft)],
            cwd=self.root,
            env=dict(os.environ, PYTHONDONTWRITEBYTECODE="1"),
            capture_output=True,
            text=True,
            check=False,
        )
        self.assertEqual(result.returncode, 2)

    def test_verify_cli_redacts_absolute_paths_from_json(self) -> None:
        draft = self.root / "chapter.md"
        absolute = (self.root / "src/core.py").as_posix()
        draft.write_text(f"**来源：**\n`{absolute}:1`\n", encoding="utf-8")
        result = subprocess.run(
            [sys.executable, str(SCRIPT_DIR / "verify_source_refs.py"), str(draft), "--root", str(self.root), "--json"],
            cwd=self.root,
            env=dict(os.environ, PYTHONDONTWRITEBYTECODE="1"),
            capture_output=True,
            text=True,
            check=False,
        )
        self.assertEqual(result.returncode, 1)
        self.assertNotIn(str(self.root), result.stdout)
        payload = json.loads(result.stdout)
        self.assertEqual(payload["citations"][0]["path"], "<absolute-path-redacted>")


if __name__ == "__main__":
    unittest.main()
