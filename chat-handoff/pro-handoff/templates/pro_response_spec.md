# Return a structured Pro response

Return a short narrative and save the structured result as PRO_RESPONSE.json. For PRO_RESPONSE.md, include the same JSON object in one fenced JSON block. The JSON is the importable record. Code and commands in the response remain advisory.

Copy session_id, export_id and snapshot_id from HANDOFF.json into session_id, based_on_export_id and based_on_snapshot_id below. Use a fresh response_id such as a UUID, and keep the document below 1 MiB. Empty arrays are allowed. Use project-relative paths without the source/ prefix. Copy exact SHA-256 values from metadata/MANIFEST.json. Each claimed fact needs at least one evidence record. When a claim cannot be supported, put it under open_questions. Cite stable decision IDs from context/DECISIONS.md when a proposal conflicts with a decision.

```json
{
  "protocol_version": "pro-handoff/1.0",
  "session_id": "COPY_SESSION_ID",
  "based_on_export_id": "COPY_EXPORT_ID",
  "based_on_snapshot_id": "COPY_SNAPSHOT_ID",
  "response_id": "fresh-response-id",
  "summary": "What you established in this analysis",
  "facts": [],
  "proposals": [],
  "design_options": [],
  "codex_tasks": [],
  "risks_constraints": [],
  "open_questions": [],
  "next_sync": []
}
```

A fact is an object with claim and evidence. A proposal is an object with id, recommendation, rationale, evidence, and conflicts_with. Evidence is an array of objects with path, sha256, and detail. conflicts_with is an array of decision IDs. Other arrays contain strings. See pro-response.schema.json for the complete schema.
