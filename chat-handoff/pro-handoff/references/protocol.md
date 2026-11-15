# pro-handoff/1.0

Use UTF-8 JSON and POSIX-style project-relative file paths. The [handoff schema](handoff.schema.json) and [response schema](pro-response.schema.json) describe the wire objects. The engine additionally checks cross-object references, digests, and state transitions.

## Exports

Each ZIP contains HANDOFF.json, START_HERE.md, PROMPT_FOR_PRO.md, context/, metadata/, protocol/, and the selected files under source/. HANDOFF.json binds the session, export, package type, scope, snapshot, and optional base. metadata/MANIFEST.json repeats the complete target snapshot's paths, byte counts and SHA-256 digests. The snapshot ID is the SHA-256 of the UTF-8 canonical JSON of this file mapping (keys sorted, no extra whitespace, ASCII escapes enabled). Full and recovery packages include all files in that manifest. A recovery package has no base and includes the current state, decision ledger and selected evidence history.

A delta names one Base Export ID and its Snapshot ID. Apply metadata/OPERATIONS.json to that exact manifest. Remove deleted paths and rename sources, then remove omitted paths from the active handoff scope. An omission means the path still exists or its absence could not be established. Add renamed destinations and overlay added and modified files. The ZIP carries added, modified and renamed destinations. A rename means a unique SHA-256 match between one proven deletion and one addition. An edited or ambiguous move is represented as a deletion and an addition. Verify the result against the complete target manifest. Read the current context even if the delta contains no source changes.

The local export registry distinguishes generated exports, explicit delivery via mark-sent, and Pro acknowledgments via import. The newest confirmed export by generation order is the next delta base. An older acknowledgment is retained without moving the base backward. Delta delivery requires that its base has been confirmed. A missing, corrupt or absent baseline cannot silently produce a delta.

## Responses

Return PRO_RESPONSE.json as defined by the schema. Copy the three binding IDs from HANDOFF.json and generate a fresh response ID. A Markdown response may contain human-readable prose and a single fenced JSON object using the same schema. The response is archived verbatim. Citations use project-relative paths and the digests from the target export manifest.

The engine rejects invalid structure, unknown exports, cross-session responses, and snapshot mismatches. It checks cited files against both the exported manifest and current disk, and labels older responses as historical. A citation absent from the declared export or carrying a different digest remains unverified across subsequent exports, even if that digest later matches the working tree. Claimed facts and requested work enter the state as findings or pending proposals. A local review records verified facts and accepted decisions. Conflict reports distinguish declared decision conflicts, conservative evidence-path overlaps, and stale or unverified evidence. Free-form recommendations are reviewed by Codex for semantic conflicts and can be recorded with the local review command.

## Local state

Each project's .pro-handoff/index.json maps names and UUIDs to session directories and records the active session. The checksummed session.json is the commit record. Immutable artifacts are written and verified before that record is atomically replaced. STATE.md and events.jsonl are rebuildable views of committed data. Under the per-project OS lock, the engine appends missing journal events or rebuilds an inconsistent projection after interruption. A crash before commit can leave unreferenced artifacts. A damaged commit record fails closed. Events, response files, export manifests and plans retain provenance without requiring STATE.md to grow by one transcript per turn.
