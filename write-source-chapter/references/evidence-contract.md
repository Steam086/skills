# Evidence contract

Evidence is part of the explanation, not decorative attribution. The objective is reproducibility: another reader should be able to open the same revision and verify the claim quickly.

## Establish the baseline

- Use the revision named by the user. Otherwise use the current worktree and account for uncommitted changes.
- Do not combine line ranges from different revisions without saying so.
- If repository source is unavailable, narrow the claim or state the limitation; never fabricate a location.
- Verify citations again near delivery because edits can move lines.
- Keep citations repository-relative. Do not publish host-specific checkout roots, home directories, virtual-environment locations, interpreter paths, or temporary paths as source evidence.

## Inspect complementary evidence

Follow the claim through the evidence types it actually needs:

- public declarations establish available types and contracts;
- implementations establish realized behavior and call edges;
- tests establish exercised behavior and boundary cases;
- configuration/build files establish defaults, feature gates, and wiring;
- design documents and comments may establish stated intent;
- benchmarks establish measurements only under their recorded environment.

No single type is universally authoritative. For example, a declaration can show an API exists but usually cannot prove its full runtime behavior; a test can show one exercised case but not all possible behavior.

## Citation format

Use repository-relative paths and verified integer line ranges:

```markdown
**来源：**
- `path/to/public-interface:42-79`
- `path/to/implementation:115-168`
- `path/to/behavior-test:210-247`
```

Use a single line as `path:42`; use a range as `path:42-79`. Prefer the smallest span that contains the relevant symbol or behavior. Split unrelated evidence into separate citations instead of citing a huge range.

Put each citation token in inline code, including root-level extensionless files and paths containing spaces, for example `` `Makefile:12-28` `` or `` `docs/design notes.md:40-63` ``. Use `/` as the separator in the published repository-relative path on every host. Do not use absolute paths, `..`, backslashes, URLs, or a path relative to the chapter file.

Place citations under a `来源：` marker (or a semantically equivalent `Source:` / `Evidence:` marker in a user-defined format). This makes root-level names and other tokens mechanically unambiguous and keeps the evidence scope clear.

Do not cite:

- a whole file when precise lines are available;
- generated-looking or malformed line values;
- a declaration as proof that a particular implementation path always executes;
- a test name as proof of behavior without inspecting the assertions;
- a performance number without its workload and environment source.

If paths or line numbers in imported documentation are broken, resolve them against the repository. If they cannot be verified, omit or explicitly flag them.

## Claim-to-evidence discipline

Place a source marker close enough that its scope is unambiguous. One citation block may support several tightly related sentences; it should not silently cover an entire long section with unrelated claims.

For important entities—types, functions, modules, rules, jobs, schemas, components, or transformations—explain only the applicable dimensions:

- responsibility and entry, caller, trigger, or upstream dependency;
- inputs, outputs, and error channel;
- side effects and important internal calls;
- ownership, scope, persistence, or lifetime;
- synchronization, ordering, consistency, or execution-context constraints;
- behavior at boundaries.

When stating an ordered call path, verify every important edge. Do not infer a call merely because compatible methods exist.

## Separate fact from interpretation

Use this distinction:

```markdown
<Source fact: what the code, test, configuration, or design document shows.>

**来源：**
`path/to/core-mechanism:88-134`

**解读：**
<What this implies for architecture, correctness, cost, or operation.>
```

An interpretation is supported when it follows from the evidence, but it is not necessarily the authors' stated intention. Use an explicit qualifier when intent or causality is not directly documented:

```markdown
**推断：** 这种拆分可能用于缩短临界区；源码显示锁的边界，但未直接说明设计动机。
```

Use calibrated wording such as `表明`, `与……一致`, `可能`, or `在该条件下` instead of upgrading evidence into certainty.

## Code, tables, and numbers

- Quote only the lines needed to explain a decision; abbreviate unrelated bodies without changing semantics.
- Explain the behavior after a code excerpt rather than translating it line by line.
- Every comparison table must use comparable dimensions and source each non-obvious value.
- For metrics, include units, aggregation/percentile, hardware, concurrency/workload, baseline, and revision when available.
- Distinguish constants/defaults from runtime-effective values and theoretical limits from measured results.

## When evidence is incomplete

Choose one of three honest outcomes:

1. narrow the claim to what is demonstrated;
2. mark a bounded inference and state the missing evidence;
3. omit the claim.

Do not hide uncertainty in confident explanatory prose.
