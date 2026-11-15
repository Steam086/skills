"""Import untrusted advisory reports. Local review owns verified knowledge."""

import re

from common import (HASH, ID, LABEL, HandoffError, PROTOCOL, atomic_write, canonical,
                    digest, fields, json_bytes, load, new_id, parse_json, require_text, safe_path, text_list)
from scanner import current_hash, policy
from selector import safe_text
from session_store import confirm_base
from snapshot import snapshot_id, validate_manifest

MAX_RESPONSE = 1024 * 1024
EVIDENCE_LIMIT = 32 * 1024 * 1024
UNBOUND_EVIDENCE = {"outside_export_scope", "hash_differs_from_export"}
LISTS = ("design_options", "codex_tasks", "risks_constraints", "open_questions", "next_sync")
RESPONSE_KEYS = ("protocol_version", "session_id", "based_on_export_id", "based_on_snapshot_id",
                 "response_id", "summary", "facts", "proposals", *LISTS)
FENCE = re.compile(r"^[ ]{0,3}(\x60{3,}|~{3,})[ \t]*([^\r\n]*?)\s*\r?$", re.MULTILINE)


def matches(value, regex, name):
    if not isinstance(value, str) or not regex.fullmatch(value):
        raise HandoffError(f"Invalid {name}")
    return value


def parse_response(raw):
    if len(raw) > MAX_RESPONSE:
        raise HandoffError("Response exceeds 1 MiB")
    try:
        body = raw.decode("utf-8-sig").strip()
    except UnicodeError as error:
        raise HandoffError("Response must be UTF-8") from error
    if not body.startswith("{"):
        blocks = []
        fence = None
        for match in FENCE.finditer(body):
            if fence is None:
                fence = match
            elif (not match[2] and match[1][0] == fence[1][0]
                  and len(match[1]) >= len(fence[1])):
                candidate = body[fence.end():match.start()].strip()
                language = fence[2].lower()
                if language == "json" or (not language and candidate.startswith("{")):
                    blocks.append(candidate)
                fence = None
        if len(blocks) != 1:
            raise HandoffError("Provide a JSON object or Markdown with exactly one fenced JSON object")
        body = blocks[0]
    report = parse_json(body.encode())
    fields(report, RESPONSE_KEYS, name="response")
    if report["protocol_version"] != PROTOCOL:
        raise HandoffError(f"Unsupported response protocol {report['protocol_version']!r}")
    for name in ("session_id", "based_on_export_id"):
        matches(report[name], ID, name)
    matches(report["based_on_snapshot_id"], HASH, "based_on_snapshot_id")
    matches(report["response_id"], LABEL, "response_id")
    require_text(report["summary"], "summary")
    for key in LISTS:
        text_list(report[key], key)
    for key in ("facts", "proposals"):
        if not isinstance(report[key], list) or len(report[key]) > 100:
            raise HandoffError(f"{key} must be an array of up to 100 items")
    for fact in report["facts"]:
        fields(fact, ("claim", "evidence"), name="fact")
        require_text(fact["claim"], "fact claim")
        validate_evidence(fact["evidence"], required=True)
    seen = set()
    for proposal in report["proposals"]:
        fields(proposal, ("id", "recommendation", "rationale", "evidence", "conflicts_with"), name="proposal")
        ident = matches(proposal["id"], LABEL, "proposal ID")
        if ident in seen:
            raise HandoffError(f"Duplicate proposal ID {ident}")
        seen.add(ident)
        for key in ("recommendation", "rationale"):
            require_text(proposal[key], key)
        validate_evidence(proposal["evidence"])
        for ident in text_list(proposal["conflicts_with"], "conflicts_with"):
            matches(ident, LABEL, "conflicting decision ID")
    return report


def validate_evidence(evidence, required=False):
    if not isinstance(evidence, list) or len(evidence) > 100 or (required and not evidence):
        raise HandoffError("Invalid evidence list")
    for entry in evidence:
        fields(entry, ("path", "sha256", "detail"), name="evidence")
        safe_path(entry["path"])
        matches(entry["sha256"], HASH, "evidence hash")
        require_text(entry["detail"], "evidence detail")


def saved_manifest(folder, ident):
    matches(ident, HASH, "snapshot ID")
    path = folder / "snapshots" / f"{ident}.json"
    if path.is_symlink():
        raise HandoffError("Unsafe snapshot record")
    files = load(path)
    validate_manifest(files)
    if snapshot_id(files) != ident:
        raise HandoffError("Snapshot manifest checksum mismatch")
    return files


def inspect_evidence(root, entries, exported, cache):
    results = []
    for entry in entries:
        path = entry["path"]
        base = exported.get(path, {}).get("sha256")
        if base is None:
            status = "outside_export_scope"
        elif base != entry["sha256"]:
            status = "hash_differs_from_export"
        else:
            if path not in cache:
                cache[path] = current_hash(root, path, EVIDENCE_LIMIT)
            local, unavailable = cache[path]
            if unavailable:
                status = "missing" if unavailable == "missing from working tree" else "unavailable"
            else:
                status = "changed" if local != base else "matches_export"
        results.append({"path": path, "status": status})
    return results


def has_unbound_evidence(entries, exported):
    return any(exported.get(entry["path"], {}).get("sha256") != entry["sha256"] for entry in entries)


def import_report(root, folder, state, raw):
    report = parse_response(raw)
    if report["session_id"] != state["session_id"]:
        raise HandoffError("Response Session ID does not match the selected session")
    export_id = report["based_on_export_id"]
    if export_id not in state["exports"]:
        raise HandoffError("Response refers to an unknown export")
    snapshot = state["exports"][export_id]["snapshot_id"]
    if snapshot != report["based_on_snapshot_id"]:
        raise HandoffError("Response refers to a different or stale snapshot for this export")
    ident = report["response_id"]
    normalized = digest(canonical(report))
    if ident in state["imports"]:
        if state["imports"][ident]["sha256"] != normalized:
            raise HandoffError("Response ID has already been used for different content")
        return {"duplicate": True, "response_id": ident}
    content_id = digest(canonical({key: value for key, value in report.items() if key != "response_id"}))
    for prior, entry in state["imports"].items():
        if entry["content_id"] == content_id:
            return {"duplicate": True, "response_id": prior}

    exported = saved_manifest(folder, snapshot)
    reference = state["confirmed_base_export_id"] or state["latest_export_id"]
    historical = state["exports"][export_id]["revision"] < state["exports"][reference]["revision"]
    confirmed = {item["id"]: item for item in state["knowledge"]["accepted_decisions"]}
    details = {"response_id": ident, "export_id": export_id, "historical": historical,
               "facts": [], "proposals": [], "codex_tasks": report["codex_tasks"],
               "risks_constraints": report["risks_constraints"], "open_questions": report["open_questions"],
               "next_sync": report["next_sync"]}
    cache = {}
    knowledge = state["knowledge"]
    for index, fact in enumerate(report["facts"], 1):
        evidence = inspect_evidence(root, fact["evidence"], exported, cache)
        knowledge["pro_findings"].append({
            "id": f"{ident}/fact/{index}", "text": fact["claim"], "source": ident,
            "evidence": fact["evidence"],
            "unbound_evidence": any(row["status"] in UNBOUND_EVIDENCE for row in evidence),
            "stale": any(item["status"] != "matches_export" for item in evidence),
        })
        details["facts"].append({"claim": fact["claim"], "evidence": evidence})
    for proposal in report["proposals"]:
        evidence = inspect_evidence(root, proposal["evidence"], exported, cache)
        paths = {entry["path"] for entry in proposal["evidence"]}
        declared = sorted(set(proposal["conflicts_with"]) & confirmed.keys())
        overlaps = sorted(
            ident for ident, decision in confirmed.items()
            if ident not in declared and paths & {entry["path"] for entry in decision.get("evidence", [])}
        )
        stale = any(item["status"] != "matches_export" for item in evidence)
        details["proposals"].append({
            "id": proposal["id"], "recommendation": proposal["recommendation"],
            "evidence": evidence, "stale_evidence": stale, "declared_conflicts": declared,
            "potential_conflicts": overlaps,
            "unknown_conflict_ids": sorted(set(proposal["conflicts_with"]) - confirmed.keys()),
        })
        reason = proposal["rationale"]
        if declared or overlaps:
            reason += "\nReview conflicts with: " + ", ".join(declared + overlaps)
        knowledge["pending_proposals"].append({
            "id": f"{ident}/proposal/{proposal['id']}", "text": proposal["recommendation"],
            "reason": reason, "source": ident, "evidence": proposal["evidence"], "stale": stale,
            "unbound_evidence": any(row["status"] in UNBOUND_EVIDENCE for row in evidence),
        })
    for index, task in enumerate(report["codex_tasks"], 1):
        knowledge["pending_proposals"].append({
            "id": f"{ident}/task/{index}", "text": task, "source": ident,
            "reason": "Pro requested local work. Local review required.",
        })
    for key, label in (("open_questions", "Pro open question"), ("next_sync", "Pro next sync request")):
        for index, text in enumerate(report[key], 1):
            knowledge["pro_findings"].append({
                "id": f"{ident}/{key}/{index}", "text": text, "source": ident, "reason": label,
            })
    extension = "json" if raw.lstrip().lstrip(b"\xef\xbb\xbf").startswith(b"{") else "md"
    # A generated name avoids platform-dependent collisions between remote response IDs.
    archive_id = new_id()
    confirm_base(state, export_id, "pro_acknowledged")
    atomic_write(folder / "responses" / f"{archive_id}.{extension}", raw)
    atomic_write(folder / "responses" / f"{archive_id}.review.json", json_bytes(details))
    state["imports"][ident] = {
        "sha256": normalized, "content_id": content_id, "raw_sha256": digest(raw),
        "artifact": f"{archive_id}.{extension}", "review": f"{archive_id}.review.json",
        "export_id": export_id, "historical": historical,
    }
    state["latest_import_id"] = ident
    return details


def refresh_facts(root, folder, state):
    current_hashes, snapshots = {}, {}
    knowledge = state["knowledge"]
    for key in ("verified_facts", "accepted_decisions", "pro_findings", "pending_proposals"):
        for item in knowledge[key]:
            entries = item.get("evidence")
            if not entries:
                continue
            source = item.get("source")
            if source and "unbound_evidence" not in item:
                # Restore the export binding for records written by earlier versions.
                export = state["imports"][source]["export_id"]
                ident = state["exports"][export]["snapshot_id"]
                if ident not in snapshots:
                    try:
                        snapshots[ident] = saved_manifest(folder, ident)
                    except (OSError, HandoffError):
                        # A damaged or absent manifest cannot validate old citations.
                        snapshots[ident] = None
                exported = snapshots[ident]
                if exported is not None:
                    item["unbound_evidence"] = has_unbound_evidence(entries, exported)
            if source and item.get("unbound_evidence", True):
                item["stale"] = True
                continue
            for evidence in entries:
                path = evidence["path"]
                if path not in current_hashes:
                    current_hashes[path] = current_hash(root, path, EVIDENCE_LIMIT)[0]
            item["stale"] = any(current_hashes[row["path"]] != row["sha256"] for row in entries)


def review(root, folder, state, data):
    """A locally authored edit, independent from the Pro response format."""
    local_lists = ("implementation_status", "open_questions", "next_actions")
    keys = ("verified_facts", "accepted_decisions", "supersede", "resolve", "conflicts", *local_lists)
    fields(data, (), keys, name="local review")
    if not data:
        raise HandoffError("Review has no updates")
    knowledge = state["knowledge"]
    for key in local_lists:
        if key in data:
            knowledge[key] = text_list(data[key], key)
            for item in knowledge[key]:
                safe_text(item, key)
    for key in ("verified_facts", "accepted_decisions"):
        entries = data.get(key, [])
        if not isinstance(entries, list) or len(entries) > 100:
            raise HandoffError(f"{key} must be a list of up to 100 entries")
        previous = {item["id"]: item for item in knowledge[key]}
        for item in entries:
            fields(item, ("id", "text", "evidence"), ("reason",), name=key)
            ident = matches(item["id"], LABEL, "local item ID")
            if key == "accepted_decisions" and any(row["id"] == ident for row in knowledge["superseded_decisions"]):
                raise HandoffError(f"Decision ID {ident} has been superseded; use a fresh ID")
            if key == "accepted_decisions" and ident in previous and previous[ident]["text"] != item["text"]:
                raise HandoffError(f"Supersede changed decision {ident} and use a fresh ID")
            safe_text(require_text(item["text"], "local review text"), key)
            if "reason" in item:
                safe_text(require_text(item["reason"], "review reason"), key)
            validate_evidence(item["evidence"], required=key == "verified_facts")
            for evidence in item["evidence"]:
                if policy(evidence["path"]):
                    raise HandoffError(f"Restricted review evidence: {evidence['path']}")
                safe_text(evidence["path"], "review evidence path")
                safe_text(evidence["detail"], "review evidence detail")
                if current_hash(root, evidence["path"], EVIDENCE_LIMIT)[0] != evidence["sha256"]:
                    raise HandoffError(f"Review evidence is stale or unavailable: {evidence['path']}")
            previous[ident] = item.copy()
        knowledge[key] = list(previous.values())
    supersede = data.get("supersede", {})
    fields(supersede, (), [item["id"] for item in knowledge["accepted_decisions"]], name="decisions to supersede")
    for item in list(knowledge["accepted_decisions"]):
        if item["id"] in supersede:
            reason = require_text(supersede[item["id"]], "supersession reason")
            safe_text(reason, "supersession reason")
            knowledge["accepted_decisions"].remove(item)
            knowledge["superseded_decisions"].append({**item, "reason": reason})
    resolve = set(text_list(data.get("resolve", []), "resolved item IDs"))
    conflicts = data.get("conflicts", {})
    pending = {item["id"]: item for key in ("pending_proposals", "pro_findings") for item in knowledge[key]}
    if resolve - pending.keys():
        raise HandoffError("Unknown item to resolve")
    fields(conflicts, (), pending.keys(), name="reviewed conflicts")
    for ident, reason in conflicts.items():
        safe_text(require_text(reason, "conflict reason"), "conflict reason")
        pending[ident]["reason"] = reason
    for key in ("pending_proposals", "pro_findings"):
        knowledge[key] = [item for item in knowledge[key] if item["id"] not in resolve]
    refresh_facts(root, folder, state)
