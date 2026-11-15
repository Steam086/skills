#!/usr/bin/env python3
"""Local pro-handoff engine. All commands run offline."""

import argparse
from pathlib import Path
import stat
import sys

from common import (ID, HandoffError, atomic_write, digest, json_bytes, new_id, parse_json,
                    require_text, terminal_text)
from exporter import prepare, publish
from importer import MAX_RESPONSE, import_report, matches, refresh_facts, review, saved_manifest
from scanner import discover, project
from selector import Limits, validate_plan
from session_store import Store, confirm_base, render_state
from validator import verify

MAX_PLAN = 4 * 1024 * 1024


def input_bytes(path, limit):
    if path == "-":
        data = sys.stdin.buffer.read(limit + 1)
    else:
        location = Path(path).expanduser()
        if not stat.S_ISREG(location.stat().st_mode):
            raise HandoffError("Input path must be a regular file. Use - for stdin.")
        with location.open("rb") as stream:
            data = stream.read(limit + 1)
    if len(data) > limit:
        raise HandoffError(f"Input exceeds {limit} bytes")
    return data


def parser():
    shared = argparse.ArgumentParser(add_help=False)
    shared.add_argument("--project", type=Path, default=argparse.SUPPRESS, help="project directory or Git subdirectory")
    shared.add_argument("--session", default=argparse.SUPPRESS, help="session name or ID")
    shared.add_argument("--json", action="store_true", default=argparse.SUPPRESS, help="machine-readable output")
    root = argparse.ArgumentParser(description=__doc__, parents=[shared])
    commands = root.add_subparsers(dest="command", required=True)

    def command(name, help_text):
        return commands.add_parser(name, parents=[shared], help=help_text)

    command("init", "create or activate a session").add_argument("--goal")
    command("status", "show active or selected session and local state")
    command("scan", "discover project files and Git status")
    for name in ("preview", "export", "recover"):
        export = command(name, "preview or publish a semantically planned ZIP")
        if name != "recover":
            export.add_argument("--type", choices=("full", "delta", "recovery"), default="full")
        export.add_argument("--plan", required=True, help="Handoff Plan JSON file or - for stdin")
        export.add_argument("--max-zip-bytes", type=int, default=Limits.max_zip_bytes)
        export.add_argument("--max-file-bytes", type=int, default=Limits.max_file_bytes)
        export.add_argument("--max-files", type=int, default=Limits.max_files)
        if name != "preview":
            authorization = export.add_mutually_exclusive_group()
            authorization.add_argument("--approve", metavar="PREVIEW_TOKEN")
            authorization.add_argument("--yes", action="store_true", help="explicit noninteractive first-export confirmation")
    command("mark-sent", "record delivery after the user uploads an export").add_argument("export_id")
    command("import-response", "archive a JSON or Markdown Pro response").add_argument("path", help="path or - for stdin")
    command("review", "apply a locally authored state review").add_argument("path", help="path or - for stdin")
    activate = command("use", "activate a session without creating one")
    activate.add_argument("name")
    check = command("verify", "verify archive integrity and replay any delta")
    check.add_argument("zip", type=Path)
    check.add_argument("--base-export-id", help="look up this base export in the selected local session")
    return root


def session_summary(state):
    result = {key: state[key] for key in (
        "session_id", "session_name", "goal", "git_head", "snapshot_id", "state_revision", "status",
        "latest_export_id", "confirmed_base_export_id", "latest_import_id", "created_at", "updated_at",
    )}
    result["exports"] = state["exports"]
    return result


def known_session(index, selector):
    return index["active"] if selector is None else (
        selector in index["sessions"] or selector in index["sessions"].values()
    )


def run(args, store):
    selector = getattr(args, "session", None)
    command = args.command
    if command == "scan":
        return {"project": str(store.root), "git": store.is_git, **discover(store.root, store.is_git)}
    if command == "verify" and not args.base_export_id:
        return verify(args.zip)
    write = command in {"init", "export", "recover"}
    with store.locked(create=write) as index:
        if command == "status":
            result = {"project": str(store.root), "active": index["active"], "sessions": index["sessions"]}
            if selector is not None or index["active"]:
                folder, state = store.select(index, selector)
                refresh_facts(store.root, folder, state)
                result.update(session=session_summary(state), state_file=str(folder / "STATE.md"),
                              current_state=render_state(state))
                prior = state["latest_export_id"]
                result["latest_plan_file"] = str(folder / "plans" / f"{prior}.json") if prior else None
                base = state["confirmed_base_export_id"]
                result["confirmed_base_plan_file"] = str(folder / "plans" / f"{base}.json") if base else None
                result["confirmed_base_manifest_file"] = (
                    str(folder / "snapshots" / f"{state['exports'][base]['snapshot_id']}.json") if base else None
                )
                latest = state["latest_import_id"]
                result["latest_import_review"] = str(folder / "responses" / state["imports"][latest]["review"]) if latest else None
            return result
        if command == "init":
            goal = require_text(args.goal, "goal") if args.goal is not None else None
            _, state = store.select(index, selector, create=True, goal=goal)
            store.activate(index, state["session_id"])
            return session_summary(state)
        if command == "use":
            _, state = store.select(index, args.name)
            store.activate(index, state["session_id"])
            return session_summary(state)
        if command in {"preview", "export", "recover"}:
            plan = validate_plan(parse_json(input_bytes(args.plan, MAX_PLAN)))
            limits = Limits(args.max_zip_bytes, args.max_file_bytes, args.max_files)
            folder, state = store.select(index, selector) if known_session(index, selector) else (None, None)
            if state is None and selector is not None and ID.fullmatch(selector):
                raise HandoffError(f"Unknown session ID {selector}")
            requested = "recovery" if command == "recover" else args.type
            prepared = prepare(store.root, store.is_git, folder, state, plan, limits, requested,
                               session_name=selector or "default")
            result = prepared[0]
            if command == "preview":
                return result
            if args.approve and args.approve != result["preview_token"]:
                raise HandoffError("Preview changed. Generate a new preview and confirm its current token.")
            if result["preview_required"] and not (args.approve or args.yes):
                raise HandoffError("First export requires preview and --approve TOKEN, or explicit --yes")
            if state is None:
                folder, state = store.select(index, selector, create=True, goal=plan["goal"])
            result = publish(store, folder, state, plan, limits, prepared)
            store.activate(index, state["session_id"])
            return result

        folder, state = store.select(index, selector)
        if command == "mark-sent":
            ident = matches(args.export_id, ID, "export ID")
            if ident not in state["exports"]:
                raise HandoffError(f"Unknown export {ident}")
            record = state["exports"][ident]
            if "user_sent" not in record["delivery"]:
                archive = folder / "exports" / f"{ident}.zip"
                if archive.is_symlink() or digest(archive.read_bytes()) != record["sha256"]:
                    raise HandoffError("Export file failed integrity check")
                confirm_base(state, ident, "user_sent")
                store.commit(folder, state, "mark-sent", {"export_id": ident})
            return session_summary(state)
        if command == "import-response":
            result = import_report(store.root, folder, state, input_bytes(args.path, MAX_RESPONSE))
            if not result.get("duplicate"):
                store.commit(folder, state, "import", {"response_id": result["response_id"],
                                                      "export_id": result["export_id"]})
            return result
        if command == "review":
            raw = input_bytes(args.path, MAX_PLAN)
            review(store.root, folder, state, parse_json(raw))
            ident = new_id()
            atomic_write(folder / "reviews" / f"{ident}.json", raw)
            state["reviews"][ident] = digest(raw)
            store.commit(folder, state, "review", {"review_id": ident})
            return session_summary(state)
        ident = matches(args.base_export_id, ID, "base export ID")
        record = state["exports"].get(ident)
        if not record or not record["delivery"]:
            raise HandoffError(f"No confirmed base export {ident} in the selected session")
        return verify(args.zip, base=saved_manifest(folder, record["snapshot_id"]), base_export_id=ident)


def report_output(result, args):
    if not getattr(args, "json", False) and "zip" in result:
        print(terminal_text(f"{result['type']} ZIP: {result['zip']}\n"
                            f"{result['source_file_count']} source files in ZIP, "
                            f"{result['snapshot_file_count']} in target snapshot, "
                            f"{result['zip_bytes']:,} compressed bytes\n"
                            f"Prompt file: {result['prompt_file']}\nExport ID: {result['export_id']}"))
        if result["type"] != result["requested_type"]:
            print("No confirmed delta baseline. Produced a standalone full export.")
        print("Exclusions:", json_bytes(result["exclusion_counts"]).decode().strip())
        print("Coverage gaps:", json_bytes(result["coverage_gaps"]).decode().strip())
        print()
        print(terminal_text(result["prompt"]), end="")
    else:
        sys.stdout.buffer.write(json_bytes(result))


def main(argv=None):
    args = parser().parse_args(argv)
    try:
        root, is_git = project(getattr(args, "project", Path.cwd()))
        store = Store(root, is_git)
        result = run(args, store)
        if store.warning:
            print(terminal_text(store.warning), file=sys.stderr)
        report_output(result, args)
        return 0
    except (HandoffError, OSError) as error:
        print(terminal_text(f"pro-handoff: {error}"), file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
